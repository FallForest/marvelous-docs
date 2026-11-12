import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * The top-level block the pointer is over, plus its measured box.
 *
 * The drag handle lives in the left gutter, outside the editor's DOM, so it
 * cannot be a child of the block it belongs to: a button inside a paragraph
 * would be part of the paragraph's text. That makes "which block am I pointing
 * at?" a hover question rather than a DOM one, and this hook is the single
 * answer — a document position from `posAtCoords`, the top-level node that
 * contains it, and that node's own rect.
 *
 * The anchor is a fixed-position box, so it is re-measured on scroll, resize and
 * every transaction. A stale `top` would park the handle over a different
 * paragraph the moment the document scrolls.
 */

export type BlockAnchor = {
  /** Document position of the top-level node. */
  pos: number
  /** Node size in document characters. */
  size: number
  type: string
  /** Viewport rect of the node's DOM element. */
  top: number
  bottom: number
  left: number
  right: number
  height: number
  /** An empty text block: it gets a handle but no "convert" entries. */
  empty: boolean
}

type Located = { pos: number; node: PMNode }

/**
 * The top-level node containing `pos`.
 *
 * The boundary is half-open (`pos < offset + nodeSize`): a position exactly at
 * the end of block N is the start of block N+1, and an inclusive test resolved it
 * to N, so a pointer at the top edge of a paragraph reported the paragraph above
 * it — the handle floated one block up and a drop landed one block early. The
 * document's final position belongs to the last block, hence the fallback.
 */
function topLevelAt(editor: Editor, pos: number): Located | null {
  let found: Located | null = null
  const doc = editor.state.doc
  doc.forEach((node, offset) => {
    if (found) return
    const isLast = offset + node.nodeSize >= doc.content.size
    if (pos < offset + node.nodeSize || isLast) found = { pos: offset, node }
  })
  return found
}

function rectFor(editor: Editor, pos: number): DOMRect | null {
  const dom = editor.view.nodeDOM(pos)
  if (!(dom instanceof HTMLElement)) return null
  const rect = dom.getBoundingClientRect()
  // A node can be measured at zero size before layout settles; reporting it
  // would put the handle at the top-left corner of the viewport.
  if (!rect.height && !rect.width) return null
  return rect
}

function measure(editor: Editor, pos: number): BlockAnchor | null {
  const target = topLevelAt(editor, pos)
  if (!target) return null
  const rect = rectFor(editor, target.pos)
  if (!rect) return null
  return {
    pos: target.pos,
    size: target.node.nodeSize,
    type: target.node.type.name,
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    height: rect.height,
    empty: target.node.isTextblock && target.node.content.size === 0,
  }
}

/**
 * Resolves a pointer position to a top-level block.
 *
 * `posAtCoords` returns null over the canvas padding, over a gap between blocks
 * and past the last block, so the fallback compares the pointer against the
 * rects of the top-level DOM children — which is also what makes the area below
 * the last paragraph return that paragraph rather than nothing.
 */
function locate(editor: Editor, x: number, y: number): number | null {
  const coords = editor.view.posAtCoords({ left: x, top: y })
  if (coords) return coords.pos

  const children = Array.from(editor.view.dom.children) as HTMLElement[]
  let cursor = 0
  let last: number | null = null
  for (const child of children) {
    const rect = child.getBoundingClientRect()
    if (y >= rect.top - 4 && y <= rect.bottom + 4) return cursor
    last = cursor
    // Advance by the node's own size, not by one per DOM child: the positions
    // of top-level nodes are not consecutive.
    const node = editor.state.doc.nodeAt(cursor)
    if (!node) break
    cursor += node.nodeSize
  }
  return last
}

export function useBlockAnchor(editor: Editor | null, enabled = true) {
  const [anchor, setAnchor] = useState<BlockAnchor | null>(null)
  /** Non-null while a menu or a drag owns the anchor. */
  const pinned = useRef<number | null>(null)

  const remeasurePinned = useCallback(() => {
    if (!editor || pinned.current === null) return
    const next = measure(editor, pinned.current)
    if (next) setAnchor(next)
  }, [editor])

  const pin = useCallback((pos: number | null) => {
    pinned.current = pos
    if (!editor || pos === null) return
    const next = measure(editor, pos)
    if (next) setAnchor(next)
  }, [editor])

  const refresh = useCallback((pos: number) => {
    if (!editor) return null
    const next = measure(editor, pos)
    if (next) setAnchor(next)
    return next
  }, [editor])

  useEffect(() => {
    if (!editor || !enabled) { setAnchor(null); return }
    const dom = editor.view.dom as HTMLElement

    const onMove = (event: PointerEvent) => {
      if (pinned.current !== null) return
      const pos = locate(editor, event.clientX, event.clientY)
      if (pos === null) return
      const next = measure(editor, pos)
      if (next) setAnchor(next)
    }

    const onLeave = (event: PointerEvent) => {
      if (pinned.current !== null) return
      // The pointer must be allowed to travel into the gutter to reach the
      // handle, so "left the editor" includes that strip and not the document.
      const rect = dom.getBoundingClientRect()
      const inside = event.clientX >= rect.left - 56 && event.clientX <= rect.right + 8
        && event.clientY >= rect.top - 8 && event.clientY <= rect.bottom + 40
      if (!inside) setAnchor(null)
    }

    const remeasure = () => {
      if (pinned.current !== null) { remeasurePinned(); return }
      setAnchor((current) => (current && measure(editor, current.pos)) ?? current)
    }

    dom.addEventListener('pointermove', onMove)
    dom.addEventListener('pointerleave', onLeave)
    window.addEventListener('scroll', remeasure, true)
    window.addEventListener('resize', remeasure)
    editor.on('update', remeasure)
    editor.on('selectionUpdate', remeasure)

    return () => {
      dom.removeEventListener('pointermove', onMove)
      dom.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('scroll', remeasure, true)
      window.removeEventListener('resize', remeasure)
      editor.off('update', remeasure)
      editor.off('selectionUpdate', remeasure)
    }
  }, [editor, enabled, remeasurePinned])

  return { anchor, setAnchor, pin, refresh }
}
