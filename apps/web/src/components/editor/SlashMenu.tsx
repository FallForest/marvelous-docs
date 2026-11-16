import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckSquare, Code2, Heading1, Heading2, Heading3, ImagePlus, List, ListOrdered, Minus, Quote, Table2, Type } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import type { LucideIcon } from 'lucide-react'
import { staggerStyle } from '../../lib/motion'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { compositionGuard } from '../../lib/editor/ime'

type Range = { from: number; to: number }
type SlashItem = {
  id: string
  label: string
  hint: string
  /**
   * Latin, pinyin and common aliases.
   *
   * Typing `/h1` or `/biaoti` used to return nothing: the filter only looked at
   * the Chinese label and hint, so a writer who thinks in English or in pinyin
   * had to switch to the mouse. These are search terms, not display text - the
   * menu still shows the Chinese label.
   */
  keywords: string[]
  icon: LucideIcon
  run: (editor: Editor, range: Range) => void
}

type Props = {
  editor: Editor | null
  anchor: { left: number; top: number } | null
  query: string
  range: { from: number; to: number } | null
  onClose: () => void
  onImage: () => void
}

/** The shared .stagger utility stops being readable past ~10 rows. */
const STAGGER_LIMIT = 10

export const SLASH_ITEMS: SlashItem[] = [
  { id: 'text', label: '正文', keywords: 'text body paragraph zhengwen'.split(' '), hint: '普通文本段落', icon: Type, run: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().run() },
  { id: 'h1', label: '标题 1', keywords: 'h1 heading1 title1 biaoti da biaoti'.split(' '), hint: '大标题', icon: Heading1, run: (editor, range) => editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run() },
  { id: 'h2', label: '标题 2', keywords: 'h2 heading2 title2 biaoti zhangjie'.split(' '), hint: '章节标题', icon: Heading2, run: (editor, range) => editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run() },
  { id: 'h3', label: '标题 3', keywords: 'h3 heading3 title3 biaoti xiaojie'.split(' '), hint: '小节标题', icon: Heading3, run: (editor, range) => editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run() },
  { id: 'bullet', label: '无序列表', keywords: 'bullet ul list wuxu liebiao'.split(' '), hint: '项目符号列表', icon: List, run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
  { id: 'ordered', label: '有序列表', keywords: 'ordered ol number youxu liebiao'.split(' '), hint: '编号列表', icon: ListOrdered, run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
  { id: 'task', label: '任务列表', keywords: 'task todo checkbox renwu daiban'.split(' '), hint: '带勾选框的待办', icon: CheckSquare, run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run() },
  { id: 'quote', label: '引用', keywords: 'quote blockquote yinyong'.split(' '), hint: '引用一段内容', icon: Quote, run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run() },
  { id: 'code', label: '代码块', keywords: 'code pre snippet daima'.split(' '), hint: '等宽代码区域', icon: Code2, run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run() },
  { id: 'table', label: '表格', keywords: 'table grid biaoge'.split(' '), hint: '3×3 表格', icon: Table2, run: (editor, range) => editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: 'divider', label: '分割线', keywords: 'divider hr rule fengexian'.split(' '), hint: '一条分隔线', icon: Minus, run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run() },
  { id: 'image', label: '图片', keywords: 'image img picture tupian'.split(' '), hint: '从网址或上传插入', icon: ImagePlus, run: (editor, range) => editor.chain().focus().deleteRange(range).run() },
]

export default function SlashMenu({ editor, anchor, query, range, onClose, onImage }: Props) {
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const reduced = useReducedMotion()
  const filtered = useMemo(() => {
    if (!query) return SLASH_ITEMS
    const needle = query.trim().toLowerCase()
    if (!needle) return SLASH_ITEMS
    /*
     * Label first, then hint, then aliases: the label is what the writer sees, so a
     * match there is what they meant. Aliases only widen the search - they never
     * outrank a real match, which is why they are a third pass rather than a union.
     */
    const byLabel = SLASH_ITEMS.filter((item) => item.label.includes(needle))
    if (byLabel.length) return byLabel
    const byHint = SLASH_ITEMS.filter((item) => item.hint.includes(needle))
    if (byHint.length) return byHint
    return SLASH_ITEMS.filter((item) => item.keywords.some((word) => word.startsWith(needle)))
  }, [query])

  useEffect(() => { setIndex(0) }, [query])

  useEffect(() => {
    if (!anchor) return
    /*
     * Candidate confirmation is not a command.
     *
     * Typing `/biaoti` in a Chinese IME raises Enter twice: once to confirm the
     * candidate (which the IME owns) and once, deliberately, to run the row. This
     * handler is on `document` in the capture phase, so it saw the first one and
     * inserted a block before the writer had chosen anything — and the same fate
     * awaited Escape and the arrows, which is how a menu can end a composition.
     * The guard also covers the composed-navigation keys for one beat after
     * `compositionend`, because some IMEs emit the final keydown after it.
     */
    const ime = compositionGuard()
    const onCompositionStart = () => ime.start()
    const onCompositionEnd = () => ime.end()
    const onKey = (event: KeyboardEvent) => {
      if (ime.blocked(event)) return
      // stopPropagation, not just preventDefault: the shell listens on `window`
      // and closes every overlay on Escape, so without this one press closed the
      // menu *and* the right panel behind it.
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
      if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((value) => Math.min(value + 1, Math.max(0, filtered.length - 1))) }
      if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((value) => Math.max(value - 1, 0)) }
      if (event.key === 'Enter') {
        event.preventDefault()
        const item = filtered[index]
        if (item) run(item)
      }
    }
    document.addEventListener('compositionstart', onCompositionStart, true)
    document.addEventListener('compositionend', onCompositionEnd, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('compositionstart', onCompositionStart, true)
      document.removeEventListener('compositionend', onCompositionEnd, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [anchor, filtered, index, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * Keep the highlighted row visible while arrowing through a filtered list.
   *
   * 'nearest' is the whole point: it is a no-op when the row is already fully
   * visible, so holding ArrowDown advances one row at a time instead of
   * re-centring the list under the pointer (which reads as the menu jumping).
   * Smooth scrolling is dropped under reduced motion, where a gliding list is
   * exactly the travel the user asked not to see.
   */
  useEffect(() => {
    if (!anchor) return
    const list = listRef.current
    const active = list?.children[index] as HTMLElement | undefined
    active?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }, [index, anchor, reduced, filtered.length])

  function run(item: SlashItem) {
    if (!editor || !range) return
    if (item.id === 'image') {
      editor.chain().focus().deleteRange(range).run()
      onImage()
      onClose()
      return
    }
    // Delete the typed "/query" then apply the block command in one chain so the
    // command runs against the corrected cursor position instead of the stale range.
    item.run(editor, range)
    onClose()
  }

  if (!anchor) return null
  return <div className="slash-menu motion-rise" style={{ left: anchor.left, top: anchor.top }} role="listbox" aria-label="插入内容">
    <div className="slash-head">插入内容 <small>输入以筛选</small></div>
    <div className="slash-list" ref={listRef}>
      {filtered.map((item, position) => {
        const Icon = item.icon
        return <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={position === index}
          className={'slash-item' + (position === index ? ' active' : '') + (position < STAGGER_LIMIT ? ' stagger' : '')}
          // Only the first screenful staggers; a 12-row cascade would still be
          // landing by the time the user has typed a second character.
          style={position < STAGGER_LIMIT ? staggerStyle(position) : undefined}
          onMouseEnter={() => setIndex(position)}
          onClick={() => run(item)}
        >
          <span className="slash-icon"><Icon size={16} /></span>
          <span><b>{item.label}</b><small>{item.hint}</small></span>
        </button>
      })}
      {filtered.length === 0 && <div className="slash-empty">没有匹配的块</div>}
    </div>
    <div className="slash-foot">↑↓ 选择 · Enter 插入 · Esc 关闭</div>
  </div>
}