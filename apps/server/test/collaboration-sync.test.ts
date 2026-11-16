import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile, readdir } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from 'y-protocols/sync'
import { socketUrl } from './socket-url.js'

/**
 * A joined client must receive the document it asks for.
 *
 * The first frame a y-websocket client sends is `sync step 1`: "here is my state
 * vector, send me what I am missing". The server answers it on a read-only fast
 * path, and that path used to hand the raw frame to `readSyncMessage` without
 * consuming the message-type varint first - so the message type was read as the
 * subtype, the rest of the frame was parsed as a state vector, the parse threw,
 * and the catch swallowed it. The client got nothing.
 *
 * Nothing caught it, because the write path is correct: the editor still received
 * updates, the room still accepted edits. The page simply started empty, the first
 * keystroke was merged next to the real body instead of into it, and the footer
 * never converged on 已保存. These tests assert the frames, because the framing is
 * where the failure lived.
 */

const WS = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'

let app: FastifyInstance
let db: PGlite
let dbServer: PGLiteSocketServer
let pool: Pool
let collaboration: typeof import('../src/collaboration/rooms.js')

test.before(async () => {
  db = new PGlite()
  const dir = new URL('../migrations/', import.meta.url)
  for (const name of (await readdir(dir)).filter((entry) => entry.endsWith('.sql')).sort()) {
    const sql = (await readFile(new URL(name, dir), 'utf8')).replace(/CREATE EXTENSION[^;]+;/gi, '')
    if (name.startsWith('001')) {
      await db.exec(sql)
      await db.query('INSERT INTO workspaces(id,name) VALUES ($1,$2)', [WS, 'Sync'])
      await db.query('INSERT INTO users(id,email,name,password_hash) VALUES ($1,$2,$3,$4)', [USER, 'sync@example.test', 'Sync', 'not-used'])
      await db.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,'admin')", [WS, USER])
      continue
    }
    await db.exec(sql)
  }
  dbServer = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 4 })
  await dbServer.start()
  process.env.DATABASE_URL = socketUrl(dbServer)
  process.env.JWT_SECRET = 'collaboration-sync-secret-long-enough'
  pool = (await import('../src/core/db.js')).pool
  collaboration = await import('../src/collaboration/rooms.js')
  const Fastify = (await import('fastify')).default
  const { registerRoutes } = await import('../src/routes/index.js')
  app = Fastify({ logger: false })
  registerRoutes(app, {
    authenticate: { preHandler: async (request) => { Object.assign(request, { user: { sub: USER, email: 'sync@example.test', workspaceId: WS } }) } },
    rateLimit: (() => async () => undefined) as never,
  })
  await app.ready()
})

test.after(async () => {
  if (collaboration) for (const id of collaboration.rooms.keys()) collaboration.evictRoom(id)
  const within = (work: Promise<unknown> | undefined, label: string) => Promise.race([
    Promise.resolve(work).catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(() => { console.warn('teardown: ' + label + ' did not finish in 5s'); resolve() }, 5000).unref?.()),
  ])
  await within(app?.close(), 'app.close')
  await within(pool?.end(), 'pool.end')
  await within(dbServer?.stop(), 'server.stop')
  await within(db?.close(), 'db.close')
})

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const content = (...nodes: unknown[]) => ({ schemaVersion: 1, doc: { type: 'doc', content: nodes } })

async function create(body: string) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/documents', payload: { title: '同步检查', content: content(paragraph(body)) } })
  assert.equal(response.statusCode, 201, response.body)
  return response.json().document as { id: string }
}

/**
 * A socket stand-in: the handler only needs to receive frames and send them.
 *
 * A real WebSocketServer per test kept the event loop alive after the assertions
 * and turned a four-second file into a hang, which is the one failure mode that
 * hides the result it was verifying. The handler uses four members, so the stand-in
 * implements exactly those.
 */
class SocketStub extends EventEmitter {
  static OPEN = 1
  readyState = 1
  sent: Uint8Array[] = []
  closed: Array<{ code?: number; reason?: string }> = []
  send(frame: Uint8Array) { this.sent.push(new Uint8Array(frame)) }
  close(code?: number, reason?: string) { this.closed.push({ code, reason }); this.readyState = 3 }
  /** Delivers one client frame, as the transport would. */
  receive(frame: Uint8Array) { this.emit('message', Buffer.from(frame)) }
  /** Resolves once the handler has sent something, or after a short wait. */
  async next(): Promise<Uint8Array[]> {
    for (let i = 0; i < 40; i++) {
      if (this.sent.length) return this.sent
      await new Promise((done) => setTimeout(done, 25))
    }
    return this.sent
  }
}

