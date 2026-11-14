import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import type { Editor, KeyboardShortcutCommand } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { baseKeymap } from '@tiptap/pm/commands'
import { history, undo } from '@tiptap/pm/history'
import { keymap } from '@tiptap/pm/keymap'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { buildEditorExtensions } from '../src/lib/editor/index.ts'
import { CodeBlockBoundary, isAtCodeBlockEnd } from '../src/lib/editor/code-block.ts'

const schema = getSchema(buildEditorExtensions({}))
const paragraph = (text = '') => schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined)
const code = (text = '') => schema.nodes.codeBlock.create({ language: 'javascript' }, text ? schema.text(text) : undefined)
const documentOf = (...nodes: PMNode[]) => schema.nodes.doc.create(null, nodes)
const sample = (text = 'a = 1\nb = 2') => documentOf(paragraph('ABOVE'), code(text), paragraph('BELOW'))

function codeRange(root: PMNode) {
  let pos = -1
  let node: PMNode | null = null
  root.descendants((child, offset) => {
    if (child.type.name === 'codeBlock' && pos < 0) { pos = offset; node = child }
  })
  assert.ok(node && pos >= 0, 'fixture has a code block')
  return { pos, start: pos + 1, end: pos + 1 + (node as PMNode).content.size }
}

function bindings(options: Record<string, unknown> = {}): Record<string, KeyboardShortcutCommand> {
  return CodeBlockBoundary.config.addKeyboardShortcuts!.call({
    options: { ...CodeBlockBoundary.options, ...options },
  } as never)
}

/**
 * Real ProseMirror state, keymap fallthrough, transactions and history. Only
 * the DOM view is absent: no splitBlock/exitCode adapters reimplement the code
 * under test. This catches selection mapping and schema/history regressions.
 */
function harness(root = sample(), offset = 0, options: Record<string, unknown> = {}) {
  let state: EditorState
  const dispatched: Transaction[] = []
  let editable = true
  const view = {
    get state() { return state },
    dispatch(tr: Transaction) { dispatched.push(tr); state = state.apply(tr) },
    endOfTextblock(direction: string) {
      return direction === 'backward' ? state.selection.$from.parentOffset === 0
        : state.selection.$from.parentOffset === state.selection.$from.parent.content.size
    },
  } as unknown as EditorView
  const editor = {
    get state() { return state },
    get isEditable() { return editable },
    view,
  } as Editor
  const handlers = bindings(options)
  const keys = Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, () => handler({ editor })]))
  state = EditorState.create({
    doc: root,
    selection: TextSelection.create(root, codeRange(root).start + offset),
    plugins: [keymap(keys), keymap(baseKeymap), history()],
  })
  return {
    get state() { return state },
    get codeText() {
      let text = ''
      state.doc.descendants(node => { if (node.type.name === 'codeBlock') text = node.textContent })
      return text
    },
    dispatched,
    setEditable(value: boolean) { editable = value },
    select(from: number, to = from) { state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to))) },
    selectCodeNode() { state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, codeRange(state.doc).pos))) },
    raw(name: string) { return handlers[name]({ editor }) },
    press(key: string, modifiers: Partial<Pick<KeyboardEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>> = {}) {
      const event = { key, code: key, keyCode: key === 'Enter' ? 13 : key === 'Tab' ? 9 : 8, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, ...modifiers } as KeyboardEvent
      for (const plugin of state.plugins) {
        if (plugin.props.handleKeyDown?.call(plugin, view, event)) return true
      }
      return false
    },
    undo() { return undo(state, tr => view.dispatch(tr)) },
  }
}

test('Enter inserts a literal newline at the end and in the middle of code', () => {
  for (const offset of [2, 'a = 1\nb = 2'.length]) {
    const h = harness(sample(), offset)
    assert.equal(h.press('Enter'), true)
    const before = 'a = 1\nb = 2'
    assert.equal(h.codeText, before.slice(0, offset) + '\n' + before.slice(offset))
    assert.equal(h.state.selection.$from.parent.type.name, 'codeBlock')
    assert.equal(h.state.selection.$from.parentOffset, offset + 1)
    assert.equal(h.state.doc.childCount, 3)
    assert.equal(h.state.doc.child(1).attrs.language, 'javascript')
  }
})

