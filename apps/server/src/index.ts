import { createServer } from 'node:http'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { config } from './core/config.js'
import { initializeWorkspace, pool } from './core/db.js'
import { fail } from './core/http.js'
import { RateLimiter } from './lib/rate-limit.js'
import { purgeExpiredTrash } from './lib/trash.js'
import { registerRoutes } from './routes/index.js'
import { registerUpgradeHandler } from './collaboration/socket.js'
import { flushRoom, rooms, setRoomLogger, evictRoom } from './collaboration/rooms.js'
/**
 * API entry point.
 *
 * This file only assembles the process: HTTP server, plugins, route table,
 * the collaboration socket, and graceful shutdown. Behaviour lives in
 * ./routes (REST), ./collaboration (rooms + y-websocket) and ./lib (pure
 * helpers). See docs/ARCHITECTURE.md for the module map.
 */

// Just above the 1 GiB a single upload may be, so the route's own check is what
// produces the 413 and its message. A bodyLimit below the route limit rejects the
// body first, with a message that does not say which limit was hit.
const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 * 1024 + 1024 * 1024 })

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
  // Fastify raises 413 for a body over bodyLimit, before any route runs — so this
  // is the message a caller sees for the one case the upload route cannot answer
  // itself. Name the ceiling rather than "request body is too large": the client
  // shows this string verbatim, and a limit the user cannot see is a limit they
  // will hit twice.
  if (status === 413) return fail(reply, 413, 'FILE_TOO_LARGE', 'Files are limited to 1 GB.')
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

/*
 * Trash retention.
 *
 * The sweep runs at boot — so a container that was down over the weekend does
 * not come back holding expired rows — and then on a timer. It is one
 * idempotent statement and never touches a row inside its window, so a failure
 * only means the next tick retries; that is why it can share the process with
 * request handling instead of needing a job runner.
 */
async function sweepTrash() {
  try {
    const removed = await purgeExpiredTrash(pool, config.trashRetentionDays)
    if (!removed.length) return
    /*
     * A purged row may still have a live collaboration room and connected
     * editors — the row was in the bin, but someone can have it open through a
     * stale tab. The room's next debounced save would insert versions for a
     * deleted document, so the room is evicted (clients are closed with it)
     * before the sweep reports success.
     */
    for (const id of removed) evictRoom(id)
    app.log.info({ removed: removed.length, retentionDays: config.trashRetentionDays }, 'Expired trash purged')
  } catch (error) {
    app.log.error(error, 'Trash retention sweep failed')
  }
}
void sweepTrash()
const trashTimer = setInterval(() => void sweepTrash(), config.trashSweepIntervalMs)
trashTimer.unref()

await app.listen({ port: config.port, host: config.host })
await new Promise<void>((resolve, reject) => {
  wsHttpServer.once('error', reject)
  wsHttpServer.listen(config.collabPort, config.host, resolve)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    clearInterval(trashTimer)
    for (const ws of wsServer.clients) ws.close(1001, 'Server shutting down')
    await Promise.all([...rooms.values()].map(flushRoom))
    wsServer.close()
    wsHttpServer.close()
    await app.close()
    await pool.end()
    process.exit(0)
  })
}
