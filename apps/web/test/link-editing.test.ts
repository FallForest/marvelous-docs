import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { buildEditorExtensions } from '../src/lib/editor/index.ts'
import { linkEditTransaction, mapLinkEdit, safeHttpHref, startLinkEdit } from '../src/lib/editor/link-editing.ts'

const schema = getSchema(buildEditorExtensions())
const root = () => schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, [schema.text('before '), schema.text('linked words', [schema.marks.link.create({ href: 'https://example.com/old' })]), schema.text(' after')]))
const at = (from: number, to = from) => { const doc = root(); return EditorState.create({ doc, selection: TextSelection.create(doc, from, to) }) }

test('caret edits the complete existing link and prefills its address', () => {
  const state = at(11)
  const session = startLinkEdit(state, 'doc', 'request')
  assert.equal(session.prompt.href, 'https://example.com/old')
  assert.equal(state.doc.textBetween(session.from, session.to), 'linked words')
  const tr = linkEditTransaction(state, session, 'https://example.com/new')!
  assert.equal(tr.doc.textContent, state.doc.textContent)
  assert.equal(tr.doc.resolve(session.from).nodeAfter?.marks[0].attrs.href, 'https://example.com/new')
})

test('remove link preserves words and surrounding links', () => {
  const state = at(11)
  const session = startLinkEdit(state, 'doc', 'request')
  const tr = linkEditTransaction(state, session, null)!
  assert.equal(tr.doc.textContent, state.doc.textContent)
  assert.equal(tr.doc.rangeHasMark(session.from, session.to, schema.marks.link), false)
})

test('dialog target follows edits before it and rejects a deleted target', () => {
  let state = at(11)
  let session = startLinkEdit(state, 'doc', 'request')
  const prefix = state.tr.insertText('new ', 1)
  session = mapLinkEdit(session, prefix)
  state = state.apply(prefix)
  const changed = linkEditTransaction(state, session, 'https://example.com/new')!
  assert.equal(changed.doc.textBetween(session.from, session.to), 'linked words')
  assert.equal(changed.doc.resolve(1).nodeAfter?.marks.length, 0)
  const deletion = state.tr.delete(session.from, session.to)
  session = mapLinkEdit(session, deletion)
  state = state.apply(deletion)
  assert.equal(session.valid, false)
  assert.equal(linkEditTransaction(state, session, 'https://example.com/no'), null)
})

test('a whole-document replacement never reattaches to matching coordinates', () => {
  const state = at(11)
  const session = startLinkEdit(state, 'doc', 'request')
  const replacement = state.tr.replaceWith(0, state.doc.content.size, root().content)
  assert.equal(mapLinkEdit(session, replacement).valid, false)
})

test('bare caret inserts a visible linked URL; selection links preserve text', () => {
  const state = at(2)
  const inserted = linkEditTransaction(state, startLinkEdit(state, 'doc', 'request'), 'https://example.com')!
  assert.ok(inserted.doc.textContent.includes('bhttps://example.comefore'))
  assert.equal(inserted.doc.resolve(2).nodeAfter?.marks[0].type.name, 'link')
  const selected = at(1, 7)
  const tr = linkEditTransaction(selected, startLinkEdit(selected, 'doc', 'request'), 'https://example.com')!
  assert.equal(tr.doc.textContent, selected.doc.textContent)
  assert.equal(tr.doc.resolve(1).nodeAfter?.marks[0].type.name, 'link')
})

test('unsafe or incomplete schemes cannot be saved or opened', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,hi', 'file:///C:/x', '//example.com', 'not a URL']) {
    assert.equal(safeHttpHref(href), null)
    const state = at(11)
    assert.equal(linkEditTransaction(state, startLinkEdit(state, 'doc', 'request'), href), null)
  }
  assert.equal(safeHttpHref(' https://example.com '), 'https://example.com/')
})
