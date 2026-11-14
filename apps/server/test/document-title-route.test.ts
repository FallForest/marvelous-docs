import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { prosemirrorToYXmlFragment } from 'y-prosemirror'

const WS = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const LEGACY_NAMED = '33333333-3333-4333-8333-333333333333'
const LEGACY_UNTITLED = '44444444-4444-4444-8444-444444444444'
const text = (value: string) => ({ type: 'text', text: value })
const paragraph = (value = '') => ({ type: 'paragraph', ...(value ? { content: [text(value)] } : {}) })
const heading = (value: string) => ({ type: 'heading', attrs: { level: 1 }, content: [text(value)] })
const content = (...nodes: unknown[]) => ({ schemaVersion: 1, doc: { type: 'doc', content: nodes } })

type Document = { id: string; title: string; titleMode: 'auto' | 'manual'; version: number; createdAt: string; content: ReturnType<typeof content> }
let app: FastifyInstance
let db: PGlite
let server: PGLiteSocketServer
let pool: Pool
let collaboration: typeof import('../src/collaboration/rooms.js')
let titleMigration = ''

test.before(async () => {
  db = new PGlite()
  const dir = new URL('../migrations/', import.meta.url)
  for (const name of (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = (await readFile(new URL(name, dir), 'utf8')).replace(/CREATE EXTENSION[^;]+;/gi, '')
    if (name === '004_document_title_mode.sql') {
      // These rows predate title_mode. A placeholder is not evidence that the
      // person who created it wanted the server to rename it later.
      await db.query('INSERT INTO workspaces(id,name) VALUES ($1,$2)', [WS, 'Titles'])
      await db.query('INSERT INTO users(id,email,name,password_hash) VALUES ($1,$2,$3,$4)', [USER, 'titles@example.com', 'Titles', 'not-used'])
      await db.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,'admin')", [WS, USER])
      for (const [id, title] of [[LEGACY_NAMED, 'Old chosen title'], [LEGACY_UNTITLED, '未命名文档']]) {
        await db.query('INSERT INTO documents(id,workspace_id,title,content,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$5)', [id, WS, title, content(paragraph('Old body')), USER])
      }
      titleMigration = sql
    }
    await db.exec(sql)
  }
  // REST syncs an already-open room after committing its transaction. That
  // housekeeping can borrow another pool connection before the first releases.
  server = new PGLiteSocketServer({ db, port: 5603, host: '127.0.0.1', maxConnections: 4 })
  await server.start()
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5603/postgres'
  process.env.JWT_SECRET = 'document-title-route-secret-long-enough'
  pool = (await import('../src/core/db.js')).pool
  collaboration = await import('../src/collaboration/rooms.js')
  const Fastify = (await import('fastify')).default
  const { registerRoutes } = await import('../src/routes/index.js')
  app = Fastify({ logger: false })
  registerRoutes(app, {
    authenticate: { preHandler: async (request) => { Object.assign(request, { user: { sub: USER, email: 'titles@example.com', workspaceId: WS } }) } },
    rateLimit: (() => async () => undefined) as never,
  })
  await app.ready()
})

test.after(async () => {
  if (collaboration) for (const id of collaboration.rooms.keys()) collaboration.evictRoom(id)
  await app?.close()
  await pool?.end()
  await server?.stop()
  await db?.close()
})

async function create(fields: Record<string, unknown> = {}) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/documents', payload: { content: content(paragraph()), ...fields } })
  assert.equal(response.statusCode, 201, response.body)
  return response.json().document as Document
}

async function read(id: string) {
  const response = await app.inject({ method: 'GET', url: '/api/v1/documents/' + id })
  assert.equal(response.statusCode, 200, response.body)
  return response.json().document as Document
}

async function update(document: Document, fields: Record<string, unknown>) {
  const response = await app.inject({ method: 'PUT', url: '/api/v1/documents/' + document.id, payload: { expectedVersion: document.version, ...fields } })
  assert.equal(response.statusCode, 200, response.body)
  return response.json().document as Document
}

async function writeCollaboratively(id: string, next: ReturnType<typeof content>) {
  const room = await collaboration.getRoom(id)
  const { schema } = await import('../src/lib/schema.js')
  const { roomField } = await import('../src/collaboration/ydoc.js')
  room.lastActor = USER
  room.doc.transact(() => {
    const fragment = room.doc.getXmlFragment(roomField)
    fragment.delete(0, fragment.length)
    prosemirrorToYXmlFragment(schema.nodeFromJSON(next.doc), fragment)
  }, 'test-editor-update')
  await collaboration.flushRoom(room)
  return read(id)
}

