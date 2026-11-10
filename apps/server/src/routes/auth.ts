import { randomBytes, createHash } from 'node:crypto'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { fail, parse } from '../http.js'
import { passwordHash, passwordMatches, safeUser } from '../security.js'
import { loginBuckets, LoginRateLimiter } from '../lib/rate-limit.js'
import type { AuthRequest, Claims } from '../types.js'
import type { RouteDeps } from './deps.js'

const emailSchema = z.string().email().max(320).transform((v) => v.toLowerCase())

/** Sign-in, invite redemption, session identity, and invite creation. */
export function registerAuthRoutes(app: FastifyInstance, deps: RouteDeps) {
  const loginLimiter = new LoginRateLimiter()
  const sweep = setInterval(() => loginLimiter.sweep(), 10 * 60 * 1000)
  sweep.unref()

  app.post('/api/v1/auth/login', async (request, reply) => {
    const input = parse(z.object({ email: emailSchema, password: z.string().min(1).max(1024) }), request.body)
    if (!input) return fail(reply, 400, 'INVALID_INPUT', 'Email and password are required.')

    const buckets = loginBuckets(request.ip || 'unknown', input.email)
    const blockedSeconds = loginLimiter.retryAfter(buckets)
    if (blockedSeconds !== null) {
      reply.header('Retry-After', String(blockedSeconds))
      return fail(reply, 429, 'RATE_LIMITED', 'Too many failed login attempts. Try again later.')
    }

    const result = await pool.query(
      'SELECT u.id,u.email,u.name,u.password_hash,m.workspace_id,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE lower(u.email)=lower($1) ORDER BY m.created_at LIMIT 1',
      [input.email])
    if (!result.rowCount || !(await passwordMatches(input.password, result.rows[0].password_hash))) {
      loginLimiter.recordFailure(buckets)
      return fail(reply, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')
    }

    loginLimiter.clear(buckets)
    const row = result.rows[0]
    const token = app.jwt.sign({ sub: row.id, email: row.email, workspaceId: row.workspace_id } satisfies Claims, { expiresIn: '12h' })
    return { token, user: safeUser(row) }
  })

  app.post('/api/v1/auth/accept-invite', async (request, reply) => {
    const input = parse(z.object({
      inviteToken: z.string().min(24),
      password: z.string().min(12).max(1024),
      name: z.string().trim().min(1).max(120),
    }), request.body)
    if (!input) return fail(reply, 400, 'INVALID_INPUT', 'Invite token, name, and a password of at least 12 characters are required.')

    const tokenHash = createHash('sha256').update(input.inviteToken).digest('hex')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const found = await client.query('SELECT * FROM invites WHERE token_hash=$1 AND expires_at>now() FOR UPDATE', [tokenHash])
      if (!found.rowCount) { await client.query('ROLLBACK'); return fail(reply, 404, 'INVITE_INVALID', 'Invite is invalid or expired.') }
      const invite = found.rows[0]
      const existing = await client.query('SELECT id FROM users WHERE lower(email)=lower($1)', [invite.email])
      if (existing.rowCount) {
        await client.query('ROLLBACK')
        return fail(reply, 409, 'ACCOUNT_EXISTS', 'This email already has an account. Ask an administrator to add it to the workspace.')
      }
      const userResult = await client.query(
        'INSERT INTO users(email,name,password_hash) VALUES ($1,$2,$3) RETURNING id,email,name',
        [invite.email, input.name, await passwordHash(input.password)])
      const user = userResult.rows[0]
      await client.query(
        'INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role',
        [invite.workspace_id, user.id, invite.role])
      await client.query('DELETE FROM invites WHERE id=$1', [invite.id])
      await client.query('COMMIT')
      const token = app.jwt.sign({ sub: user.id, email: user.email, workspaceId: invite.workspace_id } satisfies Claims, { expiresIn: '12h' })
      return { token, user: safeUser({ ...user, role: invite.role }) }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  })

  app.get('/api/v1/me', deps.authenticate, async (request) => {
    const auth = request as AuthRequest
    const result = await pool.query(
      'SELECT u.id,u.email,u.name,m.role FROM users u JOIN memberships m ON m.user_id=u.id AND m.workspace_id=$2 WHERE u.id=$1',
      [auth.user.sub, auth.user.workspaceId])
    return { user: result.rowCount ? safeUser(result.rows[0]) : null }
  })

  app.post('/api/v1/invites', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const membership = await pool.query('SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2', [auth.user.workspaceId, auth.user.sub])
    if (!membership.rowCount || membership.rows[0].role !== 'admin') {
      return fail(reply, 403, 'FORBIDDEN', 'Workspace administrator role is required.')
    }
    const input = parse(z.object({ email: emailSchema, role: z.enum(['admin', 'member']).default('member') }), request.body)
    if (!input) return fail(reply, 400, 'INVALID_INPUT', 'A valid email and optional role are required.')

    const inviteToken = randomBytes(32).toString('base64url')
    const result = await pool.query(
      "INSERT INTO invites(workspace_id,email,role,token_hash,expires_at,created_by) VALUES ($1,$2,$3,$4,now()+interval '7 days',$5) RETURNING id,email,role,expires_at",
      [auth.user.workspaceId, input.email, input.role, createHash('sha256').update(inviteToken).digest('hex'), auth.user.sub])
    return reply.code(201).send({ invite: { ...result.rows[0], token: inviteToken } })
  })
}
