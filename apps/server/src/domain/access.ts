import { pool } from '../core/db.js'
import type { Claims, DocumentRow } from '../core/types.js'

/**
 * Columns a list response needs. `content` is deliberately absent: the tree only
 * uses id/title/kind/parentId, and shipping every document's full Tiptap JSON
 * made the first paint scale with total workspace size (5-20 MB for 100 docs).
 */
export const DOCUMENT_SUMMARY_COLUMNS =
  'd.id, d.title, d.title_mode, d.kind, d.parent_id, d.version, d.created_by, d.updated_by, d.created_at, d.updated_at, d.deleted_at'

/** Document without its body, for list endpoints. */
export function documentSummaryJson(row: Partial<DocumentRow> & Pick<DocumentRow, 'id' | 'title' | 'kind' | 'version'>) {
  return {
    id: row.id,
    title: row.title,
    titleMode: row.title_mode ?? 'manual',
    kind: row.kind,
    parentId: row.parent_id ?? null,
    version: row.version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
  }
}

/** Shape every document response uses, so REST and the WebSocket agree. */
export function documentJson(row: DocumentRow) {
  return {
    id: row.id,
    title: row.title,
    titleMode: row.title_mode,
    kind: row.kind,
    parentId: row.parent_id,
    content: row.content,
    version: row.version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
  }
}

export const ROLE_LEVEL: Record<string, number> = { none: -1, viewer: 0, editor: 1, owner: 2 }

/**
 * Effective role = workspace admin override, then the explicit ACL row, then
 * the workspace default (editor) for unrestricted documents.
 */
export function accessRoleFor(row: { member_role?: string; role?: string | null; acl_restricted?: boolean }): 'owner' | 'editor' | 'viewer' | 'none' {
  if (row.member_role === 'admin') return 'owner'
  if (row.role === 'owner' || row.role === 'editor' || row.role === 'viewer') return row.role
  return row.acl_restricted ? 'none' : 'editor'
}

/**
 * SQL fragment: the documents the caller may see, as one set.
 *
 * `getDocumentAccess` answers this for a single document; list endpoints used to
 * answer it themselves with the row's own `acl_restricted`, which is why a
 * document inside a restricted folder still turned up in the tree, in search
 * (with a body snippet) and in the bin.
 *
 * Two traversals, both descending from the nodes that change the answer:
 *
 *   - `restricted_tree` - every document under a folder marked restricted;
 *   - `grant_tree` - every document under a node the caller holds an explicit
 *     grant on, carrying the role down the chain.
 *
 * A document is visible when the caller is a workspace admin, when a grant covers
 * it (directly or from an ancestor), or when nothing on its chain is restricted.
 * A grant is what unlocks a restricted subtree: the restricted root has to belong
 * to somebody, or sharing a folder would be something you can do and nobody can
 * receive.
 *
 * `scope` decides which rows the walks may pass through, not the rule itself:
 *
 *   - `'live'` is the tree, search, recent and favorites. A trashed row is not
 *     part of the live hierarchy, so it neither carries a restriction down nor
 *     counts as restricted itself.
 *   - `'any'` is the bin. A child trashed on its own must still be listed beside
 *     its trashed folder, so the walks see deleted rows too.
 *
 * Expects `$1` to be the user id and `$2` the workspace id, so it drops into any
 * query that already passes them in that order.
 */
export function visibleDocumentsCte(scope: 'live' | 'any') {
  const liveOnly = scope === 'live'
  const rootFilter = liveOnly ? ' AND root.deleted_at IS NULL' : ''
  const childFilter = liveOnly ? ' AND child.deleted_at IS NULL' : ''
  const selfFilter = liveOnly ? ' AND d.deleted_at IS NULL' : ''
  return `restricted_tree AS (
    SELECT root.id FROM documents root
     WHERE root.workspace_id = $2 AND root.acl_restricted${rootFilter}
    UNION ALL
    SELECT child.id FROM documents child
      JOIN restricted_tree rt ON child.parent_id = rt.id
     WHERE true${childFilter}
  ),
  grant_tree AS (
    SELECT d.id, a.role FROM documents d
      JOIN document_acl a ON a.document_id = d.id AND a.user_id = $1
     WHERE d.workspace_id = $2${selfFilter}
    UNION
    SELECT child.id, grant_tree.role FROM documents child
      JOIN grant_tree ON child.parent_id = grant_tree.id
     WHERE true${childFilter}
  ),
  visible_documents AS (
    SELECT d.id FROM documents d
      LEFT JOIN restricted_tree rt ON rt.id = d.id
      LEFT JOIN grant_tree g ON g.id = d.id
     WHERE d.workspace_id = $2${liveOnly ? ' AND d.deleted_at IS NULL' : ''}
       AND (
         EXISTS (SELECT 1 FROM memberships m
                  WHERE m.workspace_id = $2 AND m.user_id = $1 AND m.role = 'admin')
         OR g.id IS NOT NULL
         OR rt.id IS NULL
       )
  )`
}

