import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { buildEditorExtensions } from '../src/lib/editor/index.ts'
import { CodeBlockBoundary, isAtCodeBlockEnd } from '../src/lib/editor/code-block.ts'

/**
 * Runs a key handler from the boundary extension against a real ProseMirror
 * state, with no DOM.
 *
 * The extension's handlers only ever touch `editor.state` and `editor.commands`,
 * so a thin adapter over EditorState and a transaction-based command layer is
 * enough to assert exactly what each press does to the document.
 */

const schema = getSchema(buildEditorExtensions({}))

function doc() {
  return schema.nodeFromJSON({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'ABOVE' }] },
      { type: 'codeBlock', attrs: { language: 'text' }, content: [{ type: 'text', text: 'a = 1\nb = 2' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'BELOW' }] },
    ],
  })
}

function shape(state) {
  return state.doc.content.content.map((n) => n.type.name + '(' + JSON.stringify(n.textContent) + ')').join(' | ')
}

function codeRange(root = doc()) {
  let pos = -1, size = 0, contentSize = 0
  root.descendants((child, offset) => { if (child.type.name === 'codeBlock' && pos < 0) { pos = offset; size = child.nodeSize; contentSize = child.content.size } })
  // Content runs from pos+1 to pos+1+contentSize. nodeSize counts the two
  // boundary tokens as well, so "the end of the block" is not nodeSize-2.
  return { pos, size, contentSize, start: pos + 1, end: pos + 1 + contentSize }
}

/**
 * A minimal stand-in for Tiptap's Editor: the handlers read `state` and call
 * `commands`. Every command here returns a boolean and replaces the state, which
 * is the same contract the extension relies on.
 */
function makeEditor(state) {
  const editor = {
    state,
    chain() {
      const commands = []
      const api = {
        command(fn) { commands.push({ kind: 'custom', fn }); return api },
        setTextSelection(pos) { commands.push({ kind: 'select', pos }); return api },
        run() {
          let tr = editor.state.tr
          let selection = editor.state.selection
          for (const item of commands) {
            if (item.kind === 'select') {
              selection = TextSelection.create(tr.doc, item.pos)
              tr = tr.setSelection(selection)
            } else {
              item.fn({ tr, state: { ...editor.state, selection }, commands: {} })
            }
          }
          editor.state = editor.state.apply(tr)
          return true
        },
      }
      return api
    },
    commands: {
      splitBlock: () => { adapters.splitBlock(editor); return true },
      setHardBreak: () => { adapters.setHardBreak(editor); return true },
      exitCode: () => { adapters.exitCode(editor); return true },
    },
    isActive: (name) => {
      const { $from } = editor.state.selection
      return name === 'codeBlock' && $from.parent.type.name === 'codeBlock'
    },
  }
  return editor
}

/** The three commands the extension calls, expressed as transactions. */
const adapters = {
  splitBlock(editor) {
    const { $from } = editor.state.selection
    const pos = $from.end()
    const tr = editor.state.tr
    const paragraph = schema.nodes.paragraph.create()
    tr.insert(pos, paragraph)
    tr.setSelection(TextSelection.create(tr.doc, pos + 2))
    editor.state = editor.state.apply(tr)
  },
  setHardBreak(editor) {
    const { $from } = editor.state.selection
    const tr = editor.state.tr.insertText('\n', $from.pos, $from.pos)
    editor.state = editor.state.apply(tr)
  },
  exitCode(editor) {
    adapters.splitBlock(editor)
  },
}

/** The handlers as the extension registers them, resolved from its spec. */
function handlers() {
  const spec = CodeBlockBoundary.config.addKeyboardShortcuts.call({
    options: { exitOnEnterAtEnd: true, removeOnEmptyBackspace: true, allowShiftEnterExit: false },
  })
  return spec
}

test('Enter in the middle of a block is not claimed', () => {
  const range = codeRange()
  const editor = makeEditor(EditorState.create({ doc: doc(), selection: TextSelection.create(doc(), range.pos + 3) }))
  assert.equal(handlers().Enter({ editor }), false, 'the stock newline handler must keep this press')
})

test('Enter at the end of a block claims the press and creates a paragraph below', () => {
  const range = codeRange()
  const base = doc()
  const editor = makeEditor(EditorState.create({ doc: base, selection: TextSelection.create(base, range.end) }))
  assert.equal(handlers().Enter({ editor }), true)
  const after = shape(editor.state)
  assert.match(after, /codeBlock\(.*\) \| paragraph\(""\) \| paragraph\("BELOW"\)/, 'a paragraph must appear directly after the block')
  assert.equal(editor.state.selection.$from.parent.type.name, 'paragraph', 'the caret must leave the block')
})

test('Shift+Enter inside a block inserts a newline instead of leaving', () => {
  const range = codeRange()
  const base = doc()
  const editor = makeEditor(EditorState.create({ doc: base, selection: TextSelection.create(base, range.pos + 1) }))
  assert.equal(handlers()['Shift-Enter']({ editor }), true)
  assert.equal(editor.state.selection.$from.parent.type.name, 'codeBlock', 'the caret must stay inside')
})

test('Backspace mid-block is left to the browser', () => {
  const range = codeRange()
  const base = doc()
  const editor = makeEditor(EditorState.create({ doc: base, selection: TextSelection.create(base, range.pos + 4) }))
  assert.equal(handlers().Backspace({ editor }), false)
})

test('Backspace at the start empties the block before removing it', () => {
  const range = codeRange()
  const base = doc()
  const editor = makeEditor(EditorState.create({ doc: base, selection: TextSelection.create(base, range.pos + 1) }))
  assert.equal(handlers().Backspace({ editor }), true)
  assert.equal(shape(editor.state), 'paragraph("ABOVE") | codeBlock("") | paragraph("BELOW")', 'first press empties, it does not demote')
  assert.equal(editor.state.selection.$from.parent.type.name, 'codeBlock', 'the caret must stay in the now-empty block')
})

test('the helper agrees with the handler on what "the end" means', () => {
  const base = doc()
  const range = codeRange(base)
  const atEnd = { empty: true, $from: base.resolve(range.end) }
  assert.equal(isAtCodeBlockEnd(atEnd), true)
  const mid = { empty: true, $from: base.resolve(range.pos + 3) }
  assert.equal(isAtCodeBlockEnd(mid), false)
})
