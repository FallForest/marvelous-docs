import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { createPortal } from 'react-dom'
import {
  ArrowDown, ArrowUp, CheckSquare, Code2, Copy as CopyIcon, GripVertical, Heading1, Heading2, Heading3,
  List, ListOrdered, Plus, Quote, Trash2, Type, X,
} from 'lucide-react'
import { afterBlock, blockSpans, dropTargetBefore, planMove } from '../../lib/editor/blocks'
import type { BlockSpan } from '../../lib/editor/blocks'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import type { BlockAnchor } from '../../hooks/useBlockAnchor'

/**
 * Block drag handle, drop indicator, and right-click menu.
 *
 * Feishu/Notion-style: pointing at a block reveals a grip in the left gutter;
 * the grip starts a block drag, and right-clicking a block opens the same
 * actions as a context menu. Both read from one command table, so the menu and
 * the drag cannot drift apart.
 *
 * Coordinates come from the block's own rect (useBlockAnchor), so both surfaces
 * are placed in viewport space and never inherit the editor's scroll offset.
 */

type BlockCommand = {
  id: string
  label: string
  icon: typeof Type
  danger?: boolean
  /** False when the command does not apply to the block under the cursor. */
  applies: (anchor: BlockAnchor) => boolean
  run: (editor: Editor, anchor: BlockAnchor) => void
}

const TEXT_BLOCKS = new Set(['paragraph', 'heading'])

/** Top-level node sizes, in document order. */
function spansOf(editor: Editor): BlockSpan[] {
  const doc = editor.state.doc
  return blockSpans(Array.from({ length: doc.childCount }, (_, index) => doc.child(index).nodeSize))
}

/** Position of the top-level block containing `pos`, half-open at its end. */
function topLevelPos(editor: Editor, pos: number): number | null {
  let owner: number | null = null
  const doc = editor.state.doc
  doc.forEach((node, offset) => {
    if (owner !== null) return
    if (pos < offset + node.nodeSize || offset + node.nodeSize >= doc.content.size) owner = offset
  })
  return owner
}

/** Removes a top-level node, leaving one empty paragraph when it was the last. */
function deleteBlock(editor: Editor, anchor: BlockAnchor) {
  if (editor.state.doc.childCount <= 1) {
    editor.chain().focus().clearNodes().run()
    return
  }
  editor.chain().focus().deleteRange({ from: anchor.pos, to: anchor.pos + anchor.size }).run()
}

function duplicateBlock(editor: Editor, anchor: BlockAnchor) {
  const node = editor.state.doc.nodeAt(anchor.pos)
  if (!node) return
  const at = anchor.pos + anchor.size
  editor.chain().focus().insertContentAt(at, node.toJSON()).setTextSelection(at + 1).run()
}

/** Applies a delete-then-insert plan as one transaction, so it is one undo step. */
function applyMove(editor: Editor, plan: ReturnType<typeof planMove>) {
  if (!plan) return
  const node = editor.state.doc.nodeAt(plan.deleteFrom)
  if (!node) return
  const { tr } = editor.state
  tr.delete(plan.deleteFrom, plan.deleteTo)
  tr.insert(plan.insertAt, node)
  editor.view.dispatch(tr)
  editor.commands.setTextSelection(plan.insertAt + 1)
}

function moveBlock(editor: Editor, anchor: BlockAnchor, direction: -1 | 1) {
  const spans = spansOf(editor)
  const index = spans.findIndex((span) => span.pos === anchor.pos)
  if (index < 0) return
  if (direction === -1 && index === 0) return
  if (direction === 1 && index === spans.length - 1) return
  /*
   * Both directions are expressed as "insert before this block":
   *   up   → before the previous one
   *   down → before the one after the next one (null = append at the end)
   *
   * Planning "down" as an append/after-insert instead would need a second
   * coordinate computation, and getting the two out of step is exactly how the
   * block ends up one position past where the pointer was.
   */
  const before = direction === -1 ? spans[index - 1]!.pos : spans[index + 2]?.pos ?? null
  applyMove(editor, planMove(spans, anchor.pos, before))
}

function insertParagraphBelow(editor: Editor, anchor: BlockAnchor) {
  const at = afterBlock(spansOf(editor), anchor.pos)
  if (at === null) return
  editor.chain().focus().insertContentAt(at, { type: 'paragraph' }).setTextSelection(at + 1).run()
}

