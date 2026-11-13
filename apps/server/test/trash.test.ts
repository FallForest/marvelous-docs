import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import {
  DEFAULT_RETENTION_DAYS, purgeExpiredTrash, resolveRetentionDays, trashExpiresAt,
} from '../src/lib/trash.js'

/**
 * Trash retention.
 *
 * Two layers, matching the module: the window arithmetic is pure and checked
 * here against a fixed clock, and the sweep runs against a real PostgreSQL
 * engine (PGlite, in-process) because the interesting part is the recursive
 * cascade 鈥?a child that was deleted separately must not survive its folder.
 */

test('an unset or unusable window falls back to the documented default', () => {
  assert.equal(resolveRetentionDays(undefined), DEFAULT_RETENTION_DAYS)
  assert.equal(resolveRetentionDays(''), DEFAULT_RETENTION_DAYS)
  assert.equal(resolveRetentionDays('   '), DEFAULT_RETENTION_DAYS)
  assert.equal(resolveRetentionDays('thirty'), DEFAULT_RETENTION_DAYS)
  assert.equal(resolveRetentionDays(NaN), DEFAULT_RETENTION_DAYS)
  assert.equal(DEFAULT_RETENTION_DAYS, 30)
})

test('the window is clamped, never trusted as configured', () => {
  // Zero or negative would empty the bin on the next sweep, which is data loss.
  assert.equal(resolveRetentionDays(0), 1)
  assert.equal(resolveRetentionDays('-7'), 1)
  assert.equal(resolveRetentionDays(-1), 1)
  // A typo like 36500 must not turn the bin into a permanent archive again.
  assert.equal(resolveRetentionDays(36500), 365)
  assert.equal(resolveRetentionDays('90'), 90)
  // Fractions floor, so "1.9 days" cannot round up past a day boundary.
  assert.equal(resolveRetentionDays('1.9'), 1)
})

test('the deadline is the delete time plus the window', () => {
  const deletedAt = new Date('2024-03-01T00:00:00.000Z')
  assert.equal(trashExpiresAt(deletedAt, 30), '2024-03-31T00:00:00.000Z')
  assert.equal(trashExpiresAt('2024-03-01T00:00:00.000Z', 1), '2024-03-02T00:00:00.000Z')
  // A row that was never deleted has no deadline at all.
  assert.equal(trashExpiresAt(null, 30), null)
  assert.equal(trashExpiresAt(undefined, 30), null)
  assert.equal(trashExpiresAt('not-a-date', 30), null)
})

test('the deadline uses the clamped window, not the raw input', () => {
  const deletedAt = '2024-03-01T00:00:00.000Z'
  assert.equal(trashExpiresAt(deletedAt, 0), trashExpiresAt(deletedAt, 1))
})

/* ------------------------------------------------------------------ */
/* The sweep, against real SQL                                         */
/* ------------------------------------------------------------------ */

async function seed() {
  const db = new PGlite()
  const strip = (sql: string) => sql.replace(/CREATE EXTENSION[^;]+;/gi, '')
  const dir = new URL('../migrations/', import.meta.url)
  for (const name of ['001_initial.sql', '002_share_links.sql', '003_full_text_search.sql']) {
    await db.exec(strip(await readFile(new URL(name, dir), 'utf8')))
  }
  const ws = await db.query<{ id: string }>("INSERT INTO workspaces(name) VALUES ('W') RETURNING id")
  const user = await db.query<{ id: string }>(
    "INSERT INTO users(email,name,password_hash) VALUES ('a@example.com','A','x') RETURNING id")
  return { db, workspaceId: ws.rows[0]!.id, userId: user.rows[0]!.id }
}

/** Inserts a row with an explicit age, so the sweep's boundary is testable. */
async function insert(
  db: PGlite,
  workspaceId: string,
  userId: string,
  title: string,
  options: { parentId?: string | null; ageDays?: number | null } = {},
) {
  const age = options.ageDays
  const result = await db.query<{ id: string }>(
    `INSERT INTO documents(workspace_id,parent_id,title,kind,content,created_by,updated_by,deleted_at)
     VALUES ($1,$2,$3,'document','{"type":"doc"}'::jsonb,$4,$4,
             CASE WHEN $5::float8 IS NULL THEN NULL ELSE now() - ($5::float8 * interval '1 day') END)
     RETURNING id`,
    [workspaceId, options.parentId ?? null, title, userId, age ?? null])
  return result.rows[0]!.id
}

