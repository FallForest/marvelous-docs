import { z } from 'zod'
import type * as Y from 'yjs'
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { fail, parse } from '../http.js'
import { documentJson, recordActivity } from '../access.js'
import { assertFolderParent, insertDocument } from '../documents.js'
import { createYDoc, yState } from '../collaboration/ydoc.js'
import { flushRoom, rooms, syncRoomFromContent } from '../collaboration/rooms.js'
import { requireNode } from '../guards.js'
import { firstHeadingTitle, markdownToTiptap } from '../lib/markdown.js'
import { getTemplate } from '../lib/templates.js'
import { contentSchema, idParams, uuidSchema } from './schemas.js'
import type { AuthRequest, DocumentRow } from '../types.js'
import type { RouteDeps } from './deps.js'

const MAX_IMPORT_CHARS = 2 * 1024 * 1024

/**
 * Document writes: create, import, update, duplicate, and the favorite toggle.
 *
 * Every content write validates against the server schema first, because the
 * stored JSON must stay renderable by the editor and the exporters.
 */
export function registerDocumentWriteRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.post('/api/v1/documents', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const input = parse(z.object({
      title: z.string().trim().min(1).max(500).optional(),
      kind: z.enum(['document', 'folder']).default('document'),
      parentId: uuidSchema.optional().nullable(),
      content: contentSchema.optional(),
      templateId: z.string().trim().min(1).max(64).optional(),
    }), request.body)
    if (!input) return fail(reply, 400, 'INVALID_INPUT', 'Title and either content or templateId are required.')

    const kind = input.kind ?? 'document'
    if (kind === 'folder' && !input.title) return fail(reply, 400, 'INVALID_INPUT', 'Folders require a title.')
    if (kind === 'folder' && (input.content || input.templateId)) return fail(reply, 400, 'INVALID_INPUT', 'Folder content is managed by the server and must not be supplied.')
    if (kind === 'document' && !input.content && !input.templateId) return fail(reply, 400, 'INVALID_INPUT', 'Documents require schemaVersion 1 content or a templateId.')
    if (input.content && input.templateId) return fail(reply, 400, 'INVALID_INPUT', 'Provide either content or templateId, not both.')

    let content: unknown = input.content
    let title = input.title
    if (input.templateId) {
      const template = getTemplate(input.templateId)
      if (!template) return fail(reply, 400, 'INVALID_INPUT', 'Unknown templateId.')
      content = template.content
      title = title ?? template.name
    }
    if (!title) return fail(reply, 400, 'INVALID_INPUT', 'Documents require a title or a templateId.')
    if (kind === 'folder') content = { schemaVersion: 1, doc: { type: 'doc', content: [] } }

    let initialDoc: Y.Doc | null = null
    if (kind === 'document') {
      try { initialDoc = createYDoc((content as { doc: unknown }).doc) }
      catch { return fail(reply, 400, 'INVALID_CONTENT', 'Document content does not match the supported Tiptap schema.') }
    }
    if (!await assertFolderParent(auth, input.parentId ?? null, reply)) { initialDoc?.destroy(); return }

    const row = await insertDocument(auth, title, kind, input.parentId ?? null, content, initialDoc)
    initialDoc?.destroy()
    return reply.code(201).send({ document: documentJson(row) })
  })

  app.post('/api/v1/documents/import', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const input = parse(z.object({
      format: z.literal('markdown').default('markdown'),
      title: z.string().trim().min(1).max(500).optional(),
      parentId: uuidSchema.optional().nullable(),
      markdown: z.string().max(MAX_IMPORT_CHARS),
    }), request.body)
    if (!input) return fail(reply, 400, 'INVALID_INPUT', 'Provide format "markdown", the markdown source, and an optional title and parentId.')
    if (!input.markdown.trim()) return fail(reply, 400, 'INVALID_INPUT', 'markdown must not be empty.')
    if (Buffer.byteLength(input.markdown, 'utf8') > MAX_IMPORT_CHARS) return fail(reply, 400, 'INVALID_INPUT', 'Markdown imports are limited to 2 MB.')

    const document = markdownToTiptap(input.markdown)
    let initialDoc: Y.Doc
    try { initialDoc = createYDoc(document) }
    catch { return fail(reply, 400, 'INVALID_CONTENT', 'Imported Markdown cannot be represented with the server editor schema.') }
    if (!await assertFolderParent(auth, input.parentId ?? null, reply)) { initialDoc.destroy(); return }

    const title = (input.title ?? firstHeadingTitle(document) ?? 'Imported document').slice(0, 500).trim() || 'Imported document'
    const row = await insertDocument(auth, title, 'document', input.parentId ?? null, { schemaVersion: 1, doc: document }, initialDoc)
    initialDoc.destroy()
    return reply.code(201).send({ document: documentJson(row) })
  })

  app.put('/api/v1/documents/:id', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')

    // Flush first: the optimistic check must compare against persisted state.
    const roomBeforeUpdate = rooms.get(params.id)
    if (roomBeforeUpdate) await flushRoom(roomBeforeUpdate)

    const access = await requireNode(auth, reply, params.id, 'editor')
    if (!access) return

    const input = parse(z.object({
      title: z.string().trim().min(1).max(500).optional(),
      parentId: uuidSchema.nullable().optional(),
      content: contentSchema.optional(),
      expectedVersion: z.number().int().positive(),
    }), request.body)
    if (!input || (input.title === undefined && input.parentId === undefined && input.content === undefined)) {
      return fail(reply, 400, 'INVALID_INPUT', 'At least one document field and expectedVersion are required.')
    }
    if (access.row.kind === 'folder' && input.content) return fail(reply, 400, 'INVALID_CONTENT', 'Folders do not store document content.')

    let replacementState: Buffer | null = null
    if (input.content) {
      try {
        const replacement = createYDoc(input.content.doc)
        replacementState = yState(replacement)
        replacement.destroy()
      } catch {
        return fail(reply, 400, 'INVALID_CONTENT', 'Document content does not match the supported Tiptap schema.')
      }
    }

    if (input.expectedVersion !== access.row.version) {
      return fail(reply, 409, 'VERSION_CONFLICT', `Document is at version ${access.row.version}; reload and retry.`)
    }
    if (input.parentId) {
      if (input.parentId === params.id) return fail(reply, 400, 'INVALID_PARENT', 'A folder cannot be moved into itself.')
      const parent = await pool.query('SELECT id,kind FROM documents WHERE id=$1 AND workspace_id=$2 AND id<>$3', [input.parentId, auth.user.workspaceId, params.id])
      if (!parent.rowCount || parent.rows[0]!.kind !== 'folder') return fail(reply, 400, 'INVALID_PARENT', 'Parent must be a folder in this workspace.')
      if (access.row.kind === 'folder') {
        const cycle = await pool.query(`WITH RECURSIVE subtree AS (
          SELECT id FROM documents WHERE parent_id=$1
          UNION ALL SELECT d.id FROM documents d JOIN subtree s ON d.parent_id=s.id
        ) SELECT 1 FROM subtree WHERE id=$2`, [params.id, input.parentId])
        if (cycle.rowCount) return fail(reply, 400, 'INVALID_PARENT', 'A folder cannot be moved inside one of its descendants.')
      }
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const current = await client.query<DocumentRow>('SELECT * FROM documents WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [params.id, auth.user.workspaceId])
      if (!current.rowCount) { await client.query('ROLLBACK'); return fail(reply, 404, 'NOT_FOUND', 'Document was not found.') }
      const old = current.rows[0]!
      // Re-check inside the row lock: another writer may have won the race.
      if (old.version !== input.expectedVersion) {
        await client.query('ROLLBACK')
        return fail(reply, 409, 'VERSION_CONFLICT', `Document is at version ${old.version}; reload and retry.`)
      }
      await client.query(
        'INSERT INTO document_versions(document_id,version,title,content,created_by) VALUES ($1,$2,$3,$4,$5)',
        [old.id, old.version, old.title, old.content, old.updated_by])
      const updated = await client.query<DocumentRow>(`UPDATE documents SET title=COALESCE($2,title), parent_id=CASE WHEN $3 THEN $4 ELSE parent_id END,
        content=COALESCE($5,content), yjs_state=COALESCE($7,yjs_state), version=version+1, updated_by=$6, updated_at=now() WHERE id=$1 RETURNING *`,
        [params.id, input.title ?? null, input.parentId !== undefined, input.parentId ?? null, input.content ?? null, auth.user.sub, replacementState])
      await client.query('COMMIT')

      const activeRoom = input.content ? rooms.get(params.id) : undefined
      if (activeRoom) await syncRoomFromContent(activeRoom, input.content!.doc)
      if (input.content) await recordActivity(params.id, auth.user.sub, 'edit', app.log)
      return { document: documentJson(updated.rows[0]!) }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  })

  app.post('/api/v1/documents/:id/duplicate', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    const input = parse(z.object({
      title: z.string().trim().min(1).max(500).optional(),
      parentId: uuidSchema.nullable().optional(),
    }), request.body ?? {})
    if (!input) return fail(reply, 400, 'INVALID_INPUT', 'Optional title and parentId must be valid when supplied.')

    // Editing rights, not viewing: the copy is created with the caller as owner,
    // so letting a viewer duplicate a restricted document would let them grant
    // themselves access and re-share it.
    const access = await requireNode(auth, reply, params.id, 'editor')
    if (!access) return
    if (access.role === 'none') return fail(reply, 403, 'FORBIDDEN', 'You do not have permission for this operation.')
    if (access.row.kind !== 'document') return fail(reply, 400, 'NOT_A_DOCUMENT', 'Folders cannot be duplicated.')

    const parentId = input.parentId !== undefined ? input.parentId : access.row.parent_id
    if (!await assertFolderParent(auth, parentId, reply)) return

    const title = (input.title ?? `${access.row.title} (copy)`).slice(0, 500)
    let initialDoc: Y.Doc
    try { initialDoc = createYDoc((access.row.content as { doc: unknown }).doc) }
    catch { return fail(reply, 409, 'INVALID_STORED_CONTENT', 'The source document cannot be copied with the current editor schema.') }

    const row = await insertDocument(auth, title, 'document', parentId, access.row.content, initialDoc)
    initialDoc.destroy()
    return reply.code(201).send({ document: documentJson(row) })
  })

  app.put('/api/v1/documents/:id/favorite', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    if (!await requireNode(auth, reply, params.id)) return

    const input = parse(z.object({ favorite: z.boolean() }), request.body)
    if (!input) return fail(reply, 400, 'INVALID_INPUT', 'favorite must be boolean.')
    if (input.favorite) {
      await pool.query('INSERT INTO document_favorites(document_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [params.id, auth.user.sub])
    } else {
      await pool.query('DELETE FROM document_favorites WHERE document_id=$1 AND user_id=$2', [params.id, auth.user.sub])
    }
    return { favorite: input.favorite }
  })
}
