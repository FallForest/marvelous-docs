import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '../core/db.js'
import { fail, parse } from '../core/http.js'
import { documentJson, documentSummaryJson, DOCUMENT_SUMMARY_COLUMNS, visibleDocumentsCte } from '../domain/access.js'
import { flushRoom, rooms } from '../collaboration/rooms.js'
import { recordActivity } from '../domain/access.js'
import { requireDoc } from '../domain/guards.js'
import { buildTsQuery, searchSql, type SearchRow } from '../lib/search.js'
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
    // Visibility comes from one place. Testing the row's own `acl_restricted`
    // here made a restricted folder's contents listable while opening them was a
    // 404, and made an inherited grant unreachable.
    const result = await pool.query<DocumentRow>(`WITH RECURSIVE ${visibleDocumentsCte('live')}
      SELECT ${DOCUMENT_SUMMARY_COLUMNS} FROM documents d
      WHERE d.id IN (SELECT id FROM visible_documents)
      ORDER BY d.updated_at DESC`, [auth.user.sub, auth.user.workspaceId])
    return { documents: result.rows.map(documentSummaryJson) }
  })

  app.get('/api/v1/documents/trash', deps.authenticate, async (request) => {
    const auth = request as AuthRequest
    // 'any' rather than 'live': a child trashed on its own must still be listed
    // beside its trashed folder. See visibleDocumentsCte. The `any` scope means
    // the CTE stops filtering deleted rows, so this query has to - otherwise the
    // bin lists the live tree.
    const result = await pool.query<DocumentRow>(`WITH RECURSIVE ${visibleDocumentsCte('any')}
      SELECT ${DOCUMENT_SUMMARY_COLUMNS} FROM documents d
      WHERE d.deleted_at IS NOT NULL AND d.id IN (SELECT id FROM visible_documents)
      ORDER BY d.deleted_at DESC`, [auth.user.sub, auth.user.workspaceId])
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
    const result = await pool.query<DocumentRow>(`WITH RECURSIVE ${visibleDocumentsCte('live')}
      SELECT ${DOCUMENT_SUMMARY_COLUMNS}, max(da.created_at) AS activity_at
        FROM document_activity da JOIN documents d ON d.id=da.document_id
       WHERE da.user_id=$1 AND d.id IN (SELECT id FROM visible_documents)
       GROUP BY d.id ORDER BY activity_at DESC LIMIT 50`, [auth.user.sub, auth.user.workspaceId])
    return { documents: result.rows.map(documentSummaryJson) }
  })

  app.get('/api/v1/documents/favorites', deps.authenticate, async (request) => {
    const auth = request as AuthRequest
    const result = await pool.query<DocumentRow>(`WITH RECURSIVE ${visibleDocumentsCte('live')}
      SELECT ${DOCUMENT_SUMMARY_COLUMNS} FROM document_favorites f JOIN documents d ON d.id=f.document_id
       WHERE f.user_id=$1 AND d.id IN (SELECT id FROM visible_documents)
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
      result = await pool.query<SearchRow>(searchSql(visibleDocumentsCte('live')), [auth.user.sub, auth.user.workspaceId, tsquery, query.scope, query.limit])
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
        titleMode: row.titleMode,
        kind: row.kind,
        parentId: row.parentId,
        version: row.version,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        titleMatch: row.title_match,
        // The snippet is built from the indexed prose the query just read,
        // instead of decoding every hit's Tiptap JSON.
        snippet: snippetFromText(row.body_text, query.q),
      })),
    }
  })

  /*
   * The version alone, for a client waiting on its own write.
   *
   * The editor used to confirm a save by polling `GET /documents/:id` until the
   * version moved - which, for a collaborative document, pulls the whole body and
   * flushes the room on every poll. The confirmation only needs the number, and it
   * has to be cheap enough to ask once a second while somebody types.
   *
   * No flush: the point of the poll is to observe what the room has *persisted*, so
   * forcing it first would make every poll report success regardless of whether the
   * write actually landed.
   */
  app.get('/api/v1/documents/:id/version', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    const access = await requireDoc(auth, reply, params.id)
    if (!access) return
    return { version: access.row.version, updatedAt: access.row.updated_at }
  })
  app.get('/api/v1/documents/:id', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    const query = parse(z.object({ visit: z.literal('1').optional() }), request.query)
    if (!query) return fail(reply, 400, 'INVALID_INPUT', 'visit must be 1 when explicitly opening a document.')
    const access = await requireDoc(auth, reply, params.id)
    if (!access) return

    // A live room holds the newest content; flush before reading SQL.
    const room = rooms.get(params.id)
    if (room) await flushRoom(room)

    const current = await pool.query<DocumentRow>('SELECT * FROM documents WHERE id=$1 AND workspace_id=$2', [params.id, auth.user.workspaceId])
    if (current.rowCount && query.visit === '1') await recordActivity(params.id, auth.user.sub, 'view', app.log)
    return current.rowCount ? { document: documentJson(current.rows[0]!) } : fail(reply, 404, 'NOT_FOUND', 'Document was not found.')
  })
}
