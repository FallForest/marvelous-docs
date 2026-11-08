import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

const migrationsDir = new URL('../../migrations/', import.meta.url);

/**
 * Applies every SQL file in `migrations/` in filename order. Each statement set
 * must be idempotent because the runner replays the directory on every boot.
 */
export async function applyMigrations(pool: Pick<Pool, 'query'>): Promise<string[]> {
  const directory = fileURLToPath(migrationsDir);
  const files = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationsDir), 'utf8');
    await pool.query(sql);
  }
  return files;
}
