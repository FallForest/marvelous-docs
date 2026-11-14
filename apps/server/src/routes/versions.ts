import { z } from 'zod'
import * as Y from 'yjs'
import type { FastifyInstance } from 'fastify'
import { pool } from '../core/db.js'
import { fail, parse } from '../core/http.js'
import { documentJson, recordActivity } from '../domain/access.js'
import { createYDoc, yState } from '../collaboration/ydoc.js'
import { applyPreparedRoomContent, prepareRoomContent, scheduleDocumentHistory, withRoomMutation } from '../collaboration/rooms.js'
import { requireDoc } from '../domain/guards.js'
import { versionParams } from './schemas.js'
import type { AuthRequest, DocumentRow } from '../core/types.js'
import type { RouteDeps } from './deps.js'
import { automaticDocumentTitle } from '../lib/document-title.js'
import { historyFingerprint, saveHistorySnapshot } from '../domain/history.js'

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

    const query = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.coerce.number().int().positive().optional() }), request.query)
    if (!query) return fail(reply, 400, 'INVALID_INPUT', 'limit must be 1–100 and cursor must be a version number.')
    const limit = query.limit ?? 30
    const result = await pool.query(
      `SELECT v.id,v.version,v.title,v.created_by AS "createdBy",u.name AS "createdByName",v.created_at AS "createdAt",v.reason,v.summary
       FROM document_versions v JOIN users u ON u.id=v.created_by
       WHERE v.document_id=$1 AND ($2::integer IS NULL OR v.version<$2) ORDER BY v.version DESC LIMIT $3`,
      [params.id, query.cursor ?? null, limit + 1])
    const versions = result.rows.slice(0, limit)
    return { versions, nextCursor: result.rows.length > limit ? String(versions[versions.length - 1]!.version) : null }
  })

  app.get('/api/v1/documents/:id/versions/:versionId', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(versionParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document and version ids must be UUIDs.')
    if (!await requireDoc(auth, reply, params.id)) return

    const result = await pool.query(
      'SELECT v.id,v.document_id AS "documentId",v.version,v.title,v.content,v.created_by AS "createdBy",u.name AS "createdByName",v.created_at AS "createdAt",v.reason,v.summary FROM document_versions v JOIN users u ON u.id=v.created_by WHERE v.id=$1 AND v.document_id=$2',
      [params.versionId, params.id])
    if (!result.rowCount) return fail(reply, 404, 'VERSION_NOT_FOUND', 'Version was not found.')
    return { version: result.rows[0] }
  })

  app.post('/api/v1/documents/:id/versions/:versionId/restore', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(versionParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document and version ids must be UUIDs.')

    return withRoomMutation(params.id, async (room) => {
    const access = await requireDoc(auth, reply, params.id, 'editor')
    if (!access) return

    const input = parse(z.object({ expectedVersion: z.number().int().positive(), expectedStateVector: z.string().max(65536).regex(/^[A-Za-z0-9+/]+={0,2}$/).optional() }), request.body)
    if (!input) return fail(reply, 400, 'INVALID_INPUT', 'expectedVersion is required.')
    if (input.expectedVersion !== access.row.version) {
      return fail(reply, 409, 'VERSION_CONFLICT', `Document is at version ${access.row.version}; reload and retry.`)
    }
    if (input.expectedStateVector) {
      let received: Map<number, number>, expected: Map<number, number>
      try {
        expected = Y.decodeStateVector(Buffer.from(input.expectedStateVector, 'base64'))
        if (room) received = Y.decodeStateVector(Y.encodeStateVector(room.doc))
        else {
          const stored = await pool.query('SELECT yjs_state FROM documents WHERE id=$1', [params.id])
          const document = new Y.Doc()
          try { if (stored.rows[0]?.yjs_state) Y.applyUpdate(document, new Uint8Array(stored.rows[0].yjs_state)); received = Y.decodeStateVector(Y.encodeStateVector(document)) }
          finally { document.destroy() }
        }
      } catch { return fail(reply, 400, 'INVALID_INPUT', 'expectedStateVector must encode a valid Yjs state vector.') }
      if ([...expected].some(([client, clock]) => (received.get(client) ?? 0) < clock)) {
        return fail(reply, 409, 'SYNC_PENDING', 'The server has not received all local edits yet; wait for synchronization before restoring.')
      }
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

      const target = await client.query('SELECT version,title,content FROM document_versions WHERE id=$1 AND document_id=$2', [params.versionId, params.id])
      if (!target.rowCount) { await client.query('ROLLBACK'); return fail(reply, 404, 'VERSION_NOT_FOUND', 'Version was not found.') }

      const restoredTitle = old.title_mode === 'auto' ? automaticDocumentTitle(target.rows[0]!.content) : target.rows[0]!.title
      if (historyFingerprint(old.title, old.content) === historyFingerprint(restoredTitle, target.rows[0]!.content)) {
        await client.query('COMMIT')
        return { document: documentJson(old) }
      }
      let restoredState: Buffer
      let prepared: ReturnType<typeof prepareRoomContent> | undefined
      try {
        if (room) { prepared = prepareRoomContent(room, (target.rows[0]!.content as { doc: unknown }).doc); restoredState = prepared.state }
        else {
          const restored = createYDoc((target.rows[0]!.content as { doc: unknown }).doc)
          restoredState = yState(restored)
          restored.destroy()
        }
      } catch {
        await client.query('ROLLBACK')
        return fail(reply, 409, 'INVALID_STORED_CONTENT', 'The selected version cannot be restored with the current editor schema.')
      }

      await saveHistorySnapshot(client, old, 'before_restore')
      const updated = await client.query<DocumentRow>(
        'UPDATE documents SET title=$2,content=$3,yjs_state=$4,version=version+1,updated_by=$5,updated_at=now() WHERE id=$1 RETURNING *',
        [params.id, restoredTitle, target.rows[0]!.content, restoredState, auth.user.sub])
      await client.query('DELETE FROM document_history_pending WHERE document_id=$1', [params.id])
      await client.query('COMMIT')
      // This is a pure in-memory update; no failure-prone second DB commit.
      if (room && prepared) applyPreparedRoomContent(room, prepared)
      void scheduleDocumentHistory(params.id)
      await recordActivity(params.id, auth.user.sub, 'history_restore', app.log, { sourceVersionId: params.versionId, sourceVersion: target.rows[0]!.version, fromVersion: old.version, toVersion: updated.rows[0]!.version })
      return { document: documentJson(updated.rows[0]!) }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
    })
  })
}