test('omitted title enables auto naming, with REST prose then H1 and live Yjs H1 persistence', async () => {
  let document = await create({ content: content(paragraph('First prose line')) })
  assert.equal(document.title, 'First prose line')
  assert.equal(document.titleMode, 'auto')
  assert.ok(Number.isFinite(Date.parse(document.createdAt)))
  const createdAt = document.createdAt
  document = await update(document, { content: content(paragraph('Earlier prose'), heading('REST heading')) })
  assert.equal(document.title, 'REST heading')
  document = await writeCollaboratively(document.id, content(heading('Yjs heading')))
  assert.equal(document.title, 'Yjs heading')
  assert.equal(document.titleMode, 'auto')
  assert.equal(document.createdAt, createdAt)
  const stored = await pool.query('SELECT title,title_mode,content,yjs_state FROM documents WHERE id=$1', [document.id])
  assert.equal(stored.rows[0].title, 'Yjs heading')
  assert.equal(stored.rows[0].title_mode, 'auto')
  assert.ok(stored.rows[0].yjs_state.length > 0)
})

test('an open room observes a manual rename and later REST and Yjs writes never overwrite it', async () => {
  let document = await create({ content: content(paragraph('Automatic first line')) })
  await collaboration.getRoom(document.id)
  document = await update(document, { title: 'My permanent name' })
  assert.equal(document.titleMode, 'manual')
  document = await update(document, { content: content(heading('Changed through REST')), titleMode: 'auto' })
  assert.equal(document.title, 'My permanent name')
  assert.equal(document.titleMode, 'manual', 'updates cannot re-enable automatic naming')
  document = await writeCollaboratively(document.id, content(heading('Changed through Yjs')))
  assert.equal(document.title, 'My permanent name')
  assert.equal(document.titleMode, 'manual')
  assert.deepEqual(document.content.doc.content[0].content, [text('Changed through Yjs')])
})

test('a concurrent rename after REST access was read causes a conflict instead of losing the manual name', async () => {
  const document = await create({ content: content(paragraph('Automatic before the race')) })
  const originalQuery = pool.query
  const query = pool.query.bind(pool)
  pool.query = (async (sql: string, params?: unknown[]) => {
    const result = await query(sql, params)
    if (typeof sql === 'string' && sql.includes('WITH RECURSIVE chain AS') && params?.[0] === document.id) {
      pool.query = originalQuery
      await update(document, { title: 'Concurrent manual name' })
    }
    return result
  }) as Pool['query']
  try {
    const stale = await app.inject({ method: 'PUT', url: '/api/v1/documents/' + document.id, payload: { expectedVersion: document.version, content: content(heading('Stale automatic name')) } })
    assert.equal(stale.statusCode, 409, stale.body)
    assert.equal(stale.json().error.code, 'VERSION_CONFLICT')
  } finally { pool.query = originalQuery }
  const current = await read(document.id)
  assert.equal(current.title, 'Concurrent manual name')
  assert.equal(current.titleMode, 'manual')
  const retried = await update(current, { content: content(heading('Retried body')) })
  assert.equal(retried.title, 'Concurrent manual name')
})

test('Yjs persistence reads a manual rename committed after its content snapshot and before the row lock', async () => {
  const document = await create({ content: content(paragraph('Automatic before Yjs snapshot')) })
  await collaboration.getRoom(document.id)
  const originalConnect = pool.connect
  // Interleave a second committed writer exactly between snapshot creation and
  // the persistence transaction. All data still goes through real PostgreSQL.
  pool.connect = (async () => {
    pool.connect = originalConnect
    await pool.query("UPDATE documents SET title=$2,title_mode='manual',version=version+1 WHERE id=$1", [document.id, 'Manual won the snapshot race'])
    return originalConnect.call(pool)
  }) as Pool['connect']
  try {
    const current = await writeCollaboratively(document.id, content(heading('Stale Yjs automatic title')))
    assert.equal(current.title, 'Manual won the snapshot race')
    assert.equal(current.titleMode, 'manual')
    assert.equal(current.version, document.version + 2)
  } finally { pool.connect = originalConnect }
})

test('manually confirming the identical untitled placeholder still permanently locks the name', async () => {
  let document = await create()
  assert.equal(document.title, '未命名文档')
  assert.equal(document.titleMode, 'auto')
  document = await update(document, { title: '未命名文档' })
  assert.equal(document.titleMode, 'manual')
  document = await writeCollaboratively(document.id, content(heading('Must not replace the placeholder')))
  assert.equal(document.title, '未命名文档')
  document = await update(document, { content: content(paragraph('REST must not replace it either')) })
  assert.equal(document.title, '未命名文档')
})

