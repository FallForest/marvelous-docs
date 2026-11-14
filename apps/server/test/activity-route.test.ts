import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { settle, socketUrl } from './socket-url.js'

// A real PostgreSQL-compatible database and the real route/guard code. No
// user data or running application database is touched by these requests.
const WS = '11111111-1111-4111-8111-111111111111'
const OTHER_WS = '11111111-1111-4111-8111-222222222222'
const ADMIN = '22222222-2222-4222-8222-222222222222'
const MEMBER = '33333333-3333-4333-8333-333333333333'
const OUTSIDER = '44444444-4444-4444-8444-444444444444'
const body = { schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'BODY_MUST_NOT_APPEAR_IN_HISTORY' }] }] } }
let app: FastifyInstance
let db: PGlite
let socket: PGLiteSocketServer
let pool: Pool
let activity: typeof import('../src/domain/access.js')
let rooms: typeof import('../src/collaboration/rooms.js')

test.before(async () => {
  db = new PGlite()
  const directory = new URL('../migrations/', import.meta.url)
  for (const name of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) {
    await db.exec((await readFile(new URL(name, directory), 'utf8')).replace(/CREATE EXTENSION[^;]+;/gi, ''))
  }
  await db.query('INSERT INTO workspaces(id,name) VALUES ($1,$2),($3,$4)', [WS, 'Activity fixture', OTHER_WS, 'Other workspace'])
  for (const [id, name] of [[ADMIN, 'Actual administrator'], [MEMBER, 'Actual member'], [OUTSIDER, 'Other administrator']]) {
    await db.query('INSERT INTO users(id,email,name,password_hash) VALUES ($1,$2,$3,$4)', [id, id + '@example.test', name, 'not-used'])
  }
  await db.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,'admin'),($1,$3,'member'),($4,$5,'admin')", [WS, ADMIN, MEMBER, OTHER_WS, OUTSIDER])
  socket = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 4 })
  await socket.start()
  // The port is assigned by the OS: a fixed one collides with the suite that ran
  // before, and a killed-but-lingering process blocks the next run with EADDRINUSE.
  process.env.DATABASE_URL = socketUrl(socket)
  process.env.JWT_SECRET = 'activity-route-test-isolated-secret'
  pool = (await import('../src/core/db.js')).pool
  activity = await import('../src/domain/access.js')
  rooms = await import('../src/collaboration/rooms.js')
  const Fastify = (await import('fastify')).default
  const { registerRoutes } = await import('../src/routes/index.js')
  app = Fastify({ logger: false })
  registerRoutes(app, {
    authenticate: { preHandler: async (request) => {
      const user = request.headers['x-test-user'] === 'member' ? MEMBER : request.headers['x-test-user'] === 'outsider' ? OUTSIDER : ADMIN
      Object.assign(request, { user: { sub: user, email: user + '@example.test', workspaceId: user === OUTSIDER ? OTHER_WS : WS } })
    } },
    rateLimit: (() => async () => undefined) as never,
  })
  await app.ready()
})

test.after(async () => {
  if (rooms) for (const id of rooms.rooms.keys()) rooms.evictRoom(id)
  await settle('close(app)', app?.close())
  await settle('pool.end', pool?.end())
  await settle('stop(socket)', socket?.stop())
  await settle('close(db)', db?.close())
})

async function document(title = 'History fixture') {
  const result = await pool.query<{ id: string }>('INSERT INTO documents(workspace_id,title,content,created_by,updated_by) VALUES ($1,$2,$3,$4,$4) RETURNING id', [WS, title, body, ADMIN])
  return result.rows[0]!.id
}

async function request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: Record<string, unknown>, user = 'admin') {
  return app.inject({ method, url: '/api/v1' + url, headers: { 'x-test-user': user }, ...(payload ? { payload } : {}) })
}

async function actions(id: string) {
  const response = await request('GET', '/documents/' + id + '/activity')
  assert.equal(response.statusCode, 200, response.body)
  return response.json().activity as Array<{ action: string; details: Record<string, unknown>; userId: string; userName: string }>
}

