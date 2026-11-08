import pg from 'pg';
import { applyMigrations } from './lib/migrations.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const applied = await applyMigrations(pool);
  console.log('Database schema is current (' + applied.join(', ') + ').');
} finally {
  await pool.end();
}
