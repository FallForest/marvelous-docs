import { useEffect, useRef, useState } from 'react'
import { Bold, Code, Italic, Link2, Strikethrough, Underline } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { DURATION } from '../../lib/motion'
import { useReducedMotion } from '../../hooks/useReducedMotion'

type Props = {
  editor: Editor | null
  anchor: { left: number; top: number } | null
  onLink: () => void
  onComment: () => void
}

/**
 * DocumentEditor clamps the bar with Math.max(64, ...). When the clamp bites,
 * the bar is no longer sitting above the line, it is sitting on top of it, so
 * the scale has to grow from its top edge to keep the overshoot inside free
 * space instead of sweeping across the selected text.
 */
const BUBBLE_CLAMP_TOP = 64

/** The edge nearest the selection; the scale springs out of it. */
function originFor(anchor: { top: number }): 'top' | 'bottom' {
  return anchor.top <= BUBBLE_CLAMP_TOP ? 'top' : 'bottom'
}

/** Floating formatting menu shown when text is selected, mirroring Feishu's bubble toolbar. */
export default function BubbleToolbar({ editor, anchor, onLink, onComment }: Props) {
  const reduced = useReducedMotion()
  /*
   * DocumentEditor clears the anchor on the same tick the selection collapses,
   * so the bar has to outlive it by one exit beat or there is nothing to animate.
   *
   * `leaving` is derived during render rather than set from an effect: a state
   * flip in an effect lands after the commit, which means the element would be
   * removed first and then re-inserted for its own exit — a visible flash. The
   * last position is cached in a ref, which is already fresh by then because the
   * effect that wrote it ran after the previous (non-null) commit.
   */
  const lastRef = useRef(anchor)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (anchor) {
      lastRef.current = anchor
      setDismissed(false)
      return
    }
    if (!lastRef.current) return
    const timer = window.setTimeout(() => setDismissed(true), reduced ? 0 : DURATION.fast)
    return () => window.clearTimeout(timer)
  }, [anchor, reduced])

  // The live anchor wins while the user is still adjusting the selection; only
  // after it disappears does the cached position drive the exit.
  const shown = anchor ?? (dismissed ? null : lastRef.current)
  const leaving = !anchor && !dismissed && lastRef.current !== null
  if (!editor || !shown) return null

  const button = (label: string, active: boolean, run: () => void, icon: React.ReactNode) => <button
    type="button"
    className={'bubble-btn' + (active ? ' is-active' : '')}
    title={label}
    aria-label={label}
    aria-pressed={active}
    onMouseDown={(event) => event.preventDefault()}
    onClick={run}
  >{icon}</button>

  return <div
    className={'bubble-toolbar' + (leaving ? ' is-leaving' : '')}
    style={{ left: shown.left, top: shown.top }}
    data-origin={originFor(shown)}
    role="toolbar"
    aria-label="选中文本格式"
    aria-hidden={leaving || undefined}
  >
    {button('加粗', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), <Bold size={15} />)}
    {button('斜体', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), <Italic size={15} />)}
    {button('下划线', editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), <Underline size={15} />)}
    {button('删除线', editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), <Strikethrough size={15} />)}
    {button('行内代码', editor.isActive('code'), () => editor.chain().focus().toggleCode().run(), <Code size={15} />)}
    <span className="bubble-divider" />
    {button('链接', editor.isActive('link'), onLink, <Link2 size={15} />)}
    <button type="button" className="bubble-btn bubble-comment" title="评论" aria-label="评论选中文本" onMouseDown={(event) => event.preventDefault()} onClick={onComment}><span>评论</span></button>
  </div>
}