import type { IncomingMessage, Server } from 'node:http'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDocumentAccess } from '../domain/access.js'
import { flushRoom, getRoom, rooms } from './rooms.js'
import { encodeAwareness, encodeSyncStep1, encodeSyncStep2, AWARENESS_MESSAGE, SYNC_MESSAGE } from './protocol.js'
import type { Claims, Room } from '../core/types.js'

const uuidSchema = z.string().uuid()

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

function messageBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return data
}

/** Wires one accepted socket into a room and replays the current state to it. */
export function attachCollaborationSocket(ws: WebSocket, room: Room, user: Claims, canWrite: boolean) {
  const clientState = { userId: user.sub, canWrite, clientIds: new Set<number>() }
  room.clients.set(ws, clientState)
  if (room.disposeTimer) { clearTimeout(room.disposeTimer); room.disposeTimer = undefined }

  ws.on('message', (data) => {
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
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, SYNC_MESSAGE)
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
  })

  ws.on('close', () => {
    awarenessProtocol.removeAwarenessStates(room.awareness, [...clientState.clientIds], ws)
    room.clients.delete(ws)
    if (room.clients.size === 0) {
      void flushRoom(room)
      room.disposeTimer = setTimeout(() => {
        void flushRoom(room).finally(() => {
          if (room.clients.size === 0) {
            rooms.delete(room.id)
            room.awareness.destroy()
            room.doc.destroy()
          }
        })
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
