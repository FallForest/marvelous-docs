/**
 * Block arithmetic for the drag handle and the block context menu.
 *
 * The planning helpers work on flat top-level spans. The commands below apply
 * those plans to a ProseMirror document, resolving nested positions to their
 * owning block and keeping selection and history in the same operation.
 *
 * A move is a delete followed by an insert, and the insert index shifts when the
 * dragged block sat before the target. Returning the two coordinates in document
 * space keeps that adjustment in one place instead of at every call site.
 */

import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { closeHistory } from '@tiptap/pm/history'
import { yUndoPluginKey } from 'y-prosemirror'

export type BlockSpan = { pos: number; size: number }

export type MovePlan = { deleteFrom: number; deleteTo: number; insertAt: number }

/** Positions of consecutive top-level nodes, in document order. */
export function blockSpans(sizes: number[]): BlockSpan[] {
  const spans: BlockSpan[] = []
  let pos = 0
  for (const size of sizes) {
    spans.push({ pos, size })
    pos += size
  }
  return spans
}

function indexOf(spans: BlockSpan[], pos: number): number {
  return spans.findIndex((span) => span.pos === pos)
}

/** End of the document body, i.e. the position after the last top-level block. */
export function endOfBlocks(spans: BlockSpan[]): number {
  if (!spans.length) return 0
  const last = spans[spans.length - 1]!
  return last.pos + last.size
}

/**
 * The block a drop at `docPos` should be inserted before, or null for "after
 * everything".
 *
 * A drop position inside a block snaps to just before that block; a position at
 * or past the end is the append case. Dropping onto itself is caught later by
 * {@link planMove} returning null.
 */
export function dropTargetBefore(spans: BlockSpan[], docPos: number): number | null {
  for (const span of spans) {
    if (docPos < span.pos + span.size) return span.pos
  }
  return null
}

/**
 * Plans lifting the block at `from` and re-inserting it before the block at
 * `before` (null: append). Returns null when the move would change nothing, so
 * a drop on the block's own top or bottom edge does not create an undo step.
 */
export function planMove(spans: BlockSpan[], from: number, before: number | null): MovePlan | null {
  const sourceIndex = indexOf(spans, from)
  if (sourceIndex < 0) return null
  const source = spans[sourceIndex]!

  if (before === null) {
    const insertAt = endOfBlocks(spans) - source.size
    if (insertAt === from) return null
    return { deleteFrom: from, deleteTo: from + source.size, insertAt }
  }

  const targetIndex = indexOf(spans, before)
  if (targetIndex < 0) return null
  // Dropping on itself, or on the gap directly after itself, is where it already is.
  if (targetIndex === sourceIndex || targetIndex === sourceIndex + 1) return null

  const insertAt = targetIndex < sourceIndex
    ? before
    // The dragged block is gone by the time the insert runs, so every position
    // after it has shifted left by its size.
    : before - source.size
  return { deleteFrom: from, deleteTo: from + source.size, insertAt }
}

/** Where "move up" / "move down" should place the block, or null at the edge. */
export function neighbourTarget(spans: BlockSpan[], pos: number, direction: -1 | 1): number | null {
  const index = indexOf(spans, pos)
  if (index < 0) return null
  if (direction === -1) return index === 0 ? null : spans[index - 1]!.pos
  return index >= spans.length - 1 ? null : spans[index + 1]!.pos
}

/** Position immediately after the block, for "insert a paragraph below". */
export function afterBlock(spans: BlockSpan[], pos: number): number | null {
  const index = indexOf(spans, pos)
  if (index < 0) return null
  const span = spans[index]!
  return span.pos + span.size
}

/** The shared editor contract does not depend on a UI component or a hook. */
type BlockEditor = {
  readonly state: EditorState
  readonly isEditable: boolean
  readonly view: Pick<EditorView, 'dispatch' | 'focus'>
}

export type TopLevelBlock = BlockSpan & { node: PMNode }

/** A nested code/list/quote position always belongs to its whole top-level block. */
export function topLevelBlockAt(doc: PMNode, pos: number): TopLevelBlock | null {
  if (!Number.isInteger(pos) || pos < 0 || pos > doc.content.size) return null
  let found: TopLevelBlock | null = null
  doc.forEach((node, offset) => {
    if (!found && (pos < offset + node.nodeSize || offset + node.nodeSize === doc.content.size)) {
      found = { pos: offset, size: node.nodeSize, node }
    }
  })
  return found
}

export function blockSpansOf(doc: PMNode): BlockSpan[] {
  return blockSpans(Array.from({ length: doc.childCount }, (_, index) => doc.child(index).nodeSize))
}

