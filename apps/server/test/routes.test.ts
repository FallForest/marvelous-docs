import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import { registerRoutes } from '../src/routes/index.js'

/**
 * Structural guard for the route table.
 *
 * The REST surface is assembled from a dozen modules, so a refactor can drop
 * an endpoint without any type error. This builds the same table the entry
 * point builds, records every registration through Fastify's own onRoute hook,
 * and compares it with the contract in docs/API.md.
 */

const EXPECTED_ROUTES = [
  'GET /healthz',
  'GET /api/v1/system/version',
  'GET /api/v1/system/update-check',
  'POST /api/v1/system/update',
  'GET /api/v1/system/update-status',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/accept-invite',
  'GET /api/v1/me',
  'POST /api/v1/invites',
  'GET /api/v1/documents',
  'GET /api/v1/documents/trash',
  'GET /api/v1/documents/recent',
  'GET /api/v1/documents/favorites',
  'GET /api/v1/documents/search',
  'POST /api/v1/documents',
  'POST /api/v1/documents/import',
  'GET /api/v1/documents/:id',
  'PUT /api/v1/documents/:id',
  'DELETE /api/v1/documents/:id',
  'POST /api/v1/documents/:id/restore',
  'DELETE /api/v1/documents/:id/permanent',
  'GET /api/v1/documents/:id/export',
  'POST /api/v1/documents/:id/duplicate',
  'PUT /api/v1/documents/:id/favorite',
  'GET /api/v1/documents/:id/activity',
  'GET /api/v1/documents/:id/acl',
  'PUT /api/v1/documents/:id/acl',
  'POST /api/v1/documents/:id/share-link',
  'GET /api/v1/documents/:id/share-link',
  'DELETE /api/v1/documents/:id/share-link/:linkId',
  'GET /api/v1/shared/:token',
  'GET /api/v1/documents/:id/comments',
  'POST /api/v1/documents/:id/comments',
  'PATCH /api/v1/documents/:id/comments/:commentId',
  'GET /api/v1/documents/:id/versions',
  'GET /api/v1/documents/:id/versions/:versionId',
  'POST /api/v1/documents/:id/versions/:versionId/restore',
  'PUT /api/v1/uploads',
  'GET /api/v1/uploads/:filename',
  'GET /api/v1/workspace/members',
  'GET /api/v1/workspace/stats',
  'GET /api/v1/templates',
  'POST /api/v1/markdown/convert',
]

async function buildApp() {
  const app = Fastify({ logger: false })
  const registered = new Set<string>()

  // Collect registrations instead of parsing the printed route tree.
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    for (const method of methods) registered.add(`${method} ${route.url}`)
  })

  await app.register(jwt, { secret: 'test-only-secret-that-is-long-enough' })
  app.decorate('authenticate', async function (this: unknown, request: { jwtVerify: () => Promise<unknown> }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
    if (this !== app) return undefined
    try { await request.jwtVerify() }
    catch { return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'A valid bearer token is required.' } }) }
  })
  const authenticate = { preHandler: (app as unknown as { authenticate: (request: unknown, reply: unknown) => Promise<unknown> }).authenticate }
  // The structural test only inspects the table, so the limiter is a pass-through.
  const rateLimit = () => async () => undefined
  registerRoutes(app, { authenticate, rateLimit: rateLimit as never })
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' } }))
  await app.ready()
  return { app, registered }
}

test('the route table registers every documented endpoint', async () => {
  const { app, registered } = await buildApp()
  assert.ok(registered.size > 0, 'no routes were registered')

  const missing = EXPECTED_ROUTES.filter((route) => !registered.has(route))
  assert.deepEqual(missing, [], 'routes missing from the table: ' + missing.join(', '))
  await app.close()
})

test('literal document paths win over the :id parameter route', async () => {
  const { app } = await buildApp()
  // Matched as /documents/:id these would fail id validation (400) before the
  // auth hook could run, so 401 proves the literal route handled them.
  for (const url of ['/api/v1/documents/trash', '/api/v1/documents/search?q=x', '/api/v1/documents/favorites']) {
    const response = await app.inject({ method: 'GET', url })
    assert.equal(response.statusCode, 401, url + ' should be guarded, not rejected as an id')
    assert.equal(response.json().error.code, 'UNAUTHENTICATED')
  }
  await app.close()
})