/** Attaches the handler to a stub, as the upgrade path does. */
async function attach(documentId: string) {
  const room = await collaboration.getRoom(documentId)
  const { attachCollaborationSocket } = await import('../src/collaboration/socket.js')
  const socket = new SocketStub()
  attachCollaborationSocket(socket as unknown as import('ws').WebSocket, room, { sub: USER, email: 'sync@example.test', workspaceId: WS } as never, true)
  // The greeting is the room's own state-vector request; the client's half of the
  // handshake is what this file is about.
  await socket.next()
  socket.sent.length = 0
  return { room, socket }
}

/** The frame a y-websocket client sends when it joins. */
function syncStep1(doc: Y.Doc) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, 0)
  syncProtocol.writeSyncStep1(encoder, doc)
  return encoding.toUint8Array(encoder)
}

/** Applies a server frame to `doc` the way the client transport does. */
function applyFrame(doc: Y.Doc, frame: Uint8Array) {
  const decoder = decoding.createDecoder(frame)
  assert.equal(decoding.readVarUint(decoder), 0, 'a sync frame is expected')
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, 0)
  syncProtocol.readSyncMessage(decoder, encoder, doc, null)
  return encoding.toUint8Array(encoder)
}

test('a joining client receives the document from the read-only sync path', async () => {
  const document = await create('房间里的正文')
  const { socket } = await attach(document.id)

  const local = new Y.Doc()
  socket.receive(syncStep1(local))
  const frames = await socket.next()
  assert.equal(frames.length, 1, 'one state-vector request gets exactly one answer')

  // Decoded the way the browser transport decodes it, into a document of its own.
  const received = new Y.Doc()
  applyFrame(received, frames[0]!)
  assert.equal(received.getXmlFragment('default').length, 1, 'the body arrives as a fragment')
  assert.match(received.getXmlFragment('default').toString(), /房间里的正文/)
  received.destroy()
  local.destroy()
})

test('a client that already has the document receives no new content', async () => {
  const document = await create('已经同步过的正文')
  const { room, socket } = await attach(document.id)

  /*
   * A state vector that already knows everything. The answer is still a step-2
   * frame - that is the protocol's shape - but it carries no update, so applying
   * it changes nothing. What must not happen is the body arriving a second time:
   * a reload would then append the page to itself.
   */
  const local = new Y.Doc()
  Y.applyUpdate(local, Y.encodeStateAsUpdate(room.doc))
  const before = local.getXmlFragment('default').length
  socket.receive(syncStep1(local))
  const frames = await socket.next()
  for (const frame of frames) applyFrame(local, frame)
  assert.equal(local.getXmlFragment('default').length, before, 'the body is not repeated')
  assert.match(local.getXmlFragment('default').toString(), /已经同步过的正文/)
  local.destroy()
})

test('a room whose durable state is empty is rebuilt from the stored body', async () => {
  const document = await create('数据库里还在的正文')
  /*
   * Simulates the damage the missing sync caused: keystrokes merged into an empty
   * fragment were persisted, so `yjs_state` describes a blank document while
   * `content` still holds the page. Opening the document must show the page.
   */
  await collaboration.evictRoom(document.id)
  const empty = new Y.Doc()
  await pool.query('UPDATE documents SET yjs_state=$2 WHERE id=$1', [document.id, Buffer.from(Y.encodeStateAsUpdate(empty))])
  empty.destroy()

  const room = await collaboration.getRoom(document.id)
  assert.match(room.doc.getXmlFragment('default').toString(), /数据库里还在的正文/, 'the stored body is what the room serves')
  const repaired = await pool.query('SELECT yjs_state FROM documents WHERE id=$1', [document.id])
  const check = new Y.Doc()
  Y.applyUpdate(check, new Uint8Array(repaired.rows[0].yjs_state))
  assert.equal(check.getXmlFragment('default').length, 1, 'the repair is persisted, not just served')
  check.destroy()
})

test('a client edit reaches the room and is echoed back to that socket', async () => {
  const document = await create('原来的句子')
  const { room, socket } = await attach(document.id)

  const local = new Y.Doc()
  socket.receive(syncStep1(local))
  const [frame] = await socket.next()
  applyFrame(local, frame!)

  const fragment = local.getXmlFragment('default')
  const text = new Y.XmlText()
  text.insert(0, '编辑器写入')
  local.transact(() => { (fragment.get(0) as Y.XmlElement).insert(0, [text]) })
  const update = Y.encodeStateAsUpdate(local, Y.encodeStateVector(room.doc))
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, 0)
  syncProtocol.writeUpdate(encoder, update)
  socket.sent.length = 0
  socket.receive(encoding.toUint8Array(encoder))

  const echoed = await socket.next()
  assert.ok(echoed.length >= 1, 'the room broadcasts the accepted update')
  assert.match(room.doc.getXmlFragment('default').toString(), /编辑器写入/)
  await collaboration.flushRoom(room)
  local.destroy()
})
