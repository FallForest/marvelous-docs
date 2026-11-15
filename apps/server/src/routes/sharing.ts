import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '../core/db.js'
import { fail, parse } from '../core/http.js'
import { requireDoc } from '../domain/guards.js'
import { recordActivity } from '../domain/access.js'
import { revokeRoomWriters } from '../collaboration/rooms.js'
import { idParams } from './schemas.js'
import type { AuthRequest } from '../core/types.js'
import type { RouteDeps } from './deps.js'

/**
 * Share tokens are stored as a plain SHA-256 digest.
 *
 * The token is 24 random bytes of base64url, so it has no structure an attacker
 * could exploit and no need for a slow KDF: the only attack is guessing, and
 * the digest removes the value of reading the table. Matches how `invites`
 * already stores its tokens (routes/auth.ts).
 */
function shareLinkHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

/** Per-document ACL editing plus public share links. */
export function registerSharingRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get('/api/v1/documents/:id/acl', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    if (!await requireDoc(auth, reply, params.id, 'owner')) return

    const result = await pool.query(
      'SELECT u.id AS "userId",u.email,u.name,a.role FROM document_acl a JOIN users u ON u.id=a.user_id WHERE a.document_id=$1 ORDER BY u.name',
      [params.id])
    const settings = await pool.query('SELECT acl_restricted FROM documents WHERE id=$1', [params.id])
    return { restricted: Boolean(settings.rows[0]?.acl_restricted), permissions: result.rows }
  })

  app.put('/api/v1/documents/:id/acl', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    if (!await requireDoc(auth, reply, params.id, 'owner')) return

    const input = parse(z.object({
      userId: z.string().uuid(),
      role: z.enum(['owner', 'editor', 'viewer']).nullable(),
      restricted: z.boolean().optional(),
    }), request.body)
    if (!input) return fail(reply, 400, 'INVALID_INPUT', 'Provide a workspace userId and role, or null to remove the explicit permission.')

    const member = await pool.query(
      'SELECT u.name FROM memberships m JOIN users u ON u.id=m.user_id JOIN documents d ON d.workspace_id=m.workspace_id WHERE d.id=$1 AND m.user_id=$2',
      [params.id, input.userId])
    if (!member.rowCount) return fail(reply, 404, 'MEMBER_NOT_FOUND', 'User is not a member of this workspace.')
    if (input.userId === auth.user.sub && input.role !== 'owner') {
      return fail(reply, 400, 'OWNER_REQUIRED', 'Document owners cannot remove their own owner role.')
    }

    const client = await pool.connect()
    let beforeRole: string | null = null
    let beforeRestricted = false
    const afterRestricted = input.restricted ?? true
    try {
      await client.query('BEGIN')
      const current = await client.query<{ acl_restricted: boolean }>('SELECT acl_restricted FROM documents WHERE id=$1 FOR UPDATE', [params.id])
      beforeRestricted = current.rows[0]!.acl_restricted
      const previous = await client.query<{ role: string }>('SELECT role FROM document_acl WHERE document_id=$1 AND user_id=$2', [params.id, input.userId])
      beforeRole = previous.rows[0]?.role ?? null
      await client.query('UPDATE documents SET acl_restricted=$2 WHERE id=$1', [params.id, afterRestricted])
      if (input.role === null) {
        await client.query('DELETE FROM document_acl WHERE document_id=$1 AND user_id=$2', [params.id, input.userId])
      } else {
        await client.query(
          'INSERT INTO document_acl(document_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT(document_id,user_id) DO UPDATE SET role=EXCLUDED.role',
          [params.id, input.userId, input.role])
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
    /*
     * A grant that is removed - or a document that becomes restricted - has to
     * reach the live sockets, not only the next REST request. The room holds the
     * only list of who is attached, and a socket that decided `canWrite` at
     * handshake time would otherwise keep writing after being demoted.
     *
     * Only writers are closed. A viewer's messages are already ignored, and
     * dropping someone who is merely reading is a worse outcome than leaving the
     * page open; `socket.ts` rechecks on the next write for everything this
     * cannot see.
     */
    if (beforeRole !== input.role || beforeRestricted !== afterRestricted) {
      await recordActivity(params.id, auth.user.sub, 'acl', app.log, {
        targetUserId: input.userId, targetUserName: member.rows[0]!.name, beforeRole, afterRole: input.role, beforeRestricted, afterRestricted,
      })
    }
    revokeRoomWriters(params.id, 'Permission changed')
    return { ok: true }
  })

  app.post('/api/v1/documents/:id/share-link', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    if (!await requireDoc(auth, reply, params.id, 'owner')) return

    const input = parse(z.object({
      permission: z.enum(['viewer', 'commenter']).default('viewer'),
      expiresInDays: z.number().int().positive().max(365).nullable().optional(),
    }), request.body ?? {})
    if (!input) return fail(reply, 400, 'INVALID_INPUT', 'Provide permission and optional expiresInDays.')

    /*
     * The token is a capability: whoever holds it can read the document without
     * an account. Storing it in plaintext made every database dump, backup and
     * log-reading incident a list of live capabilities, while invite tokens right
     * next door were already hashed. Only the hash is stored; the plaintext is
     * returned exactly once, in this response.
     */
    const token = randomBytes(24).toString('base64url')
    const tokenHash = shareLinkHash(token)
    const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400000).toISOString() : null
    const result = await pool.query(
      'INSERT INTO document_share_links(document_id,token,permission,expires_at,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id,permission,expires_at AS "expiresAt",created_at AS "createdAt"',
      [params.id, tokenHash, input.permission, expiresAt, auth.user.sub])
    // The row no longer carries the capability, so the caller gets it from here.
    result.rows[0]!.token = token
    await recordActivity(params.id, auth.user.sub, 'share_link_created', app.log, { shareLinkId: result.rows[0]!.id, permission: input.permission, expiresAt })
    return reply.code(201).send({ shareLink: result.rows[0] })
  })

  app.get('/api/v1/documents/:id/share-link', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(idParams, request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.')
    if (!await requireDoc(auth, reply, params.id, 'owner')) return

    const result = await pool.query(
      'SELECT id,permission,expires_at AS "expiresAt",created_at AS "createdAt" FROM document_share_links WHERE document_id=$1 ORDER BY created_at DESC',
      [params.id])
    return { shareLinks: result.rows }
  })

  app.delete('/api/v1/documents/:id/share-link/:linkId', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const params = parse(z.object({ id: z.string().uuid(), linkId: z.string().uuid() }), request.params)
    if (!params) return fail(reply, 400, 'INVALID_ID', 'Invalid id.')
    if (!await requireDoc(auth, reply, params.id, 'owner')) return

    const removed = await pool.query('DELETE FROM document_share_links WHERE id=$1 AND document_id=$2 RETURNING id,permission,expires_at', [params.linkId, params.id])
    if (removed.rowCount) await recordActivity(params.id, auth.user.sub, 'share_link_revoked', app.log, {
      shareLinkId: params.linkId, permission: removed.rows[0]!.permission,
      expiresAt: removed.rows[0]!.expires_at ? new Date(removed.rows[0]!.expires_at).toISOString() : null,
    })
    return { ok: true }
  })

  /**
   * Public, unauthenticated read of a shared document by token.
   *
   * Anonymous by design - the token is the whole credential - which is why it is
   * throttled: without a budget, one token is an unlimited scraping endpoint, and
   * the point of the limit is to make bulk reading slow rather than to stop the
   * person who was sent the link.
   */
  app.get('/api/v1/shared/:token', { preHandler: [deps.rateLimit(120, 60 * 1000)] }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const params = parse(z.object({ token: z.string().min(10).max(200) }), request.params)
    if (!params) return fail(reply, 400, 'INVALID_TOKEN', 'Invalid share token.')

    const result = await pool.query(
      'SELECT d.id,d.title,d.title_mode AS "titleMode",d.content,d.created_at AS "createdAt",d.updated_at AS "updatedAt",sl.permission FROM document_share_links sl JOIN documents d ON d.id=sl.document_id WHERE sl.token=$1 AND (sl.expires_at IS NULL OR sl.expires_at>now()) AND d.deleted_at IS NULL',
      [shareLinkHash(params.token)])
    if (!result.rowCount) return fail(reply, 404, 'SHARE_NOT_FOUND', 'Share link is invalid or expired.')
    return { document: result.rows[0] }
  })
}
