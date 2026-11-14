import { compareVersions } from '../lib/version.js'
import { pool } from '../core/db.js'
import { roomMetrics } from '../collaboration/rooms.js'
import { fail } from '../core/http.js'
import { config } from '../core/config.js'
import { z } from 'zod'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { AuthRequest, UpdateManifest } from '../core/types.js'
import type { RouteDeps } from './deps.js'

/** Health, version, and the admin-only self-update surface. */
export function registerSystemRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get('/healthz', async (_request, reply) => {
    try { await pool.query('SELECT 1'); return { status: 'ok' } }
    catch { return fail(reply, 503, 'DATABASE_UNAVAILABLE', 'Database is unavailable.') }
  })

  app.get('/api/v1/system/version', async () => ({ version: config.appVersion }))

  /*
   * Operational metrics, admin-only.
   *
   * JSON rather than a Prometheus exposition because there is no Prometheus here:
   * the documented deployment is one compose stack, and the operator reads this
   * with curl during an incident. A scraper can be pointed at it later without
   * changing the shape of the numbers.
   *
   * Deliberately not under `/healthz`: that answer has to be cheap and constant, and
   * this one runs aggregate queries.
   */
  app.get('/api/v1/system/metrics', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    if (!await requireWorkspaceAdmin(auth, reply)) return
    const [counts, migrations] = await Promise.all([
      pool.query<{ documents: string; versions: string; trashed: string; members: string }>(`
        SELECT (SELECT count(*) FROM documents WHERE workspace_id=$1 AND deleted_at IS NULL) AS documents,
               (SELECT count(*) FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE d.workspace_id=$1) AS versions,
               (SELECT count(*) FROM documents WHERE workspace_id=$1 AND deleted_at IS NOT NULL) AS trashed,
               (SELECT count(*) FROM memberships WHERE workspace_id=$1) AS members`, [auth.user.workspaceId]),
      pool.query<{ filename: string; applied_at: string }>('SELECT filename, applied_at FROM schema_migrations ORDER BY filename')
        .catch(() => ({ rows: [] as Array<{ filename: string; applied_at: string }> })),
    ])
    const row = counts.rows[0]
    return {
      version: config.appVersion,
      uptimeSeconds: Math.round(process.uptime()),
      workspace: {
        documents: Number(row?.documents ?? 0),
        versions: Number(row?.versions ?? 0),
        trashed: Number(row?.trashed ?? 0),
        members: Number(row?.members ?? 0),
      },
      collaboration: roomMetrics(),
      database: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
      migrations: migrations.rows,
    }
  })

  app.get('/api/v1/system/update-check', deps.authenticate, async () => {
    const latest = await readUpdateManifest()
    return {
      currentVersion: config.appVersion,
      latestVersion: latest?.version || null,
      updateAvailable: Boolean(latest && compareVersions(latest.version, config.appVersion) > 0),
      manifest: latest,
    }
  })

  app.post('/api/v1/system/update', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    if (!await requireWorkspaceAdmin(auth, reply)) return
    if (!config.updateAgentUrl || !config.updateAgentToken) {
      return fail(reply, 503, 'UPDATER_UNAVAILABLE', 'The update agent is not configured.')
    }
    try {
      const response = await fetch(`${config.updateAgentUrl}/update`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.updateAgentToken}` },
        signal: AbortSignal.timeout(5000),
      })
      const body = await response.json() as unknown
      if (!response.ok) {
        return fail(reply, response.status === 409 ? 409 : 502, 'UPDATE_START_FAILED', (body as { error?: string }).error || 'Unable to start the update.')
      }
      return reply.code(202).send({ update: body })
    } catch {
      return fail(reply, 502, 'UPDATER_UNAVAILABLE', 'The update agent could not be reached.')
    }
  })

  app.get('/api/v1/system/update-status', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    if (!await requireWorkspaceAdmin(auth, reply)) return
    if (!config.updateAgentUrl || !config.updateAgentToken) {
      return fail(reply, 503, 'UPDATER_UNAVAILABLE', 'The update agent is not configured.')
    }
    try {
      const response = await fetch(`${config.updateAgentUrl}/status`, {
        headers: { authorization: `Bearer ${config.updateAgentToken}` },
        signal: AbortSignal.timeout(3000),
      })
      const body = await response.json() as unknown
      if (!response.ok) return fail(reply, 502, 'UPDATER_UNAVAILABLE', 'The update agent returned an error.')
      return { update: body }
    } catch {
      return fail(reply, 502, 'UPDATER_UNAVAILABLE', 'The update agent could not be reached.')
    }
  })
}

/** Workspace administrator check shared by every admin-only route. */
export async function requireWorkspaceAdmin(auth: AuthRequest, reply: FastifyReply) {
  const result = await pool.query("SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND role='admin'", [auth.user.workspaceId, auth.user.sub])
  if (!result.rowCount) {
    fail(reply, 403, 'ADMIN_REQUIRED', 'Workspace administrator role is required.')
    return false
  }
  return true
}

/** Reads the optional release manifest used by the update checker. */
async function readUpdateManifest(): Promise<UpdateManifest | null> {
  if (!config.updateManifestUrl) return null
  try {
    const response = await fetch(config.updateManifestUrl, { signal: AbortSignal.timeout(3000), headers: { accept: 'application/json' } })
    if (!response.ok) return null
    const value = await response.json() as unknown
    const parsed = z.object({
      version: z.string().min(1),
      releaseUrl: z.string().url().optional(),
      notesUrl: z.string().url().optional(),
      apiImage: z.string().optional(),
      webImage: z.string().optional(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    }).safeParse(value)
    return parsed.success ? parsed.data : null
  } catch { return null }
}
