import assert from 'node:assert/strict'
import test from 'node:test'
import { getSchema } from '@tiptap/core'
import { buildEditorExtensions } from '../src/lib/editor'
import { clearSavedDraft, draftKey, isBlankDraft, readDraft, sameDraftBody, sameDraftContent, sameDraftText, writeDraft } from '../src/lib/local-drafts'

function storage() {
  const rows = new Map<string, string>()
  return { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) } }
}
const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '还没有同步' }] }] }

test('draft survives reload and is isolated by author and document', () => {
  const disk = storage()
  assert.equal(writeDraft(disk, 'doc', 'user', body), true)
  assert.deepEqual(readDraft(disk, 'doc', 'user')?.body, body)
  assert.equal(readDraft(disk, 'doc', 'someone-else'), null)
  assert.equal(readDraft(disk, 'another-doc', 'user'), null)
})

test('acknowledging an older save cannot erase a newer local edit', () => {
  const disk = storage()
  const newer = { type: 'doc', content: [{ type: 'paragraph' }] }
  writeDraft(disk, 'doc', 'user', body)
  writeDraft(disk, 'doc', 'user', newer)
  clearSavedDraft(disk, 'doc', 'user', body)
  assert.deepEqual(readDraft(disk, 'doc', 'user')?.body, newer)
  clearSavedDraft(disk, 'doc', 'user', newer)
  assert.equal(readDraft(disk, 'doc', 'user'), null)
})

test('PostgreSQL JSON key ordering does not produce false recovery prompts', () => {
  assert.equal(sameDraftBody(body, { content: body.content, type: 'doc' }), true)
  assert.equal(sameDraftBody(body, { type: 'doc', content: [] }), false)
})

test('Yjs omitted default attributes equal the editor body, without hiding actual changes', () => {
  const schema = getSchema(buildEditorExtensions())
  const client = schema.nodeFromJSON(body).toJSON()
  assert.equal(sameDraftBody(client, body, schema), true)
  const different = { type: 'doc', content: [{ type: 'paragraph' }] }
  assert.equal(sameDraftBody(client, different, schema), false)
  assert.equal(sameDraftBody(client, { type: 'not-a-valid-node' }, schema), false)
})

test('a copy whose words are already stored is not offered again', () => {
  const stored = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '已经保存的句子' }] }] }
  // Same words, different serialisation: defaults, key order, a trailing empty
  // paragraph. This is what the stored body and the editor body look like.
  const editor = {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { textAlign: null, indent: 0 }, content: [{ type: 'text', text: '已经保存的句子 ' }] },
      { type: 'paragraph' },
    ],
  }
  assert.equal(sameDraftText(stored, editor), true)
  assert.equal(sameDraftContent(stored, editor), true)
  assert.equal(sameDraftText(stored, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '另一个句子' }] }] }), false)
  // Nothing to compare: an empty copy never counts as "already saved".
  assert.equal(sameDraftText({ type: 'doc', content: [{ type: 'paragraph' }] }, { type: 'doc', content: [{ type: 'paragraph' }] }), false)

  // Same words, different writing: a paragraph split or a bold run is an edit
  // the cloud does not have, so the copy must still be offered.
  const split = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一段' }] }, { type: 'paragraph', content: [{ type: 'text', text: '第二段' }] }] }
  const joined = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一段第二段' }] }] }
  assert.equal(sameDraftText(split, joined), true, 'the words are the same')
  assert.equal(sameDraftContent(split, joined), false, 'the writing is not')
  const bold = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: '已经保存的句子' }] }] }
  const plain = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '已经保存的句子' }] }] }
  assert.equal(sameDraftContent(bold, plain), false, 'formatting is part of the edit')
})

test('a copy with nothing in it is not offered as unsaved work', () => {
  const blank = { type: 'doc', content: [{ type: 'paragraph' }] }
  assert.equal(isBlankDraft(blank), true)
  assert.equal(isBlankDraft({ type: 'doc', content: [] }), true)
  assert.equal(isBlankDraft({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }] }), true)
  // An empty table, an image or a rule is a real edit with no words in it.
  assert.equal(isBlankDraft({ type: 'doc', content: [{ type: 'horizontalRule' }] }), false)
  assert.equal(isBlankDraft({ type: 'doc', content: [{ type: 'image', attrs: { src: '/uploads/a.png' } }] }), false)
  assert.equal(isBlankDraft({ type: 'doc', content: [{ type: 'table', content: [] }] }), false)
  assert.equal(isBlankDraft({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '写下的字' }] }] }), false)
})

test('legacy draft recovery, malformed data and unavailable storage are handled', () => {
  const disk = storage()
  disk.setItem(draftKey('doc'), JSON.stringify(body))
  assert.deepEqual(readDraft(disk, 'doc', 'user')?.body, body)
  disk.setItem(draftKey('doc'), '{invalid')
  assert.equal(readDraft(disk, 'doc', 'user'), null)
  assert.equal(writeDraft({ ...disk, setItem: () => { throw new Error('quota') } }, 'doc', 'user', body), false)
})
