import type { FastifyReply } from 'fastify'
import type { z } from 'zod'

/** The one error envelope every route uses; clients branch on `code`. */
export function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } })
}

export function parse<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const result = schema.safeParse(value)
  return result.success ? result.data : null
}