/**
 * Raw document plus the caller's effective role, or null when invisible.
 *
 * A folder's restriction applies to everything beneath it, and an explicit grant
 * on the folder is what opens it again - for the folder and for everything under
 * it. Resolution order, strictest interpretation of the data:
 *
 *   1. workspace admin, which outranks every document rule
 *   2. an explicit grant on the document itself
 *   3. an explicit grant inherited from an ancestor (strongest role wins)
 *   4. a restriction anywhere on the chain denies
 *   5. otherwise the workspace default (editor)
 *
 * Step 3 used to be gated on the chain being unrestricted, which made it
 * unreachable: a grant only exists where somebody restricted something, so
 * "inherited grant, but only outside a restriction" could never fire. Sharing a
 * folder produced a subtree nobody could open.
 */
export async function getDocumentAccess(user: Claims, documentId: string, options: { includeDeleted?: boolean } = {}) {
  const result = await pool.query<DocumentRow & {
    role: string | null
    member_role: string
    chain_restricted: boolean
    inherited_role: string | null
  }>(
    `WITH RECURSIVE chain AS (
        SELECT id, parent_id, acl_restricted FROM documents WHERE id=$1
        UNION ALL
        SELECT d.id, d.parent_id, d.acl_restricted
          FROM documents d JOIN chain c ON d.id = c.parent_id
      )
      SELECT d.*, m.role AS member_role,
             da.role,
             COALESCE((SELECT bool_or(c.acl_restricted) FROM chain c), false) AS chain_restricted,
             (SELECT a2.role FROM document_acl a2
                JOIN chain c2 ON c2.id = a2.document_id
               WHERE a2.user_id=$2
               ORDER BY CASE a2.role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END DESC
               LIMIT 1) AS inherited_role
        FROM documents d
        JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$2
        LEFT JOIN document_acl da ON da.document_id=d.id AND da.user_id=$2
       WHERE d.id=$1 AND d.workspace_id=$3 AND (d.deleted_at IS NULL OR $4::boolean)`,
    [documentId, user.sub, user.workspaceId, Boolean(options.includeDeleted)])
  if (!result.rowCount) return null
  const row = result.rows[0]
  if (row.member_role === 'admin') return { row, role: 'owner' as const }
  if (row.role === 'owner' || row.role === 'editor' || row.role === 'viewer') {
    return { row, role: row.role }
  }
  if (row.inherited_role) {
    return { row, role: row.inherited_role as 'owner' | 'editor' | 'viewer' }
  }
  if (row.chain_restricted) return { row, role: 'none' as const }
  return { row, role: 'editor' as const }
}
type Logger = { warn: (payload: unknown, message: string) => void }

export type ActivityAction = 'view' | 'edit' | 'restore' | 'rename' | 'move' | 'acl' | 'share_link_created' | 'share_link_revoked' | 'history_restore' | 'trash' | 'trash_restore'
export type ActivityDetails = Record<string, string | number | boolean | null | undefined>

const ACTIVITY_DETAIL_FIELDS: Record<string, readonly string[]> = {
  rename: ['beforeTitle', 'afterTitle'],
  move: ['fromParentId', 'toParentId', 'fromParentTitle', 'toParentTitle'],
  acl: ['targetUserId', 'targetUserName', 'beforeRole', 'afterRole', 'beforeRestricted', 'afterRestricted'],
  share_link_created: ['shareLinkId', 'permission', 'expiresAt'],
  share_link_revoked: ['shareLinkId', 'permission', 'expiresAt'],
  history_restore: ['sourceVersionId', 'sourceVersion', 'fromVersion', 'toVersion'],
  trash: ['affectedCount'],
  trash_restore: ['affectedCount'],
}

/** Only structured summaries belong in history; share tokens/URLs never do. */
export function activityDetails(action: string, details: unknown): ActivityDetails {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {}
  const source = details as Record<string, unknown>
  const clean: ActivityDetails = {}
  for (const key of ACTIVITY_DETAIL_FIELDS[action] || []) {
    const value = source[key]
    if (value === null || typeof value === 'boolean') clean[key] = value
    else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value
    else if (typeof value === 'string') clean[key] = value.slice(0, 512)
  }
  return clean
}

/** Records a document activity entry without ever failing the request. */
export async function recordActivity(documentId: string, userId: string, action: ActivityAction, log?: Logger, details: ActivityDetails = {}): Promise<void> {
  try {
    if (action === 'view') {
      // A dedicated unique row makes concurrent opens share one five-minute
      // visit window. Background GETs never call this path. The hidden view
      // entries still power the existing recent-documents query.
      await pool.query(`WITH visit AS (
        INSERT INTO document_recent_visits(document_id,user_id,visited_at) VALUES ($1,$2,now())
        ON CONFLICT(document_id,user_id) DO UPDATE SET visited_at=EXCLUDED.visited_at
          WHERE document_recent_visits.visited_at <= now() - interval '5 minutes'
        RETURNING document_id,user_id
      ) INSERT INTO document_activity(document_id,user_id,action,details)
          SELECT document_id,user_id,'view','{}'::jsonb FROM visit`, [documentId, userId])
    } else {
      await pool.query('INSERT INTO document_activity(document_id,user_id,action,details) VALUES ($1,$2,$3,$4::jsonb)',
        [documentId, userId, action, JSON.stringify(activityDetails(action, details))])
    }
  } catch (error) {
    log?.warn({ err: error }, 'Unable to record document activity')
  }
}
