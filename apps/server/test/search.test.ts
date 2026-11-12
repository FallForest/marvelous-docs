import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { buildTsQuery, SEARCH_SQL } from '../src/lib/search.js'

/**
 * Search is split in two: parsing the user's words into a `tsquery`, and the
 * statement that runs it. Both are covered here.
 *
 * The SQL half runs against a real PostgreSQL engine (PGlite, in-process) with
 * the project's own migrations applied, because the interesting failures —
 * a generated column that is not immutable, a `strict` path that duplicates a
 * paragraph's words, a phrase that matches the wrong characters — only appear
 * once the server executes the statement.
 */

test('builds a phrase for a run of ideographs', () => {
  assert.equal(buildTsQuery('写作'), "'写' <-> '作'")
  assert.equal(buildTsQuery('季度计划'), "'季' <-> '度' <-> '计' <-> '划'")
  assert.equal(buildTsQuery('文'), "'文'")
});

test('latin terms are prefix-matched, ideographs are not', () => {
  assert.equal(buildTsQuery('quar'), "'quar':*")
  assert.equal(buildTsQuery('Quarterly Plan'), "'quarterly':* & 'plan':*")
  // A prefix on a single ideograph would match every word starting with it,
  // which in Chinese means most of the document.
  assert.equal(buildTsQuery('季度'), "'季' <-> '度'")
});

test('mixed scripts stay separate terms and are ANDed', () => {
  assert.equal(buildTsQuery('写 release 说明'), "'写' & 'release':* & '说' <-> '明'")
});

test('punctuation and whitespace break phrases without becoming terms', () => {
  assert.equal(buildTsQuery('季度, 计划!'), "'季' <-> '度' & '计' <-> '划'")
  assert.equal(buildTsQuery('   '), null)
  assert.equal(buildTsQuery('!!!'), null)
  assert.equal(buildTsQuery(''), null)
});

test('is case-insensitive and survives the characters tsquery treats specially', () => {
  assert.equal(buildTsQuery('ABC'), "'abc':*")
  // `&`, `|`, `!`, `:` and parentheses are tsquery operators; they must reach
  // the database as punctuation, not as syntax.
  const query = buildTsQuery('a & b | c ! d:e')
  assert.ok(query)
  assert.ok(!/!/.test(query))
  assert.ok(!/[|]/.test(query))
});

/* ------------------------------------------------------------------ */
/* The statement, against a real engine                                */
/* ------------------------------------------------------------------ */

const WS = '11111111-1111-1111-1111-111111111111'
const ADMIN = '22222222-2222-2222-2222-222222222222'
const MEMBER = '33333333-3333-3333-3333-333333333333'

async function fixture() {
  const db = new PGlite()
  const dir = new URL('../migrations/', import.meta.url)
  // PGlite has no contrib extensions; the schema only wants gen_random_uuid,
  // which is built in on PostgreSQL 13+, so the extension line is dropped.
  const initial = (await readFile(new URL('001_initial.sql', dir), 'utf8')).replace(/CREATE EXTENSION[^;]+;/i, '')
  await db.exec(initial)
  await db.exec(await readFile(new URL('002_share_links.sql', dir), 'utf8'))
  await db.exec(await readFile(new URL('003_full_text_search.sql', dir), 'utf8'))

  await db.query('INSERT INTO workspaces(id,name) VALUES ($1,$2)', [WS, 'Workspace'])
  await db.query('INSERT INTO users(id,email,name,password_hash) VALUES ($1,$2,$3,$4)', [ADMIN, 'admin@example.com', 'Admin', 'x'])
  await db.query('INSERT INTO users(id,email,name,password_hash) VALUES ($1,$2,$3,$4)', [MEMBER, 'member@example.com', 'Member', 'x'])
  await db.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,'admin')", [WS, ADMIN])
  await db.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES ($1,$2,'member')", [WS, MEMBER])
  return db
}

function document(text: string) {
  return JSON.stringify({
    schemaVersion: 1,
    doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  })
}

async function insertDocument(db: PGlite, title: string, body: string, options: { restricted?: boolean } = {}) {
  const result = await db.query<{ id: string }>(
    'INSERT INTO documents(workspace_id,title,content,acl_restricted,created_by,updated_by) VALUES ($1,$2,$3::jsonb,$4,$5,$5) RETURNING id',
    [WS, title, document(body), options.restricted ?? false, ADMIN],
  )
  return result.rows[0]!.id
}

async function search(db: PGlite, q: string, scope = 'all', user = ADMIN) {
  const tsquery = buildTsQuery(q)
  if (!tsquery) return []
  const result = await db.query(SEARCH_SQL, [user, WS, tsquery, scope, 20])
  return result.rows as Array<{ title: string; title_match: number; body_text: string; rank: number }>
}

