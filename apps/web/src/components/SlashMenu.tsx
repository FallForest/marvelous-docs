import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckSquare, Code2, Heading1, Heading2, Heading3, ImagePlus, List, ListOrdered, Minus, Quote, Table2, Type } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import type { LucideIcon } from 'lucide-react'

type SlashItem = { id: string; label: string; hint: string; icon: LucideIcon; run: (editor: Editor) => void }

type Props = {
  editor: Editor | null
  anchor: { left: number; top: number } | null
  query: string
  range: { from: number; to: number } | null
  onClose: () => void
  onImage: () => void
}

const ITEMS: SlashItem[] = [
  { id: 'text', label: '正文', hint: '普通文本段落', icon: Type, run: (editor) => editor.chain().focus().setParagraph().run() },
  { id: 'h1', label: '标题 1', hint: '大标题', icon: Heading1, run: (editor) => editor.chain().focus().setHeading({ level: 1 }).run() },
  { id: 'h2', label: '标题 2', hint: '章节标题', icon: Heading2, run: (editor) => editor.chain().focus().setHeading({ level: 2 }).run() },
  { id: 'h3', label: '标题 3', hint: '小节标题', icon: Heading3, run: (editor) => editor.chain().focus().setHeading({ level: 3 }).run() },
  { id: 'bullet', label: '无序列表', hint: '项目符号列表', icon: List, run: (editor) => editor.chain().focus().toggleBulletList().run() },
  { id: 'ordered', label: '有序列表', hint: '编号列表', icon: ListOrdered, run: (editor) => editor.chain().focus().toggleOrderedList().run() },
  { id: 'task', label: '任务列表', hint: '带勾选框的待办', icon: CheckSquare, run: (editor) => editor.chain().focus().toggleTaskList().run() },
  { id: 'quote', label: '引用', hint: '引用一段内容', icon: Quote, run: (editor) => editor.chain().focus().toggleBlockquote().run() },
  { id: 'code', label: '代码块', hint: '等宽代码区域', icon: Code2, run: (editor) => editor.chain().focus().toggleCodeBlock().run() },
  { id: 'table', label: '表格', hint: '3×3 表格', icon: Table2, run: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: 'divider', label: '分割线', hint: '一条分隔线', icon: Minus, run: (editor) => editor.chain().focus().setHorizontalRule().run() },
  { id: 'image', label: '图片', hint: '从网址或上传插入', icon: ImagePlus, run: () => undefined },
]

export default function SlashMenu({ editor, anchor, query, range, onClose, onImage }: Props) {
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const filtered = useMemo(() => {
    if (!query) return ITEMS
    const byLabel = ITEMS.filter((item) => item.label.includes(query))
    if (byLabel.length) return byLabel
    return ITEMS.filter((item) => item.hint.includes(query))
  }, [query])

  useEffect(() => { setIndex(0) }, [query])

  useEffect(() => {
    if (!anchor) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((value) => Math.min(value + 1, Math.max(0, filtered.length - 1))) }
      if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((value) => Math.max(value - 1, 0)) }
      if (event.key === 'Enter') {
        event.preventDefault()
        const item = filtered[index]
        if (item) run(item)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [anchor, filtered, index, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  function run(item: SlashItem) {
    if (!editor || !range) return
    editor.chain().focus().deleteRange(range).run()
    if (item.id === 'image') { onImage(); onClose(); return }
    item.run(editor)
    onClose()
  }

  if (!anchor) return null
  return <div className="slash-menu" style={{ left: anchor.left, top: anchor.top }} role="listbox" aria-label="插入内容">
    <div className="slash-head">插入内容 <small>输入以筛选</small></div>
    <div className="slash-list" ref={listRef}>
      {filtered.map((item, position) => {
        const Icon = item.icon
        return <button key={item.id} type="button" role="option" aria-selected={position === index} className={'slash-item' + (position === index ? ' active' : '')} onMouseEnter={() => setIndex(position)} onClick={() => run(item)}>
          <span className="slash-icon"><Icon size={16} /></span>
          <span><b>{item.label}</b><small>{item.hint}</small></span>
        </button>
      })}
      {filtered.length === 0 && <div className="slash-empty">没有匹配的块</div>}
    </div>
    <div className="slash-foot">↑↓ 选择 · Enter 插入 · Esc 关闭</div>
  </div>
}
