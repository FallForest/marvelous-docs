import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const migration = await readFile(fileURLToPath(new URL('../migrations/001_initial.sql', import.meta.url)), 'utf8');
  await pool.query(migration);
  console.log('Database schema is current.');
} finally {
  await pool.end();
}
