import { pool } from './db.js'
import type { Claims, DocumentRow } from './types.js'

/**
 * Columns a list response needs. `content` is deliberately absent: the tree only
 * uses id/title/kind/parentId, and shipping every document's full Tiptap JSON
 * made the first paint scale with total workspace size (5-20 MB for 100 docs).
 */
export const DOCUMENT_SUMMARY_COLUMNS =
  'd.id, d.title, d.kind, d.parent_id, d.version, d.created_by, d.updated_by, d.created_at, d.updated_at, d.deleted_at'

/** Document without its body, for list endpoints. */
export function documentSummaryJson(row: Partial<DocumentRow> & Pick<DocumentRow, 'id' | 'title' | 'kind' | 'version'>) {
  return {
    id: row.id,
    title: row.title,
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
 * Raw document plus the caller's effective role, or null when invisible.
 *
 * A folder's restriction applies to everything beneath it. Without inheritance a
 * viewer locked out of a folder could still open a document inside it, because
 * `acl_restricted` was only consulted on the document itself.
 *
 * Resolution order, strictest interpretation of the data:
 *   1. an explicit grant on the document itself
 *   2. an explicit grant inherited from a folder (strongest role wins)
 *   3. if anything in the chain is restricted, deny
 *   4. otherwise the workspace default (editor)
 */
export async function getDocumentAccess(user: Claims, documentId: string) {
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
       WHERE d.id=$1 AND d.workspace_id=$3 AND d.deleted_at IS NULL`, [documentId, user.sub, user.workspaceId])
  if (!result.rowCount) return null
  const row = result.rows[0]
  if (row.member_role === 'admin') return { row, role: 'owner' as const }
  if (row.role === 'owner' || row.role === 'editor' || row.role === 'viewer') {
    return { row, role: row.role }
  }
  if (row.inherited_role && !row.chain_restricted) {
    return { row, role: row.inherited_role as 'owner' | 'editor' | 'viewer' }
  }
  if (row.chain_restricted) return { row, role: 'none' as const }
  return { row, role: 'editor' as const }
}

type Logger = { warn: (payload: unknown, message: string) => void }

/** Records a document activity entry without ever failing the request. */
export async function recordActivity(documentId: string, userId: string, action: 'view' | 'edit' | 'restore', log?: Logger): Promise<void> {
  try {
    await pool.query('INSERT INTO document_activity(document_id,user_id,action) VALUES ($1,$2,$3)', [documentId, userId, action])
  } catch (error) {
    log?.warn({ err: error }, 'Unable to record document activity')
  }
}
