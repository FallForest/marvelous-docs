import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { fail, parse } from '../http.js'
import { getDocumentAccess } from '../access.js'
import { flushRoom, rooms } from '../collaboration/rooms.js'
import { requireDoc } from '../guards.js'
import { exportResponse, type ExportFormat } from '../lib/markdown.js'
import { idParams } from './schemas.js'
import type { AuthRequest } from '../types.js'
import type { RouteDeps } from './deps.js'

/**
 * Document export and the per-document activity log.
 *
 * Export flushes the room first so a download never lags behind live edits.
 */
export function registerExportRoutes(app: FastifyInstance, deps: RouteDeps) {
  // Exporting flushes the live room and serialises the whole document.
  app.get('/api/v1/documents/:id/export', { preHandler: [deps.authenticate.preHandler, deps.rateLimit(60, 5 * 60 * 1000)] }, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    const query = parse(z.object({ format: z.enum(['markdown', 'html', 'json']).default('markdown') }), request.query)
    if (!query) return fail(reply, 400, 'INVALID_INPUT', 'format must be markdown, html, or json.')

    const room = rooms.get(params.id)
    if (room) await flushRoom(room)

    const access = await getDocumentAccess(auth.user, params.id)
    if (!access) return fail(reply, 404, 'NOT_FOUND', 'Document was not found.')
    if (access.role === 'none') return fail(reply, 403, 'FORBIDDEN', 'You do not have permission for this operation.')

    const payload = exportResponse({ id: access.row.id, title: access.row.title, content: access.row.content }, query.format as ExportFormat)
    reply.header('Content-Disposition', `attachment; filename="${payload.filename}"`)
    return payload
  })

  app.get('/api/v1/documents/:id/activity', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    if (!await requireDoc(auth, reply, params.id)) return

    const query = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }), request.query)
    if (!query) return fail(reply, 400, 'INVALID_INPUT', 'limit must be an integer between 1 and 100.')

    const result = await pool.query(
      'SELECT a.id,a.user_id AS "userId",u.name AS "userName",a.action,a.created_at AS "createdAt" FROM document_activity a JOIN users u ON u.id=a.user_id WHERE a.document_id=$1 ORDER BY a.created_at DESC LIMIT $2',
      [params.id, query.limit])
    return { activity: result.rows }
  })
}
