import { useEffect, useRef, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { api } from '../../lib/endpoints'
import { discardDraft, draftText, isBlankDraft, readDraft, sameDraftContent } from '../../lib/local-drafts'
import type { Doc } from '../../lib/types'

/** Documents already offered once in this page session, so it cannot nag. */
const offered = new Set<string>()

/** A short plain-text preview, so the dialog shows what it is about to insert. */
function preview(body: Record<string, unknown>, limit = 140): string {
  const text = draftText(body).replace(/\s+/g, ' ').trim()
  if (!text) return '（正文没有文字，但有图片或表格）'
  return text.length > limit ? text.slice(0, limit) + '…' : text
}

/**
 * Offers the local safety copy that a previous session left behind.
 *
 * The bar for asking is deliberately high, because a recovery prompt that fires
 * on ordinary work is worse than no prompt at all: the writer learns to dismiss
 * it, and then dismisses the one that mattered. A copy is only offered when
 *
 *   - it holds something (not the blank body an editor mounts with),
 *   - its words are not already in the cloud copy (so a save that simply had not
 *     been acknowledged yet is not treated as lost work), and
 *   - it has not already been offered in this page session.
 *
 * Restoring puts the copy back into the document that is open, through the
 * editor itself - the same transaction path as typing - so the text appears
 * immediately and is saved by the ordinary autosave instead of racing it.
 */
export default function DraftRecovery({ doc, token, userId, onRestore, onRecovered, notify }: {
  doc: Doc
  token: string
  userId: string
  /** Writes the body into the open editor. Throws when the editor is not ready. */
  onRestore: (body: Record<string, unknown>) => Promise<void>
  /** Receives the document created by "save beside this document". */
  onRecovered: (doc: Doc) => void
  notify: (message: string) => void
}) {
  const [draft, setDraft] = useState<{ body: Record<string, unknown>; savedAt?: string } | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'restore' | 'copy' | null>(null)
  /*
   * One inspection per version of the server copy.
   *
   * The body arrives a moment after the row does, so keying on the document id
   * alone meant judging the first frame - which usually had no body to compare
   * against - and then never looking again. Keying on the version re-runs when a
   * save lands, which is exactly when a copy stops being needed.
   */
  const inspected = useRef('')

  useEffect(() => {
    // Without the server body there is nothing to compare against: wait.
    if (!doc.content) return
    const stamp = doc.id + ':' + doc.version
    if (inspected.current === stamp) return
    inspected.current = stamp

    const copy = readDraft(localStorage, doc.id, userId)
    if (!copy) return
    /*
     * Two reasons a copy is not worth asking about, and both delete it rather
     * than storing a flag: an ask that keeps coming back is the bug this
     * replaces.
     *
     *   - nothing in it (the blank body an editor mounts with), or
     *   - the cloud already holds these words, so it was saved and the copy is
     *     only an unacknowledged acknowledgement away from being deleted.
     */
    if (isBlankDraft(copy.body) || sameDraftContent(doc.content.doc, copy.body)) {
      discardDraft(localStorage, doc.id)
      return
    }
    // Already asked once in this session: dismissing it must stick.
    if (offered.has(doc.id)) return
    offered.add(doc.id)
    setDraft(copy)
    setOpen(true)
  }, [doc.id, doc.version, doc.content, userId])

  if (!open || !draft) return null
  // Narrowed once, because the two actions below capture it in closures.
  const copy = draft

  /*
   * A copy older than the document is not automatically the right answer: the
   * clock cannot say whether somebody else added something since. Both routes
   * stay available; one short line is enough to keep the choice informed.
   */
  const stale = Boolean(copy.savedAt && doc.updatedAt && Date.parse(copy.savedAt) < Date.parse(doc.updatedAt))

  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1, doc: copy.body }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = (doc.title || '未命名文档') + '-本地草稿.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  /**
   * Puts the copy back into the open document through the editor.
   *
   * The copy on disk is deliberately left alone here. It is the same text that
   * just entered the editor, so the save path clears it the moment the body is
   * acknowledged - and if the save fails, it is the only thing standing between
   * the writer and a closed tab. Deleting it at click time would make a failed
   * autosave unrecoverable for no benefit.
   */
  async function restoreHere() {
    setError('')
    setBusy('restore')
    try {
      await onRestore(copy.body)
      setOpen(false)
      notify('本地草稿已写回这篇文档，正在自动保存')
    } catch (failure) {
      setError('写回失败：' + (failure as Error).message)
    } finally { setBusy(null) }
  }

  /** Saves the copy beside the document, for comparing two versions. */
  async function restoreAsCopy() {
    setError('')
    setBusy('copy')
    try {
      const { document: recovered } = await api.createDocument(token, {
        kind: 'document', title: (doc.title || '未命名文档').slice(0, 110) + '（恢复的草稿）',
        content: { schemaVersion: 1, doc: copy.body },
      })
      discardDraft(localStorage, doc.id)
      setOpen(false)
      onRecovered(recovered)
      notify('本地草稿已另存为新文档')
    } catch (failure) {
      setError('另存失败：' + (failure as Error).message)
    } finally { setBusy(null) }
  }

  return <Dialog
    title="发现未保存的本地草稿"
    description="上次编辑留下了这份副本，里面的文字云端还没有。"
    confirmLabel="写回这篇文档"
    cancelLabel="稍后处理"
    busy={busy !== null}
    onClose={() => setOpen(false)}
    onConfirm={restoreHere}
  >
    <div className="draft-card">
      <p className="draft-preview">{preview(copy.body)}</p>
      <p className="draft-meta">
        <span>{copy.savedAt ? '保存于 ' + new Date(copy.savedAt).toLocaleString('zh-CN') : '旧版本留下的副本'}</span>
        <span aria-hidden="true">·</span>
        <button type="button" className="link-btn" onClick={download} disabled={busy !== null}>下载备份</button>
        <span aria-hidden="true">·</span>
        <button type="button" className="link-btn" onClick={() => void restoreAsCopy()} disabled={busy !== null}>
          {busy === 'copy' ? '正在另存…' : '另存为新文档'}
        </button>
      </p>
    </div>
    {stale && <p className="dialog-hint">云端此后有更新，写回会覆盖它。要留住两边，用“另存为新文档”。</p>}
    {error && <p className="dialog-error" role="alert">{error}</p>}
  </Dialog>
}