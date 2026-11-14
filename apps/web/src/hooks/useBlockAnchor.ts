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

    /*
     * Touch: hold still for a moment and the block under the finger gets its menu.
     *
     * The anchor is produced by `pointermove`, so on a device without hover it never
     * appeared at all - the gutter, the drag handle and every structural command
     * were unreachable on a phone. A long press is the gesture that already means
     * "act on this thing" on touch, and it is the only one that does not fight text
     * selection: a short drag still selects, a tap still places the caret.
     *
     * The press is cancelled by movement, not by `pointercancel` alone, because a
     * scroll that starts on the document does not always deliver one.
     */
    let pressTimer: number | undefined
    const cancelPress = () => {
      if (pressTimer === undefined) return
      window.clearTimeout(pressTimer)
      pressTimer = undefined
    }
    const onTouchStart = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return
      if (pinned.current !== null) return
      const { clientX, clientY } = event
      cancelPress()
      pressTimer = window.setTimeout(() => {
        pressTimer = undefined
        const pos = locate(editor, clientX, clientY)
        if (pos === null) return
        const next = measure(editor, pos)
        // Pin it: without a hover-out there is nothing to unpin the anchor, and the
        // menu that opens next is what closes it.
        if (next) { pinned.current = next.pos; setAnchor(next) }
      }, 400)
    }
    const onTouchMove = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return
      cancelPress()
    }

    dom.addEventListener('pointermove', onMove)
    dom.addEventListener('pointerleave', onLeave)
    dom.addEventListener('pointerdown', onTouchStart)
    dom.addEventListener('pointermove', onTouchMove)
    dom.addEventListener('pointerup', cancelPress)
    dom.addEventListener('pointercancel', cancelPress)
    window.addEventListener('scroll', remeasure, true)
    window.addEventListener('resize', remeasure)
    editor.on('update', remeasure)
    editor.on('selectionUpdate', remeasure)

    return () => {
      cancelPress()
      dom.removeEventListener('pointermove', onMove)
      dom.removeEventListener('pointerleave', onLeave)
      dom.removeEventListener('pointerdown', onTouchStart)
      dom.removeEventListener('pointermove', onTouchMove)
      dom.removeEventListener('pointerup', cancelPress)
      dom.removeEventListener('pointercancel', cancelPress)
      window.removeEventListener('scroll', remeasure, true)
      window.removeEventListener('resize', remeasure)
      editor.off('update', remeasure)
      editor.off('selectionUpdate', remeasure)
    }
  }, [editor, enabled, remeasurePinned])

  return { anchor, setAnchor, pin, refresh }
}
