/**
 * Trash expiry, rendered for humans.
 *
 * Kept in `lib/format.ts` shape (pure, no React) so the countdown can be unit
 * tested with a fixed clock: a relative countdown that silently rounds the
 * wrong way would tell someone they have a day left when the sweep is about to
 * run.
 */

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

/** Whole days left before `expiresAt`, floored — never rounds a day up. */
export function daysUntil(expiresAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!expiresAt) return null
  const time = Date.parse(expiresAt)
  if (!Number.isFinite(time)) return null
  return Math.max(0, Math.floor((time - now) / DAY_MS))
}

/**
 * Short label for a trashed row, e.g. "29 天后自动删除", "今天自动删除",
 * "已过期，等待清理".
 *
 * The three bands exist because the number alone is ambiguous near the
 * boundary: "0 天后" reads like a bug, and an expired row that the sweep has not
 * reached yet must not look like it has time left.
 */
export function trashExpiryLabel(expiresAt: string | null | undefined, now: number = Date.now()): string {
  if (!expiresAt) return ''
  const time = Date.parse(expiresAt)
  if (!Number.isFinite(time)) return ''
  const remaining = time - now
  if (remaining <= 0) return '已过期，等待清理'
  if (remaining < HOUR_MS) {
    const minutes = Math.max(1, Math.floor(remaining / MINUTE_MS))
    return minutes + ' 分钟后自动删除'
  }
  const days = Math.floor(remaining / DAY_MS)
  if (days >= 1) return days + ' 天后自动删除'
  // Under a day but over an hour: hours are precise enough to act on.
  return Math.floor(remaining / HOUR_MS) + ' 小时后自动删除'
}

/**
 * The row's own deadline is authoritative, but a client whose clock is behind
 * the server's would otherwise show time that already elapsed. Comparing
 * against the retention window the server sent keeps the "expired" verdict
 * conservative in either direction.
 */
export function isExpired(expiresAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!expiresAt) return false
  const time = Date.parse(expiresAt)
  return Number.isFinite(time) && time <= now
}
