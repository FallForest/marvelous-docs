import type { FastifyReply } from 'fastify'
import { z } from 'zod'
import { ROLE_LEVEL, getDocumentAccess } from './access.js'
import { fail, parse } from '../core/http.js'
import type { AuthRequest } from '../core/types.js'

const uuidSchema = z.string().uuid()

/**
 * Route guards.
 *
 * Every document route starts here: validate the id, resolve the effective
 * role, and enforce the minimum. Returning `null` means the reply has already
 * been sent, so handlers just `return`.
 */

export async function requireNode(
  request: AuthRequest,
  reply: FastifyReply,
  idValue: unknown,
  minimum: 'viewer' | 'editor' | 'owner' = 'viewer',
) {
  const id = parse(uuidSchema, idValue)
  if (!id) { fail(reply, 400, 'INVALID_ID', 'Document id must be a UUID.'); return null }
  const access = await getDocumentAccess(request.user, id)
  if (!access) { fail(reply, 404, 'NOT_FOUND', 'Document or folder was not found.'); return null }
  if (ROLE_LEVEL[access.role]! < ROLE_LEVEL[minimum]!) {
    fail(reply, 403, 'FORBIDDEN', 'You do not have permission for this operation.')
    return null
  }
  return access
}

export async function requireDoc(
  request: AuthRequest,
  reply: FastifyReply,
  idValue: unknown,
  minimum: 'viewer' | 'editor' | 'owner' = 'viewer',
) {
  const access = await requireNode(request, reply, idValue, minimum)
  if (!access) return null
  if (access.row.kind !== 'document') {
    fail(reply, 404, 'NOT_A_DOCUMENT', 'This operation requires a document.')
    return null
  }
  return access
}
