import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { Selection, TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState, Transaction } from '@tiptap/pm/state'

/*
 * Code is edited as text: Enter/Shift+Enter insert a newline, Tab indents, and
 * Mod+Enter explicitly returns to the document. Triple Enter remains the stock
 * Tiptap escape. None of these keyboard rules changes the codeBlock schema or
 * language attribute, so JSON, Markdown and existing documents stay compatible.
 *
 * Tiptap 2's stock Backspace can demote the first code block to a paragraph;
 * ProseMirror's fallback can join a later block to its predecessor. Consume a
 * press at the start of nonempty code without changing anything instead.
 */

/** Whether a collapsed caret is at the final character of a code block. */
export function isAtCodeBlockEnd(selection: { empty: boolean; $from: { parent: { type: { name: string }; content: { size: number } }; parentOffset: number } }): boolean {
  const { empty, $from } = selection
  return empty && $from.parent.type.name === 'codeBlock' && $from.parentOffset === $from.parent.content.size
}

/** A cross-block range or a selected node must keep the ordinary editor keys. */
function isCodeTextSelection(state: EditorState): boolean {
  const { selection } = state
  return selection instanceof TextSelection
    && selection.$from.sameParent(selection.$to)
    && selection.$from.parent.type.name === 'codeBlock'
}

/**
 * Put the caret into the next empty paragraph, or create one immediately after
 * this code block. Do not jump into existing prose or insert duplicate blanks.
 * Works inside a quote/list item too, provided that parent permits a paragraph.
 */
function continueAfterCode(tr: Transaction): boolean {
  const { $from } = tr.selection
  if ($from.parent.type.name !== 'codeBlock') return false
  const after = $from.after()
  const next = tr.doc.nodeAt(after)
  if (next?.type.name === 'paragraph' && next.content.size === 0) {
    tr.setSelection(TextSelection.create(tr.doc, after + 1))
    return true
  }

  const paragraph = tr.doc.type.schema.nodes.paragraph
  if (!paragraph) return false
  const parent = $from.node($from.depth - 1)
  const index = $from.index($from.depth - 1) + 1
  if (!parent.canReplaceWith(index, index, paragraph)) return false
  tr.insert(after, paragraph.create())
  tr.setSelection(TextSelection.create(tr.doc, after + 1))
  return true
}

function enterCode(exitOnTripleEnter: boolean): Command {
  return (state, dispatch) => {
    if (!isCodeTextSelection(state)) return false
    const { selection } = state
    if (exitOnTripleEnter && isAtCodeBlockEnd(selection) && selection.$from.parent.textContent.endsWith('\n\n')) {
      // Like the stock escape, remove only the two empty lines used to leave.
      // If no paragraph can be inserted, discard this trial transaction and
      // leave Enter as a newline rather than silently deleting those lines.
      const tr = state.tr.delete(selection.from - 2, selection.from)
      if (continueAfterCode(tr)) {
        dispatch?.(closeHistory(tr).scrollIntoView())
        return true
      }
    }
    if (dispatch) {
      const tr = state.tr.insertText('\n', selection.from, selection.to)
      tr.setSelection(TextSelection.create(tr.doc, selection.from + 1))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

const exitCode: Command = (state, dispatch) => {
  if (!isCodeTextSelection(state)) return false
  const tr = state.tr
  if (!continueAfterCode(tr)) return false
  dispatch?.((tr.docChanged ? closeHistory(tr) : tr).scrollIntoView())
  return true
}

function backspaceCode(removeWhenEmpty: boolean): Command {
  return (state, dispatch) => {
    if (!isCodeTextSelection(state)) return false
    const { empty, $from } = state.selection
    if (!empty || $from.parentOffset !== 0) return false

    // Returning true is deliberate: letting this reach the stock keymaps can
    // clear, demote or join the block. A safe no-op must not create undo state.
    if ($from.parent.content.size || !removeWhenEmpty) return true

    if (dispatch) {
      const start = $from.before()
      const tr = state.tr
      if ($from.depth === 1 && state.doc.childCount === 1) {
        tr.replaceWith(start, $from.after(), state.schema.nodes.paragraph.create())
      } else {
        tr.delete(start, $from.after())
      }
      const target = Math.max(0, Math.min(start, tr.doc.content.size))
      tr.setSelection(Selection.near(tr.doc.resolve(target), -1))
      dispatch(closeHistory(tr).scrollIntoView())
    }
    return true
  }
}

function indentCode(size: number, outdent: boolean): Command {
  return (state, dispatch) => {
    if (!isCodeTextSelection(state)) return false
    const { selection } = state
    const { $from, $to } = selection
    const text = $from.parent.textContent
    const tabSize = Math.max(1, Math.min(8, Math.floor(size) || 2))
    const indent = ' '.repeat(tabSize)
    const tr = state.tr

    // A caret Tab inserts spaces at the caret. A range Tab shifts whole lines
    // without replacing selected code; Shift+Tab always adjusts line prefixes.
    if (selection.empty && !outdent) {
      if (dispatch) {
        tr.insertText(indent, selection.from)
        tr.setSelection(TextSelection.create(tr.doc, selection.from + tabSize))
        dispatch(tr.scrollIntoView())
      }
      return true
    }

    const first = $from.parentOffset === 0 ? 0 : text.lastIndexOf('\n', $from.parentOffset - 1) + 1
    const endOffset = $to.parentOffset
    // A selection ending exactly at the next line's start does not include it.
    const last = !selection.empty && endOffset > $from.parentOffset && text[endOffset - 1] === '\n'
      ? endOffset - 1 : endOffset
    const lines = [first]
    for (let line = first; line <= last;) {
      const next = text.indexOf('\n', line) + 1
      if (!next || next > last) break
      lines.push(next)
      line = next
    }
    const start = $from.start()
    // Editing bottom-up keeps every offset in the original code coordinates.
    for (const line of lines.reverse()) {
      const at = start + line
      if (!outdent) tr.insertText(indent, at)
      else {
        const amount = text[line] === '\t' ? 1 : Math.min(tabSize, /^ */.exec(text.slice(line))![0].length)
        if (amount) tr.delete(at, at + amount)
      }
    }
    if (dispatch && tr.docChanged) {
      tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(selection.anchor, 1), tr.mapping.map(selection.head, 1)))
      dispatch(tr.scrollIntoView())
    }
    // Even an already-unindented line owns Shift+Tab while code has focus.
    return true
  }
}

/** Keep read-only editors and every non-code selection on their normal keymaps. */
function runCodeKey(editor: Editor, command: Command): boolean {
  if (!editor.isEditable) return false
  return command(editor.state, tr => editor.view.dispatch(tr), editor.view)
}

export const CodeBlockBoundary = Extension.create({
  name: 'codeBlockBoundary',
  // These guards must run before the stock code/list/core boundary handlers.
  priority: 1100,

  addOptions() {
    return {
      exitOnTripleEnter: true,
      removeOnEmptyBackspace: true,
      tabSize: 2,
    }
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => runCodeKey(editor, enterCode(this.options.exitOnTripleEnter)),
      'Shift-Enter': ({ editor }) => runCodeKey(editor, enterCode(false)),
      'Mod-Enter': ({ editor }) => runCodeKey(editor, exitCode),
      Backspace: ({ editor }) => runCodeKey(editor, backspaceCode(this.options.removeOnEmptyBackspace)),
      Tab: ({ editor }) => runCodeKey(editor, indentCode(this.options.tabSize, false)),
      'Shift-Tab': ({ editor }) => runCodeKey(editor, indentCode(this.options.tabSize, true)),
    }
  },
})
