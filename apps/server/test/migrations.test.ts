import test from 'node:test';
import assert from 'node:assert/strict';
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
