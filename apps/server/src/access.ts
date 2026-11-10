import { pool } from './db.js'
import type { Claims, DocumentRow } from './types.js'

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

/** Raw document plus the caller's effective role, or null when invisible. */
export async function getDocumentAccess(user: Claims, documentId: string) {
  const result = await pool.query<DocumentRow & { role: string; member_role: string }>(
    `SELECT d.*, da.role, m.role AS member_role
       FROM documents d JOIN memberships m ON m.workspace_id=d.workspace_id AND m.user_id=$2
       LEFT JOIN document_acl da ON da.document_id=d.id AND da.user_id=$2
      WHERE d.id=$1 AND d.workspace_id=$3 AND d.deleted_at IS NULL`, [documentId, user.sub, user.workspaceId])
  if (!result.rowCount) return null
  const row = result.rows[0]
  return { row, role: accessRoleFor(row) }
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
