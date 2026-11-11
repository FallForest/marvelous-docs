import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'

/**
 * Shared dependencies handed to every route module.
 *
 * Routes take these as arguments instead of importing the Fastify instance,
 * which keeps the modules free of import cycles and lets the entry point own
 * plugin registration and decoration.
 */
export type RouteDeps = {
  /** preHandler that rejects unauthenticated requests with 401. */
  authenticate: { preHandler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> }
  /**
   * Builds a preHandler limiting `limit` requests per `windowMs` for the caller.
   *
   * Keyed by user id when the request is authenticated and by IP otherwise, so a
   * signed-in abuser cannot dodge the budget by switching networks, and an
   * anonymous flood is still capped per source.
   */
  rateLimit: (limit: number, windowMs: number) => preHandlerHookHandler
}
