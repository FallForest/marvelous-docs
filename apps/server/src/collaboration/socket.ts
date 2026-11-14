import type { IncomingMessage, Server } from 'node:http'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDocumentAccess } from '../domain/access.js'
import { flushRoom, getRoom, queueDocumentOperation, rooms } from './rooms.js'
import { encodeAwareness, encodeSyncStep1, encodeSyncStep2, AWARENESS_MESSAGE, SYNC_MESSAGE } from './protocol.js'
import type { Claims, Room } from '../core/types.js'

const uuidSchema = z.string().uuid()

/**
 * How stale a socket's write permission may get before it is rechecked.
 *
 * Long enough that ordinary typing never pays for a query, short enough that an
 * administrator revoking access takes effect while the person is still on the
 * page. The ACL edit also closes the sockets it affects immediately; this is the
 * backstop for the paths that cannot (membership removal, a folder inherited
 * restriction that changed three levels up).
 */
const ACCESS_RECHECK_MS = 60 * 1000

/** How long a recheck may wait for the database before the write is allowed. */
const ACCESS_RECHECK_TIMEOUT_MS = 2000

/**
 * y-websocket endpoint.
 *
 * The upgrade is authenticated with the same JWT as the REST API; a room is
 * only handed out to workspace members holding at least viewer access to the
 * document. Viewers may publish awareness but not document updates.
 */

function rejectUpgrade(socket: import('node:stream').Duplex, status: number, message: string) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  socket.destroy()
}

/**
 * True when the frame is a `sync-step-1`: a state-vector exchange that only reads.
 *
 * Decoding is cheap (a varuint and a flag) and happens before the queue, which is
 * the whole point - deciding inside the queue would defeat it.
 */
function isReadOnlySync(data: RawData): boolean {
  try {
    const decoder = decoding.createDecoder(messageBytes(data))
    if (decoding.readVarUint(decoder) !== SYNC_MESSAGE) return false
    return decoding.readVarUint(decoder) === syncProtocol.messageYjsSyncStep1
  } catch { return false }
}

function messageBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return data
}