test('background document reads are silent, explicit visits deduplicate concurrently, and recent stays access-scoped', async () => {
  const id = await document()
  for (let i = 0; i < 3; i++) assert.equal((await request('GET', '/documents/' + id)).statusCode, 200)
  assert.equal((await pool.query('SELECT 1 FROM document_activity WHERE document_id=$1', [id])).rowCount, 0)
  const opens = await Promise.all(Array.from({ length: 4 }, () => request('GET', '/documents/' + id + '?visit=1')))
  assert.ok(opens.every((response) => response.statusCode === 200))
  const before = await pool.query('SELECT created_at FROM document_activity WHERE document_id=$1', [id])
  assert.equal(before.rowCount, 1, 'concurrent opens share one recent-visit window')
  assert.deepEqual(await actions(id), [], 'visits do not fill the user-facing activity list')
  const recent = await request('GET', '/documents/recent')
  assert.ok(recent.json().documents.some((row: { id: string }) => row.id === id))
  assert.equal((await request('GET', '/documents/' + id + '?visit=1', undefined, 'member')).statusCode, 200)
  await pool.query('UPDATE documents SET acl_restricted=true WHERE id=$1', [id])
  const hidden = await request('GET', '/documents/recent', undefined, 'member')
  assert.ok(!hidden.json().documents.some((row: { id: string }) => row.id === id))
  assert.equal((await request('GET', '/documents/' + id + '/history', undefined, 'member')).statusCode, 403)
  assert.equal((await request('GET', '/documents/' + id + '/history', undefined, 'outsider')).statusCode, 404)
  await pool.query("UPDATE document_recent_visits SET visited_at=now()-interval '6 minutes' WHERE document_id=$1 AND user_id=$2", [id, ADMIN])
  assert.equal((await request('GET', '/documents/' + id + '?visit=1')).statusCode, 200)
  const after = await pool.query('SELECT created_at FROM document_activity WHERE document_id=$1 AND user_id=$2 ORDER BY created_at', [id, ADMIN])
  assert.equal(after.rowCount, 2)
  assert.equal(after.rows[0]!.created_at.toISOString(), before.rows[0]!.created_at.toISOString(), 'deduplication never rewrites legacy activity time')
  assert.equal((await request('GET', '/documents/' + id + '?visit=0')).statusCode, 400)
})

test('ACL and public-link changes record concrete summaries without link credentials or no-op events', async () => {
  const id = await document()
  const payload = { userId: MEMBER, role: 'viewer', restricted: true }
  assert.equal((await request('PUT', '/documents/' + id + '/acl', payload)).statusCode, 200)
  assert.equal((await request('PUT', '/documents/' + id + '/acl', payload)).statusCode, 200)
  let entries = await actions(id)
  assert.equal(entries.length, 1, 'repeating the same permission does not create history')
  assert.equal(entries[0]!.action, 'acl')
  assert.deepEqual(entries[0]!.details, { targetUserId: MEMBER, targetUserName: 'Actual member', beforeRole: null, afterRole: 'viewer', beforeRestricted: false, afterRestricted: true })
  assert.equal(entries[0]!.userId, ADMIN)
  assert.equal(entries[0]!.userName, 'Actual administrator')
  assert.equal((await request('PUT', '/documents/' + id + '/acl', { userId: ADMIN, role: null })).statusCode, 400)
  assert.equal((await request('POST', '/documents/' + id + '/share-link', {}, 'member')).statusCode, 403)
  const created = await request('POST', '/documents/' + id + '/share-link', { permission: 'commenter', expiresInDays: 2 })
  assert.equal(created.statusCode, 201, created.body)
  const link = created.json().shareLink
  assert.equal((await request('DELETE', '/documents/' + id + '/share-link/' + link.id)).statusCode, 200)
  assert.equal((await request('DELETE', '/documents/' + id + '/share-link/' + link.id)).statusCode, 200)
  entries = await actions(id)
  assert.deepEqual(entries.map((row) => row.action).sort(), ['acl', 'share_link_created', 'share_link_revoked'])
  const shared = entries.filter((row) => row.action.startsWith('share_link'))
  assert.ok(shared.every((row) => row.details.shareLinkId === link.id && row.details.permission === 'commenter' && typeof row.details.expiresAt === 'string'))
  assert.ok(!JSON.stringify(entries).includes(link.token))
  await activity.recordActivity(id, ADMIN, 'share_link_created', undefined, { permission: 'viewer', token: 'FORBIDDEN_TOKEN', url: 'https://secret.invalid/token' })
  const stored = await pool.query('SELECT details FROM document_activity WHERE document_id=$1 AND details->>\'permission\'=$2', [id, 'viewer'])
  assert.deepEqual(stored.rows[0]!.details, { permission: 'viewer' })
  assert.ok(!JSON.stringify((await request('GET', '/documents/' + id + '/history')).json()).includes('FORBIDDEN_TOKEN'))
})

