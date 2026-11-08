import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHarness, parseJson, runCli } from './helpers.mjs';
import { IDS, TOKEN } from './mock-server.mjs';

test('help lists commands, global options, and exit codes', async () => {
  const result = await runCli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /mdocs login/);
  assert.match(result.stdout, /mdocs export/);
  assert.match(result.stdout, /mdocs comments add/);
  assert.match(result.stdout, /--no-color/);
  assert.match(result.stdout, /Exit codes:/);
});

test('command help shows usage, options, and examples', async () => {
  const result = await runCli(['update', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: mdocs update ID --expected-version N/);
  assert.match(result.stdout, /--expected-version N/);
  assert.match(result.stdout, /Examples:/);
});

test('unknown command exits 2 with a hint', async () => {
  const result = await runCli(['nope']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown command: nope/);
});

test('version flag prints the package version', async () => {
  const result = await runCli(['--version']);
  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^mdocs \d+\.\d+\.\d+$/);
});

test('login stores a profile with owner-only permissions', async t => {
  const h = await createHarness(t);
  const result = await h.runAnonymous(['login', '--email', 'admin@example.com', '--password', 'secret']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Logged in as Ada Lovelace/);
  assert.ok(!result.stdout.includes(TOKEN), 'the saved token must never be printed');

  const raw = await readFile(h.configPath, 'utf8');
  const config = JSON.parse(raw);
  assert.equal(config.version, 1);
  assert.equal(config.defaultProfile, 'default');
  assert.equal(config.profiles.default.server, h.server.url);
  assert.equal(config.profiles.default.token, TOKEN);
  if (process.platform !== 'win32') {
    assert.equal((await stat(h.configPath)).mode & 0o777, 0o600);
    assert.equal((await stat(h.configDir)).mode & 0o777, 0o700);
  }
});

test('login migrates a legacy config file', async t => {
  const h = await createHarness(t);
  await writeFile(h.configPath, JSON.stringify({ server: 'https://legacy.example.com', token: 'legacy-token' }) + '\n', 'utf8');
  const result = await h.run(['whoami']);
  assert.equal(result.status, 0);
  const config = JSON.parse(await readFile(h.configPath, 'utf8'));
  assert.equal(config.version, 1);
  assert.equal(config.defaultProfile, 'default');
  assert.equal(config.profiles.default.server, 'https://legacy.example.com');
  assert.equal(config.profiles.default.token, 'legacy-token');
});

test('login accepts an explicit token', async t => {
  const h = await createHarness(t);
  const result = await h.runAnonymous(['login', '--token', TOKEN]);
  assert.equal(result.status, 0);
  assert.ok(!result.stdout.includes(TOKEN));
  const config = JSON.parse(await readFile(h.configPath, 'utf8'));
  assert.equal(config.profiles.default.token, TOKEN);
});

test('login rejects bad credentials with exit code 4', async t => {
  const h = await createHarness(t);
  const result = await h.runAnonymous(['login', '--email', 'admin@example.com', '--password', 'wrong']);
  assert.equal(result.status, 4);
  assert.match(result.stderr, /INVALID_CREDENTIALS/);
});

test('whoami prints a field table and a JSON envelope', async t => {
  const h = await createHarness(t);
  const human = await h.run(['whoami']);
  assert.equal(human.status, 0);
  assert.match(human.stdout, /FIELD\s+VALUE/);
  assert.match(human.stdout, /admin@example\.com/);

  const json = parseJson(await h.run(['whoami', '--json']));
  assert.equal(json.ok, true);
  assert.equal(json.command, 'whoami');
  assert.equal(json.data.user.email, 'admin@example.com');
});

test('list prints an aligned table', async t => {
  const h = await createHarness(t);
  const result = await h.run(['list']);
  assert.equal(result.status, 0);
  assert.match(result.stdout.split('\n')[0], /^ID\s+TITLE\s+KIND\s+VERSION\s+UPDATED$/);
  assert.match(result.stdout, /Quarterly plan/);
  assert.match(result.stdout, /folder/);
});

