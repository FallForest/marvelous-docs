import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { safeUser } from '../security.js'
import { templates } from '../lib/templates.js'
import type { AuthRequest } from '../types.js'
import type { RouteDeps } from './deps.js'

/** Workspace-level reads: members, stats, and the template catalogue. */
export function registerWorkspaceRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get('/api/v1/workspace/members', deps.authenticate, async (request) => {
    const auth = request as AuthRequest
    const result = await pool.query(
      'SELECT u.id,u.email,u.name,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.workspace_id=$1 ORDER BY u.name',
      [auth.user.workspaceId])
    return { members: result.rows.map((row) => ({ ...safeUser(row), role: row.role })) }
  })

  app.get('/api/v1/workspace/stats', deps.authenticate, async (request) => {
    const auth = request as AuthRequest
    const result = await pool.query<Record<string, string>>(
      `SELECT
         (SELECT count(*) FROM documents WHERE workspace_id=$1 AND kind='document' AND deleted_at IS NULL) AS documents,
         (SELECT count(*) FROM documents WHERE workspace_id=$1 AND kind='folder' AND deleted_at IS NULL) AS folders,
         (SELECT count(*) FROM memberships WHERE workspace_id=$1) AS members,
         (SELECT count(*) FROM comments c JOIN documents d ON d.id=c.document_id WHERE d.workspace_id=$1 AND c.status='open' AND d.deleted_at IS NULL) AS "openComments",
         (SELECT count(*) FROM documents WHERE workspace_id=$1 AND deleted_at IS NOT NULL) AS trashed,
         (SELECT count(*) FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE d.workspace_id=$1) AS versions`,
      [auth.user.workspaceId])
    const row = result.rows[0]!
    return {
      stats: {
        documents: Number(row.documents),
        folders: Number(row.folders),
        members: Number(row.members),
        openComments: Number(row.openComments),
        trashed: Number(row.trashed),
        versions: Number(row.versions),
      },
    }
  })

  app.get('/api/v1/templates', deps.authenticate, async () => ({
    templates: templates.map(({ id, name, description, content }) => ({ id, name, description, content })),
  }))
}
