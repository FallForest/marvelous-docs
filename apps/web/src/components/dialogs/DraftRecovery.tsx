import { useState } from 'react'
import { getSchema } from '@tiptap/core'
import { Dialog } from '../ui/Dialog'
import { api } from '../../lib/endpoints'
import { clearSavedDraft, draftText, isBlankDraft, readDraft, sameDraftBody } from '../../lib/local-drafts'
import type { Doc } from '../../lib/types'
import { buildEditorExtensions } from '../../lib/editor'

const bodySchema = getSchema(buildEditorExtensions())

/** A short plain-text preview, so the dialog shows what is about to be written. */
function preview(body: Record<string, unknown>, limit = 140): string {
  const text = draftText(body).replace(/\s+/g, ' ').trim()
  if (!text) return '（正文没有文字，但有图片或表格）'
  return text.length > limit ? text.slice(0, limit) + '…' : text
}

/**
 * Offers the local safety copy that the last session left behind.
 *
 * The copy belongs to this document, so writing it back into this document is
 * the restore: the page keeps its title, its place in the tree, its comments and
 * its history. Saving it as a second document is the escape hatch for the one
 * case that needs it - the server copy moved on and the two versions must be
 * compared side by side - so it is an explicit second button, not the default.
 * Promoting it to the default is what produced a stray blank page next to the
 * page the writer was trying to open.
 */
export default function DraftRecovery({ doc, token, userId, onRecovered, notify }: {
  doc: Doc; token: string; userId: string; onRecovered: (doc: Doc) => void; notify: (message: string) => void
}) {
  const [draft] = useState(() => {
    const copy = readDraft(localStorage, doc.id, userId)
    // A copy with nothing in it is not unsaved work. It was written by the
    // editor before the body arrived, and restoring it would blank the page.
    if (copy && isBlankDraft(copy.body)) {
      clearSavedDraft(localStorage, doc.id, userId, copy.body)
      return null
    }
    if (copy && sameDraftBody(copy.body, doc.content?.doc, bodySchema)) {
      clearSavedDraft(localStorage, doc.id, userId, copy.body)
      return null
    }
    return copy
  })
  const [open, setOpen] = useState(Boolean(draft))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'restore' | 'copy' | null>(null)
  if (!open || !draft) return null

  /*
   * A copy older than the document is not automatically the right answer.
   *
   * The safety copy is written on every keystroke and kept until the exact body
   * is acknowledged, so a stale timestamp usually still holds this writer's
   * unsaved words - but the same clock cannot say whether somebody else added
   * something in between. Both routes stay available; the warning is what keeps
   * the choice informed instead of guessed.
   */
  const stale = Boolean(draft.savedAt && doc.updatedAt && Date.parse(draft.savedAt) < Date.parse(doc.updatedAt))

  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1, doc: draft.body }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = (doc.title || '未命名文档') + '-本地草稿.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  /** Writes the copy back into this document, keeping its identity and title. */
  async function restoreHere() {
    setError('')
    setBusy('restore')
    try {
      // Read the current version first: the row may have moved since it was
      // listed, and the write is rejected rather than clobbering a newer edit.
      const { document: latest } = await api.document(token, doc.id)
      /*
       * A name chosen by hand survives the restore; a derived one is re-derived.
       *
       * Sending the title pins it as manual on the server. That is exactly what a
       * hand-named page needs - otherwise recovering an older body would rename
       * the page after the restored first line, which is the "the body became the
       * title" symptom. A page that still follows its own first line gains
       * nothing from being pinned to the name it happened to have before, so it
       * keeps deriving, and the restored body names it as usual.
       */
      const pinTitle = latest.titleMode === 'manual' ? { title: latest.title || doc.title || '未命名文档' } : {}
      const { document: saved } = await api.updateDocument(token, doc.id, {
        ...pinTitle,
        content: { schemaVersion: 1, doc: draft!.body },
        expectedVersion: latest.version,
      })
      clearSavedDraft(localStorage, doc.id, userId, draft!.body)
      setOpen(false)
      onRecovered(saved)
      notify('已把本地草稿写回这篇文档')
    } catch (failure) {
      setError('恢复失败：' + (failure as Error).message + '（草稿仍保留，可重试或另存为新文档）')
    } finally { setBusy(null) }
  }

  /** Saves the copy beside the document, for comparing two versions. */
  async function restoreAsCopy() {
    setError('')
    setBusy('copy')
    try {
      const { document: recovered } = await api.createDocument(token, {
        kind: 'document', title: (doc.title || '未命名文档').slice(0, 110) + '（恢复的草稿）',
        content: { schemaVersion: 1, doc: draft!.body },
      })
      clearSavedDraft(localStorage, doc.id, userId, draft!.body)
      setOpen(false)
      onRecovered(recovered)
      notify('本地草稿已另存为新文档')
    } catch (failure) {
      setError('另存失败：' + (failure as Error).message + '（草稿仍保留）')
    } finally { setBusy(null) }
  }

  return <Dialog
    title="发现未保存的本地草稿"
    description="上次编辑留下了本地副本，正文与云端不同。可以直接写回这篇文档，也可以另存为新文档后对照。"
    confirmLabel={busy === 'restore' ? '恢复中…' : '写回这篇文档'}
    cancelLabel="稍后处理"
    busy={busy !== null}
    onClose={() => setOpen(false)}
    onConfirm={restoreHere}
  >
    <p className="help-note">{draft.savedAt ? '本地副本保存于 ' + new Date(draft.savedAt).toLocaleString('zh-CN') : '这是旧版本保留的本地副本。'}</p>
    <p className="draft-preview" aria-label="本地草稿内容预览">{preview(draft.body)}</p>
    {stale && <p className="dialog-hint">这份副本早于云端最近一次更新，云端可能还有别人的改动。要保留两边，请选择“另存为新文档”。</p>}
    <div className="draft-actions">
      <button type="button" className="secondary-btn" onClick={download} disabled={busy !== null}>下载 JSON 备份</button>
      <button type="button" className="secondary-btn" onClick={() => void restoreAsCopy()} disabled={busy !== null}>
        {busy === 'copy' ? '另存中…' : '另存为新文档'}
      </button>
    </div>
    {error && <p className="dialog-error" role="alert">{error}</p>}
  </Dialog>
}
