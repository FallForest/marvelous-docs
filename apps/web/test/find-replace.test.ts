import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { history, undo, undoDepth } from '@tiptap/pm/history'
import { buildEditorExtensions } from '../src/lib/editor/index.ts'
import { applyTextReplacement, findTextMatches, replaceTextMatches } from '../src/lib/editor/find-replace.ts'

const schema = getSchema(buildEditorExtensions())
const p = (text = '') => schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined)
const doc = (...nodes) => schema.nodes.doc.create(null, nodes)

test('search uses document positions inside nested lists, quotes and tables', () => {
  const root = doc(p('prefix'),
    schema.nodes.bulletList.create(null, schema.nodes.listItem.create(null, p('needle'))),
    schema.nodes.blockquote.create(null, p('needle')),
    schema.nodes.table.create(null, schema.nodes.tableRow.create(null, [
      schema.nodes.tableCell.create(null, p('needle')),
      schema.nodes.tableCell.create(null, p('needle')),
    ])), p('needle'))
  const found = findTextMatches(root, 'needle')
  assert.equal(found.length, 5)
  for (const range of found) assert.equal(root.textBetween(range.from, range.to), 'needle')
  const replaced = replaceTextMatches(EditorState.create({ doc: root }), found, 'new').doc
  assert.equal(findTextMatches(replaced, 'new').length, 5)
  assert.equal(replaced.child(1).type.name, 'bulletList')
  assert.equal(replaced.child(3).firstChild?.childCount, 2)
  replaced.check()
})

test('search crosses formatting boundaries but not inline atoms or block boundaries', () => {
  const root = doc(schema.nodes.paragraph.create(null, [schema.text('nee'), schema.text('dle', [schema.marks.bold.create()])]), p('nee'), p('dle'),
    schema.nodes.paragraph.create(null, [schema.text('nee'), schema.nodes.image.create({ src: 'https://example.com/x.png' }), schema.text('dle')]))
  assert.equal(findTextMatches(root, 'needle').length, 1)
  const match = findTextMatches(root, 'needle')[0]
  assert.deepEqual(match, { from: 1, to: 7 })
})

test('hard breaks occupy real document positions and literal regexp punctuation is searchable', () => {
  const root = doc(schema.nodes.paragraph.create(null, [schema.text('a.*['), schema.nodes.hardBreak.create(), schema.text('b')]))
  assert.deepEqual(findTextMatches(root, 'a.*[\nb'), [{ from: 1, to: 7 }])
  assert.deepEqual(findTextMatches(root, '.*['), [{ from: 2, to: 5 }])
  assert.deepEqual(findTextMatches(root, ''), [])
})

test('case-insensitive Unicode matching preserves UTF-16 document offsets', () => {
  const root = doc(p('İ X 🐈 Aa aA'))
  const found = findTextMatches(root, 'aa')
  assert.equal(found.length, 2)
  for (const range of found) assert.equal(root.textBetween(range.from, range.to).toLowerCase(), 'aa')
  assert.equal(findTextMatches(root, 'Aa', true).length, 1)
})

test('replace all covers more than 500 matches and inserts literal text', () => {
  const root = doc(p(Array(650).fill('old').join(' ')))
  const found = findTextMatches(root, 'old')
  assert.equal(found.length, 650)
  const replaced = replaceTextMatches(EditorState.create({ doc: root }), found, '<b>new</b> & $&').doc
  assert.equal(replaced.textContent, Array(650).fill('<b>new</b> & $&').join(' '))
  assert.equal(replaced.firstChild?.childCount, 1)
  assert.equal(replaced.firstChild?.firstChild?.marks.length, 0)
  replaced.check()
})

test('empty replacement deletes the matched text without merging blocks', () => {
  const root = doc(p('old x old'), p('old'))
  const replaced = replaceTextMatches(EditorState.create({ doc: root }), findTextMatches(root, 'old'), '').doc
  assert.equal(replaced.childCount, 2)
  assert.equal(replaced.child(0).textContent, ' x ')
  assert.equal(replaced.child(1).textContent, '')
})

test('replacement is one undo step isolated from surrounding typing and respects read-only', () => {
  let state = EditorState.create({ doc: doc(p('old old')), plugins: [history()] })
  const dispatch = (tr) => { state = state.apply(tr) }
  let editable = true
  const editor = { get state() { return state }, get isEditable() { return editable }, view: { dispatch } } as unknown as Editor
  dispatch(state.tr.insertText('!', 8))
  const before = state.doc
  assert.equal(applyTextReplacement(editor, findTextMatches(state.doc, 'old'), 'new'), true)
  assert.equal(undoDepth(state), 2)
  dispatch(state.tr.insertText('?', state.doc.content.size - 1))
  assert.equal(undoDepth(state), 3)
  assert.equal(undo(state, dispatch), true)
  assert.equal(state.doc.textContent, 'new new!')
  assert.equal(undo(state, dispatch), true)
  assert.ok(state.doc.eq(before))
  editable = false
  assert.equal(applyTextReplacement(editor, findTextMatches(state.doc, 'old'), 'no'), false)
  assert.ok(state.doc.eq(before))
})
