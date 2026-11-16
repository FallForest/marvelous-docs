import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { EditorContent, ReactNodeViewRenderer, useEditor } from '@tiptap/react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror'
import { closeHistory } from '@tiptap/pm/history'
import type { Transaction } from '@tiptap/pm/state'
import { Check, FileText } from 'lucide-react'
import EditorToolbar from './EditorToolbar'
import BubbleToolbar from './BubbleToolbar'
import { FindReplace, OutlinePanel } from './FindReplace'
import SlashMenu, { SLASH_ITEMS } from './SlashMenu'
import TableMenu from './TableMenu'
import { Dialog } from '../ui/Dialog'
import ArtIcon from '../ui/ArtIcon'
import DocumentCreatedTime from '../ui/DocumentCreatedTime'
import { API, request } from '../../lib/api'
import { api } from '../../lib/endpoints'
import { COLLAB_URL } from '../../lib/collab'
import { visualViewportRect } from '../../lib/viewport'
import { buildEditorExtensions } from '../../lib/editor'
import { captureCommentAnchor, commentLocation, commentLocations, commentMarksKey } from '../../lib/editor/comment-marks'
import { useBlockGeometry } from '../../hooks/useBlockGeometry'
import { wordCount, formatDate } from '../../lib/format'
import CodeBlockView from './CodeBlockView'
import ImageToolbar from './ImageToolbar'
import BlockHandle from './BlockHandle'
import { useBlockAnchor } from '../../hooks/useBlockAnchor'
import { emptyContent } from '../../lib/types'
import { clearSavedDraft, isBlankDraft, sameDraftContent, writeDraft } from '../../lib/local-drafts'
import { startLinkEdit, mapLinkEdit, linkEditTransaction } from '../../lib/editor/link-editing'
import type { LinkEditSession, LinkPrompt } from '../../lib/editor/link-editing'
import { compositionGuard } from '../../lib/editor/ime'
import { activeTable, selectedImage } from '../../lib/editor/selection-target'
import { addUpload, failUpload, uploadPlaceholderKey, uploadPosition } from '../../lib/editor/upload-placeholder'
import type { CollabStatus } from '../../lib/app-types'
import type { Comment, CommentAnchor, CommentAnchorLocation, Doc, DocJson, SaveStatus, User } from '../../lib/types'

export type DocumentEditorHandle = {
  snapshot: () => { documentId: string; content: DocJson; title: string; stateVector?: string }
  flushTitle: () => Promise<void>
  setLocked: (locked: boolean) => void
  commentDraftAnchor: () => CommentAnchor | null
  /** Replaces the body through the editor, so the change is visible and saved. */
  restoreBody: (body: Record<string, unknown>) => Promise<void>
}

type DocumentEditorProps = {
  doc: Doc
  token: string
  persist: (json: Record<string, unknown>, immediate?: boolean) => void
  user: User
  saveStatus: SaveStatus
  onSaveStatus: (status: SaveStatus) => void
  onAwareness: (users: Array<{ clientId: number; name: string; color: string }>) => void
  onCollabStatus: (status: CollabStatus) => void
  onSelection: (anchor: CommentAnchor) => void
  onCommentLocations?: (locations: Record<string, CommentAnchorLocation>) => void
  onLink: (range: LinkPrompt) => void
  /** Threads on this document, so the text they are about is marked in place. */
  comments: Comment[]
  /** The thread open in the side panel, tinted in the text while it is open. */
  activeCommentId: string | null
  /** The range the composer is quoting, marked while the panel is open. */
  commentDraft: { from: number; to: number } | null
}

/**
 * Word count from the incrementally maintained storage, not from the document.
 *
 * `@tiptap/extension-character-count` recomputes on each transaction and keeps the
 * total in `editor.storage`, so reading it costs nothing. `getText()` walks the
 * whole document and allocates the full text just to count it - measurable on a
 * long document, and paid on every debounce tick while typing. The fallback keeps
 * the footer honest if the extension is ever removed from the schema.
 */
