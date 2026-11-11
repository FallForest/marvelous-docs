import { useEffect, useState } from 'react'
import { API } from '../lib/api'
import { renderDocHTML } from '../lib/render-html'

/** Public, unauthenticated view of a document reached through a share link. */
export default function SharedDocumentPage({ token }: { token: string }) {
  const [doc, setDoc] = useState<{id: string; title: string; content: Record<string, unknown>; updatedAt: string; permission: string} | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(API + '/api/v1/shared/' + token)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error.message)
        else setDoc(data.document)
      })
      .catch(() => setError('无法加载文档'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <div className="shared-page"><div className="shared-header"><div className="shared-logo">M</div><h1>Marvelous Docs</h1></div><p className="shared-state"><span className="login-spinner" aria-hidden="true" />正在加载文档…</p></div>
  if (error || !doc) return <div className="shared-page"><div className="shared-header"><div className="shared-logo">M</div><h1>Marvelous Docs</h1></div><div className="shared-content"><p className="shared-state">{error || '文档不存在或链接已过期'}</p></div></div>

  const content = doc.content as { doc?: { type: string; content?: unknown[] } }
  return <div className="shared-page">
    <div className="shared-header">
      <div className="shared-logo">M</div>
      <h1>Marvelous Docs</h1>
      <span className="shared-badge">{doc.permission === 'commenter' ? '可评论' : '仅查看'}</span>
    </div>
    {/* Keyed on the token so a second share link replays the entry instead of
        silently swapping the text in place. */}
    <div className="shared-content motion-enter" key={token} dangerouslySetInnerHTML={{ __html: renderDocHTML(content.doc) }} />
    <div className="shared-footer">由 Marvelous Docs 分享 · {new Date(doc.updatedAt).toLocaleDateString()}</div>
  </div>
}
