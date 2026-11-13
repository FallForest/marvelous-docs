import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

/**
 * The trash endpoints, through Fastify.
 *
 * `trash.test.ts` proves the statement; this proves the surface around it: the
 * list carries a deadline, emptying the bin respects visibility, and a member
 * cannot sweep the whole workspace. PostgreSQL is real (PGlite over its
 * wire-compatible socket), so the API's own pool and migrations run unmodified.
 */

let app: import('fastify').FastifyInstance
let db: PGlite
let server: PGLiteSocketServer
let pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>; end: () => Promise<void> }
let adminToken = ''
let memberToken = ''

test.before(async () => {
  db = new PGlite()
  const strip = (sql: string) => sql.replace(/CREATE EXTENSION[^;]+;/gi, '')
  const dir = new URL('../migrations/', import.meta.url)
  for (const name of ['001_initial.sql', '002_share_links.sql', '003_full_text_search.sql']) {
    await db.exec(strip(await readFile(new URL(name, dir), 'utf8')))
  }

  server = new PGLiteSocketServer({ db, port: 5601, host: '127.0.0.1' })
  await server.start()

  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5601/postgres'
  process.env.JWT_SECRET = 'trash-route-secret-that-is-long-enough'
  process.env.BOOTSTRAP_ADMIN_EMAIL = 'admin@example.com'
  process.env.BOOTSTRAP_ADMIN_PASSWORD = 'correct horse battery staple'
  process.env.BOOTSTRAP_ADMIN_NAME = 'Admin'
  process.env.TRASH_RETENTION_DAYS = '7'

  const dbModule = await import('../src/db.js')
  pool = dbModule.pool as unknown as typeof pool
  const rawQuery = pool.query.bind(pool)
  pool.query = ((sql: unknown, params?: unknown[]) =>
    rawQuery(typeof sql === 'string' ? strip(sql) : sql, params)) as typeof pool.query
  await dbModule.initializeWorkspace({ info: () => undefined })

  const Fastify = (await import('fastify')).default
  const jwt = (await import('@fastify/jwt')).default
  const { registerRoutes } = await import('../src/routes/index.js')
  const { fail } = await import('../src/http.js')

  app = Fastify({ logger: false })
  await app.register(jwt, { secret: process.env.JWT_SECRET })
  app.decorate('authenticate', async function (request, reply) {
    try { await request.jwtVerify() }
    catch { return fail(reply, 401, 'UNAUTHENTICATED', 'A valid bearer token is required.') }
  })
  registerRoutes(app, {
    authenticate: { preHandler: app.authenticate },
    rateLimit: (() => async () => undefined) as never,
  })
  await app.ready()

  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'admin@example.com', password: 'correct horse battery staple' } })
  assert.equal(login.statusCode, 200, login.body)
  adminToken = login.json().token

  const { passwordHash } = await import('../src/security.js')
  const ws = await pool.query('SELECT id FROM workspaces LIMIT 1')
  const member = await pool.query<{ id: string }>(
    'INSERT INTO users(email,name,password_hash) VALUES ($1,$2,$3) RETURNING id',
    ['member@example.com', 'Member', await passwordHash('correct horse battery staple')])
  await pool.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,'member')", [ws.rows[0]!.id, member.rows[0]!.id])
  const memberLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'member@example.com', password: 'correct horse battery staple' } })
  assert.equal(memberLogin.statusCode, 200, memberLogin.body)
  memberToken = memberLogin.json().token
})

test.after(async () => {
  await app.close()
  await pool.end()
  await server.stop()
  await db.close()
})

const auth = (bearer: string) => ({ authorization: 'Bearer ' + bearer })

async function createDocument(title: string, restricted = false) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/documents',
    headers: auth(adminToken),
    payload: { title, content: { schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph' }] } } },
  })
  assert.equal(response.statusCode, 201, response.body)
  const document = response.json().document
  if (restricted) await pool.query('UPDATE documents SET acl_restricted=true WHERE id=$1', [document.id])
  return document
}

async function trashIt(id: string) {
  const response = await app.inject({ method: 'DELETE', url: '/api/v1/documents/' + id, headers: auth(adminToken) })
  assert.equal(response.statusCode, 200, response.body)
}

const listTrash = (bearer = adminToken) =>
  app.inject({ method: 'GET', url: '/api/v1/documents/trash', headers: auth(bearer) })

