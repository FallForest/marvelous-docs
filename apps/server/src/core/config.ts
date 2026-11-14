/**
 * Process configuration, resolved once at startup.
 *
 * Every environment variable the API reads is listed here so a deployment can
 * be audited from one file instead of by grepping process.env.
 */

import { DEFAULT_RETENTION_DAYS, resolveRetentionDays } from '../lib/trash.js'

const environment = process.env.NODE_ENV || 'development'
const configuredSecret = process.env.JWT_SECRET?.trim()

const historyDuration = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1000 && parsed <= 24 * 60 * 60 * 1000 ? Math.floor(parsed) : fallback
}

if (environment === 'production' && (!configuredSecret || configuredSecret.length < 32)) {
  console.error('JWT_SECRET must be configured with at least 32 characters when NODE_ENV=production.')
  process.exit(1)
}

export const config = {
  environment,
  jwtSecret: configuredSecret || 'development-only-change-this-secret',
  port: Number(process.env.PORT || 3000),
  collabPort: Number(process.env.COLLAB_PORT || 1234),
  host: process.env.HOST || '0.0.0.0',
  uploadDir: process.env.UPLOAD_DIR || '/data/uploads',
  appVersion: process.env.APP_VERSION || '0.1.0',
  updateManifestUrl: process.env.UPDATE_MANIFEST_URL?.trim() || '',
  updateAgentUrl: process.env.UPDATE_AGENT_URL?.trim() || '',
  updateAgentToken: process.env.UPDATE_AGENT_TOKEN?.trim() || '',
  corsOrigins: (process.env.CORS_ORIGIN || '').split(',').map((value) => value.trim()).filter(Boolean),
  /**
   * Whether `request.ip` may be read from `X-Forwarded-For`.
   *
   * The documented deployment never publishes the API ports: Caddy terminates TLS
   * and nginx proxies `/api`, setting `X-Forwarded-For` itself. Without this the
   * address is the nginx container, every login failure lands in one shared bucket,
   * and ten mistakes lock the whole workspace out.
   *
   * It stays configurable because trusting the header is only safe behind a proxy
   * that overwrites it. A deployment that exposes the API directly must set
   * `TRUST_PROXY=false`, or a client can claim any address it likes.
   */
  trustProxy: process.env.TRUST_PROXY?.trim() !== 'false',
  /**
   * How long a soft-deleted document stays recoverable. Zero-day retention made
   * the bin grow without bound, so the value is clamped to a sane window and
   * unset/invalid input falls back to the documented default.
   */
  trashRetentionDays: resolveRetentionDays(process.env.TRASH_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS),
  /** How often the retention sweep runs. A quarter hour keeps the bin current. */
  trashSweepIntervalMs: 15 * 60 * 1000,
  /** Durable current-state saves stay at 500ms; history uses separate clocks. */
  historyIdleMs: historyDuration(process.env.HISTORY_IDLE_MS, 2 * 60 * 1000),
  historyIntervalMs: historyDuration(process.env.HISTORY_INTERVAL_MS, 10 * 60 * 1000),
  bootstrap: {
    email: process.env.BOOTSTRAP_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '',
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '',
    name: process.env.BOOTSTRAP_ADMIN_NAME || process.env.ADMIN_NAME || 'Administrator',
  },
}
