import { useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Columns3, Grid2X2, Rows3, Table2, Trash2 } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import type { BlockGeometry } from '../../hooks/useBlockGeometry'

/**
 * Table actions, anchored to the table the cursor is in.
 *
 * Previously this was a permanent button pinned to the bottom-right of the
 * canvas (`right:24px; bottom:52px`), which in a long document sat hundreds of
 * pixels away from the table being edited. It now rides on the table's own rect
 * and only appears while the cursor is inside a table.
 */
export default function TableMenu({ editor, table }: { editor: Editor | null; table: BlockGeometry | null }) {
  const [open, setOpen] = useState(false)
  if (!editor || !table || !editor.isActive('table')) return null

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

  // Sits just above the table's top-right corner, clamped into the viewport.
  const top = Math.max(8, table.top - 34)
  const left = Math.max(8, Math.min(table.right - 96, window.innerWidth - 104))

  return <>
    <div className="block-tool" style={{ top, left }} contentEditable={false}>
      <button
        type="button"
        className={'block-tool-trigger' + (open ? ' is-open' : '')}
        aria-haspopup="menu"
        aria-expanded={open}
        title="表格操作"
        onClick={() => setOpen((value) => !value)}
      ><Table2 size={13} /><span>表格</span></button>
    </div>
    {open && <>
      <button type="button" className="block-tool-scrim" aria-label="关闭表格菜单" onClick={() => setOpen(false)} />
      <div
        className="block-tool-panel"
        role="menu"
        aria-label="表格操作"
        style={{ top: top + 30, left: Math.max(8, Math.min(left, window.innerWidth - 200)) }}
      >
        {actions.map((action) => <button key={action.label} type="button" role="menuitem" className={action.danger ? 'danger' : ''} onClick={() => { action.run(); setOpen(false) }}>{action.icon}<span>{action.label}</span></button>)}
      </div>
    </>}
  </>
}
