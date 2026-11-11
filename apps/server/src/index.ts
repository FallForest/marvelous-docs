import { createServer } from 'node:http'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { config } from './config.js'
import { initializeWorkspace, pool } from './db.js'
import { fail } from './http.js'
import { RateLimiter } from './lib/rate-limit.js'
import { registerRoutes } from './routes/index.js'
import { registerUpgradeHandler } from './collaboration/socket.js'
import { flushRoom, rooms, setRoomLogger } from './collaboration/rooms.js'

/**
 * API entry point.
 *
 * This file only assembles the process: HTTP server, plugins, route table,
 * the collaboration socket, and graceful shutdown. Behaviour lives in
 * ./routes (REST), ./collaboration (rooms + y-websocket) and ./lib (pure
 * helpers). See docs/ARCHITECTURE.md for the module map.
 */

const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 })

// Uploads arrive as raw bodies, so they bypass JSON parsing.
app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body))
for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']) {
  app.addContentTypeParser(type, { parseAs: 'buffer' }, (_request, body, done) => done(null, body))
}

await app.register(cors, {
  origin: config.corsOrigins.length ? config.corsOrigins : config.environment === 'production' ? false : true,
  credentials: true,
})
await app.register(jwt, { secret: config.jwtSecret })

app.addHook('onSend', async (_request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('X-Frame-Options', 'SAMEORIGIN')
  reply.header('Referrer-Policy', 'no-referrer')
  return payload
})

app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
  try { await request.jwtVerify() }
  catch { return fail(reply, 401, 'UNAUTHENTICATED', 'A valid bearer token is required.') }
})

const authenticate = { preHandler: (app as unknown as { authenticate: RouteAuthHandler }).authenticate }

type RouteAuthHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>

/**
 * Builds a requests-per-window guard for an expensive endpoint.
 *
 * The bucket key prefers the authenticated user, so a signed-in abuser cannot
 * reset the budget by changing IP; anonymous traffic falls back to the address.
 * A blocked call answers 429 with Retry-After, which is what a well-behaved
 * client (and the CLI) can back off on.
 */
function rateLimit(limit: number, windowMs: number) {
  const limiter = new RateLimiter({ limit, windowMs })
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as FastifyRequest & { user?: { sub?: string } }).user
    const key = user?.sub ? 'user:' + user.sub : 'ip:' + (request.ip || 'unknown')
    const result = limiter.consume(key)
    if (result.allowed) {
      reply.header('X-RateLimit-Remaining', String(result.remaining))
      return
    }
    reply.header('Retry-After', String(result.retryAfter))
    return fail(reply, 429, 'RATE_LIMITED', 'Too many requests. Retry in ' + result.retryAfter + ' seconds.')
  }
  return handler as unknown as import('fastify').preHandlerHookHandler
}

registerRoutes(app, { authenticate, rateLimit })
setRoomLogger(app.log)

app.setErrorHandler((error, _request, reply) => {
  const status = (error as { statusCode?: number }).statusCode
  if ((error as { validation?: unknown }).validation) return fail(reply, 400, 'INVALID_INPUT', 'Request validation failed.')
  if (status === 413) return fail(reply, 413, 'FILE_TOO_LARGE', 'Request body is too large.')
  if (status && status >= 400 && status < 500) return fail(reply, status, 'INVALID_INPUT', 'The request could not be processed.')
  app.log.error(error)
  return fail(reply, 500, 'INTERNAL_ERROR', 'An unexpected server error occurred.')
})

app.setNotFoundHandler((_request, reply) => fail(reply, 404, 'NOT_FOUND', 'The requested resource was not found.'))

// Collaboration gets its own HTTP server so the WebSocket upgrade never
// competes with the REST connection handling.
const wsHttpServer = createServer()
const wsServer = registerUpgradeHandler(wsHttpServer, app)

await initializeWorkspace({ info: (message) => app.log.info(message) })
await app.listen({ port: config.port, host: config.host })
await new Promise<void>((resolve, reject) => {
  wsHttpServer.once('error', reject)
  wsHttpServer.listen(config.collabPort, config.host, resolve)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    for (const ws of wsServer.clients) ws.close(1001, 'Server shutting down')
    await Promise.all([...rooms.values()].map(flushRoom))
    wsServer.close()
    wsHttpServer.close()
    await app.close()
    await pool.end()
    process.exit(0)
  })
}
