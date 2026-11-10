import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { fail, parse } from '../http.js'
import { documentJson } from '../access.js'
import { flushRoom, rooms } from '../collaboration/rooms.js'
import { recordActivity } from '../access.js'
import { requireDoc } from '../guards.js'
import { searchSnippet } from '../lib/markdown.js'
import { uuidSchema } from './schemas.js'
import type { AuthRequest, DocumentRow } from '../types.js'
import type { RouteDeps } from './deps.js'

const idParams = z.object({ id: uuidSchema })

/**
 * Document reads: the tree, trash, recent, favorites, search, and single
 * document loads (which always flush the live room first).
 */
export function registerDocumentReadRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get('/api/v1/documents', deps.authenticate, async (request) => {
    const auth = request as AuthRequest
    const result = await pool.query<DocumentRow>(`SELECT d.* FROM documents d JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$1
      LEFT JOIN document_acl a ON a.document_id=d.id AND a.user_id=$1
      WHERE d.workspace_id=$2 AND d.deleted_at IS NULL AND (m.role='admin' OR a.role IS NOT NULL OR d.acl_restricted=false)
      ORDER BY d.updated_at DESC`, [auth.user.sub, auth.user.workspaceId])
    return { documents: result.rows.map(documentJson) }
  })

  app.get('/api/v1/documents/trash', deps.authenticate, async (request) => {
    const auth = request as AuthRequest
    const result = await pool.query<DocumentRow>(`SELECT d.* FROM documents d JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$1
      LEFT JOIN document_acl a ON a.document_id=d.id AND a.user_id=$1 WHERE d.workspace_id=$2 AND d.deleted_at IS NOT NULL
      AND (m.role='admin' OR a.role IS NOT NULL OR d.acl_restricted=false) ORDER BY d.deleted_at DESC`, [auth.user.sub, auth.user.workspaceId])
    return { documents: result.rows.map(documentJson) }
  })

  app.get('/api/v1/documents/recent', deps.authenticate, async (request) => {
    const auth = request as AuthRequest
    const result = await pool.query<DocumentRow>(`SELECT d.*, max(da.created_at) AS activity_at FROM document_activity da JOIN documents d ON d.id=da.document_id
      JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$1 LEFT JOIN document_acl a ON a.document_id=d.id AND a.user_id=$1
      WHERE da.user_id=$1 AND d.workspace_id=$2 AND d.deleted_at IS NULL AND (m.role='admin' OR a.role IS NOT NULL OR d.acl_restricted=false)
      GROUP BY d.id ORDER BY activity_at DESC LIMIT 50`, [auth.user.sub, auth.user.workspaceId])
    return { documents: result.rows.map(documentJson) }
  })

  app.get('/api/v1/documents/favorites', deps.authenticate, async (request) => {
    const auth = request as AuthRequest
    const result = await pool.query<DocumentRow>(`SELECT d.* FROM document_favorites f JOIN documents d ON d.id=f.document_id
      JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$1
      LEFT JOIN document_acl a ON a.document_id=d.id AND a.user_id=$1
      WHERE f.user_id=$1 AND d.workspace_id=$2 AND d.deleted_at IS NULL
        AND (m.role='admin' OR a.role IS NOT NULL OR d.acl_restricted=false)
      ORDER BY f.created_at DESC`, [auth.user.sub, auth.user.workspaceId])
    return { documents: result.rows.map(documentJson) }
  })

  app.get('/api/v1/documents/search', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const query = parse(z.object({
      q: z.string().trim().min(1).max(200),
      scope: z.enum(['all', 'title', 'content']).default('all'),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }), request.query)
    if (!query) return fail(reply, 400, 'INVALID_INPUT', 'q, an optional scope, and a limit between 1 and 100 are required.')

    const result = await pool.query(`SELECT d.id,d.title,d.kind,d.parent_id AS "parentId",d.updated_at AS "updatedAt",d.version,d.content,
      CASE WHEN d.title ILIKE $3 THEN 1 ELSE 0 END AS title_match
      FROM documents d JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$1 LEFT JOIN document_acl a ON a.document_id=d.id AND a.user_id=$1
      WHERE d.workspace_id=$2 AND d.deleted_at IS NULL AND (m.role='admin' OR a.role IS NOT NULL OR d.acl_restricted=false)
        AND (($4='title' AND d.title ILIKE '%'||$3||'%') OR ($4='content' AND d.content::text ILIKE '%'||$3||'%') OR ($4='all' AND (d.title ILIKE '%'||$3||'%' OR d.content::text ILIKE '%'||$3||'%')))
      ORDER BY title_match DESC,d.updated_at DESC LIMIT $5`, [auth.user.sub, auth.user.workspaceId, query.q, query.scope, query.limit])

    return {
      results: result.rows.map((row) => {
        const { content, ...rest } = row as Record<string, unknown>
        return { ...rest, snippet: searchSnippet(content, query.q) }
      }),
    }
  })

  app.get('/api/v1/documents/:id', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    const access = await requireDoc(auth, reply, params.id)
    if (!access) return

    // A live room holds the newest content; flush before reading SQL.
    const room = rooms.get(params.id)
    if (room) await flushRoom(room)

    const current = await pool.query<DocumentRow>('SELECT * FROM documents WHERE id=$1 AND workspace_id=$2', [params.id, auth.user.workspaceId])
    await recordActivity(params.id, auth.user.sub, 'view', app.log)
    return current.rowCount ? { document: documentJson(current.rows[0]!) } : fail(reply, 404, 'NOT_FOUND', 'Document was not found.')
  })
}