const COMMANDS: BlockCommand[] = [
  {
    id: 'paragraph', label: '正文', icon: Type,
    // Always available: on an existing paragraph it is a no-op, and on a quote,
    // list item or code block it is the way back to body text.
    applies: () => true,
    run: (editor, anchor) => editor.chain().focus().setTextSelection(anchor.pos + 1).setParagraph().run(),
  },
  {
    id: 'h1', label: '标题 1', icon: Heading1,
    applies: (anchor) => TEXT_BLOCKS.has(anchor.type),
    run: (editor, anchor) => editor.chain().focus().setTextSelection(anchor.pos + 1).setHeading({ level: 1 }).run(),
  },
  {
    id: 'h2', label: '标题 2', icon: Heading2,
    applies: (anchor) => TEXT_BLOCKS.has(anchor.type),
    run: (editor, anchor) => editor.chain().focus().setTextSelection(anchor.pos + 1).setHeading({ level: 2 }).run(),
  },
  {
    id: 'h3', label: '标题 3', icon: Heading3,
    applies: (anchor) => TEXT_BLOCKS.has(anchor.type),
    run: (editor, anchor) => editor.chain().focus().setTextSelection(anchor.pos + 1).setHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet', label: '无序列表', icon: List,
    applies: (anchor) => TEXT_BLOCKS.has(anchor.type),
    run: (editor, anchor) => editor.chain().focus().setTextSelection(anchor.pos + 1).toggleBulletList().run(),
  },
  {
    id: 'ordered', label: '有序列表', icon: ListOrdered,
    applies: (anchor) => TEXT_BLOCKS.has(anchor.type),
    run: (editor, anchor) => editor.chain().focus().setTextSelection(anchor.pos + 1).toggleOrderedList().run(),
  },
  {
    id: 'task', label: '任务列表', icon: CheckSquare,
    applies: (anchor) => TEXT_BLOCKS.has(anchor.type),
    run: (editor, anchor) => editor.chain().focus().setTextSelection(anchor.pos + 1).toggleTaskList().run(),
  },
  {
    id: 'quote', label: '引用', icon: Quote,
    applies: (anchor) => TEXT_BLOCKS.has(anchor.type),
    run: (editor, anchor) => editor.chain().focus().setTextSelection(anchor.pos + 1).toggleBlockquote().run(),
  },
  {
    id: 'code', label: '代码块', icon: Code2,
    applies: (anchor) => TEXT_BLOCKS.has(anchor.type),
    run: (editor, anchor) => editor.chain().focus().setTextSelection(anchor.pos + 1).toggleCodeBlock().run(),
  },
  {
    id: 'up', label: '上移', icon: ArrowUp,
    applies: (anchor) => anchor.pos > 0,
    run: (editor, anchor) => moveBlock(editor, anchor, -1),
  },
  {
    id: 'down', label: '下移', icon: ArrowDown,
    applies: () => true,
    run: (editor, anchor) => moveBlock(editor, anchor, 1),
  },
  {
    id: 'duplicate', label: '创建副本', icon: CopyIcon,
    applies: () => true,
    run: duplicateBlock,
  },
  {
    id: 'insert-below', label: '在下方插入段落', icon: Plus,
    applies: () => true,
    run: insertParagraphBelow,
  },
  {
    id: 'delete', label: '删除块', icon: Trash2, danger: true,
    applies: () => true,
    run: deleteBlock,
  },
]

const MENU_WIDTH = 208
const MENU_MAX_HEIGHT = 420

type MenuState = { left: number; top: number; pos: number } | null

type Props = {
  editor: Editor | null
  /** Block under the pointer, from useBlockAnchor. */
  anchor: BlockAnchor | null
  /** Holds the anchor at a position while the menu or a drag owns it. */
  pin: (pos: number | null) => void
  /** Re-measures a position, returning its current geometry. */
  refresh: (pos: number) => BlockAnchor | null
  editable: boolean
}

