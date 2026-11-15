import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { yUndoPluginKey } from 'y-prosemirror'

export type TextMatch = { from: number; to: number }

/**
 * Search text blocks in document coordinates. Formatting can split a word into
 * several text nodes, while lists/tables add structural positions that do not
 * exist in textBetween(). Inline atoms and block boundaries are never searched
 * through, so replacing a word cannot delete an image or merge table cells.
 */
export function findTextMatches(doc: PMNode, query: string, caseSensitive = false): TextMatch[] {
  if (!query) return []
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'gu' : 'giu')
  const matches: TextMatch[] = []
  doc.descendants((block, pos) => {
    if (!block.isTextblock) return true
    let text = ''
    let start = pos + 1
    const collect = () => {
      pattern.lastIndex = 0
      for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        matches.push({ from: start + match.index, to: start + match.index + match[0].length })
      }
      text = ''
    }
    block.forEach((child, offset) => {
      if (child.isText) text += child.text!
      else if (child.type.name === 'hardBreak') text += '\n'
      else { collect(); start = pos + 1 + offset + child.nodeSize }
    })
    collect()
    return false
  })
  return matches
}

/** One transaction, plain text, applied backwards to keep every range valid. */
export function replaceTextMatches(state: EditorState, matches: TextMatch[], replacement: string): Transaction {
  const tr = state.tr
  for (const match of matches.slice().sort((a, b) => b.from - a.from)) {
    tr.insertText(replacement, match.from, match.to)
  }
  return tr
}

/** Keep Replace All separate from adjacent typing in both history engines. */
export function applyTextReplacement(editor: Editor, matches: TextMatch[], replacement: string): boolean {
  if (!editor.isEditable || !matches.length) return false
  const undoManager = yUndoPluginKey.getState(editor.state)?.undoManager
  undoManager?.stopCapturing()
  editor.view.dispatch(closeHistory(replaceTextMatches(editor.state, matches, replacement)))
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false))
  undoManager?.stopCapturing()
  return true
}
