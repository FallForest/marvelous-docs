/**
 * Block arithmetic for the drag handle and the block context menu.
 *
 * Everything here works on a flat list of the document's top-level blocks
 * (`{ pos, size }`, document coordinates) instead of on a ProseMirror document,
 * so the parts that are easy to get subtly wrong — where a block lands after it
 * is lifted out, whether a drop is a no-op, which neighbour "move down" means —
 * are unit-testable without an editor.
 *
 * A move is a delete followed by an insert, and the insert index shifts when the
 * dragged block sat before the target. Returning the two coordinates in document
 * space keeps that adjustment in one place instead of at every call site.
 */

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