test('empty and code-only documents stay untitled through both persistence paths', async () => {
  let document = await create({ title: 'Ignored auto seed', titleMode: 'auto' })
  assert.equal(document.title, '未命名文档')
  document = await update(document, { content: content({ type: 'codeBlock', content: [text('docker compose up -d')] }) })
  assert.equal(document.title, '未命名文档')
  document = await writeCollaboratively(document.id, content(paragraph('')))
  assert.equal(document.title, '未命名文档')
})

test('migration preserves named and placeholder legacy rows as manual and is safe to replay', async () => {
  for (const [id, title] of [[LEGACY_NAMED, 'Old chosen title'], [LEGACY_UNTITLED, '未命名文档']]) {
    let document = await read(id!)
    assert.equal(document.titleMode, 'manual')
    document = await update(document, { content: content(heading('Fresh heading')) })
    assert.equal(document.title, title)
  }
  const automatic = await create({ content: content(paragraph('Replay retains auto')) })
  await pool.query(titleMigration)
  assert.equal((await read(automatic.id)).titleMode, 'auto')
  await assert.rejects(pool.query("UPDATE documents SET title_mode='other' WHERE id=$1", [automatic.id]), /documents_title_mode_check/)
})

test('explicit names, templates, imports and duplicates default to manual naming', async () => {
  const explicit = await create({ title: 'Chosen name', content: content(heading('Body heading')) })
  assert.equal(explicit.titleMode, 'manual')
  assert.equal(explicit.title, 'Chosen name')
  const templateResponse = await app.inject({ method: 'POST', url: '/api/v1/documents', payload: { templateId: 'meeting-notes' } })
  assert.equal(templateResponse.statusCode, 201, templateResponse.body)
  assert.equal(templateResponse.json().document.titleMode, 'manual')
  const imported = await app.inject({ method: 'POST', url: '/api/v1/documents/import', payload: { markdown: '# Imported heading\n\nBody' } })
  assert.equal(imported.statusCode, 201, imported.body)
  assert.equal(imported.json().document.titleMode, 'manual')
  const duplicate = await app.inject({ method: 'POST', url: '/api/v1/documents/' + explicit.id + '/duplicate', payload: {} })
  assert.equal(duplicate.statusCode, 201, duplicate.body)
  assert.equal(duplicate.json().document.titleMode, 'manual')
})

test('restoring a version never unlocks a manual document', async () => {
  let document = await create({ content: content(paragraph('Original text')) })
  document = await update(document, { content: content(heading('Later content')) })
  const snapshots = await app.inject({ method: 'GET', url: '/api/v1/documents/' + document.id + '/versions' })
  const snapshot = snapshots.json().versions[0]
  document = await update(document, { title: 'Manual before restore' })
  const restored = await app.inject({ method: 'POST', url: '/api/v1/documents/' + document.id + '/versions/' + snapshot.id + '/restore', payload: { expectedVersion: document.version } })
  assert.equal(restored.statusCode, 200, restored.body)
  document = restored.json().document
  assert.equal(document.titleMode, 'manual')
  const restoredTitle = document.title
  document = await writeCollaboratively(document.id, content(heading('Must stay manual after restoration')))
  assert.equal(document.title, restoredTitle)
})

test('list, search, shared and favorite responses include the true document creation time and title mode', async () => {
  const document = await create({ content: content(paragraph('创建时间验证')) })
  const createdAt = '2020-01-02T03:04:05.000Z'
  await pool.query('UPDATE documents SET created_at=$2 WHERE id=$1', [document.id, createdAt])
  await app.inject({ method: 'PUT', url: '/api/v1/documents/' + document.id + '/favorite', payload: { favorite: true } })
  for (const path of ['/api/v1/documents', '/api/v1/documents/favorites']) {
    const response = await app.inject({ method: 'GET', url: path })
    const entry = response.json().documents.find((entry: Document) => entry.id === document.id)
    assert.equal(entry.createdAt, createdAt)
    assert.equal(entry.titleMode, 'auto')
  }
  const search = await app.inject({ method: 'GET', url: '/api/v1/documents/search?q=' + encodeURIComponent('创建时间验证') })
  assert.equal(search.json().results[0].createdAt, createdAt)
  assert.equal(search.json().results[0].titleMode, 'auto')
  const link = await app.inject({ method: 'POST', url: '/api/v1/documents/' + document.id + '/share-link', payload: { permission: 'viewer' } })
  assert.equal(link.statusCode, 201, link.body)
  const shared = await app.inject({ method: 'GET', url: '/api/v1/shared/' + link.json().shareLink.token })
  assert.equal(shared.statusCode, 200, shared.body)
  assert.equal(shared.json().document.createdAt, createdAt)
  assert.equal(shared.json().document.titleMode, 'auto')
})
