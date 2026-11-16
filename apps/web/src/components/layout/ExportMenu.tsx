import { ArrowDownToLine, FileType2, Printer } from 'lucide-react'
import Popover from '../ui/Popover'
import ArtIcon from '../ui/ArtIcon'
import type { ExportTarget } from '../../lib/types'

/**
 * The export destinations, declared once.
 *
 * Two surfaces offer them — the top bar's 导出 button and the document 更多 menu
 * — and they must not drift apart: a format added to one menu and forgotten in the
 * other is a document that can be exported one way while the visible label says
 * another. The rows are therefore shared, and only the popover shell differs.
 */
export const EXPORT_ITEMS: Array<{ format: ExportTarget; label: string; hint: string }> = [
  { format: 'pdf', label: 'PDF', hint: '分页文档' },
  { format: 'markdown', label: 'Markdown', hint: '.md' },
  { format: 'html', label: 'HTML', hint: '.html' },
  { format: 'json', label: 'JSON', hint: '.json' },
  { format: 'print', label: '打印', hint: '打印预览' },
]

type ExportMenuProps = { open: boolean; onSelect: (format: ExportTarget) => void; onClose: () => void }

/** The list itself, for a surface that already owns a popover. */
export function ExportMenuItems({ onSelect, formats = EXPORT_ITEMS.map((item) => item.format) }: { onSelect: (format: ExportTarget) => void; formats?: ExportTarget[] }) {
  return <>{EXPORT_ITEMS.filter((item) => formats.includes(item.format)).map((item) => <button key={item.format} type="button" role="menuitem" className="menu-item" onClick={() => onSelect(item.format)}>
    {item.format === 'print'
      ? <ArtIcon name="print" fallback={<Printer size={15} />} />
      : item.format === 'pdf' ? <ArtIcon name="document" fallback={<FileType2 size={15} />} /> : <ArtIcon name="download" fallback={<ArrowDownToLine size={15} />} />}
    <span>{item.label}</span>
    <small className="menu-hint">{item.hint}</small>
  </button>)}</>
}

/**
 * A standalone export popover, kept for surfaces that want the formats on their
 * own anchored menu (a caller with no room for a 更多 row).
 *
 * The document top bar no longer uses it: those targets moved into 更多, per the
 * audit, so that one menu owns the document actions instead of five icons.
 */
export default function ExportMenu({ open, onSelect, onClose }: ExportMenuProps) {
  return <Popover open={open} onClose={onClose} label="导出文档" className="export-menu">
    <div className="menu-heading">导出</div>
    <ExportMenuItems onSelect={(format) => { onClose(); onSelect(format) }} />
  </Popover>
}
