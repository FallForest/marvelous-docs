import type { FastifyReply } from 'fastify'
import type * as Y from 'yjs'
import { pool } from '../core/db.js'
import { fail } from '../core/http.js'
import { yState } from '../collaboration/ydoc.js'
import type { AuthRequest, DocumentRow } from '../core/types.js'

/** A parent must exist in this workspace and be a folder, not a document. */
export async function assertFolderParent(auth: AuthRequest, parentId: string | null | undefined, reply: FastifyReply): Promise<boolean> {
  if (!parentId) return true
  const parent = await pool.query('SELECT id,kind FROM documents WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL', [parentId, auth.user.workspaceId])
  if (!parent.rowCount || parent.rows[0].kind !== 'folder') {
    fail(reply, 404, 'PARENT_NOT_FOUND', 'Parent folder was not found.')
    return false
  }
  return true
}

/**
 * Inserts a document or folder and grants the creator ownership.
 *
 * Callers shape `content` first (template, markdown import, copy) because the
 * stored JSON and the initial Yjs state must be produced from the same tree.
 */
export async function insertDocument(
  auth: AuthRequest,
  title: string,
  kind: 'document' | 'folder',
  parentId: string | null,
  content: unknown,
  initialDoc: Y.Doc | null,
): Promise<DocumentRow> {
  const result = await pool.query<DocumentRow>(
    'INSERT INTO documents(workspace_id,parent_id,title,kind,content,yjs_state,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *',
    [auth.user.workspaceId, parentId, title, kind, content, initialDoc ? yState(initialDoc) : null, auth.user.sub])
  await pool.query("INSERT INTO document_acl(document_id,user_id,role) VALUES ($1,$2,'owner')", [result.rows[0].id, auth.user.sub])
  return result.rows[0]
}
