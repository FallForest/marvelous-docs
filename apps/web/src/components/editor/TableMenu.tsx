import { useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Columns3, Grid2X2, Rows3, Trash2 } from 'lucide-react'
import type { Editor } from '@tiptap/react'

export default function TableMenu({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false)
  if (!editor || !editor.isActive('table')) return null
  const actions: Array<{ label: string; icon: React.ReactNode; run: () => void; danger?: boolean }> = [
    { label: '上方插入行', icon: <ArrowUp size={15} />, run: () => editor.chain().focus().addRowBefore().run() },
    { label: '下方插入行', icon: <ArrowDown size={15} />, run: () => editor.chain().focus().addRowAfter().run() },
    { label: '左侧插入列', icon: <ArrowLeft size={15} />, run: () => editor.chain().focus().addColumnBefore().run() },
    { label: '右侧插入列', icon: <ArrowRight size={15} />, run: () => editor.chain().focus().addColumnAfter().run() },
    { label: '删除行', icon: <Rows3 size={15} />, run: () => editor.chain().focus().deleteRow().run(), danger: true },
    { label: '删除列', icon: <Columns3 size={15} />, run: () => editor.chain().focus().deleteColumn().run(), danger: true },
    { label: '合并单元格', icon: <Grid2X2 size={15} />, run: () => editor.chain().focus().mergeCells().run() },
    { label: '拆分单元格', icon: <Grid2X2 size={15} />, run: () => editor.chain().focus().splitCell().run() },
    { label: '切换表头', icon: <Rows3 size={15} />, run: () => editor.chain().focus().toggleHeaderRow().run() },
    { label: '删除表格', icon: <Trash2 size={15} />, run: () => editor.chain().focus().deleteTable().run(), danger: true },
  ]
  return <div className="table-menu">
    <button type="button" className="table-menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>表格操作</button>
    {open && <>
      <button type="button" className="table-menu-scrim" aria-label="关闭表格菜单" onClick={() => setOpen(false)} />
      <div className="table-menu-panel" role="menu" aria-label="表格操作">
        {actions.map((action) => <button key={action.label} type="button" role="menuitem" className={action.danger ? 'danger' : ''} onClick={() => { action.run(); setOpen(false) }}>{action.icon}<span>{action.label}</span></button>)}
      </div>
    </>}
  </div>
}
