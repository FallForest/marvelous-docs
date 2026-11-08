import { useEffect, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { Clock3, RefreshCw, X } from 'lucide-react'
import { request } from '../lib/api'
import { buildEditorExtensions } from '../lib/editor'
import { formatDate } from '../lib/format'
import { emptyContent } from '../lib/types'
import type { Version } from '../lib/types'

type VersionPreviewProps = {
  token: string
  documentId: string
  version: Version
  onRestore: (versionId: string) => Promise<boolean>
  onClose: () => void
}

export default function VersionPreview({ token, documentId, version, onRestore, onClose }: VersionPreviewProps) {
  const [detail, setDetail] = useState<Version | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    request<{ version: Version }>('/documents/' + documentId + '/versions/' + version.id, token)
      .then((result) => { if (live) setDetail(result.version) })
      .catch((cause) => { if (live) setError((cause as Error).message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [token, documentId, version.id])

  const editor = useEditor({
    extensions: buildEditorExtensions(),
    content: detail?.content?.doc || emptyContent.doc,
    editable: false,
    editorProps: { attributes: { class: 'tiptap-content version-content' } },
  }, [detail?.id])

  async function restore() {
    setBusy(true)
    const restored = await onRestore(version.id)
    setBusy(false)
    if (restored) onClose()
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="version-modal" role="dialog" aria-modal="true" aria-labelledby="version-title">
      <header>
        <div>
          <div className="version-modal-icon"><Clock3 size={17} /></div>
          <h2 id="version-title">版本 {version.version}</h2>
          <p>{detail?.createdByName || version.createdByName || version.createdBy || '成员'} · {formatDate(detail?.createdAt || version.createdAt) || '历史快照'}</p>
        </div>
        <button className="icon-btn" aria-label="关闭版本预览" title="关闭" onClick={onClose}><X size={17} /></button>
      </header>
      <div className="version-modal-body">
        {loading ? <div className="version-state"><RefreshCw size={16} />正在加载版本内容…</div>
          : error ? <div className="version-state version-error">版本加载失败：{error}</div>
            : <EditorContent editor={editor} />}
      </div>
      <footer>
        {confirming ? <>
          <span className="version-confirm">确认恢复到这个版本？当前内容会先保存为新版本。</span>
          <div>
            <button className="secondary-btn" disabled={busy} onClick={() => setConfirming(false)}>取消</button>
            <button className="primary-btn" disabled={busy} onClick={() => void restore()}>{busy ? '正在恢复…' : '确认恢复'}</button>
          </div>
        </> : <>
          <span>只读预览，不会修改文档。</span>
          <div>
            <button className="secondary-btn" onClick={onClose}>关闭</button>
            <button className="primary-btn" disabled={busy || loading || !!error} onClick={() => setConfirming(true)}>恢复此版本</button>
          </div>
        </>}
      </footer>
    </section>
  </div>
}