/** Wires one accepted socket into a room and replays the current state to it. */
export function attachCollaborationSocket(ws: WebSocket, room: Room, user: Claims, canWrite: boolean) {
  const clientState = { userId: user.sub, canWrite, clientIds: new Set<number>() }
  /**
   * Permission is re-read while a socket lives, not only at the handshake.
   *
   * `canWrite` used to be a snapshot taken during the upgrade, so demoting an
   * editor to viewer left their open connection writing until they happened to
   * reconnect - the revocation existed in the database and nowhere else. A
   * recheck costs one indexed query and only runs when the socket actually
   * tries to write, so a viewer who never types never pays for it.
   */
  const accessCheckedAt = { value: Date.now() }
  async function canStillWrite() {
    if (!clientState.canWrite) return false
    if (Date.now() - accessCheckedAt.value < ACCESS_RECHECK_MS) return true
    accessCheckedAt.value = Date.now()
    /*
     * Time-boxed on purpose. The check runs inside the per-document queue, and a
     * slow or wedged database would otherwise stop both this socket's edits and
     * every other operation queued for the document. A timeout is treated as
     * "still allowed": the alternative is to cut a writer off because the
     * database was briefly busy, which loses work for the wrong reason. The ACL
     * endpoint closes affected sockets immediately, so this stays a backstop.
     */
    const access = await Promise.race([
      getDocumentAccess(user, room.id).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ACCESS_RECHECK_TIMEOUT_MS).unref?.()),
    ])
    if (access === null) return true
    if (!access || access.role === 'none' || access.role === 'viewer') {
      clientState.canWrite = false
      // 4003 is "gone for good" in our vocabulary: the client stops retrying
      // instead of reconnecting into the same refusal.
      ws.close(4003, 'Permission revoked')
      return false
    }
    return true
  }
  room.clients.set(ws, clientState)
  if (room.disposeTimer) { clearTimeout(room.disposeTimer); room.disposeTimer = undefined }

  ws.on('message', (data) => {
    /*
     * Sync step 1 is a read and does not queue.
     *
     * `sync-step-1` carries the client's state vector and is answered from memory;
     * it touches neither the database nor the per-document write queue. Routing it
     * through that queue meant a client joining while somebody's save was in flight
     * waited for the save before it could receive the document at all - a slow
     * commit showed up as "the editor will not open", which is the wrong symptom for
     * the cause. Everything that can write still queues, because the queue is what
     * keeps a restore, a REST write and a websocket update from interleaving.
     */
    if (isReadOnlySync(data as RawData)) {
      try {
        const bytes = messageBytes(data as RawData)
        const decoder = decoding.createDecoder(bytes)
        // `readSyncMessage` needs a writable encoder even for a step-1 it will not
        // answer into; the reply is built explicitly so this path cannot mutate the
        // document.
        const encoder = encoding.createEncoder()
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws)
        ws.send(encodeSyncStep2(room.doc))
      } catch { /* a malformed frame is dropped like any other */ }
      return
    }
    void queueDocumentOperation(room.id, async () => {
    try {
      const bytes = messageBytes(data as RawData)
      const decoder = decoding.createDecoder(bytes)
      const messageType = decoding.readVarUint(decoder)
      if (messageType === SYNC_MESSAGE) {
        const typeDecoder = decoding.createDecoder(bytes)
        decoding.readVarUint(typeDecoder)
        const syncType = decoding.readVarUint(typeDecoder)
        // Read-only peers get the authoritative state instead of an ack.
        if (!clientState.canWrite && syncType !== syncProtocol.messageYjsSyncStep1) {
          ws.send(encodeSyncStep2(room.doc))
          return
        }
        // A write has to pass the recheck; a read (sync step 1) never does.
        if (syncType !== syncProtocol.messageYjsSyncStep1 && !await canStillWrite()) {
          ws.send(encodeSyncStep2(room.doc))
          return
        }
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, SYNC_MESSAGE)
        if (clientState.canWrite && syncType !== syncProtocol.messageYjsSyncStep1) room.lastActor = user.sub
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws)
        if (encoding.length(encoder) > 1 && ws.readyState === WebSocket.OPEN) ws.send(encoding.toUint8Array(encoder))
      } else if (messageType === AWARENESS_MESSAGE) {
        awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), ws)
      }
    } catch (error) {
      room.clients.delete(ws)
      ws.close(1003, 'Invalid collaboration message')
      void error
    }
    }).catch(() => { ws.close(1011, 'Collaboration update failed') })
  })

  ws.on('close', () => {
    awarenessProtocol.removeAwarenessStates(room.awareness, [...clientState.clientIds], ws)
    room.clients.delete(ws)
    if (room.clients.size === 0) {
      void flushRoom(room).catch(() => undefined)
      room.disposeTimer = setTimeout(() => {
        void flushRoom(room).then(() => {
          if (room.clients.size === 0 && !room.dirty) {
            rooms.delete(room.id)
            room.awareness.destroy()
            room.doc.destroy()
          }
        }).catch(() => undefined)
      }, 5 * 60 * 1000)
    }
  })

  ws.send(encodeSyncStep1(room.doc))
  const states = room.awareness.getStates()
  if (states.size) ws.send(encodeAwareness(room.awareness, [...states.keys()]))
}

/** Registers the /collab/:id upgrade handler on the dedicated collaboration server. */
export function registerUpgradeHandler(wsHttpServer: Server, app: FastifyInstance) {
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 })

  wsHttpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
    void (async () => {
      const url = new URL(request.url || '/', 'http://localhost')
      const match = /^\/collab\/([^/]+)\/?$/.exec(url.pathname)
      if (!match) return rejectUpgrade(socket, 404, 'Not Found')

      const documentId = decodeURIComponent(match[1])
      if (!uuidSchema.safeParse(documentId).success) return rejectUpgrade(socket, 400, 'Bad Request')

      const bearer = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
      const token = url.searchParams.get('token') || bearer
      if (!token) return rejectUpgrade(socket, 401, 'Unauthorized')

      let user: Claims
      try { user = app.jwt.verify<Claims>(token) }
      catch { return rejectUpgrade(socket, 401, 'Unauthorized') }
      if (!user.sub || !user.workspaceId) return rejectUpgrade(socket, 401, 'Unauthorized')

      const access = await getDocumentAccess(user, documentId)
      if (!access || access.role === 'none') return rejectUpgrade(socket, access ? 403 : 404, access ? 'Forbidden' : 'Not Found')

      const room = await getRoom(documentId)
      wsServer.handleUpgrade(request, socket, head, (ws) => {
        void attachCollaborationSocket(ws, room, user, access.role !== 'viewer')
      })
    })().catch((error) => {
      app.log.error(error, 'Collaboration websocket upgrade failed')
      if (!socket.destroyed) rejectUpgrade(socket, 500, 'Internal Server Error')
    })
  })

  return wsServer
}