test('Enter replaces selected code with a newline without changing block type', () => {
  const h = harness()
  const { start } = codeRange(h.state.doc)
  h.select(start + 1, start + 4)
  assert.equal(h.press('Enter'), true)
  assert.equal(h.codeText, 'a\n1\nb = 2')
  assert.equal(h.state.selection.$from.parentOffset, 2)
  h.state.doc.check()
})

test('three Enter presses at the end exit, stripping only the two escape newlines', () => {
  const h = harness(sample('print(1)'), 'print(1)'.length)
  assert.equal(h.press('Enter'), true)
  assert.equal(h.codeText, 'print(1)\n')
  assert.equal(h.press('Enter'), true)
  assert.equal(h.codeText, 'print(1)\n\n')
  assert.equal(h.press('Enter'), true)
  assert.equal(h.codeText, 'print(1)')
  assert.equal(h.state.selection.$from.parent.type.name, 'paragraph')
  assert.equal(h.state.selection.$from.parent.textContent, '')
  assert.equal(h.state.doc.child(3).textContent, 'BELOW')
  assert.equal(h.undo(), true)
  assert.equal(h.codeText, 'print(1)\n\n', 'undo restores the escape lines and original code caret')
  assert.equal(h.state.selection.$from.parent.type.name, 'codeBlock')
})

test('triple Enter reuses an immediately following empty paragraph', () => {
  const root = documentOf(code('x\n\n'), paragraph(), paragraph('KEEP'))
  const h = harness(root, 'x\n\n'.length)
  assert.equal(h.press('Enter'), true)
  assert.equal(h.codeText, 'x')
  assert.equal(h.state.doc.childCount, 3)
  assert.equal(h.state.selection.from, codeRange(h.state.doc).end + 2)
  assert.equal(h.state.doc.lastChild?.textContent, 'KEEP')
})

test('Shift+Enter stays inside code even after two trailing newlines', () => {
  const h = harness(sample('x\n\n'), 3)
  assert.equal(h.press('Enter', { shiftKey: true }), true)
  assert.equal(h.codeText, 'x\n\n\n')
  assert.equal(h.state.selection.$from.parent.type.name, 'codeBlock')
  assert.equal(h.state.doc.childCount, 3)
})

test('Mod+Enter exits from the middle of code without cutting selected text', () => {
  const h = harness()
  const { start } = codeRange(h.state.doc)
  h.select(start + 1, start + 5)
  assert.equal(h.press('Enter', { ctrlKey: true }), true)
  assert.equal(h.codeText, 'a = 1\nb = 2')
  assert.equal(h.state.doc.childCount, 4)
  assert.equal(h.state.doc.child(2).type.name, 'paragraph')
  assert.equal(h.state.doc.child(2).content.size, 0)
  assert.equal(h.state.doc.child(3).textContent, 'BELOW')
  assert.equal(h.state.selection.$from.parent.type.name, 'paragraph')
  assert.equal(h.undo(), true)
  assert.equal(h.state.doc.childCount, 3)
  assert.equal(h.state.selection.from, start + 1)
  assert.equal(h.state.selection.to, start + 5)
})

test('Mod+Enter reuses the next empty paragraph without a document or history change', () => {
  const root = documentOf(code('value'), paragraph(), paragraph('KEEP'))
  const h = harness(root, 2)
  assert.equal(h.press('Enter', { ctrlKey: true }), true)
  assert.ok(h.state.doc.eq(root))
  assert.equal(h.state.selection.from, codeRange(root).end + 2)
  assert.equal(h.undo(), false, 'caret navigation must not add an undo step')
})

test('Mod+Enter after the final code block creates valid prose', () => {
  const h = harness(documentOf(code('value')), 2)
  assert.equal(h.press('Enter', { ctrlKey: true }), true)
  assert.equal(h.state.doc.childCount, 2)
  assert.equal(h.state.selection.$from.parent.type.name, 'paragraph')
  assert.equal(h.codeText, 'value')
  h.state.doc.check()
})

