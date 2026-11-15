import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { buildEditorExtensions } from '../src/lib/editor/index.ts'
import { changeBlockIndent, TabInProse } from '../src/lib/editor/tab-in-prose.ts'

const schema = getSchema(buildEditorExtensions())
const p = (text = '', indent = 0) => schema.nodes.paragraph.create({ indent }, text ? schema.text(text) : undefined)
const doc = (...nodes) => schema.nodes.doc.create(null, nodes)

test('toolbar and keyboard indentation adjusts every selected prose block independently', () => {
  const root = doc(p('one', 0), schema.nodes.heading.create({ level: 2, indent: 2 }, schema.text('two')))
  let state = EditorState.create({ doc: root, selection: TextSelection.create(root, 1, root.content.size - 1) })
  assert.equal(changeBlockIndent(1)(state), true)
  assert.equal(state.doc.child(0).attrs.indent, 0, 'can check must not mutate')
  changeBlockIndent(1)(state, tr => { state = state.apply(tr) })
  assert.deepEqual([state.doc.child(0).attrs.indent, state.doc.child(1).attrs.indent], [1, 3])
  changeBlockIndent(-1)(state, tr => { state = state.apply(tr) })
  assert.ok(state.doc.eq(root))
})

test('indent limits disable unavailable operations instead of emitting no-op writes', () => {
  for (const [level, direction] of [[0, -1], [6, 1]] as const) {
    const root = doc(p('x', level))
    const state = EditorState.create({ doc: root, selection: TextSelection.create(root, 1) })
    let writes = 0
    assert.equal(changeBlockIndent(direction)(state, () => { writes++ }), false)
    assert.equal(writes, 0)
  }
  const root = doc(schema.nodes.codeBlock.create(null, schema.text('x')))
  assert.equal(changeBlockIndent(1)(EditorState.create({ doc: root, selection: TextSelection.create(root, 1) })), false)
})

test('ordinary and task list items indent structurally and keep task state', () => {
  for (const [listName, itemName] of [['bulletList', 'listItem'], ['taskList', 'taskItem']]) {
    const root = doc(schema.nodes[listName].create(null, [
      schema.nodes[itemName].create({ checked: false }, p('first')),
      schema.nodes[itemName].create({ checked: true }, p('second')),
    ]))
    let position = 0
    root.descendants((node, pos) => { if (node.isText && node.text === 'second') position = pos })
    let state = EditorState.create({ doc: root, selection: TextSelection.create(root, position) })
    assert.equal(changeBlockIndent(1)(state), true)
    changeBlockIndent(1)(state, tr => { state = state.apply(tr) })
    assert.equal(state.doc.firstChild?.childCount, 1)
    const nested = state.doc.firstChild?.firstChild?.lastChild
    assert.equal(nested?.type.name, listName)
    if (itemName === 'taskItem') assert.equal(nested?.firstChild?.attrs.checked, true)
    changeBlockIndent(-1)(state, tr => { state = state.apply(tr) })
    assert.ok(state.doc.eq(root))
  }
})

test('table Tab falls through to cell navigation rather than changing paragraph indent', () => {
  const root = doc(schema.nodes.table.create(null, schema.nodes.tableRow.create(null, [schema.nodes.tableCell.create(null, p('x')), schema.nodes.tableCell.create(null, p('y'))])))
  let state = EditorState.create({ doc: root, selection: TextSelection.create(root, 4) })
  const editor = { get state() { return state }, isEditable: true, view: { dispatch: (tr) => { state = state.apply(tr) } } }
  const keys = TabInProse.config.addKeyboardShortcuts!.call({ editor } as never)
  assert.equal(keys.Tab(), false)
  assert.equal(keys['Shift-Tab'](), false)
  assert.ok(state.doc.eq(root))
})