test('list --json returns the documents envelope', async t => {
  const h = await createHarness(t);
  const json = parseJson(await h.run(['list', '--json']));
  assert.equal(json.ok, true);
  assert.equal(json.command, 'list');
  assert.equal(json.data.documents.length, 2);
  assert.ok(json.data.documents.some(document => document.id === IDS.doc));
});

test('list --trash reads the trash endpoint', async t => {
  const h = await createHarness(t);
  const json = parseJson(await h.run(['list', '--trash', '--json']));
  assert.deepEqual(json.data.documents, []);
});

test('tree prints the hierarchy', async t => {
  const h = await createHarness(t);
  const result = await h.run(['tree']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Quarterly plan/);
  assert.match(result.stdout, /Projects\//);
});

test('search collapses whitespace in the human table', async t => {
  const h = await createHarness(t);
  const json = parseJson(await h.run(['search', 'quarterly', '--json']));
  assert.equal(json.data.results[0].id, IDS.doc);

  const human = await h.run(['search', 'quarterly']);
  assert.equal(human.status, 0);
  assert.match(human.stdout, /Quarterly plan body/);
  assert.ok(!human.stdout.includes('\n   plan'), 'snippets collapse whitespace');
});

test('create creates a blank document', async t => {
  const h = await createHarness(t);
  const json = parseJson(await h.run(['create', '--title', 'New doc', '--json']));
  assert.equal(json.data.document.title, 'New doc');
  assert.deepEqual(json.data.document.content, { schemaVersion: 1, doc: { type: 'doc', content: [] } });
});

test('create uses template content', async t => {
  const h = await createHarness(t);
  const json = parseJson(await h.run(['create', '--title', 'Standup', '--template', 'meeting-notes', '--json']));
  assert.equal(json.data.document.content.doc.content[0].type, 'heading');
  const request = h.server.state.requests.find(entry => entry.method === 'POST' && entry.path === '/api/v1/documents');
  assert.equal(request.body.title, 'Standup');
  assert.equal(request.body.content.doc.content[0].type, 'heading');
});

test('create imports markdown with --markdown', async t => {
  const h = await createHarness(t);
  const file = join(h.configDir, 'notes.md');
  await writeFile(file, '# Notes\n\nBody\n', 'utf8');
  const result = await h.run(['create', '--title', 'Notes', '--markdown', file, '--json']);
  assert.equal(result.status, 0);
  const request = h.server.state.requests.find(entry => entry.method === 'POST' && entry.path === '/api/v1/documents/import');
  assert.equal(request.body.markdown, '# Notes\n\nBody\n');
  assert.equal(request.body.format, 'markdown');
});

test('import detects markdown and json files', async t => {
  const h = await createHarness(t);
  const markdown = join(h.configDir, 'page.md');
  await writeFile(markdown, '# Page\n', 'utf8');
  const markdownResult = await h.run(['import', markdown, '--json']);
  assert.equal(markdownResult.status, 0);

  const jsonFile = join(h.configDir, 'document.json');
  await writeFile(jsonFile, JSON.stringify({ schemaVersion: 1, doc: { type: 'doc', content: [] } }), 'utf8');
  const jsonResult = await h.run(['import', jsonFile, '--json']);
  assert.equal(jsonResult.status, 0);
  assert.equal(parseJson(jsonResult).data.document.title, 'document');
});

test('read prints the document object', async t => {
  const h = await createHarness(t);
  const json = parseJson(await h.run(['read', IDS.doc, '--json']));
  assert.equal(json.id, IDS.doc);
  assert.equal(json.version, 3);
});

test('export defaults to the DocJson object', async t => {
  const h = await createHarness(t);
  const result = await h.run(['export', IDS.doc]);
  assert.equal(result.status, 0);
  const document = parseJson(result);
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.doc.type, 'doc');
});