test('Mod+Enter supports code nested inside a blockquote', () => {
  const root = documentOf(schema.nodes.blockquote.create(null, code('nested')), paragraph('AFTER'))
  const h = harness(root)
  assert.equal(h.press('Enter', { ctrlKey: true }), true)
  assert.equal(h.state.doc.firstChild?.childCount, 2)
  assert.equal(h.state.doc.firstChild?.lastChild?.type.name, 'paragraph')
  assert.equal(h.state.selection.$from.depth, 2)
  assert.equal(h.state.doc.lastChild?.textContent, 'AFTER')
  h.state.doc.check()
})

test('Backspace at nonempty code start neither clears, demotes nor joins it', () => {
  for (const root of [sample(), documentOf(code('KEEP'), paragraph('AFTER'))]) {
    const h = harness(root)
    const before = h.state.toJSON()
    assert.equal(h.press('Backspace'), true)
    assert.deepEqual(h.state.toJSON(), before)
    assert.equal(h.dispatched.length, 0)
    assert.equal(h.undo(), false)
  }
})

test('Backspace inside code remains ordinary character deletion', () => {
  const h = harness(sample(), 3)
  assert.equal(h.raw('Backspace'), false)
  assert.equal(h.press('Backspace'), false, 'the browser owns ordinary text deletion')
  assert.equal(h.codeText, 'a = 1\nb = 2')
})

test('Backspace over a selected range uses ordinary deleteSelection', () => {
  const h = harness()
  const { start } = codeRange(h.state.doc)
  h.select(start + 1, start + 4)
  assert.equal(h.raw('Backspace'), false)
  assert.equal(h.press('Backspace'), true)
  assert.equal(h.codeText, 'a1\nb = 2')
  assert.equal(h.state.selection.$from.parent.type.name, 'codeBlock')
})

test('Backspace removes only an empty code block and undo restores it', () => {
  const root = sample('')
  const h = harness(root)
  assert.equal(h.press('Backspace'), true)
  assert.equal(h.state.doc.childCount, 2)
  assert.equal(h.state.doc.firstChild?.textContent, 'ABOVE')
  assert.equal(h.state.doc.lastChild?.textContent, 'BELOW')
  assert.equal(h.state.selection.$from.parent.type.name, 'paragraph')
  assert.equal(h.state.selection.$from.parent.textContent, 'ABOVE')
  h.state.doc.check()
  assert.equal(h.undo(), true)
  assert.ok(h.state.doc.eq(root))
  assert.equal(h.state.selection.$from.parent.type.name, 'codeBlock')
})

test('Backspace on the only empty code block keeps a valid paragraph', () => {
  const root = documentOf(code())
  const h = harness(root)
  assert.equal(h.press('Backspace'), true)
  assert.equal(h.state.doc.childCount, 1)
  assert.equal(h.state.doc.firstChild?.type.name, 'paragraph')
  assert.equal(h.state.selection.from, 1)
  h.state.doc.check()
  assert.equal(h.undo(), true)
  assert.ok(h.state.doc.eq(root))
})

test('Backspace can remove an empty first block without damaging following prose', () => {
  const h = harness(documentOf(code(), paragraph('KEEP')))
  assert.equal(h.press('Backspace'), true)
  assert.equal(h.state.doc.childCount, 1)
  assert.equal(h.state.doc.firstChild?.textContent, 'KEEP')
  assert.equal(h.state.selection.$from.parent.type.name, 'paragraph')
  h.state.doc.check()
})

test('Tab inserts two spaces at the caret and is undoable', () => {
  const h = harness(sample('abc'), 1)
  assert.equal(h.press('Tab'), true)
  assert.equal(h.codeText, 'a  bc')
  assert.equal(h.state.selection.$from.parentOffset, 3)
  assert.equal(h.undo(), true)
  assert.equal(h.codeText, 'abc')
})

test('Tab indents selected lines without replacing code, and Shift+Tab reverses it', () => {
  const root = sample('alpha\nbeta\ngamma')
  const h = harness(root)
  const { start } = codeRange(root)
  h.select(start + 2, start + 'alpha\nbet'.length)
  assert.equal(h.press('Tab'), true)
  assert.equal(h.codeText, '  alpha\n  beta\ngamma')
  assert.equal(h.state.doc.textBetween(h.state.selection.from, h.state.selection.to), 'pha\n  bet')
  assert.equal(h.press('Tab', { shiftKey: true }), true)
  assert.ok(h.state.doc.eq(root))
  assert.equal(h.state.selection.from, start + 2)
  assert.equal(h.state.selection.to, start + 'alpha\nbet'.length)
})