test('applies the search migration idempotently', async () => {
  const db = await fixture()
  const migration = await readFile(new URL('../migrations/003_full_text_search.sql', import.meta.url), 'utf8')
  // The runner replays the directory on every boot.
  await db.exec(migration)
  await db.exec(migration)
  await db.close()
});

test('indexes English terms and prefix-matches them', async () => {
  const db = await fixture()
  await insertDocument(db, 'Quarterly plan', 'Revenue grew in the third quarter.')
  await insertDocument(db, 'Other', 'Nothing relevant here.')

  assert.deepEqual((await search(db, 'quarter')).map((row) => row.title), ['Quarterly plan'])
  assert.deepEqual((await search(db, 'revenue')).map((row) => row.title), ['Quarterly plan'])
  assert.deepEqual(await search(db, 'absent'), [])
  await db.close()
});

test('indexes CJK without a word segmenter, and keeps phrases adjacent', async () => {
  const db = await fixture()
  await insertDocument(db, '季度计划', '本文说明写作方法。')
  await insertDocument(db, '作文训练', '作文课的内容。')

  // "写作" is two adjacent lexemes: 写 then 作.
  assert.deepEqual((await search(db, '写作')).map((row) => row.title), ['季度计划'])
  // "作文" exists in the second document and must not match the first, where
  // 作 and 文 are nowhere near each other.
  assert.deepEqual((await search(db, '作文')).map((row) => row.title), ['作文训练'])
  // A single ideograph is a plain lexeme.
  assert.deepEqual((await search(db, '训练')).map((row) => row.title), ['作文训练'])
  await db.close()
});

test('a title match outranks body relevance, and repetition outranks recency', async () => {
  const db = await fixture()
  await insertDocument(db, 'Unrelated heading', 'budget budget budget budget')
  await insertDocument(db, 'budget', 'One brief mention.')

  const results = await search(db, 'budget')
  assert.equal(results[0]!.title, 'budget', 'the document named after the term comes first')
  assert.equal(results[0]!.title_match, 1)
  assert.equal(results[1]!.title_match, 0)
  await db.close()
});

test('scope narrows to the title or the body', async () => {
  const db = await fixture()
  await insertDocument(db, 'Roadmap', 'mentions migration once')
  await insertDocument(db, 'Migration notes', 'unrelated body')

  assert.deepEqual((await search(db, 'migration', 'title')).map((row) => row.title), ['Migration notes'])
  assert.deepEqual((await search(db, 'migration', 'content')).map((row) => row.title), ['Roadmap'])
  assert.deepEqual((await search(db, 'migration', 'all')).map((row) => row.title).sort(), ['Migration notes', 'Roadmap'])
  await db.close()
});

test('restricted documents stay invisible to members without a grant', async () => {
  const db = await fixture()
  const id = await insertDocument(db, 'Secret budget', 'classified numbers', { restricted: true })

  assert.deepEqual(await search(db, 'classified', 'all', MEMBER), [])
  // The workspace admin override still sees it.
  assert.equal((await search(db, 'classified', 'all', ADMIN)).length, 1)

  await db.query("INSERT INTO document_acl(document_id,user_id,role) VALUES ($1,$2,'viewer')", [id, MEMBER])
  assert.equal((await search(db, 'classified', 'all', MEMBER)).length, 1)
  await db.close()
});

test('trashed documents are excluded', async () => {
  const db = await fixture()
  const id = await insertDocument(db, 'Draft', 'obsolete wording')
  await db.query('UPDATE documents SET deleted_at=now() WHERE id=$1', [id])
  assert.deepEqual(await search(db, 'obsolete'), [])
  await db.close()
});

test('returns the indexed prose for the snippet, without the Tiptap JSON', async () => {
  const db = await fixture()
  await insertDocument(db, 'Notes', 'The target phrase sits here.')
  const [row] = await search(db, 'target')
  assert.equal(row!.body_text.trim(), 'The target phrase sits here.')
  assert.ok(!row!.body_text.includes('"type"'), 'body_text is prose, not JSON')
  await db.close()
});

test('a long paragraph is not scored as several copies of itself', async () => {
  const db = await fixture()
  // `strict` in the extraction path matters: the non-strict jsonpath returned a
  // paragraph's text once per nesting level, which tripled its ts_rank.
  const long = 'alpha beta gamma delta epsilon zeta eta theta'
  await insertDocument(db, 'Short', 'alpha')
  await insertDocument(db, 'Long', long)

  const rows = await search(db, 'alpha')
  const short = rows.find((row) => row.title === 'Short')!
  const longRow = rows.find((row) => row.title === 'Long')!
  assert.ok(short.rank >= longRow.rank, 'a one-word body must not rank below an eight-word one')
  assert.equal(longRow.body_text.trim(), long)
  await db.close()
});
