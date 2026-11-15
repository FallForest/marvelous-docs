import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { settle, socketUrl } from './socket-url.js'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const AUTHOR = '22222222-2222-4222-8222-222222222222'
const EDITOR = '33333333-3333-4333-8333-333333333333'
const ADMIN = '44444444-4444-4444-8444-444444444444'
const content = (text: string) => ({ schemaVersion: 1, doc: { type: 'doc', content: text ? [{ type: 'paragraph', content: [{ type: 'text', text }] }] : [{ type: 'paragraph' }] } })
let db: PGlite, server: PGLiteSocketServer, pool: Pool, app: FastifyInstance
let caller = AUTHOR

test.before(async () => {
  db = new PGlite()
  const directory = new URL('../migrations/', import.meta.url)
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    await db.exec((await readFile(new URL(name, directory), 'utf8')).replace(/CREATE EXTENSION[^;]+;/gi, ''))
  }
  await db.query('INSERT INTO workspaces(id,name) VALUES ($1,$2)', [WORKSPACE, 'Comments'])
  for (const id of [AUTHOR, EDITOR, ADMIN]) {
    await db.query('INSERT INTO users(id,email,name,password_hash) VALUES ($1,$2,$3,$4)', [id, id + '@example.test', id === AUTHOR ? 'Author' : 'Editor', 'unused'])
    await db.query('INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,$3)', [WORKSPACE, id, id === ADMIN ? 'admin' : 'member'])
  }
  server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 4 })
  await server.start()
  process.env.DATABASE_URL = socketUrl(server)
  pool = (await import('../src/core/db.js')).pool
  app = (await import('fastify')).default({ logger: false })
  const { registerRoutes } = await import('../src/routes/index.js')
  registerRoutes(app, {
    authenticate: { preHandler: async (request) => { Object.assign(request, { user: { sub: caller, workspaceId: WORKSPACE, email: caller + '@example.test' } }) } },
    rateLimit: (() => async () => undefined) as never,
  })
  await app.ready()
})

test.after(async () => {
  await settle('app', app?.close())
  await settle('pool', pool?.end())
  await settle('server', server?.stop())
  await settle('db', db?.close())
})

async function create() {
  caller = AUTHOR
  const response = await app.inject({ method: 'POST', url: '/api/v1/documents', payload: { title: 'Discussion', content: content('The quoted words') } })
  assert.equal(response.statusCode, 201, response.body)
  return response.json().document
}
const post = (id: string, payload: unknown) => app.inject({ method: 'POST', url: `/api/v1/documents/${id}/comments`, payload })
const patch = (id: string, commentId: string, payload: unknown) => app.inject({ method: 'PATCH', url: `/api/v1/documents/${id}/comments/${commentId}`, payload })
const anchor = { from: 1, to: 4, text: 'The', relative: { from: { type: { client: 7, clock: 1 }, item: { client: 7, clock: 2 }, assoc: 0 }, to: { type: { client: 7, clock: 1 }, item: { client: 7, clock: 5 }, assoc: -1 } } }

test('quoted discussion survives deletion of all document content with its quote and replies', async () => {
  const doc = await create()
  const root = await post(doc.id, { body: 'Keep this discussion', anchor })
  assert.equal(root.statusCode, 201, root.body)
  const comment = root.json().comment
  const reply = await post(doc.id, { body: 'Follow up', parentId: comment.id })
  assert.equal(reply.statusCode, 201)
  const saved = await app.inject({ method: 'PUT', url: '/api/v1/documents/' + doc.id, payload: { expectedVersion: doc.version, content: content('') } })
  assert.equal(saved.statusCode, 200, saved.body)
  const rows = (await app.inject({ method: 'GET', url: `/api/v1/documents/${doc.id}/comments` })).json().comments
  assert.equal(rows.length, 2)
  assert.equal(rows[0].body, 'Keep this discussion')
  assert.deepEqual(rows[0].anchor, anchor)
  assert.equal(rows[0].status, 'open', 'deleting prose must not silently resolve a discussion')
  assert.equal(rows[1].parentId, comment.id)
})