test('a range ending at a line start does not indent that next line', () => {
  const h = harness(sample('a\nb\nc'))
  const { start } = codeRange(h.state.doc)
  h.select(start, start + 2)
  assert.equal(h.press('Tab'), true)
  assert.equal(h.codeText, '  a\nb\nc')
})

test('line indentation includes an empty first line when selection starts at zero', () => {
  const h = harness(sample('\nvalue'))
  const { start, end } = codeRange(h.state.doc)
  h.select(start, end)
  assert.equal(h.press('Tab'), true)
  assert.equal(h.codeText, '  \n  value')
  assert.equal(h.press('Tab', { shiftKey: true }), true)
  assert.equal(h.codeText, '\nvalue')
})

test('line indentation preserves a backwards selection and existing language', () => {
  const h = harness(sample('a\nb'))
  const { start, end } = codeRange(h.state.doc)
  h.select(end, start)
  assert.equal(h.press('Tab'), true)
  assert.equal(h.codeText, '  a\n  b')
  assert.ok(h.state.selection.anchor > h.state.selection.head)
  assert.equal(h.state.doc.child(1).attrs.language, 'javascript')
  assert.equal(h.undo(), true)
  assert.equal(h.codeText, 'a\nb')
})

test('Shift+Tab removes one tab or up to two leading spaces on covered lines', () => {
  const h = harness(sample('\talpha\n beta\n    gamma'))
  const { start, end } = codeRange(h.state.doc)
  h.select(start, end)
  assert.equal(h.press('Tab', { shiftKey: true }), true)
  assert.equal(h.codeText, 'alpha\nbeta\n  gamma')
  h.state.doc.check()
})

test('Shift+Tab in the middle adjusts only the current line prefix', () => {
  const h = harness(sample('  first\n  second'), '  first\n  sec'.length)
  assert.equal(h.press('Tab', { shiftKey: true }), true)
  assert.equal(h.codeText, '  first\nsecond')
  assert.equal(h.state.selection.$from.parentOffset, '  first\nsec'.length)
})

test('Shift+Tab on an unindented line is a safe no-op rather than focus escape', () => {
  const h = harness(sample('value'), 2)
  assert.equal(h.press('Tab', { shiftKey: true }), true)
  assert.equal(h.codeText, 'value')
  assert.equal(h.dispatched.length, 0)
})

test('code keys never claim prose, cross-block ranges, selected nodes or read-only views', () => {
  const h = harness()
  h.select(2)
  for (const key of ['Enter', 'Shift-Enter', 'Mod-Enter', 'Backspace', 'Tab', 'Shift-Tab']) assert.equal(h.raw(key), false, key + ' in prose')
  const { start } = codeRange(h.state.doc)
  h.select(2, start + 2)
  for (const key of ['Enter', 'Shift-Enter', 'Mod-Enter', 'Backspace', 'Tab', 'Shift-Tab']) assert.equal(h.raw(key), false, key + ' over blocks')
  h.selectCodeNode()
  for (const key of ['Enter', 'Shift-Enter', 'Mod-Enter', 'Backspace', 'Tab', 'Shift-Tab']) assert.equal(h.raw(key), false, key + ' over node')
  h.select(start)
  h.setEditable(false)
  for (const key of ['Enter', 'Shift-Enter', 'Mod-Enter', 'Backspace', 'Tab', 'Shift-Tab']) assert.equal(h.raw(key), false, key + ' read-only')
})

test('the helper identifies a collapsed code end, excluding range and prose', () => {
  const h = harness()
  const { start, end } = codeRange(h.state.doc)
  h.select(end)
  assert.equal(isAtCodeBlockEnd(h.state.selection), true)
  h.select(start)
  assert.equal(isAtCodeBlockEnd(h.state.selection), false)
  h.select(start, end)
  assert.equal(isAtCodeBlockEnd(h.state.selection), false)
  h.select(2)
  assert.equal(isAtCodeBlockEnd(h.state.selection), false)
})
