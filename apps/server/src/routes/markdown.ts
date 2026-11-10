import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { fail, parse } from '../http.js'
import { markdownToTiptap } from '../lib/markdown.js'

/** Markdown → Tiptap JSON, used by the CLI before it posts a document. */
export function registerMarkdownRoutes(app: FastifyInstance) {
  app.post('/api/v1/markdown/convert', async (request, reply) => {
    const input = parse(z.object({ markdown: z.string().min(1).max(500000) }), request.body)
    if (!input) return fail(reply, 400, 'INVALID_INPUT', 'Provide markdown text.')
    const doc = markdownToTiptap(input.markdown)
    return { content: { schemaVersion: 1, doc } }
  })
}
