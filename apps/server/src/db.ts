import pg from 'pg'
import { applyMigrations } from './lib/migrations.js'
import { config } from './config.js'
import { passwordHash } from './security.js'

const { Pool } = pg

export const pool = new Pool({ connectionString: process.env.DATABASE_URL })

/**
 * Applies migrations, then creates the bootstrap administrator when the
 * configured e-mail does not exist yet. Safe to run on every boot.
 */
export async function initializeWorkspace(log: { info: (message: string) => void }): Promise<void> {
  await applyMigrations(pool)
  const { email, password, name } = config.bootstrap
  if (!email || !password) return
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const exists = await client.query('SELECT id FROM users WHERE lower(email)=lower($1)', [email])
    if (exists.rowCount) { await client.query('COMMIT'); return }
    const workspace = await client.query("INSERT INTO workspaces(name) VALUES ('Marvelous Docs') RETURNING id")
    const user = await client.query('INSERT INTO users(email,name,password_hash) VALUES ($1,$2,$3) RETURNING id', [email.toLowerCase(), name, await passwordHash(password)])
    await client.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,'admin')", [workspace.rows[0].id, user.rows[0].id])
    await client.query('COMMIT')
    log.info('Initial administrator created')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
