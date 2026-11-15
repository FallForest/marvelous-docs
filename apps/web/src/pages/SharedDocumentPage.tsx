import { useEffect, useState } from 'react'
import { loadSharedDocument } from '../lib/shared-document'
import type { SharedDocument } from '../lib/shared-document'
import { renderDocHTML } from '../lib/export/render-html'
import { Sparkles } from 'lucide-react'
import ArtIcon from '../components/ui/ArtIcon'

/** Public, unauthenticated view of a document reached through a share link. */
export default function SharedDocumentPage({ token }: { token: string }) {
  const [result, setResult] = useState<{ token: string; doc: SharedDocument } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setResult(null)
    loadSharedDocument(token, controller.signal)
      .then((doc) => { if (!controller.signal.aborted) setResult({ token, doc }) })
      .catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message || '无法加载文档') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [token, attempt])

  const doc = result?.token === token ? result.doc : null
  const pageTitle = doc ? doc.title + ' · Marvelous Docs' : '共享文档 · Marvelous Docs'
  useEffect(() => {
    const previous = document.title
    document.title = pageTitle
    return () => { document.title = previous }
  }, [pageTitle])

  if (loading || (!error && !doc)) return <div className="shared-page" data-vt-scope="main"><div className="shared-header"><div className="shared-logo"><ArtIcon name="brand-spark" fallback={<Sparkles size={28} />} /></div><h1>Marvelous Docs</h1></div><p className="shared-state" role="status"><span className="login-spinner" aria-hidden="true" />正在加载文档…</p></div>
  if (error || !doc) return <div className="shared-page" data-vt-scope="main"><div className="shared-header"><div className="shared-logo"><ArtIcon name="brand-spark" fallback={<Sparkles size={28} />} /></div><h1>Marvelous Docs</h1></div><div className="shared-content"><p className="shared-state" role="alert">{error || '文档不存在或链接已过期'}</p><button type="button" className="secondary-btn" onClick={() => setAttempt((value) => value + 1)}>重新加载</button></div></div>

  return <div className="shared-page" data-vt-scope="main">
    <div className="shared-header">
      <div className="shared-logo"><ArtIcon name="brand-spark" fallback={<Sparkles size={28} />} /></div>
      <span className="shared-brand">Marvelous Docs</span>
      {/* The public page has no comment box, so it must not promise commenting:
          a "commenter" link still resolves to a read-only render here, and the
          badge says what the page can actually do. */}
      <span className="shared-badge">仅查看</span>
    </div>
    {/* Keyed on the token so a second share link replays the entry instead of
        silently swapping the text in place. */}
    <article className="shared-content motion-enter" key={token}>
      <h1 className="shared-document-title">{doc.title || '未命名文档'}</h1>
      <div dangerouslySetInnerHTML={{ __html: renderDocHTML(doc.content.doc) }} />
    </article>
    <div className="shared-footer">由 Marvelous Docs 分享 · {new Date(doc.updatedAt).toLocaleDateString()}</div>
  </div>
}
