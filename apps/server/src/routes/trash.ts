import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { fail, parse } from '../http.js'
import { accessRoleFor, recordActivity, ROLE_LEVEL } from '../access.js'
import { requireNode } from '../guards.js'
import { idParams } from './schemas.js'
import type { AuthRequest, DocumentRow } from '../types.js'
import type { RouteDeps } from './deps.js'

/**
 * Trash lifecycle: soft delete (with descendants), restore, permanent delete.
 *
 * Deletes cascade through the subtree so a folder never leaves orphans behind.
 */
export function registerTrashRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.delete('/api/v1/documents/:id', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    if (!await requireNode(auth, reply, params.id, 'owner')) return

    await pool.query(`WITH RECURSIVE subtree AS (
        SELECT id FROM documents WHERE id=$1 AND workspace_id=$3
        UNION ALL SELECT d.id FROM documents d JOIN subtree s ON d.parent_id=s.id
      ) UPDATE documents SET deleted_at=now(),updated_at=now(),updated_by=$2
        WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL`, [params.id, auth.user.sub, auth.user.workspaceId])
    return { ok: true }
  })

  app.post('/api/v1/documents/:id/restore', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')

    // Trashed rows are invisible to requireNode, so resolve the role here.
    const result = await pool.query<DocumentRow & { role: string | null; member_role: string }>(`SELECT d.*, da.role, m.role AS member_role FROM documents d
      JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$2
      LEFT JOIN document_acl da ON da.document_id=d.id AND da.user_id=$2
      WHERE d.id=$1 AND d.workspace_id=$3`, [params.id, auth.user.sub, auth.user.workspaceId])
    if (!result.rowCount || !result.rows[0]!.deleted_at) return fail(reply, 404, 'NOT_FOUND', 'Document was not found.')

    const row = result.rows[0]!
    if (ROLE_LEVEL[accessRoleFor(row)]! < ROLE_LEVEL.editor!) {
      return fail(reply, 403, 'FORBIDDEN', 'You do not have permission for this operation.')
    }
    await pool.query(`WITH RECURSIVE subtree AS (
        SELECT id FROM documents WHERE id=$1
        UNION ALL SELECT d.id FROM documents d JOIN subtree s ON d.parent_id=s.id
      ) UPDATE documents SET deleted_at=NULL,updated_at=now(),updated_by=$2
        WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NOT NULL`, [params.id, auth.user.sub])
    await recordActivity(params.id, auth.user.sub, 'restore', app.log)
    return { ok: true }
  })

  app.delete('/api/v1/documents/:id/permanent', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')

    const owner = await pool.query(`SELECT 1 FROM documents d
      JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$2
      LEFT JOIN document_acl a ON a.document_id=d.id AND a.user_id=$2
      WHERE d.id=$1 AND (m.role='admin' OR a.role='owner' OR d.created_by=$2)`, [params.id, auth.user.sub])
    if (!owner.rowCount) return fail(reply, 404, 'NOT_FOUND', 'Document was not found.')

    await pool.query(`WITH RECURSIVE subtree AS (
        SELECT id FROM documents WHERE id=$1
        UNION ALL SELECT d.id FROM documents d JOIN subtree s ON d.parent_id=s.id
      ) DELETE FROM documents WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NOT NULL`, [params.id])
    return { ok: true }
  })
}
