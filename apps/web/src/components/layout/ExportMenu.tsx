import { ArrowDownToLine, Printer } from 'lucide-react'
import Popover from '../ui/Popover'
import type { ExportTarget } from '../../lib/types'

const ITEMS: Array<{ format: ExportTarget; label: string; hint: string }> = [
  { format: 'markdown', label: 'Markdown', hint: '.md' },
  { format: 'html', label: 'HTML', hint: '.html' },
  { format: 'json', label: 'JSON', hint: '.json' },
  { format: 'print', label: '打印', hint: '打印预览' },
]

type ExportMenuProps = { open: boolean; onSelect: (format: ExportTarget) => void; onClose: () => void }

export default function ExportMenu({ open, onSelect, onClose }: ExportMenuProps) {
  return <Popover open={open} onClose={onClose} label="导出文档" className="export-menu">
    <div className="menu-heading">导出</div>
    {ITEMS.map((item) => <button key={item.format} type="button" role="menuitem" className="menu-item" onClick={() => { onClose(); onSelect(item.format) }}>
      {item.format === 'print' ? <Printer size={15} /> : <ArrowDownToLine size={15} />}
      <span>{item.label}</span>
      <small className="menu-hint">{item.hint}</small>
    </button>)}
  </Popover>
}
