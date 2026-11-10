import type { FastifyRequest } from 'fastify'

/**
 * Shared dependencies handed to every route module.
 *
 * Routes take these as arguments instead of importing the Fastify instance,
 * which keeps the modules free of import cycles and lets the entry point own
 * plugin registration and decoration.
 */
export type RouteDeps = {
  /** preHandler that rejects unauthenticated requests with 401. */
  authenticate: { preHandler: (request: FastifyRequest, reply: import('fastify').FastifyReply) => Promise<unknown> }
}
