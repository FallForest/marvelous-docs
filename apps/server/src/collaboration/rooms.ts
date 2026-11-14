import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import { prosemirrorToYXmlFragment } from 'y-prosemirror'
import { WebSocket } from 'ws'
import type { FastifyBaseLogger } from 'fastify'
import { pool } from '../core/db.js'
import { schema } from '../lib/schema.js'
import { createYDoc, contentFromYDoc, roomField, yState } from './ydoc.js'
import { encodeAwareness, encodeSyncUpdate } from './protocol.js'
import { savedDocumentTitle } from '../lib/document-title.js'
import { config } from '../core/config.js'
import { checkpointHistoryIfDue, noteHistoryEdit } from '../domain/history.js'
import type { DocumentRow, Room } from '../core/types.js'

/**
 * In-memory collaboration rooms.
 *
 * A room is created on first join, kept in memory, and evicted five minutes
 * after the last client leaves. PostgreSQL always stays the durable copy, so
 * every REST read flushes the pending room state first.
 */

/**
 * How stale the Tiptap projection may get before a save refreshes it.
 *
 * Chosen against the two things it trades between: `content` is what search reads,
 * so a long interval makes a just-typed word unfindable; the projection rebuilds
 * two GIN indexes, so a short one brings back the write amplification this exists
 * to remove. Ten seconds is short enough that a reader never notices and long
 * enough that a burst of typing costs one rebuild instead of twenty.
 *
 * Read paths do not wait for it: `flushRoom` forces a projection, so anything that
 * observes `content` sees the current document regardless of this clock.
 */
const PROJECTION_INTERVAL_MS = 10 * 1000
export const rooms = new Map<string, Room>()

/**
 * Operational counters, for `/api/v1/system/metrics`.
 *
 * Every number here answers a question an operator asks during an incident that the
 * logs cannot: how many documents are hot, whether writes are queued behind one of
 * them, and whether the pool is the bottleneck. They are read, never cached, so a
 * metric cannot be stale in the one moment it matters.
 */
export function roomMetrics() {
  let clients = 0
  let dirty = 0
  let pendingProjections = 0
  for (const room of rooms.values()) {
    clients += room.clients.size
    if (room.dirty) dirty++
    if (room.projectionDirty) pendingProjections++
  }
  return {
    rooms: rooms.size,
    clients,
    dirtyRooms: dirty,
    roomsAwaitingProjection: pendingProjections,
    queuedDocumentOperations: documentQueues.size,
    scheduledHistoryCheckpoints: historyTimers.size,
  }
}
const roomLoads = new Map<string, Promise<Room>>()
const documentQueues = new Map<string, Promise<unknown>>()
const historyTimers = new Map<string, NodeJS.Timeout>()

/** REST, socket updates and disk persistence share one per-document order. */
export function queueDocumentOperation<T>(documentId: string, operation: () => Promise<T> | T): Promise<T> {
  const previous = documentQueues.get(documentId) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(operation)
  const settled = current.then(() => undefined, () => undefined)
  documentQueues.set(documentId, settled)
  void settled.then(() => { if (documentQueues.get(documentId) === settled) documentQueues.delete(documentId) })
  return current
}

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
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(message) } catch (error) { log.warn(error, 'Unable to broadcast collaboration update') }
    }
  }
}

/** Returns the live room for a document, loading it on first join. */
export async function getRoom(documentId: string): Promise<Room> {
  const existing = rooms.get(documentId)
  if (existing) return existing
  const pending = roomLoads.get(documentId)
  if (pending) return pending
  const loading = queueDocumentOperation(documentId, () => rooms.get(documentId) ?? loadRoom(documentId))
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
    /** True when `content` lags `yjs_state`; cleared by a projecting save. */
    projectionDirty: false,
    projectedAt: Date.now(),
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
  void scheduleDocumentHistory(documentId)
  return room
}

function scheduleRoomSave(room: Room) {
  if (room.timer) clearTimeout(room.timer)
  room.timer = setTimeout(() => {
    room.timer = undefined
    // A REST read may be about to look at `content`, so this one always projects.
  room.saveQueue = queueDocumentOperation(room.id, () => persistRoom(room, { forceProjection: true }))
    void room.saveQueue.catch((error) => log.error(error, 'Collaboration persistence queue failed'))
  }, 500)
}

