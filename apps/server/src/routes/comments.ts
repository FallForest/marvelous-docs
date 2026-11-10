import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { fail, parse } from '../http.js'
import { requireDoc } from '../guards.js'
import { idParams, uuidSchema } from './schemas.js'
import type { AuthRequest } from '../types.js'
import type { RouteDeps } from './deps.js'

/** Threaded comments with a text anchor, status, and resolver. */
export function registerCommentRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get('/api/v1/documents/:id/comments', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    if (!await requireDoc(auth, reply, params.id)) return

    const result = await pool.query(
      'SELECT c.id,c.parent_id AS "parentId",c.body,c.anchor,c.status,c.resolved_at AS "resolvedAt",c.resolved_by AS "resolvedBy",c.created_at AS "createdAt",c.updated_at AS "updatedAt",u.id AS "userId",u.name AS "userName" FROM comments c JOIN users u ON u.id=c.user_id WHERE c.document_id=$1 ORDER BY c.created_at',
      [params.id])
    return { comments: result.rows }
  })

  app.post('/api/v1/documents/:id/comments', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    if (!await requireDoc(auth, reply, params.id, 'editor')) return

    const input = parse(z.object({
      body: z.string().trim().min(1).max(10000),
      anchor: z.unknown().optional(),
      parentId: uuidSchema.nullable().optional(),
    }), request.body)
    if (!input) return fail(reply, 400, 'INVALID_INPUT', 'Comment body is required.')

    if (input.parentId) {
      const parent = await pool.query('SELECT 1 FROM comments WHERE id=$1 AND document_id=$2', [input.parentId, params.id])
      if (!parent.rowCount) return fail(reply, 404, 'PARENT_COMMENT_NOT_FOUND', 'Parent comment was not found.')
    }

    const result = await pool.query(
      'INSERT INTO comments(document_id,user_id,body,anchor,parent_id) VALUES ($1,$2,$3,$4,$5) RETURNING id,parent_id AS "parentId",body,anchor,status,created_at AS "createdAt",updated_at AS "updatedAt"',
      [params.id, auth.user.sub, input.body, input.anchor ?? null, input.parentId ?? null])
    return reply.code(201).send({ comment: { ...result.rows[0], userId: auth.user.sub } })
  })

  app.patch('/api/v1/documents/:id/comments/:commentId', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(z.object({ id: uuidSchema, commentId: uuidSchema }), request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document and comment ids must be UUIDs.')
    if (!await requireDoc(auth, reply, params.id, 'editor')) return

    const input = parse(z.object({
      body: z.string().trim().min(1).max(10000).optional(),
      status: z.enum(['open', 'resolved']).optional(),
    }), request.body)
    if (!input || (!input.body && !input.status)) return fail(reply, 400, 'INVALID_INPUT', 'Comment body or status is required.')

    // Authors edit their own comments; workspace admins may resolve anyone's.
    const result = await pool.query(
      `UPDATE comments SET body=COALESCE($3,body),status=COALESCE($4,status),
         resolved_at=CASE WHEN $4='resolved' THEN now() WHEN $4='open' THEN NULL ELSE resolved_at END,
         resolved_by=CASE WHEN $4='resolved' THEN $2 WHEN $4='open' THEN NULL ELSE resolved_by END,
         updated_at=now()
       WHERE id=$1 AND document_id=$5
         AND (user_id=$2 OR EXISTS (SELECT 1 FROM memberships m JOIN documents d ON d.workspace_id=m.workspace_id WHERE d.id=$5 AND m.user_id=$2 AND m.role='admin'))
       RETURNING id,body,status,parent_id AS "parentId",resolved_at AS "resolvedAt",updated_at AS "updatedAt"`,
      [params.commentId, auth.user.sub, input.body ?? null, input.status ?? null, params.id])
    if (!result.rowCount) return fail(reply, 404, 'COMMENT_NOT_FOUND', 'Comment was not found.')
    return { comment: result.rows[0] }
  })
}
