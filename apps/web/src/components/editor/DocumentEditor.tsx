import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EditorContent, useEditor } from '@tiptap/react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { ArrowDown, ArrowUp, Check, Copy as CopyIcon, Trash2 } from 'lucide-react'
import EditorToolbar from './EditorToolbar'
import BubbleToolbar from './BubbleToolbar'
import { FindReplace, OutlinePanel } from './FindReplace'
import SlashMenu, { SLASH_ITEMS } from './SlashMenu'
import TableMenu from './TableMenu'
import { Dialog } from '../ui/Dialog'
import { API, request } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { COLLAB_URL } from '../../lib/collab'
import { buildEditorExtensions } from '../../lib/editor'
import { useBlockGeometry } from '../../hooks/useBlockGeometry'
import { wordCount, formatDate } from '../../lib/format'
import LanguagePicker from './LanguagePicker'
import ImageToolbar from './ImageToolbar'
import BlockHandle from './BlockHandle'
import { useBlockAnchor } from '../../hooks/useBlockAnchor'
import { grammarFor } from '../../lib/highlight'
import { emptyContent } from '../../lib/types'
import type { CollabStatus } from '../../lib/app-types'
import type { Doc, SaveStatus, User } from '../../lib/types'

type DocumentEditorProps = {
  doc: Doc
  token: string
  persist: (json: Record<string, unknown>, immediate?: boolean) => void
  user: User
  saveStatus: SaveStatus
  onSaveStatus: (status: SaveStatus) => void
  onAwareness: (users: Array<{ clientId: number; name: string; color: string }>) => void
  onCollabStatus: (status: CollabStatus) => void
  onSelection: (anchor: { from: number; to: number; text: string }) => void
  onExport: (format: 'markdown' | 'html' | 'json') => void
  onLink: (range: { from: number; to: number }) => void
}

