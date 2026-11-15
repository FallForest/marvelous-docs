import { useState } from 'react'
import { getSchema } from '@tiptap/core'
import { Dialog } from '../ui/Dialog'
import { api } from '../../lib/endpoints'
import { clearSavedDraft, readDraft, sameDraftBody } from '../../lib/local-drafts'
import type { Doc } from '../../lib/types'
import { buildEditorExtensions } from '../../lib/editor'

const bodySchema = getSchema(buildEditorExtensions())

/** Recover into a new document so newer work by collaborators stays intact. */
export default function DraftRecovery({ doc, token, userId, onRecovered, notify }: {
  doc: Doc; token: string; userId: string; onRecovered: (doc: Doc) => void; notify: (message: string) => void
}) {
  const [draft] = useState(() => {
    const copy = readDraft(localStorage, doc.id, userId)
    if (copy && sameDraftBody(copy.body, doc.content?.doc, bodySchema)) {
      clearSavedDraft(localStorage, doc.id, userId, copy.body)
      return null
    }
    return copy
  })
  const [open, setOpen] = useState(Boolean(draft))
  const [error, setError] = useState('')
  if (!open || !draft) return null

  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1, doc: draft.body }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = (doc.title || '未命名文档') + '-本地草稿.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <Dialog title="发现未保存的本地草稿" description="上次编辑留下了本地副本。可以恢复为新文档，与当前云端内容对照；关闭后草稿仍会保留。" confirmLabel="恢复为新文档" cancelLabel="稍后处理" onClose={() => setOpen(false)} onConfirm={async () => {
    setError('')
    try {
      const { document: recovered } = await api.createDocument(token, {
        kind: 'document', title: (doc.title || '未命名文档').slice(0, 110) + '（恢复的草稿）',
        content: { schemaVersion: 1, doc: draft.body },
      })
      clearSavedDraft(localStorage, doc.id, userId, draft.body)
      setOpen(false)
      onRecovered(recovered)
      notify('本地草稿已恢复为新文档')
    } catch (failure) { setError('恢复失败：' + (failure as Error).message) }
  }}>
    <p className="help-note">{draft.savedAt ? '本地副本保存于 ' + new Date(draft.savedAt).toLocaleString('zh-CN') : '这是旧版本保留的本地副本。'}</p>
    <button type="button" className="secondary-btn" onClick={download}>下载草稿备份</button>
    {error && <p className="dialog-error" role="alert">{error}</p>}
  </Dialog>
}
