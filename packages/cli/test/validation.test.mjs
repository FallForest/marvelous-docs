import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, runCli } from './helpers.mjs';
import { IDS } from './mock-server.mjs';

test('bare invocation prints help and exits 0', async () => {
  const result = await runCli([]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /mdocs list/);
});

test('unknown option exits 2', async t => {
  const h = await createHarness(t);
  const result = await h.run(['list', '--nope']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown option --nope/);
});

test('missing --title exits 2', async t => {
  const h = await createHarness(t);
  const result = await h.run(['create']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Missing required option --title/);
});

test('conflicting content sources exit 2', async t => {
  const h = await createHarness(t);
  const result = await h.run(['create', '--title', 'x', '--input', 'a.json', '--markdown', 'b.md']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Use only one of --input and --markdown/);
});

test('template cannot be combined with content', async t => {
  const h = await createHarness(t);
  const result = await h.run(['create', '--title', 'x', '--template', 'blank', '--input', 'a.json']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--template cannot be combined/);
});

test('update without --expected-version exits 2', async t => {
  const h = await createHarness(t);
  const result = await h.run(['update', IDS.doc, '--title', 'x']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--expected-version/);
});

test('update without fields exits 2', async t => {
  const h = await createHarness(t);
  const result = await h.run(['update', IDS.doc, '--expected-version', '3']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /at least one of --title, --parent, or --input/);
});

test('invalid export format exits 2', async t => {
  const h = await createHarness(t);
  const result = await h.run(['export', IDS.doc, '--format', 'xml']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--format must be one of: json, markdown, html/);
});

test('invalid document id exits 2', async t => {
  const h = await createHarness(t);
  const result = await h.run(['read', 'not-a-uuid']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /must be a UUID/);
});

test('invalid shell exits 2', async () => {
  const result = await runCli(['completion', 'tcsh']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /completion requires one of: bash, zsh, fish, powershell/);
});

test('exclusive list flags exit 2', async t => {
  const h = await createHarness(t);
  const result = await h.run(['list', '--trash', '--favorites']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Use only one of --trash/);
});

test('favorite requires exactly one of --on and --off', async t => {
  const h = await createHarness(t);
  const result = await h.run(['favorite', IDS.doc]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /exactly one of --on or --off/);
});

test('repeated option exits 2', async t => {
  const h = await createHarness(t);
  const result = await h.run(['list', '--folder', IDS.folder, '--folder', IDS.doc]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /more than once/);
});

test('network failures exit 3', async t => {
  const h = await createHarness(t);
  const result = await h.run(['list'], { server: 'http://127.0.0.1:1' });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /Cannot reach http:\/\/127\.0\.0\.1:1/);
});