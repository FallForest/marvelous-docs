import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState, Transaction } from '@tiptap/pm/state'

/**
 * In-place placeholders for images that are still uploading.
 *
 * The upload used to insert the image wherever the caret happened to be when the
 * request finished. Typing during a 20 MB upload, or clicking elsewhere, moved
 * that caret, so the picture landed in a different paragraph from the one the
 * writer dropped it on. The clipboard screenshot case made it worse: the caret is
 * wherever the last keystroke left it.
 *
 * The fix is to reserve the spot *when the gesture happens* and to keep the
 * reservation attached to the text around it:
 *
 *   - the placeholder is a widget decoration, not a node, so it never enters the
 *     document body, the save payload, the collaboration update, the export or
 *     the undo history;
 *   - its position is remapped through every transaction, so text typed above it
 *     pushes it down exactly like real content;
 *   - it can carry a failure state and a retry affordance without a second
 *     piece of UI floating somewhere else.
 *
 * This is the "mapped upload placeholder at the original drop position" gap in
 * docs/PRODUCT-CONTRACTS.md, minus caption/alt editing, which needs editor UI of
 * its own.
 */

export type UploadStatus = 'uploading' | 'error'

export type UploadEntry = {
  id: string
  pos: number
  status: UploadStatus
  /** Shown in the placeholder; the file name is the most useful short label. */
  name: string
  message?: string
}

export type UploadPlaceholderState = { entries: UploadEntry[] }

export const uploadPlaceholderKey = new PluginKey<UploadPlaceholderState>('upload-placeholder')

/** Adds one entry at `pos`, replacing any entry with the same id (a retry). */
export function addUpload(state: EditorState, entry: UploadEntry): Transaction {
  return state.tr.setMeta(uploadPlaceholderKey, { type: 'add', entry })
}

/** Marks an entry failed; the placeholder stays and offers a retry. */
export function failUpload(state: EditorState, id: string, message: string): Transaction {
  return state.tr.setMeta(uploadPlaceholderKey, { type: 'status', id, status: 'error', message })
}

/** The current position of an entry, or null when it is gone. */
export function uploadPosition(state: EditorState, id: string): number | null {
  const entry = uploadPlaceholderKey.getState(state)?.entries.find((item) => item.id === id)
  return entry ? entry.pos : null
}

type Meta =
  | { type: 'add'; entry: UploadEntry }
  | { type: 'status'; id: string; status: UploadStatus; message?: string }
  | { type: 'remove'; id: string }

/**
 * The placeholder surface. `onRetry` is called with the entry id when the
 * writer taps 重试; the component owns the retry because it owns the file and the
 * token.
 */
function placeholderDom(entry: UploadEntry, onRetry: (id: string) => void): HTMLElement {
  const box = document.createElement('span')
  box.className = 'upload-placeholder' + (entry.status === 'error' ? ' is-error' : '')
  box.setAttribute('data-upload-id', entry.id)
  box.setAttribute('contenteditable', 'false')
  box.setAttribute('role', 'status')
  box.setAttribute('aria-live', 'polite')

  const label = document.createElement('span')
  label.className = 'upload-placeholder-label'
  box.appendChild(label)

  if (entry.status === 'error') {
    label.textContent = entry.message || '上传失败'
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.className = 'upload-placeholder-retry'
    retry.textContent = '重试'
    retry.addEventListener('mousedown', (event) => event.preventDefault())
    retry.addEventListener('click', (event) => { event.preventDefault(); onRetry(entry.id) })
    box.appendChild(retry)
  } else {
    label.textContent = entry.name ? '正在上传 ' + entry.name + '…' : '正在上传图片…'
  }
  return box
}

export function uploadPlaceholderPlugin(onRetry: (id: string) => void): Plugin<UploadPlaceholderState> {
  return new Plugin<UploadPlaceholderState>({
    key: uploadPlaceholderKey,
    state: {
      init: () => ({ entries: [] }),
      apply(tr, value) {
        const meta = tr.getMeta(uploadPlaceholderKey) as Meta | undefined
        /*
         * Remap through the transaction's own mapping first.
         *
         * A position stored in a plain variable goes stale the moment anyone
         * types above the placeholder — including a collaborator, whose change
         * arrives as a transaction this plugin also sees. `tr.mapping` is that
         * mapping, so nothing has to be recomputed by hand.
         */
        const entries = value.entries
          .map((entry) => ({ ...entry, pos: tr.mapping.map(entry.pos) }))
          .filter((entry) => entry.pos <= tr.doc.content.size)

        if (!meta) return { entries }
        // `add` is also how a retry re-arms an existing entry, so an id is a
        // single reservation: same id replaces, never duplicates.
        if (meta.type === 'add') return { entries: [...entries.filter((entry) => entry.id !== meta.entry.id), meta.entry] }
        if (meta.type === 'remove') return { entries: entries.filter((entry) => entry.id !== meta.id) }
        return {
          entries: entries.map((entry) => entry.id === meta.id
            ? { ...entry, status: meta.status, message: meta.message }
            : entry),
        }
      },
    },
    props: {
      decorations(state) {
        const entries = uploadPlaceholderKey.getState(state)?.entries ?? []
        if (!entries.length) return DecorationSet.empty
        return DecorationSet.create(state.doc, entries.map((entry) => Decoration.widget(
          Math.min(entry.pos, state.doc.content.size),
          () => placeholderDom(entry, onRetry),
          // `side: 1` keeps the placeholder after text inserted at the same
          // position, and `key` makes ProseMirror update rather than recreate the
          // widget when only its status changed — recreating it would restart
          // its own animations and lose the retry focus.
          { side: 1, key: entry.id + ':' + entry.status },
        )))
      },
    },
  })
}
