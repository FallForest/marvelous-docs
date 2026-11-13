import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { fail, parse } from '../http.js'
import { accessRoleFor, recordActivity, ROLE_LEVEL } from '../access.js'
import { requireNode } from '../guards.js'
import { idParams } from './schemas.js'
import { config } from '../config.js'
import { purgeExpiredTrash } from '../lib/trash.js'
import { evictRoom } from '../collaboration/rooms.js'
import type { AuthRequest, DocumentRow } from '../types.js'
import type { RouteDeps } from './deps.js'

/**
 * Trash lifecycle: soft delete (with descendants), restore, permanent delete,
 * and the bulk empty.
 *
 * Deletes cascade through the subtree so a folder never leaves orphans behind.
 *
 * Retention is a backstop, not the only exit: a row that outlives
 * `TRASH_RETENTION_DAYS` is swept automatically (see `lib/trash.ts` and the
 * timer in `index.ts`), so the bin cannot fill up with things nobody remembers
 * deleting. The empty endpoint exists because the common case is not one
 * mistaken delete — it is forty untitled scratch documents nobody wants.
 */
export function registerTrashRoutes(app: FastifyInstance, deps: RouteDeps) {
  /*
   * `DELETE /documents/trash` clears the whole bin. The path is the same one the
   * list uses, so it reads as "empty the trash" rather than "delete a document
   * named trash"; Fastify resolves the literal segment before `:id`, so the two
   * never collide.
   *
   * Admins clear the whole workspace bin; a member clears only the rows they
   * may see (unrestricted, or explicitly granted), which is the same visibility
   * rule the trash list uses.
   */
  app.delete('/api/v1/documents/trash', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const member = await pool.query<{ role: string }>(
      'SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2', [auth.user.workspaceId, auth.user.sub])
    if (!member.rowCount) return fail(reply, 403, 'FORBIDDEN', 'You do not have permission for this operation.')

    const visibleOnly = member.rows[0]!.role !== 'admin'
    const result = await pool.query<{ id: string }>(
      `WITH RECURSIVE visible AS (
          SELECT d.id FROM documents d
            LEFT JOIN document_acl a ON a.document_id=d.id AND a.user_id=$1
           WHERE d.workspace_id=$2 AND d.acl_restricted=false
          UNION
          SELECT d.id FROM documents d
            JOIN document_acl a ON a.document_id=d.id AND a.user_id=$1
           WHERE d.workspace_id=$2
        ), subtree AS (
          SELECT d.id FROM documents d WHERE d.workspace_id=$2 AND d.deleted_at IS NOT NULL
             AND ($3::boolean = false OR d.id IN (SELECT id FROM visible))
          UNION ALL
          SELECT child.id FROM documents child JOIN subtree s ON child.parent_id = s.id
        )
        DELETE FROM documents WHERE id IN (SELECT id FROM subtree) RETURNING id`,
      [auth.user.sub, auth.user.workspaceId, visibleOnly])
    // Same reason as the sweep: a stale tab must not keep writing to a row that
    // is gone, and a room's debounced save would do exactly that.
    for (const row of result.rows) evictRoom(row.id)
    return { ok: true, removed: result.rowCount ?? 0 }
  })

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
    return { ok: true, retentionDays: config.trashRetentionDays }
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

    const removed = await pool.query<{ id: string }>(`WITH RECURSIVE subtree AS (
        SELECT id FROM documents WHERE id=$1
        UNION ALL SELECT d.id FROM documents d JOIN subtree s ON d.parent_id=s.id
      ) DELETE FROM documents WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NOT NULL RETURNING id`, [params.id])
    for (const row of removed.rows) evictRoom(row.id)
    return { ok: true }
  })

  /*
   * The sweep, on demand. The timer already runs it on a schedule, but an admin
   * who has just changed the retention window should not have to wait a quarter
   * hour to see the effect, and the operation is one statement.
   */
  app.post('/api/v1/documents/trash/sweep', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const admin = await pool.query("SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND role='admin'",
      [auth.user.workspaceId, auth.user.sub])
    if (!admin.rowCount) return fail(reply, 403, 'ADMIN_REQUIRED', 'Workspace administrator role is required.')
    try {
      const removed = await purgeExpiredTrash(pool, config.trashRetentionDays)
      for (const id of removed) evictRoom(id)
      return { ok: true, removed: removed.length, retentionDays: config.trashRetentionDays }
    } catch (error) {
      app.log.error(error, 'Trash sweep failed')
      return fail(reply, 500, 'SWEEP_FAILED', 'The trash could not be swept.')
    }
  })
}
