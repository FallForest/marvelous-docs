import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'

/** A block that can host its own toolbar. */
export type BlockKind = 'codeBlock' | 'table' | 'image' | 'horizontalRule'

export type BlockGeometry = {
  /** Document position of the node, used for in-place edits. */
  pos: number
  kind: BlockKind
  /** Viewport rect, so toolbars can be positioned with fixed coordinates. */
  top: number
  bottom: number
  left: number
  right: number
  width: number
  height: number
  /** Language for code blocks, empty for other kinds. */
  language: string
  /** Plain text, used by the code block copy action. */
  text: string
}

const TRACKED: BlockKind[] = ['codeBlock', 'table', 'image', 'horizontalRule']

/**
 * Geometry for every toolbar-bearing block in the document.
 *
 * Replaces the previous code-block-only query over `pre` elements: the same
 * measurement now serves tables, images and dividers, so a toolbar can be
 * anchored to whatever block the user is working on.
 *
 * Re-measures on editor transactions, window scroll/resize, and — crucially —
 * on `ResizeObserver`, because opening the comments panel changes the editor
 * width without firing a window resize.
 */
export function useBlockGeometry(editor: Editor | null, enabled = true): BlockGeometry[] {
  const [blocks, setBlocks] = useState<BlockGeometry[]>([])

  useEffect(() => {
    if (!editor || !enabled) { setBlocks([]); return }
    const view = editor.view
    const dom = view.dom as HTMLElement | undefined
    if (!dom) return

    let frame = 0
    // Re-measuring on every keystroke drops a block out of the list the
    // instant it scrolls past the viewport edge, which makes an anchored
    // toolbar pop out of existence mid-edit. Keep the previous measurement
    // when the new pass finds nothing, so the toolbar fades instead.
    const measure = () => {
      frame = 0
      const found: BlockGeometry[] = []
      editor.state.doc.descendants((node, pos) => {
        const kind = node.type.name as BlockKind
        if (!TRACKED.includes(kind)) return
        const nodeDom = view.nodeDOM(pos)
        if (!(nodeDom instanceof HTMLElement)) return
        const rect = nodeDom.getBoundingClientRect()
        // Skip blocks scrolled out of the viewport: a fixed-position toolbar
        // would otherwise float over unrelated chrome.
        if (rect.bottom < 0 || rect.top > window.innerHeight) return
        found.push({
          pos,
          kind,
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
          language: kind === 'codeBlock' ? String(node.attrs.language || '') : '',
          text: kind === 'codeBlock' ? node.textContent : '',
        })
      })
      setBlocks((previous) => (found.length || !previous.length ? found : previous))
    }
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }

    measure()
    editor.on('update', schedule)
    editor.on('selectionUpdate', schedule)
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(dom)
    // Panels open/close changes layout without resizing the editor element.
    const shell = dom.closest('.workspace-content') ?? dom.parentElement
    if (shell) observer?.observe(shell)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      editor.off('update', schedule)
      editor.off('selectionUpdate', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
    }
  }, [editor, enabled])

  return blocks
}