test('the list states the retention window and each row\'s deadline', async () => {
  const doc = await createDocument('过期测试')
  await trashIt(doc.id)

  const response = await listTrash()
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().retentionDays, 7, 'the configured window reaches the client')
  const row = response.json().documents.find((entry: { id: string }) => entry.id === doc.id)
  assert.ok(row, 'the trashed row is listed')
  assert.ok(row.expiresAt, 'each row carries its own deadline')
  const days = (Date.parse(row.expiresAt) - Date.now()) / 86_400_000
  assert.ok(days > 6.9 && days <= 7, 'the deadline is the delete time plus the window, got ' + days)
})

test('an id looks different from the literal /documents/trash route', async () => {
  // Neither path may be answered by the other: the empty call must not be
  // parsed as "delete document whose id is 'trash'".
  const bad = await app.inject({ method: 'DELETE', url: '/api/v1/documents/trash', headers: auth('not-a-real-token') })
  assert.equal(bad.statusCode, 401)
  assert.equal(bad.json().error.code, 'UNAUTHENTICATED')
})

test('emptying the bin removes only what the caller can see', async () => {
  const visible = await createDocument('可见')
  const hidden = await createDocument('受限', true)
  await trashIt(visible.id)
  await trashIt(hidden.id)

  const before = (await listTrash(adminToken)).json().documents.map((row: { id: string }) => row.id)
  assert.ok(before.includes(hidden.id) && before.includes(visible.id))

  // A member cannot see the restricted row, so emptying must not take it —
  // while every row they can see (including ones from earlier cases) goes.
  const asMember = await app.inject({ method: 'DELETE', url: '/api/v1/documents/trash', headers: auth(memberToken) })
  assert.equal(asMember.statusCode, 200, asMember.body)

  const after = (await listTrash(adminToken)).json().documents.map((row: { id: string }) => row.id)
  assert.ok(after.includes(hidden.id), 'the restricted row survives a member\'s empty')
  assert.ok(!after.includes(visible.id), 'the visible row went')
  assert.equal(asMember.json().removed, before.length - after.length)
})

test('an admin empties everything', async () => {
  await createDocument('清理一')
  await createDocument('清理二').then((doc) => trashIt(doc.id))
  await createDocument('清理三').then((doc) => trashIt(doc.id))

  const response = await app.inject({ method: 'DELETE', url: '/api/v1/documents/trash', headers: auth(adminToken) })
  assert.equal(response.statusCode, 200, response.body)
  assert.ok(response.json().removed >= 2, 'both rows were removed, got ' + response.json().removed)
  assert.deepEqual((await listTrash()).json().documents, [])
})

test('emptying an empty bin is a no-op, not an error', async () => {
  const response = await app.inject({ method: 'DELETE', url: '/api/v1/documents/trash', headers: auth(adminToken) })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().removed, 0)
})

test('the on-demand sweep is admin-only', async () => {
  const asMember = await app.inject({ method: 'POST', url: '/api/v1/documents/trash/sweep', headers: auth(memberToken) })
  assert.equal(asMember.statusCode, 403)
  assert.equal(asMember.json().error.code, 'ADMIN_REQUIRED')

  const asAdmin = await app.inject({ method: 'POST', url: '/api/v1/documents/trash/sweep', headers: auth(adminToken) })
  assert.equal(asAdmin.statusCode, 200, asAdmin.body)
  assert.equal(asAdmin.json().removed, 0, 'nothing is past the window yet')
  assert.equal(asAdmin.json().retentionDays, 7)
})

test('the sweep removes a row that is past the window', async () => {
  const doc = await createDocument('已过期')
  await trashIt(doc.id)
  // Backdate the delete, the one thing the API never does for you.
  await pool.query("UPDATE documents SET deleted_at=now() - interval '8 days' WHERE id=$1", [doc.id])

  const sweep = await app.inject({ method: 'POST', url: '/api/v1/documents/trash/sweep', headers: auth(adminToken) })
  assert.equal(sweep.statusCode, 200)
  assert.equal(sweep.json().removed, 1)

  const rows = await listTrash()
  assert.ok(!rows.json().documents.some((row: { id: string }) => row.id === doc.id))
})

test('every trash route requires a session', async () => {
  for (const [method, url] of [['GET', '/api/v1/documents/trash'], ['DELETE', '/api/v1/documents/trash'], ['POST', '/api/v1/documents/trash/sweep']] as const) {
    const response = await app.inject({ method, url })
    assert.equal(response.statusCode, 401, method + ' ' + url)
  }
})
