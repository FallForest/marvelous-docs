import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { api } from './lib/endpoints'
import { Dialog } from './components/ui/Dialog'
import { withViewTransition } from './lib/motion'
import { COLLAB_URL } from './lib/collab'
import { ancestorsOf, buildDocTree, filterDocTree } from './lib/tree'
import { useWorkspaceData } from './hooks/useWorkspaceData'
import { useSharing } from './hooks/useSharing'
import { useInvite } from './hooks/useInvite'
import { useDocumentExport } from './hooks/useDocumentExport'
import { useTheme } from './hooks/useTheme'
import { emptyContent } from './lib/types'
import { DocumentSaveQueue } from './lib/document-saves'
import { clearSavedDraft, readDraft, writeDraft } from './lib/local-drafts'
import { syncDocumentUrl } from './lib/url'
import type { LinkPrompt } from './lib/editor/link-editing'
import type { CollabStatus, HomeView, RightTab } from './lib/app-types'
import { FAVORITES_SCOPE } from './lib/app-types'
import type {
  Comment, CommentAnchorLocation, Doc, DocJson, SaveStatus, SearchScope, TreeAction, User, Version,
} from './lib/types'
import AdminWorkspace from './pages/AdminPage'
import CommandPalette from './pages/CommandPalette'
import HomeDashboard, { FolderOverview } from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import BootScreen from './pages/BootScreen'
import SearchPage from './pages/SearchPage'
import SharedDocumentPage from './pages/SharedDocumentPage'
import ShellDialogs from './components/dialogs/ShellDialogs'
import ShareDialog from './components/dialogs/ShareDialog'
import InviteDialog from './components/dialogs/InviteDialog'
import MoveDialog from './components/dialogs/MoveDialog'
import TemplateLibrary from './components/dialogs/TemplateLibrary'
import DraftRecovery from './components/dialogs/DraftRecovery'
import DocumentEditor, { type DocumentEditorHandle } from './components/editor/DocumentEditor'
import { templateLabel } from './components/layout/TemplateMenu'
import DocumentPanel from './components/panels/DocumentPanel'
import Sidebar from './components/layout/Sidebar'
import TopBar from './components/layout/TopBar'
import VersionPreview from './components/panels/VersionPreview'

/**
 * Workspace shell: owns session, the document list, and which overlay is open.
 *
 * Rendering of individual surfaces lives in ./pages (route-level screens),
 * ./components/editor (the Tiptap surface) and ./components/dialogs, so this
 * file only wires them together. The data behind an overlay that is closed most
 * of the time — sharing, invites, export — lives in its own hook under ./hooks,
 * because none of it is needed to paint the shell.
 */
