import { FilePlus2, FileText, FolderPlus, Upload } from 'lucide-react'
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

export const fallbackTemplates: Template[] = TEMPLATE_ORDER.map((id) => ({ id, name: TEMPLATE_LABELS[id], description: TEMPLATE_HINTS[id] }))

/** Localized label for a template id, used when creating a document from it. */
export function templateLabel(id: string, fallback?: string): string {
  return TEMPLATE_LABELS[id] || fallback || '未命名文档'
}

export function mergeTemplates(fetched: Template[]): Template[] {
  const byId = new Map(fetched.map((template) => [template.id, template]))
  const merged = TEMPLATE_ORDER.map((id) => byId.get(id) || fallbackTemplates.find((template) => template.id === id)!)
  fetched.forEach((template) => {
    if (template.id !== 'blank' && !TEMPLATE_ORDER.includes(template.id)) merged.push(template)
  })
  return merged
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

export default function TemplateMenu({ open, templates, onCreateBlank, onCreateTemplate, onImport, onNewFolder, onClose }: TemplateMenuProps) {
  const entries = mergeTemplates(templates)
  return <Popover open={open} onClose={onClose} label="新建" align="right" className="template-menu sketch-frame">
    <div className="menu-heading">新建</div>
    <button type="button" role="menuitem" className="menu-item" onClick={() => { onClose(); onCreateBlank() }}><ArtIcon name="new-document" fallback={<FilePlus2 size={15} />} /><span>空白文档</span></button>
    {entries.map((template) => <button key={template.id} type="button" role="menuitem" className="menu-item" onClick={() => { onClose(); onCreateTemplate(template.id) }}>
      <span className="handdrawn-only template-art"><ArtIcon name="document" fallback={<FileText size={15} />} /></span>
      <span className="menu-item-copy"><b>{TEMPLATE_LABELS[template.id] || template.name}</b><small>{TEMPLATE_HINTS[template.id] || template.description || '模板'}</small></span>
    </button>)}
    <div className="menu-divider" />
    <button type="button" role="menuitem" className="menu-item" onClick={() => { onClose(); onImport() }}><Upload size={15} /><span>导入 Markdown</span></button>
    <button type="button" role="menuitem" className="menu-item" onClick={() => { onClose(); onNewFolder() }}><ArtIcon name="folder" fallback={<FolderPlus size={15} />} /><span>新建文件夹</span></button>
  </Popover>
}
