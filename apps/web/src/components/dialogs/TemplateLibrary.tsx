import { useEffect, useId, useRef } from 'react'
import { ArrowUpRight, BookOpen, FileText, X } from 'lucide-react'
import { usePresence } from '../../hooks/usePresence'
import { mergeTemplates, templateLabel } from '../layout/TemplateMenu'
import ArtIcon from '../ui/ArtIcon'
import type { Template } from '../../lib/types'

type TemplateLibraryProps = {
  templates: Template[]
  onCreateTemplate: (templateId: string) => void
  onClose: () => void
}

const TEMPLATE_HINTS: Record<string, string> = {
  'meeting-notes': '议程、决议与行动项',
  'weekly-report': '本周进展、指标与风险',
  'project-plan': '目标、里程碑与负责人',
  'product-spec': '问题、用户、范围与成功指标',
  'release-notes': '亮点、修复与升级说明',
}

/** An optional catalogue, separate from the blank-document creation flow. */
export default function TemplateLibrary({ templates, onCreateTemplate, onClose }: TemplateLibraryProps) {
  const entries = mergeTemplates(templates)
  const panel = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  const { closing, requestClose, onAnimationEnd } = usePresence(onClose)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = panel.current
    const focusables = () => node ? Array.from(node.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')).filter((button) => button.offsetParent !== null) : []
    const initial = node?.querySelector<HTMLButtonElement>('.template-library-card') || focusables()[0]
    initial?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        requestClose()
        return
      }
      if (event.key !== 'Tab') return
      const controls = focusables()
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (!first || !last) { event.preventDefault(); return }
      if (!node?.contains(document.activeElement)) { event.preventDefault(); first.focus(); return }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      previous?.focus({ preventScroll: true })
    }
  }, [requestClose])

  return <div className={'modal-backdrop' + (closing ? ' is-closing' : '')} onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose() }}>
    <section
      ref={panel}
      className={'template-library modal-panel' + (closing ? ' is-closing' : '')}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onAnimationEnd={onAnimationEnd}
    >
      <header className="template-library-header">
        <span className="template-library-symbol"><ArtIcon name="notebook" fallback={<BookOpen size={24} />} /></span>
        <div className="template-library-heading"><h2 id={titleId}>模板库</h2><p id={descriptionId}>需要一些结构时，从这里选一个起点。</p></div>
        <button type="button" className="icon-btn" aria-label="关闭模板库" onClick={requestClose}><X size={18} /></button>
      </header>
      <div className="template-library-list" aria-label="可用模板">
        {entries.map((template) => <button
          key={template.id}
          type="button"
          className="template-library-card sketch-frame"
          onClick={() => { onClose(); onCreateTemplate(template.id) }}
        >
          <span className="template-library-card-icon"><ArtIcon name="document" fallback={<FileText size={25} />} /></span>
          <span className="template-library-card-copy"><b>{templateLabel(template.id, template.name)}</b><small>{TEMPLATE_HINTS[template.id] || template.description || '使用这个模板开始，再按需要自由修改。'}</small></span>
          <ArrowUpRight size={16} className="template-library-card-arrow" aria-hidden="true" />
        </button>)}
        {entries.length === 0 && <div className="template-library-empty"><ArtIcon name="document" fallback={<FileText size={30} />} /><b>暂无可用模板</b><p>可以先关闭模板库，从空白文档开始。</p></div>}
      </div>
      <footer className="template-library-footer"><span>选择后会新建一份文档，内容可以自由修改。</span><button type="button" className="secondary-btn" onClick={requestClose}>关闭</button></footer>
    </section>
  </div>
}