export default function BlockHandle({ editor, anchor, pin, refresh, editable }: Props) {
  const reduced = useReducedMotion()
  const [menu, setMenu] = useState<MenuState>(null)
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null)
  /** The block the menu is open for; re-measured so it follows layout changes. */
  const [menuAnchor, setMenuAnchor] = useState<BlockAnchor | null>(null)

  const closeMenu = useCallback(() => {
    setMenu(null)
    setMenuAnchor(null)
    pin(null)
  }, [pin])

  useEffect(() => {
    if (!menu) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeMenu() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [menu, closeMenu])

  const openMenu = useCallback((pos: number, left: number, top: number) => {
    const box = refresh(pos)
    pin(pos)
    setMenuAnchor(box)
    setMenu({
      pos,
      left: Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - MENU_MAX_HEIGHT)),
    })
  }, [pin, refresh])

  /* Right-click anywhere in the body opens the same menu for the block under the
     pointer. The listener is attached to the editor element, so the browser menu
     still works everywhere else on the page. */
  useEffect(() => {
    if (!editor || !editable) return
    const dom = editor.view.dom as HTMLElement
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      // A field or one of the floating toolbars owns its own menu semantics.
      if (target?.closest('input, textarea, a, .code-overlay, .block-menu')) return
      const coords = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
      if (!coords) return
      // Half-open on purpose: a position at the end of block N is the start of
      // N+1, and an inclusive test put the menu on the block above the click.
      const owner = topLevelPos(editor, coords.pos)
      if (owner === null) return
      event.preventDefault()
      openMenu(owner, event.clientX, event.clientY)
    }
    dom.addEventListener('contextmenu', handler)
    return () => dom.removeEventListener('contextmenu', handler)
  }, [editor, editable, openMenu])

  const startDrag = (event: React.PointerEvent) => {
    if (!editor || !anchor) return
    event.preventDefault()
    const from = anchor.pos
    setDrag({ from, over: null })
    pin(from)
    document.body.classList.add('is-dragging-block')

    const pointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('pointercancel', cancel)
      document.body.classList.remove('is-dragging-block')
      setDrag(null)
      const spans = spansOf(editor)
      const coords = editor.view.posAtCoords({ left: upEvent.clientX, top: upEvent.clientY })
      if (coords) applyMove(editor, planMove(spans, from, dropTargetBefore(spans, coords.pos)))
      pin(null)
    }
    const onPointerMove = (moveEvent: PointerEvent) => {
      const coords = editor.view.posAtCoords({ left: moveEvent.clientX, top: moveEvent.clientY })
      const spans = spansOf(editor)
      setDrag({ from, over: coords ? dropTargetBefore(spans, coords.pos) : null })
    }
    const cancel = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('pointercancel', cancel)
      document.body.classList.remove('is-dragging-block')
      setDrag(null)
      pin(null)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', pointerUp)
    window.addEventListener('pointercancel', cancel)
  }

  const items = useMemo(() => {
    if (!menuAnchor) return []
    return COMMANDS.filter((command) => command.applies(menuAnchor))
  }, [menuAnchor])

  if (!editor) return null

  /*
   * Visibility follows the block anchor, not the gutter.
   *
   * An earlier version only showed the gutter once the pointer had entered it —
   * which is unreachable, because entering it requires it to be visible. The
   * anchor already means "the pointer is over a block or in the strip beside
   * one" (useBlockAnchor keeps a ~56px band alive), so that is the condition.
   */
  const visible = editable && anchor !== null && drag === null && menu === null
  const dropBox = drag && drag.over !== null ? refresh(drag.over) : null

  return <>
    {visible && anchor && <div
      className={'block-gutter' + (drag ? ' is-dragging' : '')}
      style={{ top: anchor.top, left: anchor.left }}
      contentEditable={false}
    >
      <button
        type="button"
        className="block-grip"
        aria-label="拖动块"
        title="拖动以移动，点击打开块菜单"
        aria-haspopup="menu"
        onPointerDown={startDrag}
        onClick={(event) => { event.preventDefault(); openMenu(anchor.pos, anchor.left, anchor.bottom + 6) }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          openMenu(anchor.pos, anchor.left, anchor.bottom + 6)
        }}
      ><GripVertical size={15} /></button>
      <button
        type="button"
        className="block-add"
        aria-label="在下方插入段落"
        title="插入段落"
        onClick={() => insertParagraphBelow(editor, anchor)}
      ><Plus size={14} /></button>
    </div>}

    {/* Drop indicator: a 2px rule at the top edge of the block it would land before. */}
    {dropBox && <div
      className="block-drop-line"
      style={{ top: dropBox.top - 1, left: dropBox.left, width: Math.max(80, dropBox.right - dropBox.left) }}
      contentEditable={false}
      aria-hidden="true"
    />}

    {menu && menuAnchor && createPortal(<>
      <button type="button" className="block-menu-scrim" aria-label="关闭块菜单" onClick={closeMenu} />
      <div
        className={'block-menu' + (reduced ? '' : ' motion-rise')}
        role="menu"
        aria-label="块操作"
        style={{ left: menu.left, top: menu.top, maxHeight: MENU_MAX_HEIGHT }}
      >
        <div className="block-menu-head">
          <span>{menuAnchor.type === 'heading' ? '标题' : menuAnchor.type === 'codeBlock' ? '代码块' : '块操作'}</span>
          <button type="button" className="block-menu-close" aria-label="关闭" onClick={closeMenu}><X size={13} /></button>
        </div>
        <div className="block-menu-list">
          {items.map((command) => {
            const Icon = command.icon
            return <button
              key={command.id}
              type="button"
              role="menuitem"
              className={'block-menu-item' + (command.danger ? ' danger' : '')}
              onClick={() => { command.run(editor, menuAnchor); closeMenu() }}
            ><Icon size={14} /><span>{command.label}</span></button>
          })}
        </div>
      </div>
    </>, document.body)}
  </>
}