function countWords(editor: Editor): number {
  const stored = (editor.storage as { characterCount?: { words?: () => number } }).characterCount
  if (stored && typeof stored.words === 'function') return stored.words()
  return wordCount(editor.getText())
}
const DocumentEditor = forwardRef<DocumentEditorHandle, DocumentEditorProps>(function DocumentEditor({ doc, token, persist, user, saveStatus, onSaveStatus, onAwareness, onCollabStatus, onSelection, onCommentLocations, onLink, comments, activeCommentId, commentDraft }: DocumentEditorProps, ref) {
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null)
  const [provider, setProvider] = useState<WebsocketProvider | null>(null)
  const [title, setTitle] = useState(doc.title)
  const [titleSaving, setTitleSaving] = useState(false)
  const [words, setWords] = useState(0)
  const [imagePrompt, setImagePrompt] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [bubbleAnchor, setBubbleAnchor] = useState<{ left: number; top: number } | null>(null)
  const [slash, setSlash] = useState<{ left: number; top: number; query: string; range: { from: number; to: number } } | null>(null)
  const statusTimer = useRef<number | undefined>(undefined)
  const wordTimer = useRef<number | undefined>(undefined)
  const currentDocument = useRef(doc)
  currentDocument.current = doc
  const titleEditing = useRef(false)
  const titleDirty = useRef(false)
  const titleWritePending = useRef(false)
  const titleOrigin = useRef<Pick<Doc, 'title' | 'titleMode'>>(doc)
  const live = useRef(true)
  const restoreLock = useRef(false)
  const localDirty = useRef(false)
  const [locked, setLocked] = useState(false)
  const titleRequest = useRef<Promise<Doc | null> | null>(null)
  const linkSession = useRef<LinkEditSession | null>(null)
  const linkSequence = useRef(0)
  const confirmation = useRef(0)
  /** When the current wait for a sync began; 0 while there is nothing to wait for. */
  const waitingSince = useRef(0)
  /** True once this wait has been reported, so the notice appears once. */
  const reportedWait = useRef(false)
  const confirmSave = useRef<() => Promise<void>>(async () => {})
  /** One tracker for the title field, so its Enter/Escape share the guard. */
  const titleIme = useRef(compositionGuard())

  useEffect(() => {
    if (!titleEditing.current && !titleWritePending.current) setTitle(doc.title)
  }, [doc.id, doc.title, doc.version])

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      window.clearTimeout(statusTimer.current)
      window.clearTimeout(wordTimer.current)
    }
  }, [])

  // The provider owns a live socket, so it must be created inside an effect.
  // Memoising it would reuse a destroyed provider after React StrictMode's
  // development remount and leave the room stuck in "connecting".
  useEffect(() => {
    if (!COLLAB_URL) { onCollabStatus('disconnected'); setYdoc(null); setProvider(null); return }
    const document = new Y.Doc()
    const connection = new WebsocketProvider(COLLAB_URL, doc.id, document, { params: { token } })
    setYdoc(document)
    setProvider(connection)
    return () => {
      onAwareness([])
      connection.destroy()
      document.destroy()
      setProvider((current) => current === connection ? null : current)
      setYdoc((current) => current === document ? null : current)
    }
  }, [doc.id, token, onAwareness, onCollabStatus])

  useEffect(() => {
    if (!provider) return
    const color = ['#4677c8', '#b15c9b', '#4b8b6b', '#c17a3c'][Math.abs(user.id.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0)) % 4]
    provider.awareness.setLocalStateField('user', { name: user.name || user.email.split('@')[0], color })
    const publish = () => {
      const people: Array<{ clientId: number; name: string; color: string }> = []
      provider.awareness.getStates().forEach((state, clientId) => {
        const person = state.user as { name?: string; color?: string } | undefined
        if (clientId !== provider.awareness.clientID && person?.name) people.push({ clientId, name: person.name, color: person.color || '#64748b' })
      })
      onAwareness(people)
    }
    const status = (event: { status: string }) => onCollabStatus(event.status === 'connected' ? 'connected' : event.status === 'connecting' ? 'connecting' : 'disconnected')
    provider.on('status', status)
    provider.awareness.on('change', publish)
    publish()
    return () => {
      provider.off('status', status)
      provider.awareness.off('change', publish)
    }
  }, [provider, user.id, user.name, user.email, onAwareness, onCollabStatus])

  useEffect(() => {
    const preserveSelection = (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest('.toolbar-format')) event.preventDefault()
    }
    document.addEventListener('mousedown', preserveSelection)
    return () => document.removeEventListener('mousedown', preserveSelection)
  }, [])



  /**
   * Confirms the edit actually reached the database.
   *
   * A version can advance because somebody else saved. Confirm the current
   * body after the room flushes, and keep the safety copy until it matches.
   */
  async function confirmPersisted() {
    const attempt = ++confirmation.current
    try {
      if (!live.current || restoreLock.current || !localDirty.current) return
      if (!provider?.wsconnected || !provider.synced) {
        /*
         * A socket that never syncs must not spin the footer for ever.
         *
         * The check used to retry every 1.2 s with no deadline, so a collaboration
         * connection that could not be established left 正在保存… on screen
         * indefinitely - the one status that tells a writer nothing about whether
         * their words are safe. After roughly fifteen seconds the status says the
         * truth instead: not confirmed yet, and the copy is on disk. The retry
         * continues, so a connection that comes back still clears it.
         */
        waitingSince.current ||= Date.now()
        if (!reportedWait.current && Date.now() - waitingSince.current > 15000) {
          // Said once per episode. Repeating it every fifteen seconds turned a
          // status the reader had already understood into a recurring alarm.
          reportedWait.current = true
          onSaveStatus('error')
          window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '实时协作连接尚未建立，内容已保留在本地副本中。连接恢复后会自动保存。' }))
        }
        window.clearTimeout(statusTimer.current)
        statusTimer.current = window.setTimeout(() => { void confirmPersisted() }, 1200)
        return
      }
      waitingSince.current = 0
      reportedWait.current = false
      const { document: latest } = await api.document(token, doc.id)
      if (!live.current || restoreLock.current || attempt !== confirmation.current) return
      /*
       * "Saved" means the cloud holds these words, which is not the same claim as
       * "these two JSON trees are byte-identical". The strict comparison almost
       * never held - attribute defaults and key order differ after one round trip
       * through PostgreSQL - so this loop kept re-checking and the footer could sit
       * on 正在保存… long after the text had landed. `sameDraftContent` answers the
       * question the writer is actually asking.
       */
      if (provider.wsconnected && provider.synced && editor && sameDraftContent(latest.content?.doc, editor.getJSON(), editor.schema)) {
        clearSavedDraft(localStorage, doc.id, user.id, editor.getJSON())
        localDirty.current = false
        onSaveStatus('saved')
        return
      }
      // The room has not flushed yet; keep waiting rather than lying.
      window.clearTimeout(statusTimer.current)
      statusTimer.current = window.setTimeout(() => { void confirmPersisted() }, 1200)
    } catch (error) {
      if (!live.current || !localDirty.current || attempt !== confirmation.current) return
      onSaveStatus('error')
      window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '保存遇到问题，请保留此页面并重试：' + (error as Error).message }))
      window.clearTimeout(statusTimer.current)
      statusTimer.current = window.setTimeout(() => { void confirmPersisted() }, 5000)
    }
  }
  confirmSave.current = confirmPersisted

  const editor = useEditor({
    extensions: buildEditorExtensions({ ydoc: provider ? ydoc : null, placeholder: '从这里开始写作…', codeBlockNodeView: ReactNodeViewRenderer(CodeBlockView), onRetryUpload: (id) => retryUploadRef.current(id) }),
    content: doc.content?.doc || emptyContent.doc,
    autofocus: doc.titleMode === 'auto' && doc.title === '未命名文档' && doc.version === 1 ? 'start' : false,
    onUpdate: ({ editor: instance, transaction }) => {
      if (restoreLock.current) return
      /*
       * The footer needs a word count that is roughly current, not exact. Counting
       * the whole document on every keystroke was O(n) per character typed; the
       * character-count extension already maintains the number incrementally, so
       * reading it is O(1). The debounce stays: the footer is not worth a re-render
       * per keystroke either way.
       */
      window.clearTimeout(wordTimer.current)
      wordTimer.current = window.setTimeout(() => setWords(countWords(instance)), 300)
      if (provider) {
        // Initial sync and other people's changes are not our unsaved draft.
        // A merge while our own edit is pending does belong in its safety copy.
        const remote = transaction.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean; isUndoRedoOperation?: boolean } | undefined
        if (remote?.isChangeOrigin && !remote.isUndoRedoOperation && !localDirty.current) return
        /*
         * An empty body before the first sync is not unsaved work.
         *
         * The editor mounts with a blank document and the room fills it in a
         * moment later; a transaction in that window writes "nothing" into the
         * safety copy, and offering it back later replaced a real page with a
         * blank one. Once the room has synced, an empty body is a genuine one -
         * somebody selected all and deleted it - so only the pre-sync window is
         * filtered. Typing offline is never blank, so it is still kept.
         */
        const body = instance.getJSON()
        if (!provider.synced && isBlankDraft(body)) return
        localDirty.current = true
        if (!writeDraft(localStorage, doc.id, user.id, body)) {
          window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '浏览器无法保存本地草稿，请保持页面打开直到云端保存完成。' }))
        }
        onSaveStatus('saving')
        window.clearTimeout(statusTimer.current)
        statusTimer.current = window.setTimeout(() => { void confirmPersisted() }, 1000)
      } else {
        persist(instance.getJSON())
      }
    },
    onCreate: ({ editor: instance }) => setWords(countWords(instance)),
    onBlur: () => setBubbleAnchor(null),
    onSelectionUpdate: ({ editor: instance }) => {
      const { from, to } = instance.state.selection
      const isNodeSelection = instance.state.selection.constructor.name === 'NodeSelection'
      /*
       * Any non-empty text range gets the bubble, including a range that spans
       * paragraphs.
       *
       * The old test also compared the two ends' parent nodes, so a sentence
       * selected across a line break — the most common way to quote something in
       * prose — hid the only pointer-accessible way to bold it, link it or
       * comment on it. The single-block restriction was a leftover from
       * positioning the bar off one line's coordinates; the geometry below works
       * from the selection's two ends, which is correct for both cases.
       */
      if (to > from && !isNodeSelection) {
        onSelection(captureCommentAnchor(instance.state, { from, to }))
        const start = instance.view.coordsAtPos(from)
        const end = instance.view.coordsAtPos(to)
        /*
         * A multi-line range reports the first line's top and the last line's
         * bottom. Anchoring to the top of the *first* line keeps the bar out of
         * the selected text; anchoring to the last line would cover the words the
         * writer just selected.
         */
        const view = visualViewportRect()
        const top = Math.min(start.top, end.top) - 52
        setBubbleAnchor({
          left: Math.max(12, Math.min(view.left + view.width - 312, (start.left + end.left) / 2 - 150)),
          top: Math.max(view.top + 8, top),
        })
      } else {
        setBubbleAnchor(null)
      }
    },
    editorProps: {
      attributes: { class: 'tiptap-content' },
      // Paste and drop both route through insertImageFile. Returning false hands
      // the event back to ProseMirror, which is what keeps ordinary text paste
      // and ProseMirror's own drop handling working.
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || [])
        if (!files.length) return false
        // Never preventDefault synchronously: the upload is async, but claiming
        // the event is not, and a false claim would swallow a text paste whose
        // clipboard also carries a stale image.
        void (async () => {
          for (const file of files) await insertImageFile(file)
        })()
        return files.some((file) => file.type.startsWith('image/'))
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files || [])
        if (!files.length) return false
        void (async () => {
          for (const file of files) await insertImageFile(file)
        })()
        return files.some((file) => file.type.startsWith('image/'))
      },
    },
  }, [doc.id, provider])

  // Geometry for floating table/image controls. Code chrome is an inline
  // node view and scrolls inside the paper without viewport overlays.
  const blocks = useBlockGeometry(editor)
  /*
   * Which table/image the floating bars belong to.
   *
   * These used to be `blocks.find(...)` — the first table or first image in the
   * viewport. With two on screen the bar sat beside one and its buttons acted on
   * the other, which is the worst class of bug in an editor: the wrong content
   * changes. The target now comes from the selection (lib/editor/selection-target)
   * and is only matched to measured geometry for placement, so the bar is absent
   * rather than guessing when the object is not selected.
   */
  const [objectTargets, setObjectTargets] = useState<{ table: number | null; image: number | null }>({ table: null, image: null })
  useEffect(() => {
    if (!editor) { setObjectTargets({ table: null, image: null }); return }
    const sync = () => {
      const image = selectedImage(editor.state)
      const table = activeTable(editor.state)
      setObjectTargets((current) => current.table === (table?.pos ?? null) && current.image === (image?.pos ?? null)
        ? current
        : { table: table?.pos ?? null, image: image?.pos ?? null })
    }
    sync()
    editor.on('selectionUpdate', sync)
    // A collaborator can delete the object under the bar; the tool must go with it.
    editor.on('transaction', sync)
    return () => { editor.off('selectionUpdate', sync); editor.off('transaction', sync) }
  }, [editor])
  const tableGeometry = objectTargets.table === null ? null : blocks.find((block) => block.kind === 'table' && block.pos === objectTargets.table) ?? null
  const imageGeometry = objectTargets.image === null ? null : blocks.find((block) => block.kind === 'image' && block.pos === objectTargets.image) ?? null
  // The gutter handle follows the pointer; it is pinned while its menu or a
  // drag is open so the target cannot change under the user mid-gesture.
  const blockAnchor = useBlockAnchor(editor)


  /*
   * Push the thread list into the editor whenever it changes.
   *
   * The markers are view-only decorations, so this is the only wiring they
   * need: the server stays the source of truth, and a thread that is resolved,
   * deleted or fetched after a reload re-tints the text without any of it
   * reaching the document body. `activeCommentId` rides along so opening a
   * thread in the panel lights up the exact sentence it is about.
   */
  useEffect(() => {
    if (!editor) return
    editor.commands.setCommentMarks(comments, activeCommentId)
  }, [editor, comments, activeCommentId])

  useEffect(() => {
    if (!editor) return
    editor.commands.setCommentDraft(commentDraft)
  }, [editor, commentDraft])

  useEffect(() => {
    if (!editor || !onCommentLocations) return
    let previous = ''
    const publish = () => {
      const locations = commentLocations(editor.state)
      const encoded = JSON.stringify(locations)
      if (encoded !== previous) { previous = encoded; onCommentLocations(locations) }
    }
    publish()
    editor.on('transaction', publish)
    return () => { editor.off('transaction', publish) }
  }, [editor, onCommentLocations])

  // Reveal the quoted text when a comment anchor is clicked in the side panel.
  useEffect(() => {
    const reveal = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id
      if (!id || !editor) return
      const location = commentLocation(editor.state, id)
      if (location?.status !== 'attached' || location.from === undefined || location.to === undefined) return
      editor.chain().focus().setTextSelection({ from: location.from, to: location.to }).scrollIntoView().run()
    }
    window.addEventListener('mdoc-focus-anchor', reveal)
    return () => window.removeEventListener('mdoc-focus-anchor', reveal)
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const update = () => {
      const { $from } = editor.state.selection
      // Never trigger inside code blocks: file paths such as /usr/local/bin/xray
      // are ordinary text there, not a command.
      if ($from.parent.type.name === 'codeBlock') { setSlash(null); return }
      /*
       * List items and quotes host the command too. They were excluded because the
       * handler used to look at `$from.parent`, but the parent of a caret in a list
       * item is the list item - so the one place a writer most wants to add a block
       * (continuing a list with a table, say) was the one place it did not work.
       */
      const hosts = ['paragraph', 'heading', 'listItem', 'taskItem', 'blockquote']
      if (!hosts.includes($from.parent.type.name)) { setSlash(null); return }
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
      /*
       * A trigger after any break, not only after ASCII whitespace. Chinese prose
       * rarely has a space before a slash: it follows `，`, `。` or `：` directly, so
       * `/(^|\s)\//` made the command nearly unusable in the language this product
       * is written in.
       */
      const match = /(^|[\s，。！？、；：）」』】》])\/([^\s/]*)$/.exec(textBefore)
      if (!match) { setSlash(null); return }
      const query = match[2] || ''
      // Hide the menu when nothing matches so it cannot cover the document.
      const needle = query.trim().toLowerCase()
      const hasMatch = SLASH_ITEMS.some((item) => !needle
        || item.label.includes(needle)
        || item.hint.includes(needle)
        || item.keywords.some((word) => word.startsWith(needle)))
      if (!hasMatch) { setSlash(null); return }
      const coords = editor.view.coordsAtPos($from.pos)
      // Same reason as the bubble menu: a slash menu under the keyboard is a slash
      // menu the writer cannot see.
      const view = visualViewportRect()
      setSlash({
        left: Math.max(12, Math.min(view.left + view.width - 280, coords.left)),
        top: Math.min(view.top + view.height - 60, coords.bottom + 6),
        query,
        range: { from: $from.pos - query.length - 1, to: $from.pos },
      })
    }
    editor.on('update', update)
    editor.on('selectionUpdate', update)
    return () => { editor.off('update', update); editor.off('selectionUpdate', update) }
  }, [editor])

  const rangeSelection = useCallback(() => {
    if (!editor || !editor.isEditable || restoreLock.current) return
    const session = startLinkEdit(editor.state, doc.id, doc.id + ':' + (++linkSequence.current))
    linkSession.current = session
    onLink(session.prompt)
  }, [editor, doc.id, onLink])

  useEffect(() => {
    if (!editor) return
    const map = ({ transaction }: { transaction: Transaction }) => {
      if (linkSession.current) linkSession.current = mapLinkEdit(linkSession.current, transaction)
    }
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<LinkPrompt & { nextHref: string | null }>).detail
      if (!detail || detail.documentId !== doc.id) return
      const session = linkSession.current
      if (!session || session.prompt.requestId !== detail.requestId || restoreLock.current || !editor.isEditable) return
      const tr = linkEditTransaction(editor.state, session, detail.nextHref)
      linkSession.current = null
      if (!tr) {
        window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '原来的文字已被删除或替换，请重新选择后再设置链接。' }))
        return
      }
      const undoManager = yUndoPluginKey.getState(editor.state)?.undoManager
      undoManager?.stopCapturing()
      editor.view.dispatch(closeHistory(tr))
      editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false))
      undoManager?.stopCapturing()
      editor.view.focus()
    }
    const cancel = (event: Event) => {
      const prompt = (event as CustomEvent<LinkPrompt | null>).detail
      if (!prompt || prompt.requestId === linkSession.current?.prompt.requestId) linkSession.current = null
    }
    editor.on('transaction', map)
    window.addEventListener('mdoc-insert-link', handler)
    window.addEventListener('mdoc-cancel-link', cancel)
    return () => {
      linkSession.current = null
      editor.off('transaction', map)
      window.removeEventListener('mdoc-insert-link', handler)
      window.removeEventListener('mdoc-cancel-link', cancel)
    }
  }, [editor, doc.id])

  /*
   * `Ctrl+K` with text selected asks for a link, by way of the shell.
   *
   * The shell owns the keyboard map and the editor owns the selection, so the key
   * crosses the boundary as an event rather than as a prop. The range is read here,
   * where it is authoritative, and the link prompt is opened through the same
   * `onLink` the toolbar uses — one prompt, two ways in.
   */
  useEffect(() => {
    if (!editor) return
    const openLink = () => {
      rangeSelection()
    }
    window.addEventListener('mdoc-link-selection', openLink)
    return () => window.removeEventListener('mdoc-link-selection', openLink)
  }, [editor, rangeSelection])

  useEffect(() => {
    const handler = () => {
      if (restoreLock.current) return
      if (provider) {
        onSaveStatus('saving')
        if (localDirty.current) void confirmSave.current()
        else onSaveStatus('saved')
        return
      }
      if (editor) persist(editor.getJSON(), true)
    }
    window.addEventListener('mdoc-force-save', handler)
    return () => window.removeEventListener('mdoc-force-save', handler)
  }, [provider, editor, doc.id, token, persist, onSaveStatus])

  function commentSelection() {
    const selection = editor?.state.selection
    if (selection && selection.to > selection.from) onSelection(captureCommentAnchor(editor!.state, selection))
  }

  /** 20 MiB, matching MAX_UPLOAD_BYTES on the server and nginx's proxy limit. */
  const MAX_IMAGE_BYTES = 20 * 1024 * 1024

  /** PUTs one image and returns the URL it is served from, or throws. */
  async function putImage(file: File): Promise<string> {
    const response = await fetch(API + '/api/v1/uploads', {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': file.name, Authorization: 'Bearer ' + token },
      body: file,
    })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error?.message || '上传失败')
    return API + body.file.url
  }

  async function uploadImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_IMAGE_BYTES) { window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '图片不能超过 20 MB' })); return }
    try {
      setImageUrl(await putImage(file))
    } catch (error) {
      window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '图片上传失败：' + (error as Error).message }))
    }
  }

  /**
   * Uploads an image dropped or pasted into the editor and inserts it.
   *
   * Returns false for anything that is not an image, so the caller can let ProseMirror
   * handle the event itself — a pasted paragraph of text, a copied spreadsheet cell,
   * a PDF dragged in from the desktop: all of those have their own correct
   * behaviour and none of them is this function's business.
   *
   * Why it exists at all: before this, pasting a screenshot did nothing. The
   * clipboard carries an image as a File with no name, and the editor had no
   * handler, so the browser pasted whatever text alternative the source offered
   * (usually nothing) and the image was silently dropped.
   */
  async function insertImageFile(file: File): Promise<boolean> {
    if (!file.type.startsWith('image/')) return false
    if (file.size > MAX_IMAGE_BYTES) {
      window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '图片不能超过 20 MB' }))
      return true
    }
    /*
     * Reserve the spot now, at the position the gesture happened.
     *
     * The image used to be inserted where the caret was *when the upload
     * finished*: typing during a slow upload, or clicking into another paragraph
     * to keep working, moved the picture somewhere the writer never dropped it.
     * The reservation is a decoration (lib/editor/upload-placeholder), so it is
     * remapped through every later edit and never reaches the saved body.
     */
    const instance = editor
    const id = 'upload-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    const at = instance ? instance.state.selection.from : null
    if (instance && at !== null) {
      instance.view.dispatch(addUpload(instance.state, {
        id,
        pos: at,
        status: 'uploading',
        name: file.name && file.name !== 'image.png' ? file.name.slice(0, 40) : '',
      }))
    }
    uploads.current.set(id, file)
    await runUpload(id, file)
    return true
  }

  /** Files waiting on a retry, keyed by placeholder id. */
  const uploads = useRef(new Map<string, File>())

  /**
   * Uploads one reserved image and settles its placeholder.
   *
   * Focus is deliberately left alone: the writer may be typing two paragraphs
   * away, and `focus()` here would move the caret mid-word. The image is dropped
   * at the mapped position instead, and the transaction does not arrive through
   * `setImage` on the current selection.
   */
  async function runUpload(id: string, file: File) {
    try {
      const named = file.name && file.name !== 'image.png'
        ? file
        : new File([file], 'pasted-' + Date.now() + '.' + (file.type.split('/')[1] || 'png'), { type: file.type })
      const url = await putImage(named)
      const instance = editor
      if (!instance || instance.isDestroyed) return
      const pos = uploadPosition(instance.state, id)
      const tr = instance.state.tr
      if (pos === null) {
        // The document was switched or the reservation was removed: the upload
        // still succeeded, so do not lose the file silently.
        window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '图片已上传，但文档已切换，请重新插入。链接：' + url }))
        return
      }
      tr.setMeta(uploadPlaceholderKey, { type: 'remove', id })
      tr.insert(pos, instance.schema.nodes.image.create({ src: url }))
      instance.view.dispatch(tr.scrollIntoView())
      uploads.current.delete(id)
    } catch (error) {
      const instance = editor
      if (instance && !instance.isDestroyed && uploadPosition(instance.state, id) !== null) {
        instance.view.dispatch(failUpload(instance.state, id, '上传失败：' + (error as Error).message))
      } else {
        window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '图片上传失败：' + (error as Error).message }))
      }
    }
  }

  /** Retry handler handed to the decoration plugin. */
  const retryUpload = useCallback((id: string) => {
    const file = uploads.current.get(id)
    if (!file || !editor) return
    editor.view.dispatch(addUpload(editor.state, { id, pos: editor.state.selection.from, status: 'uploading', name: file.name || '' }))
    // Via the ref: `runUpload` closes over the editor created by `useEditor`,
    // which is declared before it. Listing it as a dependency would make the
    // callback unstable on every render for no benefit, and the ref always
    // points at the current definition.
    void runUploadRef.current(id, file)
  }, [editor])
  const runUploadRef = useRef<(id: string, file: File) => Promise<void>>(async () => undefined)
  runUploadRef.current = runUpload
  /*
   * The plugin is created inside `useEditor`, which must not depend on this
   * callback (it would rebuild the editor and drop the document). A ref carries
   * the live handler to the widget instead, so a retry button always calls the
   * current one.
   */
  const retryUploadRef = useRef(retryUpload)
  retryUploadRef.current = retryUpload

  function saveTitle(next: string) {
    const pending = writeTitle(next)
    titleRequest.current = pending
    return pending
  }

  async function writeTitle(next: string): Promise<Doc | null> {
    const clean = next.trim()
    titleDirty.current = false
    if (!clean) { setTitle(currentDocument.current.title); return currentDocument.current }
    const origin = titleOrigin.current
    titleWritePending.current = true
    setTitleSaving(true)
    setTitle(clean)
    try {
      // Content autosaves may advance the version, but a different manual
      // rename must be shown to the user rather than overwritten on a retry.
      for (let attempt = 0; attempt < 2; attempt++) {
        const latest = await request<{ document: Doc }>('/documents/' + doc.id, token)
        if (latest.document.titleMode !== 'auto' && (latest.document.title !== origin.title || origin.titleMode === 'auto')) {
          window.dispatchEvent(new CustomEvent('mdoc-updated', { detail: latest.document }))
          throw new Error('标题已在其他地方修改，请确认新名称后重试。')
        }
        try {
          const result = await request<{ document: Doc }>('/documents/' + doc.id, token, { method: 'PUT', body: JSON.stringify({ title: clean, expectedVersion: latest.document.version }) })
          if (live.current) setTitle(result.document.title)
          window.dispatchEvent(new CustomEvent('mdoc-updated', { detail: result.document }))
          return result.document
        } catch (error) {
          if ((error as { status?: number }).status !== 409 || attempt > 0) throw error
        }
      }
    } catch (error) {
      if (live.current) setTitle(currentDocument.current.title)
      window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '标题保存失败：' + (error as Error).message }))
      return null
    } finally {
      titleWritePending.current = false
      if (live.current) setTitleSaving(false)
    }
    return null
  }

  useImperativeHandle(ref, () => ({
    commentDraftAnchor: () => {
      if (!editor) return null
      const draft = commentMarksKey.getState(editor.state)?.draft
      return draft ? captureCommentAnchor(editor.state, draft) : null
    },
    snapshot: () => {
      if (!editor) throw new Error('编辑器正在加载，请稍后重试。')
      const vector = provider && ydoc ? Y.encodeStateVector(ydoc) : undefined
      return {
        documentId: doc.id,
        content: { schemaVersion: 1, doc: editor.getJSON() },
        title: titleDirty.current || titleWritePending.current ? title : currentDocument.current.title,
        stateVector: vector ? btoa(Array.from(vector, (byte) => String.fromCharCode(byte)).join('')) : undefined,
      }
    },
    flushTitle: async () => {
      if (COLLAB_URL && (!provider || !provider.wsconnected || !provider.synced || !ydoc)) throw new Error('等待实时协作同步完成后再恢复。')
      if (titleRequest.current && !await titleRequest.current) throw new Error('标题尚未保存成功，请先处理后再恢复。')
      if (titleDirty.current && !await saveTitle(title)) throw new Error('标题尚未保存成功，请先处理后再恢复。')
    },
    setLocked: (value) => {
      restoreLock.current = value
      setLocked(value)
      if (editor && !editor.isDestroyed) editor.setEditable(!value)
      if (value) window.clearTimeout(statusTimer.current)
    },
    /*
     * Recovery is an edit, so it goes through the editor.
     *
     * Writing the copy straight to the API left the open editor showing the old
     * body: the reload that followed was the only thing that could reveal the
     * text, and for a collaborative room the pending local state could put the
     * old body back on top. Dispatching the replacement as an ordinary document
     * transaction does what typing does - the writer sees it at once, the room
     * broadcasts it, autosave persists it, and the undo stack can take it back.
     */
    restoreBody: async (body) => {
      if (!editor || editor.isDestroyed) throw new Error('编辑器正在加载，请稍后再试。')
      /*
       * A connected room that has not synced yet is about to deliver the cloud
       * copy, and anything dispatched before that arrives is merged with it - the
       * recovered text would land next to the old body instead of replacing it.
       * So the write waits for the first sync, but only while a socket is
       * actually open: offline (no socket), there is nothing to merge with and
       * waiting would just fail the one case recovery matters most for.
       */
      if (provider?.wsconnected && !provider.synced) {
        const synced = await new Promise<boolean>((resolve) => {
          const done = (state: boolean) => { window.clearTimeout(timer); provider.off('sync', done); resolve(state) }
          const timer = window.setTimeout(() => { provider.off('sync', done); resolve(false) }, 8000)
          provider.on('sync', done)
        })
        if (!synced) throw new Error('实时协作同步超时，请稍后重试。')
      }
      if (!editor || editor.isDestroyed) throw new Error('文档已切换，请重新选择恢复。')
      const replacement = editor.schema.nodeFromJSON(body)
      /*
       * Marked dirty before the transaction lands. Without it the footer would
       * claim "saved" for a body that has never left the browser, and the
       * safety copy would be neither written nor cleared.
       */
      localDirty.current = true
      editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, replacement.content))
      editor.commands.setTextSelection(1)
      editor.view.focus()
      /*
       * Only a collaborative session needs the confirmation timer: its autosave
       * goes through the room, so the footer has to be read back from the server.
       * Without a room, onUpdate already hands the body to the REST save path,
       * which reports its own status; polling there would never settle.
       */
      if (provider) {
        onSaveStatus('saving')
        window.clearTimeout(statusTimer.current)
        statusTimer.current = window.setTimeout(() => { void confirmPersisted() }, 1000)
      }
    },
  }))

  return <>
    <EditorToolbar
      editor={editor}
      onInteract={() => setBubbleAnchor(null)}
      actions={{
        onLink: rangeSelection,
        onImage: () => setImagePrompt(true),
        onFind: () => setFindOpen(true),
        onOutline: () => setOutlineOpen(true),
        onComment: () => { commentSelection(); window.dispatchEvent(new Event('mdoc-open-comments')) },
      }}
    />
    <div
      className="paper"
      /*
       * Clicking the blank paper below the last paragraph continues writing.
       *
       * The canvas has `min-height:45vh` but the paper keeps ~100px of padding
       * under it, and that band looked like part of the page while doing
       * nothing — the click landed on a div and no caret appeared, so a writer
       * who wanted to add a line at the end had to aim at the last line of text.
       * Now the blank area below the text is a place to write.
       *
       * Only a click that is not on the text, the title or a control qualifies:
       * the editor handles its own clicks (including a click under the last
       * block, which ProseMirror already resolves), and a link, checkbox or
       * button inside the body keeps its own behaviour.
       */
      onMouseDown={(event) => {
        if (!editor || !editor.isEditable) return
        const target = event.target as HTMLElement | null
        if (!target || target.closest('.tiptap-content, .document-heading, input, textarea, button, a, label')) return
        // Right and middle click belong to the context menu, not to the caret.
        if (event.button !== 0) return
        event.preventDefault()
        editor.chain().focus('end').run()
      }}
    >
      <div className="document-heading">
        <div className="document-title-row">
          <span className="theme-decoration document-title-art" aria-hidden="true"><ArtIcon name="notebook" fallback={<FileText size={40} />} /></span>
          <div className="document-title-field"><input
          aria-label="文档标题"
          disabled={titleSaving || locked}
          maxLength={500}
          title={doc.titleMode === 'auto' ? '根据正文自动命名；手动修改后固定名称' : '修改文档标题'}
          value={title}
          onFocus={(event) => { titleEditing.current = true; titleOrigin.current = currentDocument.current; titleDirty.current = false; if (doc.titleMode === 'auto' && title === '未命名文档') event.currentTarget.select() }}
          onChange={(event) => { titleDirty.current = true; setTitle(event.target.value) }}
          onCompositionStart={() => titleIme.current.start()}
          onCompositionEnd={() => titleIme.current.end()}
          onBlur={(event) => { titleEditing.current = false; if (titleDirty.current) void saveTitle(event.target.value); else setTitle(currentDocument.current.title) }}
          onKeyDown={(event) => {
            /*
             * Enter means "I have finished the title" — but only after the input
             * method has finished it. The first Enter a Chinese writer presses
             * confirms a candidate; this handler used to blur the field on it,
             * so a title being composed was committed half-written and the caret
             * left before the last character arrived.
             */
            if (event.nativeEvent.isComposing || titleIme.current.blocked(event.nativeEvent)) return
            if (event.key === 'Enter') {
              event.preventDefault()
              titleEditing.current = false
              if (titleDirty.current) void saveTitle(event.currentTarget.value)
              /*
               * Land in the body instead of nowhere.
               *
               * Blurring alone left focus on <body>: the next keystroke went to
               * no one, and the writer had to click into the text before
               * continuing. Enter on the title is the documented way to start
               * writing the document, so it now places the caret at the start of
               * the first block.
               */
              editor?.chain().focus('start').run()
              return
            }
            if (event.key === 'Escape') {
              titleDirty.current = false
              setTitle(currentDocument.current.title)
              event.currentTarget.blur()
            }
          }}
          /></div>
        </div>
        <div className="doc-meta"><DocumentCreatedTime doc={doc} /><span>最后编辑于 {formatDate(doc.updatedAt) || '刚刚'}</span>{doc.titleMode === 'auto' && <span className="title-mode-hint">根据正文自动命名，可直接修改</span>}</div>
      </div>
      <EditorContent editor={editor} />
    </div>
    <SlashMenu editor={editor} anchor={slash} query={slash?.query || ''} range={slash?.range || null} onClose={() => setSlash(null)} onImage={() => setImagePrompt(true)} />
    {editor && <BlockHandle
      editor={editor}
      anchor={blockAnchor.anchor}
      pin={blockAnchor.pin}
      refresh={blockAnchor.refresh}
      editable={editor.isEditable}
    />}
    <TableMenu editor={editor} table={tableGeometry} />
    <ImageToolbar editor={editor} image={imageGeometry} />
    <BubbleToolbar editor={editor} anchor={bubbleAnchor} onLink={() => rangeSelection()} onComment={() => { commentSelection(); window.dispatchEvent(new Event('mdoc-open-comments')) }} />
    {imagePrompt && <Dialog
      title="插入图片"
      description="粘贴图片地址，或上传本地图片（20 MB 以内）。"
      confirmLabel="插入"
      onConfirm={() => { if (imageUrl.trim()) { editor?.chain().focus().setImage({ src: imageUrl.trim() }).run(); setImageUrl(''); setBubbleAnchor(null) } setImagePrompt(false) }}
      onClose={() => setImagePrompt(false)}
    >
      <div className="dialog-field">
        <label htmlFor="image-url">图片地址</label>
        <div className="image-insert-row">
          <input id="image-url" placeholder="https://example.com/image.png" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} />
          <label className="image-upload-btn secondary-btn">上传<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="visually-hidden" onChange={(event) => void uploadImage(event)} /></label>
        </div>
      </div>
    </Dialog>}
    {findOpen && <FindReplace editor={editor} initial="" onClose={() => setFindOpen(false)} />}
    {outlineOpen && <OutlinePanel editor={editor} onClose={() => setOutlineOpen(false)} />}
    <div className="editor-footer">
      <span className="footer-count">字数 <span className="footer-count-value">{words}</span></span>
      <span className="meta-divider" />
      <span className={'footer-save ' + saveStatus}>{saveStatus === 'saved' && <Check className="theme-decoration footer-save-icon" size={14} aria-hidden="true" />}{saveStatus === 'saving' ? '正在保存…' : saveStatus === 'error' ? '保存失败' : '已保存'}</span>
      <span className="footer-spacer" />
      <span className="footer-hint">{provider
        ? <>实时协作已开启 <span className="footer-hint-divider">·</span> <kbd>Ctrl/⌘+S</kbd> 强制保存</>
        : <><kbd>Ctrl/⌘+S</kbd> 保存 <span className="footer-hint-divider">·</span> <kbd>Ctrl/⌘+Shift+E</kbd> 导出 Markdown</>}</span>
    </div>
  </>
})

export default DocumentEditor
