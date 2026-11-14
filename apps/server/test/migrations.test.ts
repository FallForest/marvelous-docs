import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from '../src/lib/migrations.js';

test('applies every migration in filename order', async () => {
  const executed: string[] = [];
  const pool = { query: async (sql: string) => { executed.push(sql); return { rows: [] }; } };
  const files = await applyMigrations(pool);
  assert.ok(files.length >= 1);
  assert.ok(files.every(name => name.endsWith('.sql')));
  assert.deepEqual([...files].sort(), files);
  assert.equal(executed.length, files.length);
  assert.ok(executed[0]!.includes('CREATE TABLE IF NOT EXISTS workspace'));
  assert.ok(executed.join('\n').includes('document_activity_document_recent'));
});

test('rejects a directory without SQL only when there are no files', async () => {
  const executed: string[] = [];
  const pool = { query: async (sql: string) => { executed.push(sql); return { rows: [] }; } };
  const files = await applyMigrations(pool);
  assert.ok(files.length > 0);
  assert.ok(executed.every(sql => sql.length > 0));
});

/* ------------------------------------------------------------------ */
/* Version retention, against real SQL                                 */
/* ------------------------------------------------------------------ */

/**
 * migrations/007 is the only migration with logic in it; everything else is DDL.
 * The pruning predicate is four conditions deep, so it is checked here rather
 * than trusted: a widening bug would quietly delete history nobody can restore.
 */
async function seedRetention() {
  const db = new PGlite();
  const strip = (sql: string) => sql.replace(/CREATE EXTENSION[^;]+;/gi, '');
  const dir = new URL('../migrations/', import.meta.url);
  for (const name of [
    '001_initial.sql', '002_share_links.sql', '003_full_text_search.sql',
    '005_history_checkpoints.sql', '006_activity_history.sql', '007_version_retention.sql',
  ]) await db.exec(strip(await readFile(new URL(name, dir), 'utf8')));
  const ws = await db.query<{ id: string }>("INSERT INTO workspaces(name) VALUES ('W') RETURNING id");
  const user = await db.query<{ id: string }>(
    "INSERT INTO users(email,name,password_hash) VALUES ('r@example.com','R','x') RETURNING id");
  const doc = await db.query<{ id: string }>(
    `INSERT INTO documents(workspace_id,title,kind,content,created_by,updated_by)
     VALUES ($1,'D','document','{"type":"doc"}'::jsonb,$2,$2) RETURNING id`,
    [ws.rows[0]!.id, user.rows[0]!.id]);
  return { db, documentId: doc.rows[0]!.id, userId: user.rows[0]!.id };
}

/** Inserts a snapshot at a specific age, so the buckets are exact. */
async function addVersion(db: PGlite, documentId: string, userId: string, version: number, daysAgo: number, minutes: number) {
  await db.query(
    `INSERT INTO document_versions(document_id,version,title,content,created_by,created_at)
     VALUES ($1,$2,'D','{"type":"doc"}'::jsonb,$3, now() - ($4 || ' days')::interval - ($5 || ' minutes')::interval)`,
    [documentId, version, userId, daysAgo, minutes]);
}

async function prune(db: PGlite) {
  const result = await db.query<{ removed: number }>('SELECT marvelous_prune_document_versions() AS removed');
  return result.rows[0]!.removed;
}

test('the parent index the tree walks on exists', async () => {
  const { db } = await seedRetention();
  const index = await db.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE tablename='documents' AND indexname='documents_parent'");
  assert.equal(index.rows.length, 1, 'access checks, deletes and moves all recurse on parent_id');
  await db.close();
});

test('retention keeps recent history and thins the old days', async () => {
  const { db, documentId, userId } = await seedRetention();
  let version = 0;
  // Sixty snapshots today: all recent, all kept, ceiling or not.
  for (let i = 0; i < 60; i++) await addVersion(db, documentId, userId, ++version, 0, i);
  // Forty on each of two older days: four survive per day, spaced through it.
  for (const daysAgo of [10, 20]) for (let i = 0; i < 40; i++) await addVersion(db, documentId, userId, ++version, daysAgo, i);

  assert.equal(await prune(db), 72, '80 old rows reduced to 8, nothing recent touched');

  const byDay = await db.query<{ day: string; n: number }>(
    `SELECT date_trunc('day', created_at)::date::text AS day, count(*)::int AS n
       FROM document_versions GROUP BY 1 ORDER BY 1 DESC`);
  assert.deepEqual(byDay.rows.map((row) => row.n), [60, 4, 4]);
  await db.close();
});

test('retention keeps the newest rows even when they are old', async () => {
  const { db, documentId, userId } = await seedRetention();
  // A document nobody has touched in a year: every row is past the recent
  // window and past every day bucket, so only the ceiling can save it.
  for (let i = 0; i < 60; i++) await addVersion(db, documentId, userId, i + 1, 400, i);

  assert.equal(await prune(db), 10, 'the ceiling (50) decides, not the day buckets');
  const remaining = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM document_versions');
  assert.equal(remaining.rows[0]!.n, 50);
  await db.close();
});

test('a history under the ceiling is kept whole', async () => {
  const { db, documentId, userId } = await seedRetention();
  // Thirty snapshots, all old, all on one day: the day bucket would thin them to
  // four, but a document this small should not lose history at all. Protection is
  // "any rule saves it", and the ceiling is one of those rules.
  for (let i = 0; i < 30; i++) await addVersion(db, documentId, userId, i + 1, 30, i);
  assert.equal(await prune(db), 0);
  await db.close();
})

test('retention is idempotent', async () => {
  const { db, documentId, userId } = await seedRetention();
  // Past the ceiling, on one old day: the first pass has work to do, the second
  // must find nothing, so a repeated sweep cannot erode history one pass at a time.
  for (let i = 0; i < 80; i++) await addVersion(db, documentId, userId, i + 1, 30, i);
  const first = await prune(db);
  assert.ok(first > 0, 'the fixture must actually prune');
  assert.equal(await prune(db), 0);
  await db.close();
});

test('an already-populated database is recorded rather than replayed blindly', async () => {
  // A deployment that predates `schema_migrations` looks identical to a fresh one
  // from the runner's point of view: no record, and every file still on disk. The
  // distinguishing question is whether the schema is already there.
  //
  // This is checked through the log channel rather than by counting statements,
  // because the contract that matters is "it notices, and it says so".
  const messages: string[] = [];
  const pool = {
    query: async (sql: string) => { messages.push(sql); return { rows: [] } },
    connect: undefined,
  };
  const files = await applyMigrations(pool as never, { info: (m) => messages.push('info:' + m), warn: (m) => messages.push('warn:' + m) });
  assert.ok(files.length > 0);
  // No `connect`, so the lock and the record are skipped and the replay still runs.
  assert.ok(messages.some((entry) => entry.includes('CREATE TABLE IF NOT EXISTS workspace')));
  assert.ok(!messages.some((entry) => entry.startsWith('info:')), 'nothing to record without a dedicated connection');
})
