import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Pool, PoolClient } from 'pg';

const migrationsDir = new URL('../../migrations/', import.meta.url);

/** Arbitrary but fixed: two processes racing at boot take the same lock. */
const MIGRATION_LOCK_ID = 4_192_837;

export type MigrationLog = { info: (message: string) => void; warn: (message: string) => void };

const silent: MigrationLog = { info: () => undefined, warn: () => undefined };

/** Accepts the old `(pool, log)` call shape and the new options object. */
function normalise(options: MigrationOptions | MigrationLog) {
  const isLog = typeof (options as MigrationLog).info === 'function'
  if (isLog) return { log: options as MigrationLog, prepare: (sql: string) => sql }
  const value = options as MigrationOptions
  return { log: value.log ?? silent, prepare: value.prepare ?? ((sql: string) => sql) }
}

type Queryable = Pick<Pool, 'query'> & Partial<Pick<Pool, 'connect'>>;

/**
 * Applies every SQL file in `migrations/` in filename order.
 *
 * The files stay idempotent and additive - the runner still replays the directory -
 * but it now keeps a record of what it has run, and runs inside a lock:
 *
 *   - **A record.** `schema_migrations` answers "which version is deployed" and
 *     "did the file change since it ran". Nothing could answer either before, so a
 *     schema question needed a diff against the repository.
 *   - **A lock.** Two replicas booting together used to replay every file
 *     concurrently. `pg_advisory_lock` makes the second wait for the first, which
 *     is what keeps a `CREATE INDEX` from failing on a duplicate.
 *   - **One transaction per file.** A file that fails half way used to leave the
 *     schema in a state no file describes. Now it rolls back and the exception
 *     propagates, so a broken migration stops the boot instead of half-applying.
 *
 * Checksums warn rather than block. These files are designed to be replayed, and an
 * edited-but-equal statement is a comment change; refusing to boot over it would
 * turn a typo in a comment into an outage. The warning is the signal to look.
 */
/**
 * How a caller wants the SQL prepared before it is executed.
 *
 * The in-process engine the tests use has no `pgcrypto`, so those suites strip the
 * `CREATE EXTENSION` line from every file - including the ones the runner reads.
 * Without a way to pass that through, moving the runner onto a dedicated connection
 * silently bypassed the strip and every suite failed with "extension pgcrypto is
 * not available". The hook keeps the preparation with the caller, which is where the
 * knowledge of the target lives.
 */
export type MigrationOptions = {
  log?: MigrationLog
  /** Applied to each file's SQL before it runs. Defaults to the file unchanged. */
  prepare?: (sql: string) => string
}

export async function applyMigrations(pool: Queryable, options: MigrationOptions | MigrationLog = {}): Promise<string[]> {
  const { log, prepare } = normalise(options)
  const read = async (file: string) => prepare(await readFile(new URL(file, migrationsDir), 'utf8'))
  const directory = fileURLToPath(migrationsDir);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  const manager = await acquire(pool, log);
  if (!manager) {
    // No dedicated connection (the in-process PGlite used by tests). Replay as
    // before: correctness first, bookkeeping where it can be recorded.
    for (const file of files) await pool.query(await read(file));
    return files;
  }
  try {
    await manager.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())'
    );
    const applied = new Map<string, string>();
    for (const row of (await manager.query<{ filename: string; checksum: string }>('SELECT filename, checksum FROM schema_migrations')).rows) {
      applied.set(row.filename, row.checksum);
    }
    /*
     * A database that predates this table has an empty record and a populated
     * schema. Treating that as "nothing has run" would replay everything - harmless
     * by design, but a needless minute of locking on every upgrade. Detect it once by
     * asking whether the initial schema is already there.
     */
    const legacy = applied.size === 0 && await tableExists(manager, 'documents');

    for (const file of files) {
      const sql = await read(file);
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = applied.get(file);
      if (previous) {
        if (previous !== checksum) {
          log.warn('migration ' + file + ' changed after it was applied; the file is replayed but its recorded checksum is stale');
        }
        // Still replay: the files are idempotent, and a re-run is what keeps an
        // older database able to pick up an additive statement added later.
        await runFile(manager, sql);
        continue;
      }
      await runFile(manager, sql);
      await manager.query(
        'INSERT INTO schema_migrations(filename, checksum) VALUES ($1,$2) ON CONFLICT (filename) DO UPDATE SET checksum=EXCLUDED.checksum, applied_at=now()',
        [file, checksum]
      );
      if (legacy) log.info('recorded previously applied migration ' + file);
    }
    return files;
  } finally {
    await manager.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    manager.release();
  }
}

/** One file, one transaction, so a half-applied file cannot survive. */
async function runFile(manager: PoolClient, sql: string) {
  await manager.query('BEGIN');
  try {
    await manager.query(sql);
    await manager.query('COMMIT');
  } catch (error) {
    await manager.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function tableExists(manager: PoolClient, name: string) {
  const result = await manager.query<{ present: boolean }>('SELECT to_regclass($1) IS NOT NULL AS present', ['public.' + name]);
  return Boolean(result.rows[0]?.present);
}

/**
 * A dedicated connection holding the advisory lock, or null when the pool cannot
 * hand one out (the in-process engine the tests use).
 */
async function acquire(pool: Queryable, log: MigrationLog): Promise<PoolClient | null> {
  if (typeof pool.connect !== 'function') return null;
  const manager = await (pool as Pool).connect()
  // `pg` hands out a client whose own `query` is what the runner needs.
  try {
    await manager.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    return manager;
  } catch (error) {
    log.warn('could not take the migration lock, continuing without it: ' + String(error));
    manager.release();
    return null;
  }
}
