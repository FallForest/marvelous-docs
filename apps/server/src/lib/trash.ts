/**
 * Trash retention.
 *
 * A soft delete is a safety net for the next few minutes, not a second archive.
 * Without a deadline the bin grows forever and ends up holding more rows than
 * the tree itself does — which is exactly what happened: 49 untitled duplicates
 * accumulated and every one of them had to be dismissed by hand.
 *
 * So the window is a policy with three parts, all here:
 *   - a deadline per row, derived from `deleted_at` (no extra column to keep in
 *     sync, and restoring a row re-arms nothing because the row leaves the bin);
 *   - a sweep that removes rows whose deadline passed, cascading to their
 *     subtree so a purged folder never leaves orphaned children behind;
 *   - the same deadline exposed to the client, so the UI can count down instead
 *     of deleting something with no warning.
 */

/** Thirty days is long enough to notice a mistake and short enough to matter. */
export const DEFAULT_RETENTION_DAYS = 30

/**
 * Bounds for the configured window. A zero or negative value would empty the
 * bin on the next sweep, which reads as data loss, so the floor is one day; the
 * ceiling keeps a typo like `36500` from turning the bin into a permanent
 * archive again.
 */
const MIN_RETENTION_DAYS = 1
const MAX_RETENTION_DAYS = 365

const DAY_MS = 86_400_000

/**
 * Normalises `TRASH_RETENTION_DAYS`.
 *
 * Unset, empty, and non-numeric all mean "use the default": a deployment that
 * mistypes the variable gets the documented behaviour instead of a bin that
 * never (or always) empties itself.
 */
export function resolveRetentionDays(raw: unknown): number {
  // `Number('')` is 0, which would clamp to a one-day window — an environment
  // file with `TRASH_RETENTION_DAYS=` must mean "unset", not "one day".
  const text = typeof raw === 'string' ? raw.trim() : raw
  if (text === '' || text === null || text === undefined) return DEFAULT_RETENTION_DAYS
  const value = typeof text === 'number' ? text : Number(text)
  if (!Number.isFinite(value)) return DEFAULT_RETENTION_DAYS
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.floor(value)))
}

/** The moment a trashed row becomes eligible for the sweep, or null if unknown. */
export function trashExpiresAt(deletedAt: Date | string | null | undefined, retentionDays: number): string | null {
  if (!deletedAt) return null
  const time = deletedAt instanceof Date ? deletedAt.getTime() : Date.parse(deletedAt)
  if (!Number.isFinite(time)) return null
  return new Date(time + resolveRetentionDays(retentionDays) * DAY_MS).toISOString()
}

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ id: string }> }> }

/**
 * Removes every trashed row whose deadline has passed, plus the subtree under
 * each one, and returns the ids it removed.
 *
 * The cascade is deliberate and matches trashing: a folder's deadline governs
 * its contents, so a child that was deleted separately (and therefore expires
 * later) cannot survive as an orphan re-parented to the workspace root. One
 * statement, so it is safe to run on every boot and on a timer.
 *
 * Returning ids rather than a count matters at the call site: a document with a
 * live collaboration room must have that room evicted, or the next keystroke
 * from a connected editor writes to a row that no longer exists.
 */
export async function purgeExpiredTrash(db: Queryable, retentionDays: number): Promise<string[]> {
  const days = resolveRetentionDays(retentionDays)
  const result = await db.query(
    `WITH RECURSIVE expired AS (
        SELECT id FROM documents
         WHERE deleted_at IS NOT NULL
           AND deleted_at < now() - ($1::int * interval '1 day')
        UNION ALL
        SELECT d.id FROM documents d JOIN expired e ON d.parent_id = e.id
      )
      DELETE FROM documents WHERE id IN (SELECT id FROM expired) RETURNING id`, [days])
  return result.rows.map((row) => row.id)
}