async function titles(db: PGlite) {
  const rows = await db.query<{ title: string }>('SELECT title FROM documents ORDER BY title')
  return rows.rows.map((row) => row.title)
}

test('sweeps only rows past the window, and leaves live documents alone', async () => {
  const { db, workspaceId, userId } = await seed()
  await insert(db, workspaceId, userId, 'live')
  await insert(db, workspaceId, userId, 'fresh-trash', { ageDays: 3 })
  await insert(db, workspaceId, userId, 'old-trash', { ageDays: 40 })

  const removed = await purgeExpiredTrash(db, 30)
  assert.equal(removed.length, 1)
  assert.deepEqual(await titles(db), ['fresh-trash', 'live'])
  await db.close()
})

test('a row exactly at the boundary survives its last day', async () => {
  const { db, workspaceId, userId } = await seed()
  // 29.5 days: inside the window, so the next sweep must not take it.
  await insert(db, workspaceId, userId, 'almost', { ageDays: 29.5 })
  assert.deepEqual(await purgeExpiredTrash(db, 30), [])
  assert.deepEqual(await titles(db), ['almost'])
  await db.close()
})

test('a child deleted separately expires with its parent folder', async () => {
  const { db, workspaceId, userId } = await seed()
  const folder = await insert(db, workspaceId, userId, 'folder', { ageDays: 40 })
  const child = await insert(db, workspaceId, userId, 'child', { parentId: folder, ageDays: 2 })
  const grandchild = await insert(db, workspaceId, userId, 'grandchild', { parentId: child, ageDays: null })

  // The folder's window governs the subtree: a child that still has 28 days on
  // its own clock cannot outlive it as an orphan re-parented to the workspace.
  const removed = await purgeExpiredTrash(db, 30)
  assert.deepEqual(removed.sort(), [folder, child, grandchild].sort())
  assert.deepEqual(await titles(db), [])
  await db.close()
})

test('a purge leaves a live subtree in place', async () => {
  const { db, workspaceId, userId } = await seed()
  const folder = await insert(db, workspaceId, userId, 'folder')
  await insert(db, workspaceId, userId, 'child', { parentId: folder })
  await insert(db, workspaceId, userId, 'expired', { ageDays: 90 })

  assert.equal((await purgeExpiredTrash(db, 30)).length, 1)
  assert.deepEqual(await titles(db), ['child', 'folder'])
  await db.close()
})

test('the sweep is idempotent, and reports the ids a caller must evict', async () => {
  const { db, workspaceId, userId } = await seed()
  const id = await insert(db, workspaceId, userId, 'expired', { ageDays: 60 })
  assert.deepEqual(await purgeExpiredTrash(db, 30), [id])
  assert.deepEqual(await purgeExpiredTrash(db, 30), [])
  await db.close()
})

test('cascades remove dependent rows through the foreign keys', async () => {
  const { db, workspaceId, userId } = await seed()
  const id = await insert(db, workspaceId, userId, 'expired', { ageDays: 60 })
  await db.query('INSERT INTO comments(document_id,user_id,body) VALUES ($1,$2,$3)', [id, userId, 'note'])
  await db.query('INSERT INTO document_favorites(document_id,user_id) VALUES ($1,$2)', [id, userId])
  await db.query(`INSERT INTO document_versions(document_id,version,title,content,created_by)
                  VALUES ($1,1,'expired','{"type":"doc"}'::jsonb,$2)`, [id, userId])

  await purgeExpiredTrash(db, 30)
  for (const table of ['comments', 'document_favorites', 'document_versions']) {
    const remaining = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`)
    assert.equal(remaining.rows[0]!.count, '0', table + ' must not outlive its document')
  }
  await db.close()
})
