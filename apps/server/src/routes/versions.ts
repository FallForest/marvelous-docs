import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '../core/db.js'
import { fail, parse } from '../core/http.js'
import { documentJson, recordActivity } from '../domain/access.js'
import { createYDoc, yState } from '../collaboration/ydoc.js'
import { flushRoom, rooms, syncRoomFromContent } from '../collaboration/rooms.js'
import { requireDoc } from '../domain/guards.js'
import { versionParams } from './schemas.js'
import type { AuthRequest, DocumentRow } from '../core/types.js'
import type { RouteDeps } from './deps.js'
import { automaticDocumentTitle } from '../lib/document-title.js'

/**
 * Version history: list, read one snapshot, and restore.
 *
 * Restore writes the previous state as a new version, so history stays
 * append-only and a restore is itself undoable.
 */
export function registerVersionRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get('/api/v1/documents/:id/versions', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(z.object({ id: z.string().uuid() }), request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    if (!await requireDoc(auth, reply, params.id)) return

    const room = rooms.get(params.id)
    if (room) await flushRoom(room)

    const result = await pool.query(
      'SELECT id,version,title,content,created_by AS "createdBy",created_at AS "createdAt" FROM document_versions WHERE document_id=$1 ORDER BY version DESC',
      [params.id])
    return { versions: result.rows }
  })

  app.get('/api/v1/documents/:id/versions/:versionId', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(versionParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document and version ids must be UUIDs.')
    if (!await requireDoc(auth, reply, params.id)) return

    const result = await pool.query(
      'SELECT v.id,v.document_id AS "documentId",v.version,v.title,v.content,v.created_by AS "createdBy",u.name AS "createdByName",v.created_at AS "createdAt" FROM document_versions v JOIN users u ON u.id=v.created_by WHERE v.id=$1 AND v.document_id=$2',
      [params.versionId, params.id])
    if (!result.rowCount) return fail(reply, 404, 'VERSION_NOT_FOUND', 'Version was not found.')
    return { version: result.rows[0] }
  })

  app.post('/api/v1/documents/:id/versions/:versionId/restore', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(versionParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document and version ids must be UUIDs.')

    const room = rooms.get(params.id)
    if (room) await flushRoom(room)

    const access = await requireDoc(auth, reply, params.id, 'editor')
    if (!access) return

    const input = parse(z.object({ expectedVersion: z.number().int().positive() }), request.body)
    if (!input) return fail(reply, 400, 'INVALID_INPUT', 'expectedVersion is required.')
    if (input.expectedVersion !== access.row.version) {
      return fail(reply, 409, 'VERSION_CONFLICT', `Document is at version ${access.row.version}; reload and retry.`)
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const current = await client.query<DocumentRow>('SELECT * FROM documents WHERE id=$1 FOR UPDATE', [params.id])
      if (!current.rowCount) { await client.query('ROLLBACK'); return fail(reply, 404, 'NOT_FOUND', 'Document was not found.') }
      const old = current.rows[0]!
      if (old.version !== input.expectedVersion) {
        await client.query('ROLLBACK')
        return fail(reply, 409, 'VERSION_CONFLICT', `Document is at version ${old.version}; reload and retry.`)
      }

      const target = await client.query('SELECT title,content FROM document_versions WHERE id=$1 AND document_id=$2', [params.versionId, params.id])
      if (!target.rowCount) { await client.query('ROLLBACK'); return fail(reply, 404, 'VERSION_NOT_FOUND', 'Version was not found.') }

      let restoredState: Buffer
      try {
        const restored = createYDoc((target.rows[0]!.content as { doc: unknown }).doc)
        restoredState = yState(restored)
        restored.destroy()
      } catch {
        await client.query('ROLLBACK')
        return fail(reply, 409, 'INVALID_STORED_CONTENT', 'The selected version cannot be restored with the current editor schema.')
      }

      await client.query(
        'INSERT INTO document_versions(document_id,version,title,content,created_by) VALUES ($1,$2,$3,$4,$5)',
        [old.id, old.version, old.title, old.content, old.updated_by])
      const updated = await client.query<DocumentRow>(
        'UPDATE documents SET title=$2,content=$3,yjs_state=$4,version=version+1,updated_by=$5,updated_at=now() WHERE id=$1 RETURNING *',
        [params.id, old.title_mode === 'auto' ? automaticDocumentTitle(target.rows[0]!.content) : target.rows[0]!.title, target.rows[0]!.content, restoredState, auth.user.sub])
      await client.query('COMMIT')

      const activeRoom = rooms.get(params.id)
      if (activeRoom) await syncRoomFromContent(activeRoom, (target.rows[0]!.content as { doc: unknown }).doc)
      await recordActivity(params.id, auth.user.sub, 'restore', app.log)
      return { document: documentJson(updated.rows[0]!) }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  })
}
