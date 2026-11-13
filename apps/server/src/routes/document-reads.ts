import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '../core/db.js'
import { fail, parse } from '../core/http.js'
import { documentJson, documentSummaryJson, DOCUMENT_SUMMARY_COLUMNS } from '../domain/access.js'
import { flushRoom, rooms } from '../collaboration/rooms.js'
import { recordActivity } from '../domain/access.js'
import { requireDoc } from '../domain/guards.js'
import { buildTsQuery, SEARCH_SQL, type SearchRow } from '../lib/search.js'
import { trashExpiresAt } from '../lib/trash.js'
import { config } from '../core/config.js'
import { snippetFromText } from '../lib/markdown/index.js'
import { uuidSchema } from './schemas.js'
import type { AuthRequest, DocumentRow } from '../core/types.js'
import type { RouteDeps } from './deps.js'

const idParams = z.object({ id: uuidSchema })

/**
 * Document reads: the tree, trash, recent, favorites, search, and single
 * document loads (which always flush the live room first).
 */
export function registerDocumentReadRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get('/api/v1/documents', deps.authenticate, async (request) => {
    const auth = request as AuthRequest
    const result = await pool.query<DocumentRow>(`SELECT ${DOCUMENT_SUMMARY_COLUMNS} FROM documents d JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$1
      LEFT JOIN document_acl a ON a.document_id=d.id AND a.user_id=$1
      WHERE d.workspace_id=$2 AND d.deleted_at IS NULL AND (m.role='admin' OR a.role IS NOT NULL OR d.acl_restricted=false)
      ORDER BY d.updated_at DESC`, [auth.user.sub, auth.user.workspaceId])
    return { documents: result.rows.map(documentSummaryJson) }
  })

  app.get('/api/v1/documents/trash', deps.authenticate, async (request) => {
    const auth = request as AuthRequest
    const result = await pool.query<DocumentRow>(`SELECT ${DOCUMENT_SUMMARY_COLUMNS} FROM documents d JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$1
      LEFT JOIN document_acl a ON a.document_id=d.id AND a.user_id=$1 WHERE d.workspace_id=$2 AND d.deleted_at IS NOT NULL
      AND (m.role='admin' OR a.role IS NOT NULL OR d.acl_restricted=false) ORDER BY d.deleted_at DESC`, [auth.user.sub, auth.user.workspaceId])
    /*
     * Each row carries its own purge deadline. The bin used to be manual-only,
     * so nothing here was time-dependent; with retention in place the client has
     * to be able to warn before a row disappears, and deriving the deadline from
     * `deletedAt` here keeps the rule in one place (`lib/trash.ts`) instead of
     * hoping the client's clock and arithmetic match the sweep's.
     */
    return {
      documents: result.rows.map((row) => ({
        ...documentSummaryJson(row),
        expiresAt: trashExpiresAt(row.deleted_at, config.trashRetentionDays),
      })),
      retentionDays: config.trashRetentionDays,
    }
  })

  app.get('/api/v1/documents/recent', deps.authenticate, async (request) => {
    const auth = request as AuthRequest
    const result = await pool.query<DocumentRow>(`SELECT ${DOCUMENT_SUMMARY_COLUMNS}, max(da.created_at) AS activity_at FROM document_activity da JOIN documents d ON d.id=da.document_id
      JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$1 LEFT JOIN document_acl a ON a.document_id=d.id AND a.user_id=$1
      WHERE da.user_id=$1 AND d.workspace_id=$2 AND d.deleted_at IS NULL AND (m.role='admin' OR a.role IS NOT NULL OR d.acl_restricted=false)
      GROUP BY d.id ORDER BY activity_at DESC LIMIT 50`, [auth.user.sub, auth.user.workspaceId])
    return { documents: result.rows.map(documentSummaryJson) }
  })

  app.get('/api/v1/documents/favorites', deps.authenticate, async (request) => {
    const auth = request as AuthRequest
    const result = await pool.query<DocumentRow>(`SELECT ${DOCUMENT_SUMMARY_COLUMNS}, f.created_at FROM document_favorites f JOIN documents d ON d.id=f.document_id
      JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$1
      LEFT JOIN document_acl a ON a.document_id=d.id AND a.user_id=$1
      WHERE f.user_id=$1 AND d.workspace_id=$2 AND d.deleted_at IS NULL
        AND (m.role='admin' OR a.role IS NOT NULL OR d.acl_restricted=false)
      ORDER BY f.created_at DESC`, [auth.user.sub, auth.user.workspaceId])
    return { documents: result.rows.map(documentSummaryJson) }
  })

  /*
   * Full-text search over an indexed `tsvector` (see lib/search.ts and
   * migrations/003), not an ILIKE scan of `content::text`.
   *
   * The old query had three problems a LIKE cannot fix: it read and shipped the
   * whole Tiptap JSON of every candidate document just to build a snippet, it
   * could not use an index, and it ranked by title match then recency, so a
   * document that mentioned the term ten times sorted below one that mentioned
   * it once. The term is still rate-limited: a query is cheap now, but it is
   * still a query per keystroke.
   */
  app.get('/api/v1/documents/search', { preHandler: [deps.authenticate.preHandler, deps.rateLimit(120, 60 * 1000)] }, async (request, reply) => {
    const auth = request as AuthRequest
    const query = parse(z.object({
      q: z.string().trim().min(1).max(200),
      scope: z.enum(['all', 'title', 'content']).default('all'),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }), request.query)
    if (!query) return fail(reply, 400, 'INVALID_INPUT', 'q, an optional scope, and a limit between 1 and 100 are required.')

    const tsquery = buildTsQuery(query.q)
    if (!tsquery) return { results: [], query: query.q, mode: 'fulltext' }

    let result
    try {
      result = await pool.query<SearchRow>(SEARCH_SQL, [auth.user.sub, auth.user.workspaceId, tsquery, query.scope, query.limit])
    } catch (error) {
      // A tsquery parse error can only come from our own builder, but a
      // malformed one must never surface as a 500 mid-typing.
      app.log.warn({ err: error, query: tsquery }, 'Full-text query failed')
      return fail(reply, 400, 'INVALID_INPUT', 'That search could not be parsed.')
    }

    return {
      query: query.q,
      mode: 'fulltext',
      results: result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        kind: row.kind,
        parentId: row.parentId,
        version: row.version,
        updatedAt: row.updatedAt,
        titleMatch: row.title_match,
        // The snippet is built from the indexed prose the query just read,
        // instead of decoding every hit's Tiptap JSON.
        snippet: snippetFromText(row.body_text, query.q),
      })),
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