/**
 * Persists the durable Yjs state, and the Tiptap projection when it is due.
 *
 * The two halves have very different costs. `yjs_state` is a single bytea column
 * that nothing indexes; `content` feeds the generated `tsvector` columns, so every
 * write to it rebuilds two GIN indexes. Writing both on the 500 ms debounce meant a
 * typing pause rebuilt the search index twice a second, which is the most expensive
 * thing an idle editor did.
 *
 * So the state is written on every tick - that is the data-safety half, and losing
 * it loses keystrokes - while the projection is written only when it is due, or when
 * a caller asks for it (`flushRoom`, which every REST read goes through). The
 * projection is derived data: it can always be rebuilt from `yjs_state`, so a stale
 * one is recoverable in a way a stale state vector is not.
 */
async function persistRoom(room: Room, options: { forceProjection?: boolean } = {}) {
  if (!room.dirty && !room.projectionDirty) return
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query<DocumentRow>('SELECT * FROM documents WHERE id=$1 FOR UPDATE', [room.id])
    if (!current.rowCount) { await client.query('ROLLBACK'); return }
    // Capture only after entering the shared queue and acquiring the row lock.
    const changeSeq = room.changeSeq
    const state = yState(room.doc)
    const row = current.rows[0]!
    const projectNow = options.forceProjection === true || room.projectionDirty || Date.now() - room.projectedAt >= PROJECTION_INTERVAL_MS
    if (!projectNow) {
      /*
       * State only. `version` still advances: it is the optimistic-concurrency token
       * for REST writers, and it has to move when the document moves even if the
       * projection has not been refreshed yet.
       */
      const touched = await client.query<DocumentRow>(
        'UPDATE documents SET yjs_state=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$1 RETURNING *',
        [room.id, state, room.lastActor || row.updated_by])
      await noteHistoryEdit(client, row, touched.rows[0]!)
      await client.query('COMMIT')
      if (room.changeSeq === changeSeq) room.dirty = false
      room.projectionDirty = true
      void scheduleDocumentHistory(room.id)
      return
    }
    const content = contentFromYDoc(room.doc)
    const naming = savedDocumentTitle(row.title, row.title_mode, content)
    const updated = await client.query<DocumentRow>('UPDATE documents SET content=$2,yjs_state=$3,title=$5,version=version+1,updated_by=$4,updated_at=now() WHERE id=$1 RETURNING *', [room.id, content, state, room.lastActor || row.updated_by, naming.title])
    await noteHistoryEdit(client, row, updated.rows[0]!)
    await client.query('COMMIT')
    if (room.changeSeq === changeSeq) { room.dirty = false; room.projectionDirty = false }
    room.projectedAt = Date.now()
    void scheduleDocumentHistory(room.id)
  } catch (error) {
    await client.query('ROLLBACK')
    log.error(error, 'Failed to persist collaborative document')
    throw error
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
  const historyTimer = historyTimers.get(documentId)
  if (historyTimer) { clearTimeout(historyTimer); historyTimers.delete(documentId) }
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

/**
 * Closes every writable connection to a document after its ACL changed.
 *
 * Editing an ACL used to touch the database and nothing else. The socket had
 * already decided `canWrite` at handshake time, so a demoted editor kept writing
 * - the restriction existed in every REST path and in none of the live ones. The
 * room is the only place that knows who is attached, so the revocation has to
 * happen here.
 *
 * Read-only peers stay connected: their messages are ignored anyway, and
 * dropping the page under someone who is only reading is a worse outcome than
 * letting them keep their view. `socket.ts` rechecks on the next write for the
 * cases this cannot see, such as a restriction added three folders up.
 */
export function revokeRoomWriters(documentId: string, reason = 'Permission changed') {
  const room = rooms.get(documentId)
  if (!room) return 0
  let closed = 0
  for (const [ws, client] of room.clients) {
    if (!client.canWrite) continue
    client.canWrite = false
    ws.close(4003, reason)
    closed++
  }
  return closed
}
/**
 * Flushes any pending save, projection included. Call before every REST read.
 *
 * The projection runs on a slower clock than the durable state, so a reader that
 * did not force it could observe `content` from up to ten seconds ago - which is
 * fine for search after a pause and wrong for `GET /documents/:id`, where it would
 * look like the reader's own last edit had been lost.
 */
export async function flushRoom(room: Room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = undefined }
  room.saveQueue = queueDocumentOperation(room.id, () => persistRoom(room, { forceProjection: true }))
  await room.saveQueue
}