export default function DocumentEditor({ doc, token, persist, user, saveStatus, onSaveStatus, onAwareness, onCollabStatus, onSelection, onExport, onLink }: DocumentEditorProps) {
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null)
  const [provider, setProvider] = useState<WebsocketProvider | null>(null)
  const [title, setTitle] = useState(doc.title)
  const [words, setWords] = useState(0)
  const [imagePrompt, setImagePrompt] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [bubbleAnchor, setBubbleAnchor] = useState<{ left: number; top: number } | null>(null)
  const [copyState, setCopyState] = useState<{ pos: number; ok: boolean } | null>(null)
  const [slash, setSlash] = useState<{ left: number; top: number; query: string; range: { from: number; to: number } } | null>(null)
  const statusTimer = useRef<number | undefined>(undefined)
  const wordTimer = useRef<number | undefined>(undefined)
  /** Version last seen persisted, so a stale read cannot report success. */
  const persistedVersion = useRef<number>(doc.version)

  useEffect(() => { setTitle(doc.title) }, [doc.id, doc.title])

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
   * The collaboration room writes asynchronously, so the only honest signal is
   * the document's own version moving forward. On failure the status becomes
   * 'error' and stays there until the next successful confirmation.
   */
  async function confirmPersisted(local: unknown) {
    try {
      const latest = await request<{ document: { version: number } }>('/documents/' + doc.id, token)
      if (latest.document.version > persistedVersion.current) {
        persistedVersion.current = latest.document.version
        onSaveStatus('saved')
        return
      }
      // The room has not flushed yet; keep waiting rather than lying.
      window.clearTimeout(statusTimer.current)
      statusTimer.current = window.setTimeout(() => { void confirmPersisted(local) }, 1200)
    } catch (error) {
      onSaveStatus('error')
      // Keep a local copy so closing the tab cannot destroy the work.
      try { window.localStorage.setItem('mdocs-draft-' + doc.id, JSON.stringify(local)) } catch { /* quota */ }
      window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '保存遇到问题，已在本地保留草稿：' + (error as Error).message }))
    }
  }

  const editor = useEditor({
    extensions: buildEditorExtensions({ ydoc: provider ? ydoc : null, placeholder: '从这里开始写作…' }),
    content: doc.content?.doc || emptyContent.doc,
    onUpdate: ({ editor: instance }) => {
      // Counting the whole document on every keystroke is O(n); the footer only
      // needs to be roughly current.
      window.clearTimeout(wordTimer.current)
      wordTimer.current = window.setTimeout(() => setWords(wordCount(instance.getText())), 300)
      if (provider) {
        /* Collaborative edits reach the server through the Yjs room, which
           debounces and writes asynchronously. Reporting "saved" on a timer would
           claim success without any confirmation, so the status stays "saving"
           until a HEAD on the document shows the persisted version moved. */
        onSaveStatus('saving')
        window.clearTimeout(statusTimer.current)
        statusTimer.current = window.setTimeout(() => { void confirmPersisted(instance.getJSON()) }, 1000)
      } else {
        persist(instance.getJSON())
      }
    },
    onCreate: ({ editor: instance }) => setWords(wordCount(instance.getText())),
    onBlur: () => setBubbleAnchor(null),
    onSelectionUpdate: ({ editor: instance }) => {
      const { from, to } = instance.state.selection
      const { $from, $to } = instance.state.selection
      const isNodeSelection = instance.state.selection.constructor.name === 'NodeSelection'
      if (to > from && !isNodeSelection && $from.parent === $to.parent) {
        onSelection({ from, to, text: instance.state.doc.textBetween(from, to, ' ').slice(0, 500) })
        const start = instance.view.coordsAtPos(from)
        const end = instance.view.coordsAtPos(to)
        setBubbleAnchor({ left: Math.max(12, (start.left + end.left) / 2 - 150), top: Math.max(64, Math.min(start.top, end.top) - 52) })
      } else {
        setBubbleAnchor(null)
      }
    },
    editorProps: { attributes: { class: 'tiptap-content' } },
  }, [doc.id, provider])

  // Geometry for every block that hosts its own toolbar (code, table, image,
  // divider). The hook re-measures on transactions and layout changes.
  const blocks = useBlockGeometry(editor)
  const codeBlocks = blocks.filter((block) => block.kind === 'codeBlock')
  // The gutter handle follows the pointer; it is pinned while its menu or a
  // drag is open so the target cannot change under the user mid-gesture.
  const blockAnchor = useBlockAnchor(editor)


  // Reveal the quoted text when a comment anchor is clicked in the side panel.
  useEffect(() => {
    const reveal = (event: Event) => {
      const anchor = (event as CustomEvent<{ from?: number; to?: number }>).detail
      if (!anchor || !editor || typeof anchor.from !== 'number' || typeof anchor.to !== 'number') return
      editor.chain().focus().setTextSelection({ from: anchor.from, to: anchor.to }).scrollIntoView().run()
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
      // Only paragraphs and headings host the insertion command.
      if ($from.parent.type.name !== 'paragraph' && $from.parent.type.name !== 'heading') { setSlash(null); return }
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
      const match = /(^|\s)\/([^\s/]*)$/.exec(textBefore)
      if (!match) { setSlash(null); return }
      const query = match[2] || ''
      // Hide the menu when nothing matches so it cannot cover the document.
      const hasMatch = SLASH_ITEMS.some((item) => !query || item.label.includes(query) || item.hint.includes(query))
      if (!hasMatch) { setSlash(null); return }
      const coords = editor.view.coordsAtPos($from.pos)
      setSlash({ left: Math.max(12, Math.min(window.innerWidth - 280, coords.left)), top: coords.bottom + 6, query, range: { from: $from.pos - query.length - 1, to: $from.pos } })
    }
    editor.on('update', update)
    editor.on('selectionUpdate', update)
    return () => { editor.off('update', update); editor.off('selectionUpdate', update) }
  }, [editor])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ from: number; to: number; href: string }>).detail
      if (!detail || !editor) return
      editor.chain().focus().setTextSelection({ from: detail.from, to: detail.to }).extendMarkRange('link').setLink({ href: detail.href }).run()
    }
    window.addEventListener('mdoc-insert-link', handler)
    return () => window.removeEventListener('mdoc-insert-link', handler)
  }, [editor])

  useEffect(() => {
    const handler = () => {
      if (provider) {
        onSaveStatus('saving')
        request('/documents/' + doc.id, token)
          .then(() => onSaveStatus('saved'))
          .catch(() => onSaveStatus('error'))
        return
      }
      if (editor) persist(editor.getJSON(), true)
    }
    window.addEventListener('mdoc-force-save', handler)
    return () => window.removeEventListener('mdoc-force-save', handler)
  }, [provider, editor, doc.id, token, persist, onSaveStatus])

  function rangeSelection() {
    const selection = editor?.state.selection
    onLink({ from: selection?.from ?? 0, to: selection?.to ?? 0 })
  }

  function commentSelection() {
    const selection = editor?.state.selection
    if (selection && selection.to > selection.from) onSelection({ from: selection.from, to: selection.to, text: editor.state.doc.textBetween(selection.from, selection.to, ' ').slice(0, 500) })
  }

  async function uploadImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 20 * 1024 * 1024) { window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '图片不能超过 20 MB' })); return }
    try {
      const response = await fetch(API + '/api/v1/uploads', {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': file.name, Authorization: 'Bearer ' + token },
        body: file,
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message || '上传失败')
      setImageUrl(API + body.file.url)
    } catch (error) {
      window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '图片上传失败：' + (error as Error).message }))
    }
  }

  async function saveTitle(next: string) {
    const clean = next.trim() || '未命名文档'
    setTitle(clean)
    try {
      const latest = await request<{ document: Doc }>('/documents/' + doc.id, token)
      const result = await request<{ document: Doc }>('/documents/' + doc.id, token, { method: 'PUT', body: JSON.stringify({ title: clean, expectedVersion: latest.document.version }) })
      window.dispatchEvent(new CustomEvent('mdoc-updated', { detail: result.document }))
    } catch (error) {
      setTitle(doc.title)
      window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '标题保存失败：' + (error as Error).message }))
    }
  }

  return <>
    <EditorToolbar
      editor={editor}
      onInteract={() => setBubbleAnchor(null)}
      actions={{
        onLink: () => { const selection = editor?.state.selection; onLink({ from: selection?.from ?? 0, to: selection?.to ?? 0 }) },
        onImage: () => setImagePrompt(true),
        onFind: () => setFindOpen(true),
        onOutline: () => setOutlineOpen(true),
        onExport: () => onExport('json'),
        onComment: () => { commentSelection(); window.dispatchEvent(new Event('mdoc-open-comments')) },
      }}
    />
    <div className="paper">
      <div className="document-heading">
        <input
          aria-label="文档标题"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={(event) => { if (event.target.value !== doc.title) void saveTitle(event.target.value) }}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
        />
        <div className="doc-meta"><span>最后编辑于 {formatDate(doc.updatedAt) || '刚刚'}</span></div>
      </div>
      {/* Code block enhancement: language badge and per-block actions */}
      <EditorContent editor={editor} />
      {createPortal(<>
        {codeBlocks.map((block) => <div
        key={block.pos}
        className="code-overlay"
        // The overlay is re-measured on every scroll frame, so animating top
        // would queue a transition per frame. Position it, then fade the chrome
        // in once so it does not flash while the block scrolls into view.
        style={{ top: block.top, left: block.left, width: block.width }}
        contentEditable={false}
      >
        <LanguagePicker
          value={block.language}
          onChange={(id) => {
            if (!editor) return
            // Update the block this picker belongs to. block.pos comes from the
            // same doc.descendants pass that produced the overlay, so it is the
            // node's own position; placing the cursor inside first keeps the
            // attribute update inside the normal command chain.
            const target = block.pos
            if (target < 0) return
            // Put the cursor at the end of the block's text so a subsequent
            // keystroke appends instead of landing at the start, then update the
            // attribute inside the same chain.
            const node = editor.state.doc.nodeAt(target)
            const end = target + 1 + (node?.content.size ?? 0)
            // Store the grammar name the highlighter knows; the picker shows a friendly
            // label for it via languageLabel().
            editor.chain().focus().setTextSelection(end).updateAttributes('codeBlock', { language: grammarFor(id) }).run()
          }}
        />
        <span className="code-overlay-actions">
          <button
            type="button"
            className="code-overlay-icon"
            aria-label="上移代码块"
            title="上移"
            onClick={() => {
              if (!editor || block.pos < 0) return
              const { doc, tr } = editor.state
              const node = doc.nodeAt(block.pos)
              if (!node) return
              const before = doc.resolve(block.pos).nodeBefore
              if (!before) return
              const from = block.pos - before.nodeSize
              const start = from < 0 ? 0 : from
              tr.delete(block.pos, block.pos + node.nodeSize).insert(start, node)
              editor.view.dispatch(tr)
            }}
          ><ArrowUp size={13} /></button>
          <button
            type="button"
            className="code-overlay-icon"
            aria-label="下移代码块"
            title="下移"
            onClick={() => {
              if (!editor || block.pos < 0) return
              const { doc, tr } = editor.state
              const node = doc.nodeAt(block.pos)
              if (!node) return
              const after = doc.resolve(block.pos + node.nodeSize).nodeAfter
              if (!after) return
              const at = block.pos + node.nodeSize + after.nodeSize
              tr.delete(block.pos, block.pos + node.nodeSize).insert(at, node)
              editor.view.dispatch(tr)
            }}
          ><ArrowDown size={13} /></button>
          <button
            type="button"
            className="code-overlay-icon danger"
            aria-label="删除代码块"
            title="删除代码块"
            onClick={() => {
              if (!editor || block.pos < 0) return
              const { doc, tr } = editor.state
              const node = doc.nodeAt(block.pos)
              if (!node) return
              editor.view.dispatch(tr.delete(block.pos, block.pos + node.nodeSize))
            }}
          ><Trash2 size={13} /></button>
        </span>
        <button
          type="button"
          className={'code-overlay-copy' + (copyState?.pos === block.pos ? (copyState.ok ? ' copied' : ' failed') : '')}
          aria-label="复制代码"
          title="复制代码"
          onClick={async () => {
            const ok = await copyText(block.text)
            setCopyState({ pos: block.pos, ok })
            if (!ok) window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '浏览器阻止了自动复制，请手动选中代码复制。' }))
            setTimeout(() => setCopyState(null), 1800)
          }}
        >{copyState?.pos === block.pos
          ? (copyState.ok
            ? <><Check size={13} /><span>已复制</span></>
            : <><CopyIcon size={13} /><span>复制失败</span></>)
          : <><CopyIcon size={13} /><span>复制</span></>}
        </button>
        <span className="visually-hidden" role="status" aria-live="polite">
          {copyState?.pos === block.pos ? (copyState.ok ? '代码已复制到剪贴板' : '复制失败') : ''}
        </span>
      </div>)}
      </>, document.body)}    </div>
    <SlashMenu editor={editor} anchor={slash} query={slash?.query || ''} range={slash?.range || null} onClose={() => setSlash(null)} onImage={() => setImagePrompt(true)} />
    {editor && <BlockHandle
      editor={editor}
      anchor={blockAnchor.anchor}
      pin={blockAnchor.pin}
      refresh={blockAnchor.refresh}
      editable={editor.isEditable}
    />}
    <TableMenu editor={editor} table={blocks.find((block) => block.kind === 'table') ?? null} />
    <ImageToolbar editor={editor} image={blocks.find((block) => block.kind === 'image') ?? null} />
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
      <span>字数 {words}</span>
      <span className="meta-divider" />
      <span className={'footer-save ' + saveStatus}>{saveStatus === 'saving' ? '正在保存…' : saveStatus === 'error' ? '保存失败' : '已保存'}</span>
      <span className="footer-spacer" />
      <span className="footer-hint">{provider ? '实时协作已开启 · Ctrl/⌘+S 强制保存' : 'Ctrl/⌘+S 保存 · Ctrl/⌘+Shift+E 导出 Markdown'}</span>
    </div>
  </>
}
