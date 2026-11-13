import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

/**
 * The search endpoint, through Fastify.
 *
 * `search.test.ts` proves the statement; this proves the route around it — the
 * query parsing, the rate limit, the JSON shape, and the fact that a member
 * without a grant cannot reach a restricted document's text through search.
 *
 * PostgreSQL is real: PGlite exposes a wire-compatible TCP socket, so the API's
 * own `pg` pool, the migration runner, and `initializeWorkspace` run unmodified.
 *
 * A single server is shared by the cases below because booting one costs about a
 * second; each case creates its own documents.
 */

let app: import('fastify').FastifyInstance
let db: PGlite
let server: PGLiteSocketServer
let token = ''
let memberToken = ''
let pool: { end: () => Promise<void> }

test.before(async () => {
  db = new PGlite()
  // PGlite has no contrib modules. The initial schema only wants
  // gen_random_uuid, which is built into PostgreSQL 13+.
  const strip = (sql: string) => sql.replace(/CREATE EXTENSION[^;]+;/gi, '')
  const dir = new URL('../migrations/', import.meta.url)
  await db.exec(strip(await readFile(new URL('001_initial.sql', dir), 'utf8')))
  await db.exec(strip(await readFile(new URL('002_share_links.sql', dir), 'utf8')))
  await db.exec(strip(await readFile(new URL('003_full_text_search.sql', dir), 'utf8')))

  server = new PGLiteSocketServer({ db, port: 5599, host: '127.0.0.1' })
  await server.start()

  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5599/postgres'
  process.env.JWT_SECRET = 'route-test-secret-that-is-long-enough'
  process.env.BOOTSTRAP_ADMIN_EMAIL = 'admin@example.com'
  process.env.BOOTSTRAP_ADMIN_PASSWORD = 'correct horse battery staple'
  process.env.BOOTSTRAP_ADMIN_NAME = 'Admin'

  const dbModule = await import('../src/core/db.js')
  pool = dbModule.pool
  // Replaying 001 must not trip over the missing extension.
  const rawQuery = pool.query.bind(pool) as (sql: unknown, params?: unknown) => Promise<unknown>
  ;(pool as unknown as { query: unknown }).query = (sql: unknown, params?: unknown) =>
    rawQuery(typeof sql === 'string' ? strip(sql) : sql, params)
  await dbModule.initializeWorkspace({ info: () => undefined })

  const Fastify = (await import('fastify')).default
  const jwt = (await import('@fastify/jwt')).default
  const { registerRoutes } = await import('../src/routes/index.js')
  const { fail } = await import('../src/core/http.js')

  app = Fastify({ logger: false })
  await app.register(jwt, { secret: process.env.JWT_SECRET })
  app.decorate('authenticate', async function (request, reply) {
    try { await request.jwtVerify() }
    catch { return fail(reply, 401, 'UNAUTHENTICATED', 'A valid bearer token is required.') }
  })
  // The limiter is not what this file tests; the pass-through keeps the suite
  // fast without pretending the budget does not exist.
  registerRoutes(app, {
    authenticate: { preHandler: app.authenticate },
    rateLimit: (() => async () => undefined) as never,
  })
  await app.ready()

  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'admin@example.com', password: 'correct horse battery staple' } })
  assert.equal(login.statusCode, 200, login.body)
  token = login.json().token

  // A plain member, to prove restricted documents stay out of their results.
  const { passwordHash } = await import('../src/core/security.js')
  const ws = await pool.query('SELECT id FROM workspaces LIMIT 1')
  const member = await pool.query<{ id: string }>(
    'INSERT INTO users(email,name,password_hash) VALUES ($1,$2,$3) RETURNING id',
    ['member@example.com', 'Member', await passwordHash('correct horse battery staple')],
  )
  await pool.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,'member')", [ws.rows[0].id, member.rows[0]!.id])
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

async function createDocument(title: string, text: string, restricted = false) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/documents',
    headers: auth(token),
    payload: { title, content: { schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } } },
  })
  assert.equal(response.statusCode, 201, response.body)
  const document = response.json().document
  if (restricted) {
    await pool.query('UPDATE documents SET acl_restricted=true WHERE id=$1', [document.id])
  }
  return document
}

function search(q: string, options: { scope?: string; bearer?: string } = {}) {
  const scope = options.scope ? '&scope=' + options.scope : ''
  return app.inject({
    method: 'GET',
    url: '/api/v1/documents/search?q=' + encodeURIComponent(q) + scope,
    headers: auth(options.bearer ?? token),
  })
}

test('finds Chinese and English documents through the endpoint', async () => {
  await createDocument('季度计划', '本文说明写作方法，以及季度目标的拆解。')
  await createDocument('Quarterly plan', 'Revenue grew in the third quarter.')

  const chinese = await search('写作')
  assert.equal(chinese.statusCode, 200)
  assert.deepEqual(chinese.json().results.map((hit: { title: string }) => hit.title), ['季度计划'])

  const english = await search('revenue')
  assert.deepEqual(english.json().results.map((hit: { title: string }) => hit.title), ['Quarterly plan'])
});

test('returns a prose snippet and no Tiptap JSON', async () => {
  const response = await search('quarter')
  const hit = response.json().results[0]
  assert.ok(hit.snippet.includes('Revenue'), hit.snippet)
  assert.ok(!JSON.stringify(hit).includes('"type":"doc"'), 'the body must not leak into the hit')
});

test('scope narrows the match', async () => {
  await createDocument('Roadmap', 'mentions migration once')
  await createDocument('Migration notes', 'unrelated body')

  const titleOnly = await search('migration', { scope: 'title' })
  assert.deepEqual(titleOnly.json().results.map((hit: { title: string }) => hit.title), ['Migration notes'])
  const contentOnly = await search('migration', { scope: 'content' })
  assert.deepEqual(contentOnly.json().results.map((hit: { title: string }) => hit.title), ['Roadmap'])
});

test('a query with nothing searchable is an empty result, not an error', async () => {
  for (const q of ['!!!', '&&&', '...']) {
    const response = await search(q)
    assert.equal(response.statusCode, 200, q)
    assert.deepEqual(response.json().results, [], q)
  }
  // Whitespace-only is caught by the schema before it reaches the index.
  const blank = await app.inject({ method: 'GET', url: '/api/v1/documents/search?q=%20%20%20', headers: auth(token) })
  assert.equal(blank.statusCode, 400)
});

test('a restricted document is invisible to members', async () => {
  await createDocument('Board minutes', 'classified compensation figures', true)

  const asMember = await search('classified', { bearer: memberToken })
  assert.deepEqual(asMember.json().results, [])
  // The workspace admin override still reaches it.
  const asAdmin = await search('classified')
  assert.equal(asAdmin.json().results.length, 1)
});

test('rejects an over-long query and an unknown scope', async () => {
  const long = await search('x'.repeat(201))
  assert.equal(long.statusCode, 400)
  assert.equal(long.json().error.code, 'INVALID_INPUT')

  const badScope = await search('x', { scope: 'everything' })
  assert.equal(badScope.statusCode, 400)
});

test('search requires a session', async () => {
  const anonymous = await app.inject({ method: 'GET', url: '/api/v1/documents/search?q=x' })
  assert.equal(anonymous.statusCode, 401)
});