/** Flush queued edits before checking expectedVersion, then keep REST atomic. */
export function withRoomMutation<T>(documentId: string, operation: (room: Room | undefined) => Promise<T>): Promise<T> {
  return queueDocumentOperation(documentId, async () => {
    const room = rooms.get(documentId)
    if (room?.timer) { clearTimeout(room.timer); room.timer = undefined }
    if (room) await persistRoom(room, { forceProjection: true })
    return operation(room)
  })
}

export type PreparedRoomContent = { update: Uint8Array; state: Buffer }

/** Build the exact durable state without mutating/broadcasting before COMMIT. */
export function prepareRoomContent(room: Room, docJson: unknown): PreparedRoomContent {
  const replacement = schema.nodeFromJSON(docJson)
  const clone = new Y.Doc()
  try {
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(room.doc))
    const before = Y.encodeStateVector(clone)
    clone.transact(() => {
      const fragment = clone.getXmlFragment(roomField)
      fragment.delete(0, fragment.length)
      prosemirrorToYXmlFragment(replacement, fragment)
    })
    return { update: Y.encodeStateAsUpdate(clone, before), state: yState(clone) }
  } finally { clone.destroy() }
}

export function applyPreparedRoomContent(room: Room, prepared: PreparedRoomContent): void {
  room.suppressSave = true
  try { Y.applyUpdate(room.doc, prepared.update, 'rest-content-replacement') }
  finally { room.suppressSave = false }
}

/**
 * Replaces the room content from REST (edit, restore) and rebroadcasts the
 * change as an ordinary Yjs update, so connected editors converge on it.
 */
export async function syncRoomFromContent(room: Room, docJson: unknown) {
  applyPreparedRoomContent(room, prepareRoomContent(room, docJson))
}

/** Schedule the earliest durable idle/continuous deadline, not every auto-save. */
export async function scheduleDocumentHistory(documentId: string): Promise<void> {
  try {
    const pending = await pool.query('SELECT started_at,last_edit_at FROM document_history_pending WHERE document_id=$1', [documentId])
    const old = historyTimers.get(documentId)
    if (old) { clearTimeout(old); historyTimers.delete(documentId) }
    if (!pending.rowCount) return
    const row = pending.rows[0]!
    const deadline = Math.min(new Date(row.started_at).getTime() + config.historyIntervalMs, new Date(row.last_edit_at).getTime() + config.historyIdleMs)
    const timer = setTimeout(() => {
      historyTimers.delete(documentId)
      void checkpointDocumentHistory(documentId).catch((error) => log.error(error, 'History checkpoint failed'))
    }, Math.max(1, deadline - Date.now()))
    timer.unref()
    historyTimers.set(documentId, timer)
  } catch (error) { log.warn(error, 'Unable to schedule history checkpoint') }
}

export async function checkpointDocumentHistory(documentId: string): Promise<void> {
  await withRoomMutation(documentId, async () => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const current = await client.query<DocumentRow>('SELECT * FROM documents WHERE id=$1 FOR UPDATE', [documentId])
      if (current.rowCount) await checkpointHistoryIfDue(client, current.rows[0]!)
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  })
  await scheduleDocumentHistory(documentId)
}

/** Call after migrations at startup to resume checkpoints left by a restart. */
export async function resumeHistoryCheckpoints(): Promise<void> {
  const pending = await pool.query('SELECT document_id FROM document_history_pending')
  await Promise.all(pending.rows.map((row) => scheduleDocumentHistory(row.document_id)))
}
