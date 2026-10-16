import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'dist', 'index.js');

test('help prints supported commands', () => {
  const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /mdocs login/);
  assert.match(result.stdout, /mdocs export/);
});

test('invalid command exits with usage error', () => {
  const result = spawnSync(process.execPath, [cli, 'nope'], { encoding: 'utf8', env: { ...process.env, MDOCS_CONFIG_DIR: join(root, '.test-config') } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown command/);
});
