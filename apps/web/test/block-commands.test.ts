import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { history, redo, undo, undoDepth } from '@tiptap/pm/history'
import { buildEditorExtensions } from '../src/lib/editor/index.ts'
import {
  canMoveBlock, deleteBlock, duplicateBlock, insertParagraphBelow, moveBlock,
  moveBlockBefore, topLevelBlockAt,
} from '../src/lib/editor/blocks.ts'

const schema = getSchema(buildEditorExtensions({}))
const paragraph = text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) })
const code = text => ({ type: 'codeBlock', attrs: { language: 'bash' }, content: [{ type: 'text', text }] })
const document = nodes => schema.nodeFromJSON({ type: 'doc', content: nodes })

/** Real ProseMirror transactions, schema and history; only the DOM view is absent. */
function fixture(nodes, selection?) {
  const doc = document(nodes)
  const editor = {
    state: EditorState.create({ doc, plugins: [history()], ...(selection ? { selection: selection(doc) } : {}) }),
    isEditable: true,
    transactions: [],
    focuses: 0,
    view: {
      dispatch(tr) { editor.transactions.push(tr); editor.state = editor.state.apply(tr) },
      focus() { editor.focuses++ },
    },
  }
  return editor
}

const shape = editor => editor.state.doc.content.content.map(node => [node.type.name, node.textContent])
const undoOnce = editor => undo(editor.state, tr => editor.view.dispatch(tr))
const redoOnce = editor => redo(editor.state, tr => editor.view.dispatch(tr))
const positionOf = (doc, type) => {
  let found = -1
  doc.descendants((node, pos) => { if (found < 0 && node.type.name === type) found = pos })
  return found
}

test('a long code block moves down across a short paragraph using shortened-document coordinates', () => {
  const source = 'docker compose pull && docker compose up -d\n'.repeat(15)
  const editor = fixture([code(source), paragraph('x'), paragraph('tail')], doc => TextSelection.create(doc, 3, 9))
  const before = editor.state.doc
  assert.equal(moveBlock(editor, 0, 1), true)
  assert.deepEqual(shape(editor), [['paragraph', 'x'], ['codeBlock', source], ['paragraph', 'tail']])
  assert.equal(editor.state.doc.child(1).attrs.language, 'bash')
  assert.equal(editor.state.selection.anchor, 3 + 3)
  assert.equal(editor.state.selection.head, 3 + 9)
  assert.equal(editor.state.selection.$from.parent.type.name, 'codeBlock')
  assert.equal(editor.focuses, 1)
  assert.equal(editor.transactions.filter(tr => tr.docChanged).length, 1)
  assert.equal(undoDepth(editor.state), 1)
  assert.equal(undoOnce(editor), true)
  assert.ok(editor.state.doc.eq(before))
  assert.equal(undoOnce(editor), false)
  assert.equal(redoOnce(editor), true)
  assert.equal(editor.state.doc.child(1).type.name, 'codeBlock')
})

test('moving code below the final short paragraph appends at the post-delete end', () => {
  const editor = fixture([code('a long code block\nwith two lines'), paragraph('x')])
  assert.equal(moveBlock(editor, 1, 1), true)
  assert.deepEqual(shape(editor).map(block => block[0]), ['paragraph', 'codeBlock'])
  assert.equal(editor.state.selection.$from.parent.type.name, 'codeBlock')
})

test('first/last and sole-block boundaries are disabled and create no transaction or history', () => {
  const editor = fixture([code('first'), paragraph('last')])
  const last = editor.state.doc.child(0).nodeSize
  assert.equal(canMoveBlock(editor, 0, -1), false)
  assert.equal(canMoveBlock(editor, last, 1), false)
  assert.equal(moveBlock(editor, 0, -1), false)
  assert.equal(moveBlock(editor, last, 1), false)
  assert.equal(moveBlockBefore(editor, 0, last), false, 'dropping at the following block is the existing gap')
  assert.equal(editor.transactions.length, 0)
  assert.equal(undoDepth(editor.state), 0)
  const sole = fixture([code('only')])
  assert.equal(canMoveBlock(sole, 1, -1), false)
  assert.equal(canMoveBlock(sole, 1, 1), false)
})

test('drag/drop and menu moves produce the same document and cursor', () => {
  const nodes = [code('code'), paragraph('x'), paragraph('tail')]
  const menu = fixture(nodes, doc => TextSelection.create(doc, 3))
  const drag = fixture(nodes, doc => TextSelection.create(doc, 3))
  const third = drag.state.doc.child(0).nodeSize + drag.state.doc.child(1).nodeSize
  assert.equal(moveBlock(menu, 0, 1), true)
  assert.equal(moveBlockBefore(drag, 0, third), true)
  assert.ok(menu.state.doc.eq(drag.state.doc))
  assert.ok(menu.state.selection.eq(drag.state.selection))
  assert.equal(undoDepth(drag.state), 1)
})

