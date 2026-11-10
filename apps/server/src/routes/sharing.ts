import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { fail, parse } from '../http.js'
import { requireDoc } from '../guards.js'
import { idParams } from './schemas.js'
import type { AuthRequest } from '../types.js'
import type { RouteDeps } from './deps.js'

/** Per-document ACL editing plus public share links. */
export function registerSharingRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get('/api/v1/documents/:id/acl', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    if (!await requireDoc(auth, reply, params.id, 'owner')) return

    const result = await pool.query(
      'SELECT u.id AS "userId",u.email,u.name,a.role FROM document_acl a JOIN users u ON u.id=a.user_id WHERE a.document_id=$1 ORDER BY u.name',
      [params.id])
    const settings = await pool.query('SELECT acl_restricted FROM documents WHERE id=$1', [params.id])
    return { restricted: Boolean(settings.rows[0]?.acl_restricted), permissions: result.rows }
  })

  app.put('/api/v1/documents/:id/acl', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    if (!await requireDoc(auth, reply, params.id, 'owner')) return

    const input = parse(z.object({
      userId: z.string().uuid(),
      role: z.enum(['owner', 'editor', 'viewer']).nullable(),
      restricted: z.boolean().optional(),
    }), request.body)
    if (!input) return fail(reply, 400, 'INVALID_INPUT', 'Provide a workspace userId and role, or null to remove the explicit permission.')

    const member = await pool.query(
      'SELECT 1 FROM memberships m JOIN documents d ON d.workspace_id=m.workspace_id WHERE d.id=$1 AND m.user_id=$2',
      [params.id, input.userId])
    if (!member.rowCount) return fail(reply, 404, 'MEMBER_NOT_FOUND', 'User is not a member of this workspace.')
    if (input.userId === auth.user.sub && input.role !== 'owner') {
      return fail(reply, 400, 'OWNER_REQUIRED', 'Document owners cannot remove their own owner role.')
    }

    if (input.restricted !== undefined) {
      await pool.query('UPDATE documents SET acl_restricted=$2 WHERE id=$1', [params.id, input.restricted])
    } else {
      await pool.query('UPDATE documents SET acl_restricted=true WHERE id=$1', [params.id])
    }
    if (input.role === null) {
      await pool.query('DELETE FROM document_acl WHERE document_id=$1 AND user_id=$2', [params.id, input.userId])
    } else {
      await pool.query(
        'INSERT INTO document_acl(document_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT(document_id,user_id) DO UPDATE SET role=EXCLUDED.role',
        [params.id, input.userId, input.role])
    }
    return { ok: true }
  })

  app.post('/api/v1/documents/:id/share-link', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    if (!await requireDoc(auth, reply, params.id, 'owner')) return

    const input = parse(z.object({
      permission: z.enum(['viewer', 'commenter']).default('viewer'),
      expiresInDays: z.number().int().positive().max(365).nullable().optional(),
    }), request.body ?? {})
    if (!input) return fail(reply, 400, 'INVALID_INPUT', 'Provide permission and optional expiresInDays.')

    const token = randomBytes(24).toString('base64url')
    const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400000).toISOString() : null
    const result = await pool.query(
      'INSERT INTO document_share_links(document_id,token,permission,expires_at,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id,token,permission,expires_at AS "expiresAt",created_at AS "createdAt"',
      [params.id, token, input.permission, expiresAt, auth.user.sub])
    return reply.code(201).send({ shareLink: result.rows[0] })
  })

  app.get('/api/v1/documents/:id/share-link', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    if (!await requireDoc(auth, reply, params.id, 'owner')) return

    const result = await pool.query(
      'SELECT id,token,permission,expires_at AS "expiresAt",created_at AS "createdAt" FROM document_share_links WHERE document_id=$1 ORDER BY created_at DESC',
      [params.id])
    return { shareLinks: result.rows }
  })

  app.delete('/api/v1/documents/:id/share-link/:linkId', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(z.object({ id: z.string().uuid(), linkId: z.string().uuid() }), request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Invalid id.')
    if (!await requireDoc(auth, reply, params.id, 'owner')) return

    await pool.query('DELETE FROM document_share_links WHERE id=$1 AND document_id=$2', [params.linkId, params.id])
    return { ok: true }
  })

  /** Public, unauthenticated read of a shared document by token. */
  app.get('/api/v1/shared/:token', async (request, reply) => {
    const params = parse(z.object({ token: z.string().min(10).max(200) }), request.params)
    if (!params) return fail(reply, 400, 'INVALID_TOKEN', 'Invalid share token.')

    const result = await pool.query(
      'SELECT d.id,d.title,d.content,d.updated_at AS "updatedAt",sl.permission FROM document_share_links sl JOIN documents d ON d.id=sl.document_id WHERE sl.token=$1 AND (sl.expires_at IS NULL OR sl.expires_at>now()) AND d.deleted_at IS NULL',
      [params.token])
    if (!result.rowCount) return fail(reply, 404, 'SHARE_NOT_FOUND', 'Share link is invalid or expired.')
    return { document: result.rows[0] }
  })
}