test('export markdown writes a file', async t => {
  const h = await createHarness(t);
  const target = join(h.configDir, 'quarterly.md');
  const result = await h.run(['export', IDS.doc, '--format', 'markdown', '--output', target]);
  assert.equal(result.status, 0);
  const content = await readFile(target, 'utf8');
  assert.match(content, /^# Quarterly plan/);
  assert.match(result.stdout, /Wrote /);
});

test('update reports a version conflict with exit code 5', async t => {
  const h = await createHarness(t);
  const result = await h.run(['update', IDS.doc, '--expected-version', '1', '--title', 'Stale']);
  assert.equal(result.status, 5);
  assert.match(result.stderr, /409 VERSION_CONFLICT/);
  assert.match(result.stderr, /document version conflict/);
});

test('update succeeds with the current version', async t => {
  const h = await createHarness(t);
  const json = parseJson(await h.run(['update', IDS.doc, '--expected-version', '3', '--title', 'Renamed', '--json']));
  assert.equal(json.data.document.title, 'Renamed');
  assert.equal(json.data.document.version, 4);
});

test('read reports missing documents with exit code 6', async t => {
  const h = await createHarness(t);
  const result = await h.run(['read', IDS.missing]);
  assert.equal(result.status, 6);
  assert.match(result.stderr, /NOT_FOUND/);
});

test('read reports forbidden documents with exit code 4', async t => {
  const h = await createHarness(t);
  const result = await h.run(['read', IDS.forbidden]);
  assert.equal(result.status, 4);
  assert.match(result.stderr, /FORBIDDEN/);
});

test('trash, restore, delete, duplicate, and favorite succeed', async t => {
  const h = await createHarness(t);
  assert.equal((await h.run(['trash', IDS.doc])).status, 0);
  assert.equal((await h.run(['restore', IDS.doc])).status, 0);
  assert.equal((await h.run(['delete', IDS.doc])).status, 0);
  assert.equal((await h.run(['duplicate', IDS.doc, '--json'])).status, 0);
  const favorite = parseJson(await h.run(['favorite', IDS.doc, '--on', '--json']));
  assert.equal(favorite.data.favorite, true);
});

test('purge refuses without --yes', async t => {
  const h = await createHarness(t);
  const result = await h.run(['purge', IDS.doc]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--yes/);
});

test('purge deletes with --yes', async t => {
  const h = await createHarness(t);
  const result = await h.run(['purge', IDS.doc, '--yes']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Permanently deleted/);
});

test('comments list, add, and resolve', async t => {
  const h = await createHarness(t);
  const list = await h.run(['comments', 'list', IDS.doc]);
  assert.equal(list.status, 0);
  assert.match(list.stdout, /STATUS|status/);
  assert.match(list.stdout, /Ada Lovelace/);

  const added = parseJson(await h.run(['comments', 'add', IDS.doc, '--body', 'Needs a summary', '--json']));
  assert.equal(added.data.comment.body, 'Needs a summary');

  const resolved = parseJson(await h.run(['comments', 'resolve', IDS.doc, IDS.comment, '--json']));
  assert.equal(resolved.data.comment.status, 'resolved');
});

test('versions list, show, and restore', async t => {
  const h = await createHarness(t);
  const list = parseJson(await h.run(['versions', 'list', IDS.doc, '--json']));
  assert.equal(list.data.versions[0].id, IDS.version);

  const show = parseJson(await h.run(['versions', 'show', IDS.doc, IDS.version, '--json']));
  assert.equal(show.data.version.createdByName, 'Ada Lovelace');

  const restored = parseJson(await h.run(['versions', 'restore', IDS.doc, IDS.version, '--expected-version', '3', '--json']));
  assert.equal(restored.data.document.version, 4);
});

test('versions restore reports conflicts', async t => {
  const h = await createHarness(t);
  const result = await h.run(['versions', 'restore', IDS.doc, IDS.version, '--expected-version', '1']);
  assert.equal(result.status, 5);
  assert.match(result.stderr, /document version conflict/);
});

test('share list, grant, revoke, and restrict', async t => {
  const h = await createHarness(t);
  const list = parseJson(await h.run(['share', 'list', IDS.doc, '--json']));
  assert.equal(list.data.restricted, true);
  assert.equal(list.data.permissions[0].role, 'owner');

  assert.equal((await h.run(['share', 'grant', IDS.doc, '--user', IDS.otherUser, '--role', 'editor'])).status, 0);
  assert.equal((await h.run(['share', 'revoke', IDS.doc, '--user', IDS.otherUser])).status, 0);
  const restricted = parseJson(await h.run(['share', 'restrict', IDS.doc, '--off', '--json']));
  assert.equal(restricted.data.restricted, false);
});

test('members, templates, stats, and activity render tables', async t => {
  const h = await createHarness(t);
  const members = await h.run(['members']);
  assert.equal(members.status, 0);
  assert.match(members.stdout, /EMAIL/);
  assert.match(members.stdout, /grace@example\.com/);

  const templates = parseJson(await h.run(['templates', '--json']));
  assert.ok(templates.data.templates.some(template => template.id === 'meeting-notes'));

  const stats = await h.run(['stats']);
  assert.equal(stats.status, 0);
  assert.match(stats.stdout, /METRIC/);
  assert.match(stats.stdout, /documents\s+2/);

  const activity = parseJson(await h.run(['activity', IDS.doc, '--json']));
  assert.equal(activity.data.activity.length, 2);
});

test('invite prints the one-time token', async t => {
  const h = await createHarness(t);
  const result = await h.run(['invite', 'new@example.com', '--role', 'member', '--json']);
  assert.equal(result.status, 0);
  const json = parseJson(result);
  assert.equal(json.data.invite.email, 'new@example.com');
  assert.match(json.data.invite.token, /^invite-token-/);
});

test('upload prints the absolute URL', async t => {
  const h = await createHarness(t);
  const file = join(h.configDir, 'pixel.png');
  await writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const result = await h.run(['upload', file]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, new RegExp(h.server.url + '/api/v1/uploads/'));
  assert.match(result.stdout, /pixel\.png/);
});

test('doctor reports every check', async t => {
  const h = await createHarness(t);
  const result = await h.run(['doctor', '--json']);
  assert.equal(result.status, 0);
  const json = parseJson(result);
  assert.deepEqual(json.data.checks.map(check => check.name), ['server', 'authentication', 'version']);
  assert.equal(json.data.version, '0.1.0');
});

test('completion prints shell scripts', async () => {
  const bash = await runCli(['completion', 'bash']);
  assert.equal(bash.status, 0);
  assert.match(bash.stdout, /complete -F _mdocs_complete mdocs/);
  assert.match(bash.stdout, /COMPREPLY/);

  const fish = await runCli(['completion', 'fish']);
  assert.match(fish.stdout, /complete -c mdocs/);

  const zsh = await runCli(['completion', 'zsh']);
  assert.match(zsh.stdout, /#compdef mdocs/);

  const powershell = await runCli(['completion', 'powershell']);
  assert.match(powershell.stdout, /Register-ArgumentCompleter/);
});

test('unknown profile exits 2', async t => {
  const h = await createHarness(t);
  const result = await h.run(['list', '--profile', 'missing']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown profile "missing"/);
});

test('--quiet suppresses confirmations but keeps data', async t => {
  const h = await createHarness(t);
  const quiet = await h.run(['create', '--title', 'Silent', '--quiet']);
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout, '');

  const loud = await h.run(['create', '--title', 'Loud']);
  assert.match(loud.stdout, /Created/);
});
test('mkdir creates a folder with a parent', async t => {
  const h = await createHarness(t);
  const json = parseJson(await h.run(['mkdir', 'Projects 2026', '--parent', IDS.folder, '--json']));
  assert.equal(json.data.document.kind, 'folder');
  assert.equal(json.data.document.title, 'Projects 2026');
  const request = h.server.state.requests.find(entry => entry.method === 'POST' && entry.path === '/api/v1/documents');
  assert.equal(request.body.kind, 'folder');
  assert.equal(request.body.parentId, IDS.folder);
});
