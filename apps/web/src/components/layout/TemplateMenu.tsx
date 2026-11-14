import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ArrowLeft, ChevronRight, FilePlus2, FileText, FolderPlus, Upload } from 'lucide-react'
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

const TEMPLATE_HINTS: Record<string, string> = {
  'meeting-notes': '议程、决议与行动项',
  'weekly-report': '本周进展、指标与风险',
  'project-plan': '目标、里程碑与负责人',
  'product-spec': '问题、用户、范围与成功指标',
  'release-notes': '亮点、修复与升级说明',
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
  templates: Template[]
  onCreateBlank: () => void
  onCreateTemplate: (templateId: string) => void
  onImport: () => void
  onNewFolder: () => void
  onClose: () => void
}

export default function TemplateMenu({ open, ...props }: TemplateMenuProps) {
  // Closing unmounts the view state, so every fresh New menu starts on the
  // simple creation choices, even if it was closed from the office catalogue.
  return open ? <OpenTemplateMenu {...props} /> : null
}

function OpenTemplateMenu({ templates, onCreateBlank, onCreateTemplate, onImport, onNewFolder, onClose }: Omit<TemplateMenuProps, 'open'>) {
  const [officeOpen, setOfficeOpen] = useState(false)
  const entries = mergeTemplates(templates)

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (officeOpen && event.key === 'ArrowLeft') { event.preventDefault(); setOfficeOpen(false); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    if (!rows.length) return
    const index = rows.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
    event.preventDefault()
    rows[next]?.focus()
  }

  // A subview has a different height. Remount the popover to measure its actual
  // bounds and focus its first control, including on a short phone viewport.
  return <Popover key={officeOpen ? 'office' : 'create'} open onClose={onClose} label={officeOpen ? '办公模板' : '新建'} align="right" className="template-menu sketch-frame">
    <div className="template-menu-body" onKeyDown={moveFocus}>
      {officeOpen ? <>
        <button type="button" role="menuitem" className="menu-item template-back" onClick={() => setOfficeOpen(false)}><ArrowLeft size={15} /><span>返回新建</span></button>
        <div className="menu-heading">办公模板</div>
        <p className="template-note">按具体办公场景选用，内容可以自由修改。</p>
        {entries.map((template) => <button key={template.id} type="button" role="menuitem" className="menu-item" onClick={() => { onClose(); onCreateTemplate(template.id) }}>
          <ArtIcon name="document" fallback={<FileText size={15} />} />
          <span className="menu-item-copy"><b>{TEMPLATE_LABELS[template.id] || template.name}</b><small>{TEMPLATE_HINTS[template.id] || template.description || '自定义模板'}</small></span>
        </button>)}
        {entries.length === 0 && <p className="template-note">暂无可用模板。</p>}
      </> : <>
        <div className="menu-heading">新建</div>
        <button type="button" role="menuitem" aria-label="空白文档" className="menu-item template-primary" onClick={() => { onClose(); onCreateBlank() }}>
          <ArtIcon name="new-document" fallback={<FilePlus2 size={15} />} />
          <span className="menu-item-copy"><b>空白文档</b><small>从空白页开始写作</small></span>
        </button>
        <button type="button" role="menuitem" className="menu-item" onClick={() => { onClose(); onNewFolder() }}><ArtIcon name="folder" fallback={<FolderPlus size={15} />} /><span>新建文件夹</span></button>
        <button type="button" role="menuitem" className="menu-item" onClick={() => { onClose(); onImport() }}><Upload size={15} /><span>导入 Markdown</span></button>
        {entries.length > 0 && <>
          <div className="menu-divider" />
          <button type="button" role="menuitem" aria-haspopup="menu" className="menu-item template-office-entry" onClick={() => setOfficeOpen(true)}>
            <ArtIcon name="document" fallback={<FileText size={15} />} />
            <span className="menu-item-copy"><b>办公模板（可选）</b><small>会议、周报、项目等场景</small></span>
            <ChevronRight size={14} className="template-chevron" />
          </button>
        </>}
      </>}
    </div>
  </Popover>
}
