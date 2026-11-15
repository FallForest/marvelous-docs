import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '../core/db.js'
import { fail, parse } from '../core/http.js'
import { requireDoc } from '../domain/guards.js'
import { idParams, uuidSchema } from './schemas.js'
import type { AuthRequest } from '../core/types.js'
import type { RouteDeps } from './deps.js'

const itemId = z.object({ client: z.number().int().nonnegative(), clock: z.number().int().nonnegative() })
const relativePosition = z.object({ type: itemId.optional(), item: itemId.optional(), tname: z.string().max(100).optional(), assoc: z.number().int().optional() })
const anchorSchema = z.object({
  from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), text: z.string().max(500).optional(),
  blockId: z.string().max(200).optional(), relative: z.object({ from: relativePosition, to: relativePosition }).optional(),
}).refine((anchor) => anchor.from < anchor.to, 'A quote requires a nonempty range.')

/** Threaded comments with a text anchor, status, and resolver. */
export function registerCommentRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get('/api/v1/documents/:id/comments', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    if (!await requireDoc(auth, reply, params.id)) return

    const result = await pool.query(
      'SELECT c.id,c.parent_id AS "parentId",c.body,c.anchor,c.status,c.deleted_at AS "deletedAt",c.resolved_at AS "resolvedAt",c.resolved_by AS "resolvedBy",c.created_at AS "createdAt",c.updated_at AS "updatedAt",u.id AS "userId",u.name AS "userName" FROM comments c JOIN users u ON u.id=c.user_id WHERE c.document_id=$1 ORDER BY c.created_at,c.id',
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
      anchor: anchorSchema.nullable().optional(),
      parentId: uuidSchema.nullable().optional(),
    }), request.body)
    if (!input) return fail(reply, 400, 'INVALID_INPUT', 'Comment body is required.')

    let parentId = input.parentId ?? null
    if (parentId) {
      const parent = await pool.query<{ id: string; status: string }>(`WITH RECURSIVE chain AS (
        SELECT id,parent_id,status,1 AS depth FROM comments WHERE id=$1 AND document_id=$2
        UNION ALL SELECT c.id,c.parent_id,c.status,chain.depth+1 FROM comments c JOIN chain ON c.id=chain.parent_id
        WHERE c.document_id=$2 AND chain.depth<100
      ) SELECT id,status FROM chain WHERE parent_id IS NULL LIMIT 1`, [parentId, params.id])
      if (!parent.rowCount) return fail(reply, 404, 'PARENT_COMMENT_NOT_FOUND', 'Parent discussion was not found.')
      parentId = parent.rows[0]!.id
      if (parent.rows[0]!.status === 'resolved') return fail(reply, 409, 'COMMENT_RESOLVED', 'Reopen the discussion before replying.')
    }

    const result = await pool.query(
      'INSERT INTO comments(document_id,user_id,body,anchor,parent_id) VALUES ($1,$2,$3,$4,$5) RETURNING id,parent_id AS "parentId",body,anchor,status,created_at AS "createdAt",updated_at AS "updatedAt"',
      [params.id, auth.user.sub, input.body, parentId ? null : input.anchor ?? null, parentId])
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

    // All document editors can resolve a discussion. Even administrators may
    // not rewrite another author's words, and deleted words stay deleted.
    const result = await pool.query(
      `UPDATE comments SET body=COALESCE($3,body),status=COALESCE($4,status),
         resolved_at=CASE WHEN $4='resolved' THEN now() WHEN $4='open' THEN NULL ELSE resolved_at END,
         resolved_by=CASE WHEN $4='resolved' THEN $2 WHEN $4='open' THEN NULL ELSE resolved_by END,
         updated_at=now()
       WHERE id=$1 AND document_id=$5
         AND ($3::text IS NULL OR (user_id=$2 AND deleted_at IS NULL))
         AND ($4::text IS NULL OR parent_id IS NULL)
       RETURNING id,body,status,parent_id AS "parentId",deleted_at AS "deletedAt",resolved_at AS "resolvedAt",updated_at AS "updatedAt"`,
      [params.commentId, auth.user.sub, input.body ?? null, input.status ?? null, params.id])
    if (!result.rowCount) return fail(reply, 404, 'COMMENT_NOT_FOUND', 'Comment was not found.')
    return { comment: result.rows[0] }
  })

  app.delete('/api/v1/documents/:id/comments/:commentId', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(z.object({ id: uuidSchema, commentId: uuidSchema }), request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document and comment ids must be UUIDs.')
    if (!await requireDoc(auth, reply, params.id, 'editor')) return
    const result = await pool.query(`UPDATE comments SET body='',deleted_at=now(),updated_at=now()
      WHERE id=$1 AND document_id=$2 AND user_id=$3 AND deleted_at IS NULL
      RETURNING id,body,parent_id AS "parentId",deleted_at AS "deletedAt",updated_at AS "updatedAt"`,
    [params.commentId, params.id, auth.user.sub])
    if (!result.rowCount) return fail(reply, 404, 'COMMENT_NOT_FOUND', 'Comment was not found or cannot be deleted.')
    return { comment: result.rows[0] }
  })
}
