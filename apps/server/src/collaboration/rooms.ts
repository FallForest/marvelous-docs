import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import { prosemirrorToYXmlFragment } from 'y-prosemirror'
import { WebSocket } from 'ws'
import type { FastifyBaseLogger } from 'fastify'
import { pool } from '../core/db.js'
import { schema } from '../lib/schema.js'
import { createYDoc, contentFromYDoc, roomField, yState } from './ydoc.js'
import { encodeAwareness, encodeSyncUpdate } from './protocol.js'
import type { Room } from '../core/types.js'

/**
 * In-memory collaboration rooms.
 *
 * A room is created on first join, kept in memory, and evicted five minutes
 * after the last client leaves. PostgreSQL always stays the durable copy, so
 * every REST read flushes the pending room state first.
 */

export const rooms = new Map<string, Room>()
const roomLoads = new Map<string, Promise<Room>>()

type Logger = Pick<FastifyBaseLogger, 'error' | 'warn' | 'info'>

let log: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
} as unknown as Logger

/** The API installs its Fastify logger once, at startup. */
export function setRoomLogger(next: Logger) {
  log = next
}

function broadcast(room: Room, message: Uint8Array) {
  for (const client of room.clients.keys()) {
    if (client.readyState === WebSocket.OPEN) client.send(message)
  }
}

/** Returns the live room for a document, loading it on first join. */
export async function getRoom(documentId: string): Promise<Room> {
  const existing = rooms.get(documentId)
  if (existing) return existing
  const pending = roomLoads.get(documentId)
  if (pending) return pending
  const loading = loadRoom(documentId)
  roomLoads.set(documentId, loading)
  try { return await loading } finally { roomLoads.delete(documentId) }
}

async function loadRoom(documentId: string): Promise<Room> {
  const result = await pool.query('SELECT id,kind,content,yjs_state FROM documents WHERE id=$1', [documentId])
  if (!result.rowCount) throw new Error('Document disappeared while opening collaboration room.')
  if (result.rows[0].kind !== 'document') throw new Error('Folders do not support collaborative editing.')

  let doc: Y.Doc
  if (result.rows[0].yjs_state) {
    doc = new Y.Doc()
    Y.applyUpdate(doc, new Uint8Array(result.rows[0].yjs_state))
  } else {
    doc = createYDoc((result.rows[0].content as { doc: unknown }).doc)
    await pool.query('UPDATE documents SET yjs_state=$2 WHERE id=$1 AND yjs_state IS NULL', [documentId, yState(doc)])
  }

  const awareness = new awarenessProtocol.Awareness(doc)
  awareness.setLocalState(null)
  const room: Room = {
    id: documentId,
    doc,
    awareness,
    clients: new Map(),
    saveQueue: Promise.resolve(),
    suppressSave: false,
    dirty: false,
    changeSeq: 0,
  }

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    broadcast(room, encodeSyncUpdate(update))
    if (room.suppressSave) return
    const actor = origin instanceof WebSocket ? room.clients.get(origin)?.userId : undefined
    room.dirty = true
    room.changeSeq++
    room.lastActor = actor || room.lastActor
    scheduleRoomSave(room)
  })

  awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    const changed = [...added, ...updated, ...removed]
    if (origin instanceof WebSocket) {
      const controlled = room.clients.get(origin)?.clientIds
      if (controlled) {
        added.forEach((id) => controlled.add(id))
        updated.forEach((id) => controlled.add(id))
        removed.forEach((id) => controlled.delete(id))
      }
    }
    broadcast(room, encodeAwareness(awareness, changed))
  })

  rooms.set(documentId, room)
  return room
}

function scheduleRoomSave(room: Room) {
  if (room.timer) clearTimeout(room.timer)
  room.timer = setTimeout(() => {
    room.timer = undefined
    room.saveQueue = room.saveQueue
      .then(() => persistRoom(room))
      .catch((error) => log.error(error, 'Collaboration persistence queue failed'))
  }, 500)
}

async function persistRoom(room: Room) {
  if (!room.dirty) return
  const changeSeq = room.changeSeq
  const content = contentFromYDoc(room.doc)
  const state = yState(room.doc)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query('SELECT title,content,version,updated_by FROM documents WHERE id=$1 FOR UPDATE', [room.id])
    if (!current.rowCount) { await client.query('ROLLBACK'); return }
    const row = current.rows[0]
    await client.query('INSERT INTO document_versions(document_id,version,title,content,created_by) VALUES ($1,$2,$3,$4,$5)', [room.id, row.version, row.title, row.content, row.updated_by])
    await client.query('UPDATE documents SET content=$2,yjs_state=$3,version=version+1,updated_by=$4,updated_at=now() WHERE id=$1', [room.id, content, state, room.lastActor || row.updated_by])
    await client.query('COMMIT')
    if (room.changeSeq === changeSeq) room.dirty = false
  } catch (error) {
    await client.query('ROLLBACK')
    log.error(error, 'Failed to persist collaborative document')
  } finally { client.release() }
}

/**
 * Drops a room without persisting it.
 *
 * Used when the document row itself is gone (the retention sweep, an empty of
 * the bin, a permanent delete): flushing would append version rows for a
 * document that no longer exists, and an editor still holding the room would
 * keep writing into a void. Connected sockets are closed here rather than left
 * to notice on their own, so the client stops editing immediately.
 */
export function evictRoom(documentId: string): boolean {
  const room = rooms.get(documentId)
  if (!room) return false
  if (room.timer) { clearTimeout(room.timer); room.timer = undefined }
  if (room.disposeTimer) { clearTimeout(room.disposeTimer); room.disposeTimer = undefined }
  rooms.delete(documentId)
  for (const ws of room.clients.keys()) ws.close(1001, 'Document was deleted')
  room.clients.clear()
  room.awareness.destroy()
  room.doc.destroy()
  return true
}

/** Flushes any pending save; call before every REST read of the document. */
export async function flushRoom(room: Room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = undefined }
  if (!room.dirty) return room.saveQueue
  room.saveQueue = room.saveQueue.then(() => persistRoom(room))
  await room.saveQueue
}

/**
 * Replaces the room content from REST (edit, restore) and rebroadcasts the
 * change as an ordinary Yjs update, so connected editors converge on it.
 */
export async function syncRoomFromContent(room: Room, docJson: unknown) {
  const replacement = schema.nodeFromJSON(docJson)
  room.suppressSave = true
  try {
    room.doc.transact(() => {
      const fragment = room.doc.getXmlFragment(roomField)
      fragment.delete(0, fragment.length)
      prosemirrorToYXmlFragment(replacement, fragment)
    }, 'rest-content-replacement')
  } finally { room.suppressSave = false }
  await pool.query('UPDATE documents SET yjs_state=$2 WHERE id=$1', [room.id, yState(room.doc)])
}