test('replying to legacy nested replies normalizes to one root and drops duplicate anchors', async () => {
  const doc = await create()
  const root = (await post(doc.id, { body: 'Root', anchor })).json().comment
  const reply = (await post(doc.id, { body: 'Reply', parentId: root.id, anchor })).json().comment
  const nested = (await post(doc.id, { body: 'Nested', parentId: reply.id })).json().comment
  assert.equal(reply.anchor, null)
  assert.equal(nested.parentId, root.id)
  const otherDoc = await create()
  assert.equal((await post(otherDoc.id, { body: 'Wrong document', parentId: root.id })).statusCode, 404)
})

test('malformed quote ranges and relative item ids are rejected before storage', async () => {
  const doc = await create()
  for (const value of [{ from: 4, to: 1 }, { from: 2, to: 2 }, { from: -1, to: 3 }, { from: 1.5, to: 4 }, { ...anchor, relative: { from: { item: { client: 'bad', clock: 1 } }, to: {} } }]) {
    const response = await post(doc.id, { body: 'Invalid', anchor: value })
    assert.equal(response.statusCode, 400, response.body)
  }
})

test('document editors can resolve and reopen threads without changing another author words', async () => {
  const doc = await create()
  const root = (await post(doc.id, { body: 'Author words', anchor })).json().comment
  caller = EDITOR
  assert.equal((await patch(doc.id, root.id, { body: 'Changed without permission' })).statusCode, 404)
  assert.equal((await patch(doc.id, root.id, { status: 'resolved' })).statusCode, 200)
  assert.equal((await post(doc.id, { body: 'Reply closed', parentId: root.id })).statusCode, 409)
  assert.equal((await patch(doc.id, root.id, { status: 'open' })).statusCode, 200)
  assert.equal((await post(doc.id, { body: 'Reply open', parentId: root.id })).statusCode, 201)
  const rows = (await app.inject({ method: 'GET', url: `/api/v1/documents/${doc.id}/comments` })).json().comments
  assert.equal(rows[0].body, 'Author words')
  assert.equal(rows[0].status, 'open')
  assert.equal(rows[0].resolvedAt, null)
  caller = AUTHOR
})

test('only authors edit or delete; administrators manage status without changing words', async () => {
  const doc = await create()
  const root = (await post(doc.id, { body: 'Original words' })).json().comment
  const edited = await patch(doc.id, root.id, { body: 'Updated by author' })
  assert.equal(edited.statusCode, 200, edited.body)
  assert.equal(edited.json().comment.body, 'Updated by author')
  caller = ADMIN
  assert.equal((await patch(doc.id, root.id, { body: 'Administrator rewrite' })).statusCode, 404)
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/documents/${doc.id}/comments/${root.id}` })).statusCode, 404)
  assert.equal((await patch(doc.id, root.id, { status: 'resolved' })).statusCode, 200)
  caller = AUTHOR
})

test('deleting a root erases its words, keeps another author reply and cannot resurrect it by editing', async () => {
  const doc = await create()
  const root = (await post(doc.id, { body: 'Words to delete', anchor })).json().comment
  caller = EDITOR
  const reply = (await post(doc.id, { body: 'Other author context', parentId: root.id })).json().comment
  caller = AUTHOR
  const removed = await app.inject({ method: 'DELETE', url: `/api/v1/documents/${doc.id}/comments/${root.id}` })
  assert.equal(removed.statusCode, 200, removed.body)
  assert.equal(removed.json().comment.body, '')
  assert.ok(removed.json().comment.deletedAt)
  assert.equal((await patch(doc.id, root.id, { body: 'Bring deleted words back' })).statusCode, 404)
  const rows = (await app.inject({ method: 'GET', url: `/api/v1/documents/${doc.id}/comments` })).json().comments
  assert.equal(rows.length, 2)
  assert.equal(rows[0].body, '')
  assert.deepEqual(rows[0].anchor, anchor)
  assert.equal(rows[1].id, reply.id)
  assert.equal(rows[1].body, 'Other author context')
  assert.equal(rows[1].parentId, root.id)
})