test('nested code moves with its entire list and keeps the cursor inside that code', () => {
  const list = { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('item'), code('nested code')] }] }
  const editor = fixture([list, paragraph('x')])
  const nested = positionOf(editor.state.doc, 'codeBlock')
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, nested + 3)))
  assert.equal(topLevelBlockAt(editor.state.doc, nested)?.node.type.name, 'bulletList')
  assert.equal(moveBlock(editor, nested, 1), true)
  assert.deepEqual(shape(editor).map(block => block[0]), ['paragraph', 'bulletList'])
  assert.equal(editor.state.doc.child(1).child(0).child(1).type.name, 'codeBlock')
  assert.equal(editor.state.selection.$from.parent.type.name, 'codeBlock')
  assert.equal(editor.state.selection.from, nested + 3 + 3)
  assert.equal(undoOnce(editor), true)
  assert.equal(editor.state.doc.firstChild.type.name, 'bulletList')
})

test('duplicate and insert below resolve a nested code position to the top-level quote', () => {
  const quote = { type: 'blockquote', content: [paragraph('intro'), code('nested')] }
  const editor = fixture([quote, paragraph('tail')])
  const nested = positionOf(editor.state.doc, 'codeBlock')
  assert.equal(duplicateBlock(editor, nested), true)
  assert.deepEqual(shape(editor).map(block => block[0]), ['blockquote', 'blockquote', 'paragraph'])
  assert.equal(undoOnce(editor), true)
  assert.equal(insertParagraphBelow(editor, nested), true)
  assert.deepEqual(shape(editor), [['blockquote', 'intronested'], ['paragraph', ''], ['paragraph', 'tail']])
  assert.equal(editor.state.selection.$from.parent.type.name, 'paragraph')
  assert.equal(editor.state.selection.$from.parent.content.size, 0)
  assert.equal(undoDepth(editor.state), 1)
})

test('delete of the only code block removes all its text and leaves one empty paragraph', () => {
  const editor = fixture([code('this must be deleted')])
  const before = editor.state.doc
  assert.equal(deleteBlock(editor, 1), true)
  assert.deepEqual(shape(editor), [['paragraph', '']])
  assert.equal(editor.state.selection.from, 1)
  assert.equal(undoDepth(editor.state), 1)
  assert.equal(undoOnce(editor), true)
  assert.ok(editor.state.doc.eq(before))
})

test('deleting nested code deletes its owning block rather than extracting it from a list', () => {
  const list = { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('item'), code('nested')] }] }
  const editor = fixture([list, paragraph('keep')])
  assert.equal(deleteBlock(editor, positionOf(editor.state.doc, 'codeBlock')), true)
  assert.deepEqual(shape(editor), [['paragraph', 'keep']])
  assert.equal(editor.state.selection.$from.parent.type.name, 'paragraph')
  assert.equal(undoOnce(editor), true)
  assert.equal(editor.state.doc.firstChild.type.name, 'bulletList')
})

test('structural actions are separate undo steps from adjacent typing and each other', () => {
  const editor = fixture([code('source'), paragraph('x')], doc => TextSelection.create(doc, 1))
  editor.view.dispatch(editor.state.tr.insertText('typed '))
  const typedBeforeMove = editor.state.doc
  assert.equal(moveBlock(editor, 0, 1), true)
  const moved = editor.state.doc
  editor.view.dispatch(editor.state.tr.insertText('after '))
  assert.equal(undoOnce(editor), true)
  assert.ok(editor.state.doc.eq(moved), 'first undo removes later typing only')
  assert.equal(undoOnce(editor), true)
  assert.ok(editor.state.doc.eq(typedBeforeMove), 'second undo reverses the complete move only')
  assert.equal(undoOnce(editor), true)
  assert.equal(editor.state.doc.firstChild.textContent, 'source')

  assert.equal(duplicateBlock(editor, 0), true)
  assert.equal(insertParagraphBelow(editor, 0), true)
  assert.equal(deleteBlock(editor, 0), true)
  assert.equal(undoDepth(editor.state), 3)
})

test('selected atom moves as a node selection; invalid/read-only operations stay inert', () => {
  const editor = fixture([{ type: 'horizontalRule' }, paragraph('x')], doc => NodeSelection.create(doc, 0))
  assert.equal(moveBlock(editor, 0, 1), true)
  assert.ok(editor.state.selection instanceof NodeSelection)
  assert.equal(editor.state.selection.node.type.name, 'horizontalRule')
  assert.equal(topLevelBlockAt(editor.state.doc, -1), null)
  assert.equal(topLevelBlockAt(editor.state.doc, 1000), null)
  assert.equal(moveBlock(editor, -1, 1), false)
  editor.isEditable = false
  const before = editor.state.doc
  assert.equal(moveBlock(editor, 0, 1), false)
  assert.equal(deleteBlock(editor, 0), false)
  assert.equal(duplicateBlock(editor, 0), false)
  assert.equal(insertParagraphBelow(editor, 0), false)
  assert.ok(editor.state.doc.eq(before))
})
