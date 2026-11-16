import type { EditorState } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * "Which object is the user actually working on?"
 *
 * The floating table and image tools used to answer this with
 * `blocks.find((block) => block.kind === 'table')` — the first table or image in
 * the viewport, not the one under the cursor or selection. With two of either on
 * screen, the bar sat beside table A and its commands ran against table B, and
 * the image toolbar resized an image the writer had never touched.
 *
 * The answer has to come from the document state, not from layout order:
 *
 *   - a table: the table ancestor of the selection's `$from` (or of the selected
 *     node itself, if a whole table is node-selected);
 *   - an image: the selected node, when the selection is a NodeSelection on an
 *     image. A caret inside a paragraph is *not* "the image is selected" — the
 *     tools must be absent rather than acting on a neighbour.
 *
 * Both are pure functions over `EditorState`, so the choice of target can be
 * unit-tested without a DOM, which is the only way to prove "same screen, two
 * tables, correct one" in CI.
 */

export type SelectedNode = {
  /** Document position of the selected node. */
  pos: number
  node: PMNode
}

/**
 * The image the selection points at, or null.
 *
 * Deliberately strict: only a `NodeSelection` counts. ProseMirror also reports a
 * cursor position *inside* a node for some node types, and accepting that made
 * the toolbar appear while the writer was typing in the paragraph after an
 * image — the same "tools attach to a neighbour" bug in a quieter form.
 */
export function selectedImage(state: EditorState): SelectedNode | null {
  const selection = state.selection as unknown as { node?: PMNode; from: number; to: number }
  if (!selection.node || selection.node.type.name !== 'image') return null
  // The selected node starts at `from`; `to` already covers its whole nodeSize.
  const node = state.doc.nodeAt(selection.from)
  if (!node || node.type.name !== 'image') return null
  return { pos: selection.from, node }
}

/**
 * The table the selection lives in, or null.
 *
 * Walks up from `$from` so a caret in a cell, a cell selection, and a whole-table
 * node selection all resolve to the same table. `depth > 0` stops it from
 * matching a table-shaped node at the document root, which cannot happen with the
 * current schema but would silently return position 0.
 */
export function activeTable(state: EditorState): SelectedNode | null {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === 'table') return { pos: $from.before(depth), node }
  }
  // A table selected as a whole node (drag from the gutter, or Backspace on it)
  // is not inside `$from`, so it needs its own check.
  const selection = state.selection as unknown as { node?: PMNode }
  if (selection.node?.type.name === 'table') {
    const pos = state.selection.from
    const node = state.doc.nodeAt(pos)
    if (node?.type.name === 'table') return { pos, node }
  }
  return null
}

/**
 * True when the state's selection belongs to the given block position.
 *
 * Typed structurally rather than against `BlockGeometry` from
 * `hooks/useBlockGeometry`: `lib` may not import from `hooks` (enforced by
 * `test/structure.test.ts`), and this module only needs the two fields it reads.
 * The hook's own type satisfies it.
 */
export function geometryFor<T extends { pos: number; kind: string }>(
  blocks: T[],
  target: SelectedNode | null,
  kind: string,
): T | null {
  if (!target) return null
  return blocks.find((block) => block.pos === target.pos && block.kind === kind) ?? null
}