/** Keep an existing cursor/range inside the block, including a nested code block. */
function selectionInBlock(selection: Selection, block: TopLevelBlock, tr: Transaction, at: number): Selection {
  const inside = selection.from >= block.pos && selection.to <= block.pos + block.size
  if (inside && selection instanceof NodeSelection) {
    const mapped = at + selection.from - block.pos
    const node = tr.doc.nodeAt(mapped)
    if (node && NodeSelection.isSelectable(node)) return NodeSelection.create(tr.doc, mapped)
  }
  if (inside && selection instanceof TextSelection) {
    return TextSelection.between(
      tr.doc.resolve(at + selection.anchor - block.pos),
      tr.doc.resolve(at + selection.head - block.pos),
    )
  }
  if (block.node.isAtom && NodeSelection.isSelectable(block.node)) return NodeSelection.create(tr.doc, at)
  return Selection.near(tr.doc.resolve(at + 1), 1)
}

/** Isolate structural actions from adjacent typing and from each other in history. */
function dispatchBlockChange(editor: BlockEditor, tr: Transaction): boolean {
  if (!tr.docChanged) return false
  // Live collaboration replaces ProseMirror history with a Yjs UndoManager.
  // Its capture window must also be closed on both sides of the operation.
  const undoManager = yUndoPluginKey.getState(editor.state)?.undoManager
  undoManager?.stopCapturing()
  editor.view.dispatch(closeHistory(tr).scrollIntoView())
  // A history boundary after the action prevents the next keystroke from being
  // absorbed into it. This transaction changes neither content nor selection.
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false))
  undoManager?.stopCapturing()
  editor.view.focus()
  return true
}

function movePlan(editor: BlockEditor, pos: number, direction: -1 | 1): MovePlan | null {
  if (!editor.isEditable) return null
  const block = topLevelBlockAt(editor.state.doc, pos)
  if (!block) return null
  const spans = blockSpansOf(editor.state.doc)
  const index = spans.findIndex(span => span.pos === block.pos)
  if ((direction === -1 && index === 0) || (direction === 1 && index === spans.length - 1)) return null
  const before = direction === -1 ? spans[index - 1]!.pos : spans[index + 2]?.pos ?? null
  return planMove(spans, block.pos, before)
}

export function canMoveBlock(editor: BlockEditor, pos: number, direction: -1 | 1): boolean {
  return movePlan(editor, pos, direction) !== null
}

function applyMove(editor: BlockEditor, plan: MovePlan | null): boolean {
  if (!plan || !editor.isEditable) return false
  const block = topLevelBlockAt(editor.state.doc, plan.deleteFrom)
  if (!block) return false
  const selection = editor.state.selection
  const tr = editor.state.tr.delete(plan.deleteFrom, plan.deleteTo).insert(plan.insertAt, block.node)
  tr.setSelection(selectionInBlock(selection, block, tr, plan.insertAt))
  return dispatchBlockChange(editor, tr)
}

export function moveBlock(editor: BlockEditor, pos: number, direction: -1 | 1): boolean {
  return applyMove(editor, movePlan(editor, pos, direction))
}

/** Drag/drop and menu moves use the same post-deletion coordinate calculation. */
export function moveBlockBefore(editor: BlockEditor, pos: number, before: number | null): boolean {
  const block = topLevelBlockAt(editor.state.doc, pos)
  const target = before === null ? null : topLevelBlockAt(editor.state.doc, before)
  if (!block || (before !== null && !target)) return false
  return applyMove(editor, planMove(blockSpansOf(editor.state.doc), block.pos, target?.pos ?? null))
}

export function deleteBlock(editor: BlockEditor, pos: number): boolean {
  if (!editor.isEditable) return false
  const block = topLevelBlockAt(editor.state.doc, pos)
  if (!block) return false
  const tr = editor.state.tr
  if (editor.state.doc.childCount === 1) {
    const paragraph = editor.state.schema.nodes.paragraph?.createAndFill()
    if (!paragraph) return false
    tr.replaceWith(0, editor.state.doc.content.size, paragraph)
  } else tr.delete(block.pos, block.pos + block.size)
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(block.pos, tr.doc.content.size)), 1))
  return dispatchBlockChange(editor, tr)
}

export function duplicateBlock(editor: BlockEditor, pos: number): boolean {
  if (!editor.isEditable) return false
  const block = topLevelBlockAt(editor.state.doc, pos)
  if (!block) return false
  const at = block.pos + block.size
  const tr = editor.state.tr.insert(at, block.node)
  tr.setSelection(selectionInBlock(editor.state.selection, block, tr, at))
  return dispatchBlockChange(editor, tr)
}

export function insertParagraphBelow(editor: BlockEditor, pos: number): boolean {
  if (!editor.isEditable) return false
  const block = topLevelBlockAt(editor.state.doc, pos)
  const paragraph = editor.state.schema.nodes.paragraph?.createAndFill()
  if (!block || !paragraph) return false
  const at = block.pos + block.size
  const tr = editor.state.tr.insert(at, paragraph)
  tr.setSelection(TextSelection.create(tr.doc, at + 1))
  return dispatchBlockChange(editor, tr)
}
