import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '../core/db.js'
import { fail, parse } from '../core/http.js'
import { activityDetails, getDocumentAccess } from '../domain/access.js'
import { flushRoom, rooms } from '../collaboration/rooms.js'
import { requireDoc } from '../domain/guards.js'
import { exportResponse, type ExportFormat } from '../lib/markdown/index.js'
import { idParams } from './schemas.js'
import type { AuthRequest, Claims } from '../core/types.js'
import type { RouteDeps } from './deps.js'

const historyQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.string().max(1024).optional() })
const cursorValue = z.object({ at: z.string().datetime(), id: z.string().regex(/^(event|snapshot):[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i) })

function decodeCursor(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  try { return parse(cursorValue, JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))) } catch { return null }
}

type HistoryRow = {
  id: string; kind: 'snapshot' | 'event'; createdAt: string; userId: string; userName: string;
  versionId: string | null; version: number | null; title: string | null; reason: string | null;
  summary: Record<string, unknown> | null; action: string | null; details: unknown;
}

type FolderAccessCache = Map<string, ReturnType<typeof getDocumentAccess>>

async function visibleActivityDetails(user: Claims, action: string, raw: unknown, cache: FolderAccessCache) {
  const details = activityDetails(action, raw)
  if (action !== 'move') return details
  for (const side of ['from', 'to'] as const) {
    const id = details[side + 'ParentId']
    const title = side + 'ParentTitle'
    if (id === null) { details[title] = '工作区'; continue }
    if (typeof id !== 'string') continue
    if (!z.string().uuid().safeParse(id).success) { delete details[title]; continue }
    if (!cache.has(id)) cache.set(id, getDocumentAccess(user, id))
    const access = await cache.get(id)
    // An explicit document grant may allow history without a grant to its old
    // parent. Never reveal a restricted historical path through event labels.
    if (!access || access.role === 'none' || access.row.kind !== 'folder') details[title] = '受限文件夹'
    else if (typeof details[title] !== 'string') details[title] = access.row.title
  }
  return details
}

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
      `SELECT a.id,a.user_id AS "userId",u.name AS "userName",a.action,a.details,a.created_at AS "createdAt"
        FROM document_activity a JOIN users u ON u.id=a.user_id
        WHERE a.document_id=$1 AND a.action NOT IN ('view','edit') ORDER BY a.created_at DESC,a.id DESC LIMIT $2`,
      [params.id, query.limit])
    const folders: FolderAccessCache = new Map()
    return { activity: await Promise.all(result.rows.map(async (row) => ({ ...row, details: await visibleActivityDetails(auth.user, row.action, row.details, folders) }))) }
  })

  // History is a read of existing records. In particular, opening this panel
  // must not flush an editor room or create another snapshot/activity entry.
  app.get('/api/v1/documents/:id/history', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    if (!await requireDoc(auth, reply, params.id)) return
    const query = parse(historyQuery, request.query)
    if (!query) return fail(reply, 400, 'INVALID_INPUT', 'Provide a limit between 1 and 100 and an optional history cursor.')
    const limit = query.limit ?? 30
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor)
    if (query.cursor !== undefined && !cursor) return fail(reply, 400, 'INVALID_CURSOR', 'The history cursor is invalid.')

    const result = await pool.query<HistoryRow>(`WITH timeline AS (
      SELECT 'snapshot:' || v.id::text AS id,'snapshot'::text AS kind,v.created_at AS occurred_at,
        v.created_by AS user_id,u.name AS user_name,v.id AS version_id,v.version,v.title,v.reason,v.summary,
        NULL::text AS action,NULL::jsonb AS details
      FROM document_versions v JOIN users u ON u.id=v.created_by WHERE v.document_id=$1
      UNION ALL
      SELECT 'event:' || a.id::text,'event'::text,a.created_at,a.user_id,u.name,
        NULL::uuid,NULL::integer,NULL::text,NULL::text,NULL::jsonb,a.action,a.details
      FROM document_activity a JOIN users u ON u.id=a.user_id
        WHERE a.document_id=$1 AND a.action NOT IN ('view','edit')
    ) SELECT id,kind,user_id AS "userId",user_name AS "userName",
      to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
      version_id AS "versionId",version,title,reason,summary,action,details
      FROM timeline WHERE ($2::timestamptz IS NULL OR (occurred_at,id) < ($2::timestamptz,$3::text))
      ORDER BY occurred_at DESC,id DESC LIMIT $4`, [params.id, cursor?.at ?? null, cursor?.id ?? null, limit + 1])
    const page = result.rows.slice(0, limit)
    const folders: FolderAccessCache = new Map()
    const items = await Promise.all(page.map(async (row) => {
      const common = { id: row.id, kind: row.kind, createdAt: row.createdAt, userId: row.userId, userName: row.userName }
      if (row.kind === 'snapshot') return {
        ...common, versionId: row.versionId, version: row.version, title: row.title, reason: row.reason || 'legacy',
        summary: { ...row.summary, label: typeof row.summary?.label === 'string' ? row.summary.label : '历史版本' },
      }
      return { ...common, action: row.action, details: await visibleActivityDetails(auth.user, row.action || '', row.details, folders) }
    }))
    const last = page[page.length - 1]
    const nextCursor = result.rows.length > limit && last
      ? Buffer.from(JSON.stringify({ at: last.createdAt, id: last.id })).toString('base64url') : null
    return { items, nextCursor }
  })
}
