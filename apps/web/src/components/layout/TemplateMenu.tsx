import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { FolderPlus, Upload } from 'lucide-react'
import Popover from '../ui/Popover'
import ArtIcon from '../ui/ArtIcon'
import type { Template } from '../../lib/types'

const TEMPLATE_ORDER = ['meeting-notes', 'weekly-report', 'project-plan', 'product-spec', 'release-notes']

const TEMPLATE_LABELS: Record<string, string> = {
  blank: '空白文档',
  'meeting-notes': '会议纪要',
  'weekly-report': '周报',
  'project-plan': '项目计划',
  'product-spec': '产品需求',
  'release-notes': '发布说明',
}

/** Localized label for a template id, used when creating a document from it. */
export function templateLabel(id: string, fallback?: string): string {
  return TEMPLATE_LABELS[id] || fallback || '未命名文档'
}

export function mergeTemplates(fetched: Template[]): Template[] {
  // A missing catalogue must not advertise template ids the server may not
  // support. Keep the first advertised row for each id and never mutate it.
  const byId = new Map<string, Template>()
  for (const entry of fetched) {
    if (entry.id && entry.id !== 'blank' && !byId.has(entry.id)) byId.set(entry.id, entry)
  }
  const known = TEMPLATE_ORDER.flatMap((id) => byId.has(id) ? [byId.get(id)!] : [])
  const additional = [...byId.values()].filter((entry) => !TEMPLATE_ORDER.includes(entry.id))
  return [...known, ...additional]
}

type TemplateMenuProps = {
  open: boolean
  onImport: () => void
  onNewFolder: () => void
  onClose: () => void
}

/** Additional creation actions. The main New button creates a blank page. */
export default function TemplateMenu({ open, onImport, onNewFolder, onClose }: TemplateMenuProps) {
  const body = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    // Popover first measures an invisible portal; focus after its position is
    // applied so the first item is visible and can actually receive focus.
    const frame = requestAnimationFrame(() => body.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [open])

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    if (!rows.length) return
    const index = rows.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
    event.preventDefault()
    rows[next]?.focus()
  }

  return <Popover open={open} onClose={onClose} label="更多新建方式" align="right" className="template-menu creation-menu sketch-frame">
    <div ref={body} className="template-menu-body" onKeyDown={moveFocus}>
      <button type="button" role="menuitem" className="menu-item" onClick={() => { onClose(); onNewFolder() }}><ArtIcon name="folder" fallback={<FolderPlus size={15} />} /><span>新建文件夹</span></button>
      <button type="button" role="menuitem" className="menu-item" onClick={() => { onClose(); onImport() }}><Upload size={15} /><span>导入 Markdown</span></button>
    </div>
  </Popover>
}
