import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { Clock3, RefreshCw, X } from 'lucide-react'
import { api } from '../../lib/endpoints'
import { buildEditorExtensions } from '../../lib/editor'
import { formatDate } from '../../lib/format'
import { diffHistoryDocuments, diffHistoryText } from '../../lib/history'
import type { TextChange } from '../../lib/history'
import { emptyContent } from '../../lib/types'
import { usePresence } from '../../hooks/usePresence'
import type { DocJson, Version } from '../../lib/types'

type VersionPreviewProps = {
  token: string
  documentId: string
  version: Version
  currentContent?: DocJson
  currentTitle?: string
  restoring?: boolean
  onRestore: (versionId: string) => Promise<boolean>
  onClose: () => void
}

function ChangedText({ parts }: { parts: TextChange[] }) {
  return <>{parts.map((part, index) => part.kind === 'removed' ? <del key={index}>{part.text}</del> : part.kind === 'added' ? <ins key={index}>{part.text}</ins> : <span key={index}>{part.text}</span>)}</>
}

export default function VersionPreview({ token, documentId, version, currentContent, currentTitle, restoring = false, onRestore, onClose }: VersionPreviewProps) {
  const [detail, setDetail] = useState<Version | null>(null)
  const [baseline, setBaseline] = useState<{ content?: DocJson; title?: string }>({ content: currentContent, title: currentTitle })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [restoreError, setRestoreError] = useState('')
  const [mode, setMode] = useState<'changes' | 'original'>('changes')
  const [showUnchanged, setShowUnchanged] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const panel = useRef<HTMLElement | null>(null)
  const { closing, requestClose, onAnimationEnd } = usePresence(onClose)
  const locked = busy || restoring
  const close = useCallback(() => { if (!locked) requestClose() }, [locked, requestClose])

  useEffect(() => {
    let live = true
    setLoading(true); setError(''); setDetail(null); setConfirming(false); setRestoreError('')
    Promise.all([api.version(token, documentId, version.id), currentContent ? Promise.resolve({ document: { content: currentContent, title: currentTitle } }) : api.document(token, documentId)])
      .then(([result, current]) => { if (live) { setDetail(result.version); setBaseline(current.document) } })
      .catch(cause => { if (live) setError((cause as Error).message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [token, documentId, version.id, currentContent, currentTitle])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = panel.current
    const focusables = () => Array.from(node?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') || []).filter(item => item.offsetParent !== null)
    focusables()[0]?.focus({ preventScroll: true })
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
      if (event.key !== 'Tab') return
      const items = focusables(), first = items[0], last = items[items.length - 1]
      if (!first || !last) { event.preventDefault(); return }
      if (!node?.contains(document.activeElement)) { event.preventDefault(); first.focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('keydown', key, true); previous?.focus?.({ preventScroll: true }) }
  }, [close])

  const editor = useEditor({
    extensions: buildEditorExtensions(),
    content: detail?.content?.doc || emptyContent.doc,
    editable: false,
    editorProps: { attributes: { class: 'tiptap-content version-content' } },
  }, [detail?.id])
  const changes = useMemo(() => diffHistoryDocuments(baseline.content, detail?.content), [baseline.content, detail?.content])
  const changed = changes.filter(block => block.kind !== 'same')
  const title = detail?.title ?? version.title ?? '未命名文档'
  const titleChanged = baseline.title !== undefined && baseline.title !== title

  async function restore() {
    setBusy(true); setRestoreError('')
    try {
      if (await onRestore(version.id)) requestClose()
      else setRestoreError('恢复未完成，请检查提示后重试。')
    } catch (cause) { setRestoreError((cause as Error).message) }
    finally { setBusy(false) }
  }

  return <div className={'modal-backdrop' + (closing ? ' is-closing' : '')} onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <section ref={panel} className={'version-modal history-preview modal-panel' + (closing ? ' is-closing' : '')} role="dialog" aria-modal="true" aria-labelledby="version-title" onAnimationEnd={onAnimationEnd}>
      <header><div><div className="version-modal-icon"><Clock3 size={17} /></div><h2 id="version-title">版本 {version.version}</h2><p>{detail?.createdByName || version.createdByName || '成员'} · {formatDate(detail?.createdAt || version.createdAt) || '历史快照'}</p></div><button type="button" className="icon-btn" aria-label="关闭版本预览" title="关闭" disabled={locked} onClick={close}><X size={17} /></button></header>
      <div className="history-preview-tabs" role="tablist" aria-label="版本预览方式"><button type="button" role="tab" id="version-changes-tab" aria-controls="version-changes" aria-selected={mode === 'changes'} onClick={() => setMode('changes')}>与当前内容比较</button><button type="button" role="tab" id="version-original-tab" aria-controls="version-original" aria-selected={mode === 'original'} onClick={() => setMode('original')}>原始版本</button></div>
      <div className="version-modal-body history-preview-body">
        {loading ? <div className="version-state" role="status"><RefreshCw size={16} />正在加载版本内容…</div> : error ? <div className="version-state version-error" role="alert">版本加载失败：{error}</div> : mode === 'original' ? <div id="version-original" role="tabpanel" aria-labelledby="version-original-tab"><h3 className="history-original-title">{title}</h3><EditorContent editor={editor} /></div> : <div id="version-changes" role="tabpanel" aria-labelledby="version-changes-tab">
          <div className="history-diff-summary"><b>{changed.length || titleChanged ? `${changed.length} 个内容块有变化${titleChanged ? ' · 标题已变化' : ''}` : '内容与当前文档相同'}</b><p><span className="history-legend-remove">删除</span> 当前内容中将被移除的文字 <span className="history-legend-add">添加</span> 此版本中将被恢复的文字</p><label><input type="checkbox" checked={showUnchanged} onChange={event => setShowUnchanged(event.target.checked)} />显示未变化的内容块</label></div>
          {titleChanged && <section className="history-diff-block history-diff-title"><div className="history-diff-label">文档标题</div><div className="history-diff-text"><ChangedText parts={diffHistoryText(baseline.title || '', title)} /></div></section>}
          {(showUnchanged ? changes : changed).map((block, index) => <section key={index} className={'history-diff-block is-' + block.kind}>
            <div className="history-diff-label"><span>{block.kind === 'added' ? '添加' : block.kind === 'removed' ? '删除' : block.kind === 'same' ? '未变化' : '修改'}</span><b>{block.before?.label !== block.after?.label && block.before && block.after ? `${block.before.label} → ${block.after.label}` : (block.after || block.before)?.label}</b>{block.structureChanged && <small>结构或格式变化</small>}</div>
            <div className={'history-diff-text' + ((block.after || block.before)?.type === 'codeBlock' ? ' is-code' : '')}><ChangedText parts={block.text} />{!block.text.length && <em>空内容块</em>}</div>
            {block.structureChanged && block.before?.text === block.after?.text && <p className="history-structure-note">文字相同，块类型、格式或属性不同。可切换“原始版本”查看完整结构。</p>}
          </section>)}
        </div>}
      </div>
      <footer>{restoreError && <p className="history-restore-error" role="alert">{restoreError}</p>}{confirming ? <><span className="version-confirm">恢复前会先保存当前编辑，当前内容也会保留为可恢复的历史版本。</span><div><button type="button" className="secondary-btn" disabled={locked} onClick={() => setConfirming(false)}>取消</button><button type="button" className="primary-btn" disabled={locked} onClick={() => void restore()}>{locked ? '正在恢复…' : '确认恢复'}</button></div></> : <><span>只读预览 · 比较包含打开预览时尚未保存的编辑</span><div><button type="button" className="secondary-btn" disabled={locked} onClick={close}>关闭</button><button type="button" className="primary-btn" disabled={locked || loading || !!error || !detail?.content} onClick={() => setConfirming(true)}>恢复此版本</button></div></>}</footer>
    </section>
  </div>
}