test('trash restoration and legacy history restoration are distinct events and legacy noise is retained but hidden', async () => {
  const id = await document()
  await pool.query("INSERT INTO document_activity(document_id,user_id,action) VALUES ($1,$2,'view'),($1,$2,'edit'),($1,$2,'restore')", [id, ADMIN])
  assert.equal((await request('DELETE', '/documents/' + id)).statusCode, 200)
  assert.equal((await request('POST', '/documents/' + id + '/restore')).statusCode, 200)
  const entries = await actions(id)
  assert.deepEqual(entries.map((entry) => entry.action).sort(), ['restore', 'trash', 'trash_restore'])
  assert.equal(entries.find((entry) => entry.action === 'trash_restore')!.details.affectedCount, 1)
  assert.equal((await pool.query('SELECT 1 FROM document_activity WHERE document_id=$1', [id])).rowCount, 5)
})

test('the unified timeline pages mixed metadata with stable microsecond/tie cursors and never returns snapshot content', async () => {
  const id = await document()
  for (let version = 1; version <= 3; version++) {
    await pool.query(`INSERT INTO document_versions(document_id,version,title,content,created_by,created_at,reason,summary)
      VALUES ($1,$2,$3,$4,$5,$6,'legacy','{}')`, [id, version, 'Snapshot ' + version, body, ADMIN, '2026-11-14T02:00:00.000' + version + '00Z'])
  }
  for (const [action, date] of [['rename', '.000100Z'], ['move', '.000200Z'], ['restore', '.000300Z'], ['edit', '.000400Z'], ['view', '.000500Z']]) {
    await pool.query('INSERT INTO document_activity(document_id,user_id,action,created_at,details) VALUES ($1,$2,$3,$4,$5)', [id, ADMIN, action, '2026-11-14T02:00:00' + date, { beforeTitle: 'Old', afterTitle: 'New', token: 'DO_NOT_RETURN' }])
  }
  const expected = await pool.query(`SELECT id FROM (
    SELECT 'snapshot:'||id::text AS id,created_at FROM document_versions WHERE document_id=$1
    UNION ALL SELECT 'event:'||id::text,created_at FROM document_activity WHERE document_id=$1 AND action NOT IN ('view','edit')
  ) ordered ORDER BY created_at DESC,id DESC`, [id])
  const collected: Array<Record<string, unknown>> = []
  let cursor: string | null = null
  do {
    const response = await request('GET', '/documents/' + id + '/history?limit=2' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))
    assert.equal(response.statusCode, 200, response.body)
    collected.push(...response.json().items)
    cursor = response.json().nextCursor
    assert.ok(collected.length <= 6, 'a timestamp tie must not repeat the previous page')
  } while (cursor)
  assert.deepEqual(collected.map((row) => row.id), expected.rows.map((row) => row.id))
  assert.equal(new Set(collected.map((row) => row.id)).size, 6)
  assert.ok(collected.every((row) => row.userId === ADMIN && row.userName === 'Actual administrator'))
  assert.ok(!JSON.stringify(collected).includes('BODY_MUST_NOT_APPEAR_IN_HISTORY'))
  assert.ok(!JSON.stringify(collected).includes('DO_NOT_RETURN'))
  assert.ok(collected.filter((row) => row.kind === 'snapshot').every((row) => row.versionId && row.reason === 'legacy' && !('content' in row)))
  assert.equal((await pool.query('SELECT 1 FROM document_versions WHERE document_id=$1', [id])).rowCount, 3)
  assert.equal((await pool.query('SELECT 1 FROM document_activity WHERE document_id=$1', [id])).rowCount, 5)
  assert.equal((await request('GET', '/documents/' + id + '/history?cursor=not-valid')).statusCode, 400)
  assert.equal((await request('GET', '/documents/' + id + '/history?limit=101')).statusCode, 400)
})

test('the activity migration can replay without deleting legacy rows or moving recent timestamps', async () => {
  const id = await document()
  await pool.query("INSERT INTO document_activity(document_id,user_id,action,created_at) VALUES ($1,$2,'view','2020-01-01T00:00:00Z')", [id, ADMIN])
  const migration = await readFile(new URL('../migrations/006_activity_history.sql', import.meta.url), 'utf8')
  await pool.query(migration)
  await pool.query(migration)
  const visit = await pool.query('SELECT visited_at FROM document_recent_visits WHERE document_id=$1 AND user_id=$2', [id, ADMIN])
  assert.equal(visit.rows[0]!.visited_at.toISOString(), '2020-01-01T00:00:00.000Z')
  assert.equal((await pool.query('SELECT 1 FROM document_activity WHERE document_id=$1', [id])).rowCount, 1)
})