export function AppRoot() {
  const sharedMatch = window.location.pathname.match(/^\/shared\/(.+)$/)
  if (sharedMatch) return <SharedDocumentPage token={sharedMatch[1]!} />
  return <App />
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('mdocs-token') || '')
  const [workspaceView, setWorkspaceView] = useState<'documents' | 'admin'>('documents')
  const [loginError, setLoginError] = useState('')

  const [narrow, setNarrow] = useState(false)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set())
  const [rightTab, setRightTab] = useState<RightTab>('comments')
  const [showRight, setShowRight] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [showShare, setShowShare] = useState(false)
  /** Multi-select over the document tree; null means selection mode is off. */
  const [checkedIds, setCheckedIds] = useState<Set<string> | null>(null)
  /** Set when a save hit 409, so the user can pick which version wins. */
  const [conflictDoc, setConflictDoc] = useState<Doc | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)
  const invite = useInvite(token)
  /*
   * The palette is applied to <html> by this hook, not rendered by React, so it
   * is created before any early return (the login screen and the admin page are
   * separate trees and both should wear the chosen theme).
   */
  const { themeId, setTheme } = useTheme()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === 'undefined' ? true : window.innerWidth > 820)
  const [commentText, setCommentText] = useState('')
  const [commentAnchor, setCommentAnchor] = useState<Comment['anchor']>(null)
  const [commentParentId, setCommentParentId] = useState<string | null>(null)
  const [commentLocations, setCommentLocations] = useState<Record<string, CommentAnchorLocation>>({})
  const [commentSending, setCommentSending] = useState(false)
  const commentRequest = useRef(false)
  /** The thread whose card and text marker are lit up, if any. */
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const [collaborators, setCollaborators] = useState<Array<{ clientId: number; name: string; color: string }>>([])
  const [collabStatus, setCollabStatus] = useState<CollabStatus>('connecting')
  const [expanded, setExpanded] = useState(true)
  const [commandOpen, setCommandOpen] = useState(false)
  const [homeView, setHomeView] = useState<HomeView>('home')
  const [searchScope, setSearchScope] = useState<SearchScope>('all')
  const [commandIndex, setCommandIndex] = useState(0)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const [moveDoc, setMoveDoc] = useState<Doc | null>(null)
  const [previewVersion, setPreviewVersion] = useState<Version | null>(null)
  const [previewCurrent, setPreviewCurrent] = useState<{ content?: DocJson; title?: string }>({})
  const [editorEpoch, setEditorEpoch] = useState(0)
  const editorHandle = useRef<DocumentEditorHandle | null>(null)
  const restoreTarget = useRef<string | null>(null)
  const saveQueue = useRef(new DocumentSaveQueue())
  const userRef = useRef<User | null>(null)
  const [renameDoc, setRenameDoc] = useState<Doc | null>(null)
  const [deleteDoc, setDeleteDoc] = useState<Doc | null>(null)
  const [purgeDoc, setPurgeDoc] = useState<Doc | null>(null)
  /** Confirmation for emptying the whole bin; null when the dialog is closed. */
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false)
  const [emptyTrashBusy, setEmptyTrashBusy] = useState(false)
  const [linkPrompt, setLinkPrompt] = useState<LinkPrompt | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const saveTimer = useRef<number | undefined>(undefined)
  const pendingSave = useRef<{ id: string; run: () => Promise<void> } | null>(null)
  const importInput = useRef<HTMLInputElement | null>(null)
  const commentDraft = useMemo(() => showRight && rightTab === 'comments' && !commentParentId
    && commentAnchor && typeof commentAnchor.from === 'number' && typeof commentAnchor.to === 'number'
    ? { from: commentAnchor.from, to: commentAnchor.to } : null, [showRight, rightTab, commentParentId, commentAnchor])


  const closeOverlays = useCallback(() => {
    setCommandOpen(false)
    setShowRight(false)
    setActiveCommentId(null)
    setShowShare(false)
    setShowInvite(false)
    setMoveDoc(null)
    setPreviewVersion(null)
    setNewMenuOpen(false)
    setTemplateLibraryOpen(false)
    setExportMenuOpen(false)
    setThemeMenuOpen(false)
    setWorkspaceOpen(false)
  }, [])



  /** Preserve a draft before an unsaved edit can be interrupted. */
  const persist = useCallback((json: Record<string, unknown>, immediate = false) => {
    if (!token || !activeRef.current || restoreTarget.current === activeRef.current.id) return
    const source = activeRef.current
    const authorId = userRef.current?.id
    // Keep a copy before the debounce or network request can be interrupted.
    const backedUp = authorId ? writeDraft(localStorage, source.id, authorId, json) : false
    // A new document must not cancel the previous document's pending save or
    // cause that body/title to be written into the newly active document.
    if (pendingSave.current && pendingSave.current.id !== source.id) {
      window.clearTimeout(saveTimer.current)
      const previous = pendingSave.current
      pendingSave.current = null
      void previous.run()
    }
    const flush = async () => {
      if (pendingSave.current?.run === flush) pendingSave.current = null
      const doc = activeRef.current?.id === source.id ? activeRef.current : source
      if (activeRef.current?.id === source.id) setSaveStatus('saving')
      try {
        const saved = await saveQueue.current.enqueue(doc.id, async (previous) => {
          const current = activeRef.current?.id === doc.id ? activeRef.current : doc
          const version = Math.max(current.version, previous?.version ?? 0)
          const result = await api.saveContent(token, doc.id, json, version)
          if (activeRef.current?.id === doc.id) activeRef.current = result.document
          return result.document
        })
        setActive((current) => current?.id === saved.id ? saved : current)
        setDocuments((items) => items.map((item) => item.id === saved.id ? saved : item))
        if (activeRef.current?.id === source.id) setSaveStatus('saved')
        // The server accepted this edit, so the local safety copy is stale.
        if (authorId) clearSavedDraft(localStorage, doc.id, authorId, json)
      } catch (error) {
        const failure = error as Error & { status?: number }
        if (activeRef.current?.id === source.id) setSaveStatus('error')
        // Keep the exact bytes either way: a reload must not be the price of a
        // failed save, and a conflict must not silently discard the local edit.
        if (failure.status === 409) {
          setConflictDoc(doc)
        } else {
          setNotice('保存失败，' + (backedUp ? '已保留本地副本：' : '浏览器无法保留草稿，请保持页面打开：') + failure.message)
        }
      }
    }
    window.clearTimeout(saveTimer.current)
    pendingSave.current = { id: source.id, run: flush }
    if (immediate) { void flush(); return }
    setSaveStatus('saving')
    saveTimer.current = window.setTimeout(() => { void flush() }, 700)
  }, [token])

  /**
   * Resolves a version conflict.
   *
   * `mine` re-reads the document for its current version and writes the local
   * copy over it; `theirs` drops the local edit and adopts the server copy.
   * Neither path needs a page reload, and the local draft stays on disk until the
   * user actually picks one.
   */
  const resolveConflict = useCallback(async (choice: 'mine' | 'theirs') => {
    const doc = conflictDoc
    if (!doc || !token) return
    const authorId = userRef.current?.id
    const draft = authorId ? readDraft(localStorage, doc.id, authorId)?.body : undefined
    setConflictDoc(null)
    try {
      const latest = await api.document(token, doc.id)
      if (choice === 'theirs') {
        setActive(latest.document)
        setEditorEpoch((epoch) => epoch + 1)
        setDocuments((items) => items.map((item) => item.id === latest.document.id ? latest.document : item))
        if (authorId && draft) clearSavedDraft(localStorage, doc.id, authorId, draft)
        setSaveStatus('saved')
        return
      }
      if (!draft) { setNotice('本地草稿已丢失，已载入服务器版本'); setActive(latest.document); setEditorEpoch((epoch) => epoch + 1); return }
      const saved = await api.saveContent(token, doc.id, draft, latest.document.version)
      setActive(saved.document)
      setEditorEpoch((epoch) => epoch + 1)
      setDocuments((items) => items.map((item) => item.id === saved.document.id ? saved.document : item))
      if (authorId) clearSavedDraft(localStorage, doc.id, authorId, draft)
      setSaveStatus('saved')
      setNotice('已用你的版本覆盖服务器内容')
    } catch (error) {
      setSaveStatus('error')
      setNotice('处理冲突失败：' + (error as Error).message)
    }
    // setActive/setDocuments are stable setState identities; conflictDoc and token
    // are the real inputs.
  }, [conflictDoc, token]) // eslint-disable-line react-hooks/exhaustive-deps

  const workspaceData = useWorkspaceData({
    token,
    query: { commandOpen, homeView, query, searchScope, workspaceView },
    onSessionExpired: () => { localStorage.removeItem('mdocs-token'); setToken('') },
    notify: setNotice,
    leaveAdmin: () => setWorkspaceView('documents'),
  })
  const {
    user, setUser,
    documents, setDocuments,
    active, setActive, activeRef,
    comments, setComments,
    favoriteIds, favoriteSet, setFavorites,
    templates,
    stats, refreshStats, refreshDocuments,
    trashDocuments, setTrashDocuments,
    recentDocuments,
    trashRetentionDays,
    searchResults, searchLoading,
    adminMembers, adminMembersBusy,
    updateInfo, setUpdateInfo,
  } = workspaceData
  userRef.current = user

  // Everything the share dialog shows is loaded on open, so the shell keeps
  // only the boolean that decides whether it renders.
  const sharing = useSharing({
    token,
    userId: user?.id ?? null,
    notify: setNotice,
  })

  const openShareDialog = useCallback(() => {
    if (!active || active.kind === 'folder') { setNotice('请先打开一个文档再设置共享权限'); return }
    setShowShare(true)
    void sharing.load(active)
  }, [active, sharing])

  const { pdfProgress, exportActive } = useDocumentExport({
    token,
    activeRef,
    notify: setNotice,
    closeMenu: () => setExportMenuOpen(false),
  })

  const clearToken = useCallback(() => {
    localStorage.removeItem('mdocs-token')
    setToken('')
    setUser(null)
    setActive(null)
    setDocuments([])
    setComments([])
    setWorkspaceView('documents')
  }, [setUser, setActive, setDocuments, setComments])

  const startUpdate = useCallback(async () => {
    // Every early return has to say why: a silent no-op is indistinguishable from
    // a broken button, which is exactly how this looked in production.
    if (!token) { setNotice('请先登录后再检查更新。'); return }
    if (!updateInfo) { setNotice('当前没有可用的更新信息，请稍后重试。'); return }
    if (updateInfo.status === 'running') { setNotice('更新正在进行中，请稍候…'); return }
    setUpdateInfo((current) => current ? { ...current, status: 'running' } : current)
    try {
      await api.startUpdate(token)
      setNotice('更新已开始，正在备份并重启服务…')
      let attempts = 0
      const poll = async () => {
        attempts += 1
        try {
          const result = await api.updateStatus(token)
          if (result.update.status === 'completed') {
            setUpdateInfo((current) => current ? { ...current, status: 'completed' } : current)
            setNotice('更新完成，正在重新加载…')
            window.setTimeout(() => window.location.reload(), 1800)
          } else if (result.update.status === 'failed') {
            setUpdateInfo((current) => current ? { ...current, status: 'failed' } : current)
            setNotice('更新失败：' + (result.update.error || '请查看服务器日志'))
          } else if (attempts < 90) window.setTimeout(poll, 2000)
        } catch {
          if (attempts < 90) window.setTimeout(poll, 2000)
        }
      }
      window.setTimeout(poll, 2000)
    } catch (error) {
      setUpdateInfo((current) => current ? { ...current, status: 'failed' } : current)
      setNotice('更新启动失败：' + (error as Error).message)
    }
  }, [token, updateInfo, setUpdateInfo])

  /*
   * Keep the address bar pointing at the open document.
   *
   * One effect rather than a `syncDocumentUrl` beside every `setActive`: there are
   * a dozen places that select a document (open, create, import, duplicate,
   * restore, delete-then-fall-back), and the one that was forgotten would be the
   * one that leaves the address pointing at a document the reader is no longer
   * looking at. Reading `active` covers every path by construction.
   *
   * The shared-document route is excluded: `/shared/<token>` addresses a public
   * view, and rewriting its query would break a link somebody pasted into a chat.
   */
  useEffect(() => {
    if (window.location.pathname.startsWith('/shared/')) return
    syncDocumentUrl(active?.kind === 'document' ? active.id : null)
  }, [active])
  // Keyboard shortcuts, viewport tracking, document title, and the
  // unsaved-changes guard. These belong to the shell: they describe how the
  // workspace behaves, not what it contains.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey
      /*
       * `Ctrl+K` means "link this text" while text is selected, and "open the palette"
       * otherwise. The palette claimed the chord outright, so a writer with a sentence
       * highlighted got a search box - the opposite of what every editor with this
       * shortcut does.
       *
       * The selection is read from the DOM rather than from the editor handle: the
       * shell does not own the editor's state, and asking it here would couple the
       * keyboard map to the editor's internals for one key.
       */
      const selection = window.getSelection()?.toString() ?? ''
      const inEditor = Boolean(document.activeElement?.closest('.tiptap-content'))
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        const caretLink = window.getSelection()?.anchorNode?.parentElement?.closest('a[href]')
        if (inEditor && (selection.trim() || caretLink)) { window.dispatchEvent(new CustomEvent('mdoc-link-selection')); return }
        setCommandOpen(true)
        setCommandIndex(0)
      }
      else if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); window.dispatchEvent(new Event('mdoc-force-save')) }
      else if (modifier && event.shiftKey && event.key.toLowerCase() === 'e') { event.preventDefault(); void exportActive('markdown') }
      if (event.key === 'Escape') closeOverlays()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exportActive, closeOverlays])

  useEffect(() => {
    if (saveStatus === 'saved') return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saveStatus])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 820px)')
    const sync = () => { setNarrow(media.matches); if (media.matches) setSidebarOpen(false) }
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    document.title = active ? (active.title || '未命名文档') + ' · Marvelous Docs' : 'Marvelous Docs'
  }, [active?.title])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4200)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const syncDocument = (event: Event) => {
      const updated = (event as CustomEvent<Doc>).detail
      if (!updated) return
      setActive((current) => current?.id === updated.id ? updated : current)
      setDocuments((rows) => rows.map((row) => row.id === updated.id ? updated : row))
    }
    window.addEventListener('mdoc-updated', syncDocument)
    return () => window.removeEventListener('mdoc-updated', syncDocument)
  }, [])

  useEffect(() => {
    const openComments = () => { setRightTab('comments'); setShowRight(true) }
    window.addEventListener('mdoc-open-comments', openComments)
    return () => window.removeEventListener('mdoc-open-comments', openComments)
  }, [])

  /*
   * Pressing marked text opens the thread it belongs to.
   *
   * The editor only knows the comment id (it is a view decoration, not part of
   * the document), so the shell resolves it: switch to the comments tab, open
   * the panel, light up the card, and bring the quoted range into view. If the
   * thread has been deleted since the page loaded, the press is a no-op rather
   * than an empty panel.
   */
  useEffect(() => {
    const focusThread = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id
      if (!id) return
      const comment = comments.find((row) => row.id === id)
      if (!comment) return
      setRightTab('comments')
      setShowRight(true)
      setActiveCommentId(id)
      window.dispatchEvent(new CustomEvent('mdoc-focus-anchor', { detail: { id } }))
    }
    window.addEventListener('mdoc-focus-comment', focusThread)
    return () => window.removeEventListener('mdoc-focus-comment', focusThread)
  }, [comments])

  useEffect(() => {
    const showNotice = (event: Event) => setNotice((event as CustomEvent<string>).detail)
    window.addEventListener('mdoc-notice', showNotice)
    return () => window.removeEventListener('mdoc-notice', showNotice)
  }, [])

  useEffect(() => {
    if (!token || !active || active.kind === 'folder') return
    let live = true
    api.document(token, active.id, true)
      .then(({ document: document }) => { if (live) setActive(document) })
      .catch((error) => { if (live) setNotice(error.message) })
    api.comments(token, active.id)
      .then(({ comments: rows }) => { if (live) setComments(rows || []) }).catch(() => undefined)
    return () => { live = false }
  }, [token, active?.id])

  // Refresh the side panel when its tab is opened so collaboration saves made
  // while the panel was closed show up without a page reload.
  useEffect(() => {
    if (!token || !active) return
    let live = true
    if (rightTab === 'comments') {
      api.comments(token, active.id)
        .then(({ comments: rows }) => { if (live) setComments(rows || []) })
        .catch(() => undefined)
    }
    return () => { live = false }
  }, [token, active?.id, rightTab])

  useEffect(() => {
    setSaveStatus('saved')
    setCollabStatus(COLLAB_URL ? 'connecting' : 'disconnected')
    // A thread id belongs to one document; carrying the tint across a switch
    // would highlight whatever range happens to share that id in the next file.
    setActiveCommentId(null)
    setCommentAnchor(null)
    setCommentParentId(null)
    setCommentText('')
    setCommentLocations({})
    setComments([])
  }, [active?.id])

  async function login(email: string, password: string) {
    setLoginError('')
    setBusy(true)
    try {
      const result = await api.login(email, password)
      localStorage.setItem('mdocs-token', result.token)
      setToken(result.token)
      setUser(result.user)
    } catch (error) {
      setLoginError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function createDocument(kind: 'folder' | 'document' = 'document', templateId?: string) {
    if (!token) return
    setNewMenuOpen(false)
    try {
      const parentId = selectedFolderId || undefined
      const payload: Record<string, unknown> = { kind, parentId }
      if (kind === 'folder') payload.title = '新建文件夹'
      else if (templateId) { payload.templateId = templateId; payload.title = templateLabel(templateId, templates.find((template) => template.id === templateId)?.name) }
      else { payload.titleMode = 'auto'; payload.content = emptyContent }
      const { document: created } = await api.createDocument(token, payload)
      setDocuments((items) => [created, ...items])
      setShowRight(false)
      setQuery('')
      if (kind === 'folder') {
        setActive(null)
        setSelectedFolderId(created.id)
        setExpandedFolders((folders) => new Set([...folders, created.id, ...(parentId ? [parentId] : [])]))
      } else {
        setActive(created)
        setSelectedFolderId(created.parentId || null)
        setHomeView('home')
      }
      if (narrow) setSidebarOpen(false)
      if (templateId) setNotice('已用模板创建“' + (created.title || '未命名文档') + '”')
      void refreshStats()
    } catch (error) {
      setNotice('创建失败：' + (error as Error).message)
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !token) return
    if (file.size > 2 * 1024 * 1024) { setNotice('Markdown 文件不能超过 2 MB'); return }
    try {
      const markdown = await file.text()
      const { document: imported } = await api.importMarkdown(token, markdown, selectedFolderId || null)
      setDocuments((items) => [imported, ...items])
      setActive(imported)
      setSelectedFolderId(imported.parentId || null)
      setHomeView('home')
      setShowRight(false)
      setQuery('')
      setNotice('已导入“' + (imported.title || file.name) + '”')
      void refreshStats()
    } catch (error) {
      setNotice('导入失败：' + (error as Error).message)
    }
  }

  async function updateDocument(doc: Doc, fields: { title?: string; parentId?: string | null }) {
    try {
      const result = await api.updateDocument(token, doc.id, { ...fields, expectedVersion: doc.version })
      setDocuments((rows) => rows.map((row) => row.id === doc.id ? result.document : row))
      setActive((current) => current?.id === doc.id ? result.document : current)
      setNotice('文档已更新')
    } catch (error) {
      setNotice('更新失败：' + (error as Error).message)
    }
  }

  async function duplicateDocument(doc: Doc) {
    if (doc.kind === 'folder') return
    try {
      const { document: copy } = await api.duplicate(token, doc.id, doc.parentId ?? null)
      setDocuments((rows) => [copy, ...rows])
      setActive(copy)
      setSelectedFolderId(copy.parentId || null)
      setHomeView('home')
      setNotice('已创建副本“' + (copy.title || '未命名文档') + '”')
      void refreshStats()
      await refreshDocuments()
    } catch (error) {
      setNotice('复制失败：' + (error as Error).message)
    }
  }

  async function handleDocumentAction(action: TreeAction, doc: Doc) {
    if (action === 'favorite') {
      const favorite = !favoriteSet.has(doc.id)
      try {
        await api.favorite(token, doc.id, favorite)
        setFavorites(favorite ? [...favoriteIds, doc.id] : favoriteIds.filter((id) => id !== doc.id))
      } catch (error) {
        setNotice('收藏失败：' + (error as Error).message)
      }
      return
    }
    if (action === 'rename') {
      setRenameDoc(doc)
      return
    }
    if (action === 'duplicate') {
      await duplicateDocument(doc)
      return
    }
    if (action === 'move') {
      setMoveDoc(doc)
      return
    }
    if (action === 'delete') {
      setDeleteDoc(doc)
    }
  }

  function toggleChecked(doc: Doc) {
    setCheckedIds((current) => {
      const next = new Set(current ?? [])
      if (next.has(doc.id)) next.delete(doc.id)
      else next.add(doc.id)
      return next
    })
  }

  async function batchDelete() {
    if (!checkedIds || checkedIds.size === 0) return
    const ids = [...checkedIds]
    setBatchBusy(true)
    let failed = 0
    // Sequential so a failure reports the exact document and the rest still go.
    for (const id of ids) {
      try { await api.remove(token, id) } catch { failed += 1 }
    }
    setBatchBusy(false)
    setCheckedIds(null)
    setNotice(failed
      ? `已移到回收站 ${ids.length - failed} 项，${failed} 项失败`
      : `已把 ${ids.length} 项移到回收站`)
    // The tree has to be re-read: the row that was just deleted is still in
    // `documents`, and this used to dispatch a 'mdoc-reload' event that no
    // component had ever listened for, so the deleted rows stayed visible.
    await refreshDocuments()
  }

  async function batchFavorite() {
    if (!checkedIds || checkedIds.size === 0) return
    const ids = [...checkedIds]
    setBatchBusy(true)
    let failed = 0
    for (const id of ids) {
      try { await api.favorite(token, id, true) } catch { failed += 1 }
    }
    setBatchBusy(false)
    setFavorites(Array.from(new Set([...favoriteIds, ...ids])))
    setNotice(failed ? `${ids.length - failed} 项已收藏，${failed} 项失败` : `已收藏 ${ids.length} 项`)
  }

  async function moveDocument(doc: Doc, parentId: string | null) {
    setMoveDoc(null)
    await updateDocument(doc, { parentId })
  }

  async function addComment() {
    if (!commentText.trim() || !active || commentRequest.current) return
    const documentId = active.id
    const body = commentText.trim()
    const anchor = commentAnchor && !commentParentId ? editorHandle.current?.commentDraftAnchor() : null
    if (commentAnchor && !commentParentId && !anchor) { setNotice('引用的内容已删除，请移除引用后再发送。'); return }
    commentRequest.current = true
    setCommentSending(true)
    try {
      const payload: Record<string, unknown> = { body }
      if (anchor) payload.anchor = anchor
      if (commentParentId) payload.parentId = commentParentId
      const result = await api.addComment(token, documentId, payload)
      if (activeRef.current?.id !== documentId) return
      setComments((rows) => [...rows, { ...result.comment, userName: user?.name || user?.email || '成员' }])
      setCommentText('')
      setCommentAnchor(null)
      setCommentParentId(null)
      setActiveCommentId(null)
    } catch (error) {
      setNotice('评论失败：' + (error as Error).message)
    } finally {
      commentRequest.current = false
      setCommentSending(false)
    }
  }

  async function updateCommentStatus(comment: Comment, status: 'open' | 'resolved') {
    if (!active) return
    const documentId = active.id
    try {
      await api.setCommentStatus(token, documentId, comment.id, status)
      if (activeRef.current?.id !== documentId) return
      setComments((rows) => rows.map((row) => row.id === comment.id ? { ...row, status } : row))
      setNotice(status === 'resolved' ? '评论已解决' : '评论已重新打开')
    } catch (error) {
      setNotice('评论更新失败：' + (error as Error).message)
    }
  }

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; status?: 'open' | 'resolved' }>).detail
      const comment = comments.find((row) => row.id === detail?.id)
      if (comment && detail?.status) void updateCommentStatus(comment, detail.status)
    }
    window.addEventListener('mdoc-comment-status', handler)
    return () => window.removeEventListener('mdoc-comment-status', handler)
  }, [comments, active])

  function openVersionPreview(version: Version) {
    try {
      const current = editorHandle.current?.snapshot()
      setPreviewCurrent({ content: current?.content || activeRef.current?.content, title: current?.title || activeRef.current?.title })
    } catch {
      setPreviewCurrent({ content: activeRef.current?.content, title: activeRef.current?.title })
    }
    setPreviewVersion(version)
  }

  async function restoreVersion(versionId: string) {
    const source = activeRef.current
    const handle = editorHandle.current
    if (!source || !handle || restoreTarget.current) return false
    restoreTarget.current = source.id
    handle.setLocked(true)
    try {
      await handle.flushTitle()
      if (pendingSave.current?.id === source.id) {
        window.clearTimeout(saveTimer.current)
        const pending = pendingSave.current
        pendingSave.current = null
        await pending.run()
      }
      await saveQueue.current.wait(source.id)
      const snapshot = handle.snapshot()
      if (snapshot.documentId !== source.id || activeRef.current?.id !== source.id) throw new Error('当前文档已切换，请重新选择历史版本。')
      let latest = (await api.document(token, source.id)).document
      if (!snapshot.stateVector) {
        // The REST editor has no room that the server can flush. Persist its
        // exact local body before restoring, so that it becomes the backup.
        try {
          latest = await saveQueue.current.enqueue(source.id, async () => (await api.saveContent(token, source.id, snapshot.content.doc, latest.version)).document)
        } catch (error) {
          if (userRef.current) writeDraft(localStorage, source.id, userRef.current.id, snapshot.content.doc)
          throw error
        }
      }
      if (activeRef.current?.id !== source.id) throw new Error('当前文档已切换，恢复已取消。')
      const { document: restored } = await api.restoreVersion(token, source.id, versionId, latest.version, snapshot.stateVector)
      if (activeRef.current?.id === source.id) {
        activeRef.current = restored
        setActive(restored)
        // Only an explicit replacement recreates the editor. Routine autosaves
        // keep the same instance, selection and undo stack.
        setEditorEpoch((epoch) => epoch + 1)
        setSaveStatus('saved')
        setCommentAnchor(null)
        setActiveCommentId(null)
      }
      setDocuments((rows) => rows.map((row) => row.id === restored.id ? restored : row))
      if (userRef.current) clearSavedDraft(localStorage, source.id, userRef.current.id, snapshot.content.doc)
      window.dispatchEvent(new CustomEvent('mdoc-updated', { detail: restored }))
      setNotice('已恢复此版本，恢复前的内容已保留在历史中')
      return true
    } catch (error) {
      const failure = error as Error & { code?: string }
      setNotice(failure.code === 'SYNC_PENDING' ? '最近的编辑尚未同步完成，请稍后重试恢复。' : '恢复失败：' + failure.message)
      return false
    } finally {
      restoreTarget.current = null
      handle.setLocked(false)
    }
  }

  /*
   * The breadcrumb path for whatever is open. A folder shows its own ancestors; a
   * document shows the folders above it. Computed here rather than in TopBar so
   * the bar stays a projection of shell state, like every other prop it takes.
   */
  const breadcrumbTrail = useMemo(() => {
    const anchorId = active?.id ?? selectedFolderId
    if (!anchorId) return []
    return ancestorsOf(anchorId, documents).map((entry) => ({ id: entry.id, title: entry.title }))
  }, [active?.id, selectedFolderId, documents])
  const treeQuery = query === FAVORITES_SCOPE ? '' : query.trim().toLowerCase()
  const tree = useMemo(() => buildDocTree(documents), [documents])
  const visibleTree = useMemo(() => filterDocTree(tree, treeQuery), [tree, treeQuery])
  const selectedFolder = documents.find((doc) => doc.id === selectedFolderId && doc.kind === 'folder') || null
  const folderChildren = documents.filter((doc) => (doc.parentId || null) === selectedFolderId)
  const showingSearch = homeView === 'search' && !!treeQuery && treeQuery.length > 0

  // A stored token with no user yet means the session is being restored, not
  // that there is no session. Returning the login form here made every reload
  // flash a password prompt before the workspace appeared.
  if (token && !user) return <BootScreen />
  if (!token || !user) return <LoginPage onLogin={login} onAccepted={({ token: acceptedToken, user: acceptedUser }) => { setToken(acceptedToken); setUser(acceptedUser) }} error={loginError} busy={busy} />
  if (workspaceView === 'admin' && user.role === 'admin') return <AdminWorkspace
    user={user}
    members={adminMembers}
    membersBusy={adminMembersBusy}
    updateInfo={updateInfo}
    notice={notice}
    showInvite={showInvite}
    onBack={() => setWorkspaceView('documents')}
    onOpenInvite={() => { setShowInvite(true); invite.reset() }}
    /*
     * Run the update directly: the confirmation dialog lives in the document
     * shell below, but the admin page returns before that point, so queueing the
     * prompt there rendered nothing and the click looked dead. The admin page
     * already states "系统会在更新前自动备份数据库", which is what the dialog
     * repeated.
     */
    onStartUpdate={() => void startUpdate()}
    onLogout={clearToken}
    onCloseInvite={() => setShowInvite(false)}
    inviteProps={{ email: invite.email, setEmail: invite.setEmail, role: invite.role, setRole: invite.setRole, link: invite.link, error: invite.error, busy: invite.busy, copied: invite.copied, onSubmit: invite.onSubmit, onCopy: invite.onCopy }}
  />

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    {sidebarOpen && <Sidebar
      user={user}
      tree={visibleTree}
      favoriteSet={favoriteSet}
      activeId={active?.id || null}
      selectedFolderId={selectedFolderId}
      expandedFolders={expandedFolders}
      homeView={homeView}
      emptyMessage={treeQuery ? '没有匹配的文档' : '暂无文档或文件夹'}
      query={query === FAVORITES_SCOPE ? '' : query}
      narrow={narrow}
      floating={narrow}
      workspaceOpen={workspaceOpen}
      newMenuOpen={newMenuOpen}
      treeExpanded={expanded}
      onClose={() => setSidebarOpen(false)}
      onWorkspaceMenu={setWorkspaceOpen}
      onSearch={(value) => {
        setQuery(value)
        setCommandIndex(0)
        if (value.trim()) { setHomeView('search'); setActive(null); setSelectedFolderId(null) }
        else if (homeView === 'search') setHomeView('home')
      }}
      onHome={() => { withViewTransition(() => { setHomeView('home'); setActive(null); setSelectedFolderId(null); setQuery(''); setShowRight(false) }); if (narrow) setSidebarOpen(false) }}
      onAdmin={() => { withViewTransition(() => setWorkspaceView('admin')); if (narrow) setSidebarOpen(false) }}
      onRecent={() => { withViewTransition(() => { setHomeView('recent'); setActive(null); setSelectedFolderId(null); setQuery('') }); if (narrow) setSidebarOpen(false) }}
      onFavorites={() => { withViewTransition(() => { setHomeView('favorites'); setActive(null); setSelectedFolderId(null); setQuery('') }); if (narrow) setSidebarOpen(false) }}
      onTrash={() => { withViewTransition(() => { setHomeView('trash'); setActive(null); setSelectedFolderId(null); setQuery('') }); if (narrow) setSidebarOpen(false) }}
      onToggleTree={() => setExpanded((value) => !value)}
      onNewMenu={setNewMenuOpen}
      onCreateDocument={() => void createDocument('document')}
      onOpenTemplates={() => { setNewMenuOpen(false); setTemplateLibraryOpen(true); if (narrow) setSidebarOpen(false) }}
      onCreateFolder={() => void createDocument('folder')}
      onImport={() => importInput.current?.click()}
      onToggleFolder={(id) => setExpandedFolders((folders) => { const next = new Set(folders); if (next.has(id)) next.delete(id); else next.add(id); return next })}
      onSelectFolder={(folder) => { withViewTransition(() => { setSelectedFolderId(folder.id); setActive(null); setHomeView('home'); setQuery(''); setShowRight(false) }); if (narrow) setSidebarOpen(false) }}
      onSelectDocument={(doc) => { withViewTransition(() => { setActive(doc); setSelectedFolderId(doc.parentId || null); setHomeView('home'); setQuery(''); setShowRight(false) }); if (narrow) setSidebarOpen(false) }}
      onDocumentAction={(action, doc) => void handleDocumentAction(action, doc)}
      checkedIds={checkedIds}
      onToggleChecked={toggleChecked}
      onEnterSelection={() => setCheckedIds(new Set())}
      onExitSelection={() => setCheckedIds(null)}
      onBatchDelete={() => void batchDelete()}
      onBatchFavorite={() => void batchFavorite()}
      batchBusy={batchBusy}
      allDocs={documents}
      onMoveInto={(dragged, target) => void moveDocument(dragged, target ? target.id : null)}
      onHelp={() => { setWorkspaceOpen(false); setHelpOpen(true) }}
      onLogout={() => { setWorkspaceOpen(false); clearToken() }}
    />}
    {narrow && sidebarOpen && <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />}
    <main className="main-area" id="main-content" tabIndex={-1} onPointerDown={() => { if (narrow && sidebarOpen) setSidebarOpen(false) }}>
      <TopBar
        userInitial={(user.name || user.email)[0].toUpperCase()}
        title={active?.title || selectedFolder?.title || (showingSearch ? '搜索' : '所有文档')}
        showRoot={!narrow}
        trail={breadcrumbTrail}
        onOpenTrail={(id) => {
          const folder = documents.find((entry) => entry.id === id)
          if (folder) { setSelectedFolderId(folder.id); setActive(null); setHomeView('home') }
        }}
        saveStatus={saveStatus}
        collabStatus={collabStatus}
        collaborators={collaborators}
        sidebarOpen={sidebarOpen}
        hasDocument={Boolean(active)}
        favorite={Boolean(active && favoriteSet.has(active.id))}
        exportOpen={exportMenuOpen}
        themeId={themeId}
        themeOpen={themeMenuOpen}
        onThemeMenu={setThemeMenuOpen}
        onTheme={setTheme}
        onOpenSidebar={() => setSidebarOpen(true)}
        onFavorite={() => { if (active) void handleDocumentAction('favorite', active) }}
        onExport={(format) => void exportActive(format)}
        onExportMenu={setExportMenuOpen}
        onHistory={() => { setRightTab('history'); setShowRight(true) }}
        onComments={() => { setRightTab('comments'); setShowRight(true) }}
        onShare={openShareDialog}
      />
      {active && COLLAB_URL && collabStatus === 'disconnected' && <div className="collab-banner motion-sink" role="status"><AlertCircle size={14} />实时协作连接已断开，正在尝试重连，期间的修改会保存在本地。</div>}
      {active ? <div className="workspace-content">
        {/* No entry animation on the column itself.
            .workspace-content is the element named for the view transition, so
            the cross-fade already animates this exact region. Keying the column
            on the document id remounted it after that transition finished — the
            flag has been released by then — and its own motion-enter then faded
            the canvas in a second time. One region, one entrance. */}
        <section className="editor-column" key={active.id}>
          <DocumentEditor
            key={active.id + ':' + editorEpoch}
            ref={editorHandle}
            doc={active}
            token={token}
            persist={persist}
            user={user}
            saveStatus={saveStatus}
            onSaveStatus={setSaveStatus}
            onAwareness={setCollaborators}
            onCollabStatus={setCollabStatus}
            onSelection={(anchor) => { setCommentAnchor(anchor) }}
            onCommentLocations={setCommentLocations}
            onExport={(format) => void exportActive(format)}
            onLink={(range) => setLinkPrompt(range)}
            comments={comments}
            activeCommentId={activeCommentId}
            /*
             * The composer quotes a range, so that range is shown in the text
             * while the draft exists — the writer sees what the comment will
             * point at before sending it. Only while the comments tab is
             * actually visible: selecting a word to bold must not paint a quote
             * outline that belongs to a panel nobody has opened.
             */
            commentDraft={commentDraft}
          />
        </section>
        {active && <DocumentPanel
          doc={active}
          token={token}
          open={showRight}
          tab={rightTab}
          comments={comments}
          commentText={commentText}
          commentAnchor={commentAnchor}
          commentLocations={commentLocations}
          commentSending={commentSending}
          currentUserId={user.id}
          onEditComment={async (comment, body) => {
            const documentId = active.id
            const result = await api.editComment(token, documentId, comment.id, body)
            if (activeRef.current?.id === documentId) setComments((rows) => rows.map((row) => row.id === comment.id ? { ...row, ...result.comment } : row))
          }}
          onDeleteComment={async (comment) => {
            const documentId = active.id
            const result = await api.removeComment(token, documentId, comment.id)
            if (activeRef.current?.id === documentId) setComments((rows) => rows.map((row) => row.id === comment.id ? { ...row, ...result.comment } : row))
          }}
          replyTo={comments.find((comment) => comment.id === commentParentId) ?? null}
          onCancelReply={() => { setCommentParentId(null); setCommentAnchor(null) }}
          activeCommentId={activeCommentId}
          onActiveComment={setActiveCommentId}
          onTab={setRightTab}
          onClose={() => setShowRight(false)}
          onCommentText={setCommentText}
          onClearAnchor={() => setCommentAnchor(null)}
          onSubmitComment={() => void addComment()}
          onReply={(comment) => {
            // Replying points at the parent's words, so the parent's range is
            // quoted and the marker lights up while the reply is written.
            setCommentParentId(comment.id)
            setCommentAnchor(null)
            setActiveCommentId(comment.id)
          }}
          onCommentStatus={(comment, status) => void updateCommentStatus(comment, status)}
          onPreviewVersion={openVersionPreview}
        />}
      </div> : selectedFolder ? <FolderOverview
        // Remounting per folder replays the entry animation, so opening another
        // folder reads as a navigation instead of a silent content swap.
        key={selectedFolder.id}
        folder={selectedFolder}
        items={folderChildren}
        onCreate={() => void createDocument('document')}
        onImport={() => importInput.current?.click()}
        onCreateFolder={() => void createDocument('folder')}
        onOpen={(doc) => { if (doc.kind === 'folder') { setSelectedFolderId(doc.id); setActive(null) } else { setActive(doc); setSelectedFolderId(doc.parentId || null) } }}
      /> : showingSearch ? <SearchPage
        query={query.trim()}
        scope={searchScope}
        onScope={setSearchScope}
        results={searchResults}
        loading={searchLoading}
        onOpen={(doc) => { if (doc.kind === 'folder') setSelectedFolderId(doc.id); else setActive(doc); setSelectedFolderId(doc.parentId || null) }}
      /> : <HomeDashboard
        // One component serves home, favorites and trash; the key makes each
        // view a fresh mount so its cards stagger in on arrival.
        key={homeView}
        documents={homeView === 'trash' ? trashDocuments : homeView === 'recent' ? recentDocuments : documents}
        favorites={favoriteSet}
        query={query === FAVORITES_SCOPE ? '' : query}
        trash={homeView === 'trash'}
        favoritesView={homeView === 'favorites'}
        recentView={homeView === 'recent'}
        stats={stats}
        onOpen={(doc) => { setActive(doc); setSelectedFolderId(doc.parentId || null) }}
        onCreate={() => void createDocument('document')}
        onImport={() => importInput.current?.click()}
        onCreateFolder={() => void createDocument('folder')}
        onRestore={async (doc) => {
          await api.restoreFromTrash(token, doc.id)
          setTrashDocuments((rows) => rows.filter((row) => row.id !== doc.id))
          setNotice('文档已恢复')
          void refreshStats()
          await refreshDocuments()
        }}
        onPermanentDelete={async (doc) => { setPurgeDoc(doc) }}
        onEmptyTrash={() => setEmptyTrashOpen(true)}
        trashRetentionDays={trashRetentionDays ?? undefined}
      />}
      {commandOpen && <CommandPalette
        query={query}
        onQuery={(value) => { setQuery(value); setCommandIndex(0) }}
        scope={searchScope}
        onScope={(scope) => { setSearchScope(scope); setCommandIndex(0) }}
        index={commandIndex}
        onIndex={setCommandIndex}
        results={searchResults}
        loading={searchLoading}
        onClose={() => setCommandOpen(false)}
        onOpen={(doc) => { if (doc.kind === 'folder') { setSelectedFolderId(doc.id); setActive(null) } else { setActive(doc); setSelectedFolderId(doc.parentId || null) } setHomeView('home'); setQuery(''); setCommandOpen(false) }}
        onCreate={() => { setCommandOpen(false); void createDocument('document') }}
        onHome={() => { setActive(null); setSelectedFolderId(null); setHomeView('home'); setQuery(''); setCommandOpen(false) }}
      />}
      {/*
        Announcements need a live region that is present *before* the text
        changes: replacing the whole node (an old `key` on the message) means
        screen readers see a new element rather than an update, and most stay
        silent. The container is therefore always mounted and only its text
        swaps, while the visible toast is a child that animates in and out.
      */}
      <div className="notice-live" role="status" aria-live="polite" aria-atomic="true">
        {notice ? notice : ''}
        {pdfProgress !== null ? '正在生成 PDF' : ''}
      </div>
      {/*
        PDF rendering blocks the main thread for a moment on a long document, so
        it gets a scrim with a determinate bar rather than a silent pause: the
        user otherwise clicks export, sees nothing, and clicks again.
      */}
      {pdfProgress !== null && <div className="pdf-progress motion-fade" role="dialog" aria-modal="true" aria-label="正在生成 PDF">
        <div className="pdf-progress-card motion-sheet">
          <span className="pdf-progress-title">正在生成 PDF…</span>
          <span className="pdf-progress-track" aria-hidden="true"><i style={{ width: Math.round(pdfProgress * 100) + '%' }} /></span>
          <span className="pdf-progress-hint">文档较长时需要几秒钟，请保持页面打开。</span>
        </div>
      </div>}
      {notice && <div className="notice-toast">
        {notice}
        <button aria-label="关闭提示" title="关闭提示" onClick={() => setNotice('')}><X size={13} /></button>
      </div>}
    </main>
    {conflictDoc && <Dialog
      title="文档已在别处更新"
      description="另一个人或另一个标签页保存了更新的版本。选择要保留的内容，两个版本都不会因此丢失。"
      confirmLabel="保留我的版本"
      onConfirm={() => void resolveConflict('mine')}
      onClose={() => void resolveConflict('theirs')}
    >
      <p className="dialog-hint">你的改动已存为本地草稿。关闭此对话框（或按 Esc）等于选择服务器版本。</p>
    </Dialog>}
    {showShare && active && <ShareDialog
      title={active.title}
      members={sharing.members}
      permissions={sharing.permissions}
      restricted={sharing.restricted}
      busy={sharing.busy}
      loadError={sharing.loadError}
      shareLinks={sharing.shareLinks}
      shareLinkCopied={sharing.linkCopied}
      onCreateShareLink={(permission, expiresInDays) => void sharing.createLink(active, permission, expiresInDays)}
      onCopyShareLink={(link) => void sharing.copyLink(link)}
      onRetry={() => void sharing.load(active)}
      onRevokeShareLink={(linkId: string) => void sharing.revokeLink(active, linkId)}
      onRestrictedChange={(value) => void sharing.setRestriction(active, value)}
      onPermissionChange={(member, role) => void sharing.setPermission(active, member, role)}
      onClose={() => setShowShare(false)}
    />}
    {templateLibraryOpen && <TemplateLibrary templates={templates} onCreateTemplate={(templateId) => void createDocument('document', templateId)} onClose={() => setTemplateLibraryOpen(false)} />}
    {showInvite && <InviteDialog
      email={invite.email}
      setEmail={invite.setEmail}
      role={invite.role}
      setRole={invite.setRole}
      link={invite.link}
      error={invite.error}
      busy={invite.busy}
      copied={invite.copied}
      onSubmit={invite.onSubmit}
      onCopy={invite.onCopy}
      onClose={() => setShowInvite(false)}
    />}
    {moveDoc && <MoveDialog doc={moveDoc} documents={documents} busy={busy} onMove={(parentId) => void moveDocument(moveDoc, parentId)} onClose={() => setMoveDoc(null)} />}
    {previewVersion && active && <VersionPreview token={token} documentId={active.id} version={previewVersion} currentContent={previewCurrent.content} currentTitle={previewCurrent.title} onRestore={restoreVersion} onClose={() => setPreviewVersion(null)} />}
    <input ref={importInput} className="visually-hidden" type="file" accept=".md,.markdown,.txt" aria-label="导入 Markdown 文件" onChange={(event) => void handleImport(event)} />
    {active?.content && user && <DraftRecovery key={active.id} doc={active} token={token} userId={user.id} notify={setNotice} onRecovered={(recovered) => {
      setDocuments((items) => [recovered, ...items])
      setActive(recovered)
      setHomeView('home')
      setSelectedFolderId(null)
      void refreshStats()
    }} />}
    <ShellDialogs
      renameDoc={renameDoc}
      deleteDoc={deleteDoc}
      purgeDoc={purgeDoc}
      emptyTrashCount={emptyTrashOpen ? trashDocuments.length : 0}
      emptyTrashBusy={emptyTrashBusy}
      helpOpen={helpOpen}
      linkPrompt={linkPrompt}
      onRename={(doc, title) => void updateDocument(doc, { title })}
      onCancelRename={() => setRenameDoc(null)}
      onConfirmDelete={async (doc) => {
        setDeleteDoc(null)
        try {
          await api.remove(token, doc.id)
          setDocuments((rows) => rows.filter((row) => row.id !== doc.id))
          if (active?.id === doc.id) setActive(null)
          setNotice('已移到回收站')
          void refreshStats()
        } catch (error) { setNotice('删除失败：' + (error as Error).message) }
      }}
      onCancelDelete={() => setDeleteDoc(null)}
      onConfirmPurge={async (doc) => {
        setPurgeDoc(null)
        try {
          await api.purge(token, doc.id)
          setTrashDocuments((rows) => rows.filter((row) => row.id !== doc.id))
          setNotice('文档已永久删除')
          void refreshStats()
        } catch (error) { setNotice('永久删除失败：' + (error as Error).message) }
      }}
      onCancelPurge={() => setPurgeDoc(null)}
      onConfirmEmptyTrash={async () => {
        setEmptyTrashBusy(true)
        try {
          const { removed } = await api.emptyTrash(token)
          setTrashDocuments([])
          setEmptyTrashOpen(false)
          setNotice(removed ? '已永久删除 ' + removed + ' 项' : '回收站已经是空的')
          void refreshStats()
        } catch (error) { setNotice('清空回收站失败：' + (error as Error).message) }
        finally { setEmptyTrashBusy(false) }
      }}
      onCancelEmptyTrash={() => setEmptyTrashOpen(false)}
      onCloseHelp={() => setHelpOpen(false)}
      onInsertLink={(range, nextHref) => window.dispatchEvent(new CustomEvent('mdoc-insert-link', { detail: { ...range, nextHref } }))}
      onCancelLink={() => { window.dispatchEvent(new CustomEvent('mdoc-cancel-link', { detail: linkPrompt })); setLinkPrompt(null) }}
    />
  </div>
}

export default App
