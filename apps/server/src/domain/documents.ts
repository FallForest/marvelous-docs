import type { FastifyReply } from 'fastify'
import type * as Y from 'yjs'
import { pool } from '../core/db.js'
import { fail } from '../core/http.js'
import { yState } from '../collaboration/ydoc.js'
import { getDocumentAccess } from './access.js'
import type { AuthRequest, DocumentRow } from '../core/types.js'
import type { TitleMode } from '../lib/document-title.js'

/**
 * The target of a create or a move must be a folder the caller can see.
 *
 * Both halves matter. The shape check alone let any member file a document into
 * a restricted folder they had no access to: the document vanished from their
 * own tree and appeared in somebody else's, which is both confusing and a way to
 * write into a place you were kept out of. Creating inside a folder grants the
 * creator ownership of the document, not of the folder, so `viewer` is enough -
 * the same threshold a move needs to see its destination.
 */
export async function assertFolderParent(auth: AuthRequest, parentId: string | null | undefined, reply: FastifyReply): Promise<boolean> {
  if (!parentId) return true
  const parent = await pool.query<{ kind: string }>('SELECT id,kind FROM documents WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL', [parentId, auth.user.workspaceId])
  if (!parent.rowCount || parent.rows[0]!.kind !== 'folder') {
    fail(reply, 404, 'PARENT_NOT_FOUND', 'Parent folder was not found.')
    return false
  }
  // 404 rather than 403: confirming that a folder exists is itself information
  // the caller was denied, and the tree never showed it to them.
  const access = await getDocumentAccess(auth.user, parentId)
  if (!access || access.role === 'none') {
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
  titleMode: TitleMode = 'manual',
): Promise<DocumentRow> {
  const result = await pool.query<DocumentRow>(
    'INSERT INTO documents(workspace_id,parent_id,title,kind,content,yjs_state,created_by,updated_by,title_mode) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8) RETURNING *',
    [auth.user.workspaceId, parentId, title, kind, content, initialDoc ? yState(initialDoc) : null, auth.user.sub, titleMode])
  await pool.query("INSERT INTO document_acl(document_id,user_id,role) VALUES ($1,$2,'owner')", [result.rows[0].id, auth.user.sub])
  return result.rows[0]
}
