import { Bold, Code, Italic, Link2, Strikethrough, Underline } from 'lucide-react'
import type { Editor } from '@tiptap/react'

type Props = {
  editor: Editor | null
  anchor: { left: number; top: number } | null
  onLink: () => void
  onComment: () => void
}

/** Floating formatting menu shown when text is selected, mirroring Feishu's bubble toolbar. */
export default function BubbleToolbar({ editor, anchor, onLink, onComment }: Props) {
  if (!editor || !anchor) return null
  const button = (label: string, active: boolean, run: () => void, icon: React.ReactNode) => <button
    type="button"
    className={'bubble-btn' + (active ? ' is-active' : '')}
    title={label}
    aria-label={label}
    aria-pressed={active}
    onMouseDown={(event) => event.preventDefault()}
    onClick={run}
  >{icon}</button>
  return <div className="bubble-toolbar" style={{ left: anchor.left, top: anchor.top }} role="toolbar" aria-label="选中文本格式">
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
