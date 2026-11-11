import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { api } from './lib/endpoints'
import { copyText } from './lib/clipboard'
import { Dialog } from './components/ui/Dialog'
import { withViewTransition } from './lib/motion'
import { COLLAB_URL } from './lib/collab'
import { downloadTextFile, EXPORT_MIME, printHtmlDocument } from './lib/download'
import { buildDocTree, filterDocTree } from './lib/tree'
import { useWorkspaceData } from './hooks/useWorkspaceData'
import { emptyContent } from './lib/types'
import type { CollabStatus, RightTab, UpdateInfo } from './lib/app-types'
import type {
  Comment, Doc, DocumentPermission, ExportTarget, SaveStatus, SearchScope, TreeAction, Version, WorkspaceMember,
} from './lib/types'
import AdminWorkspace from './pages/AdminPage'
import CommandPalette from './pages/CommandPalette'
import HomeDashboard, { FolderOverview } from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import SearchPage from './pages/SearchPage'
import SharedDocumentPage from './pages/SharedDocumentPage'
import ShellDialogs from './components/dialogs/ShellDialogs'
import ShareDialog from './components/dialogs/ShareDialog'
import InviteDialog from './components/dialogs/InviteDialog'
import MoveDialog from './components/dialogs/MoveDialog'
import DocumentEditor from './components/editor/DocumentEditor'
import { templateLabel } from './components/layout/TemplateMenu'
import DocumentPanel from './components/panels/DocumentPanel'
import Sidebar from './components/layout/Sidebar'
import TopBar from './components/layout/TopBar'
import VersionPreview from './components/panels/VersionPreview'

/**
 * Workspace shell: owns session, document list, and every overlay.
 *
 * Rendering of individual surfaces lives in ./pages (route-level screens),
 * ./components/editor (the Tiptap surface) and ./components/dialogs, so this
 * file only wires state to them.
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
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([])
  const [documentPermissions, setDocumentPermissions] = useState<DocumentPermission[]>([])
  const [documentRestricted, setDocumentRestricted] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareLinks, setShareLinks] = useState<Array<{id: string; token: string; permission: string; expiresAt: string | null}>>([])
  const [shareLinkCopied, setShareLinkCopied] = useState(false)
  /** Multi-select over the document tree; null means selection mode is off. */
  const [checkedIds, setCheckedIds] = useState<Set<string> | null>(null)
  /** Set when a save hit 409, so the user can pick which version wins. */
  const [conflictDoc, setConflictDoc] = useState<Doc | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member')
  const [inviteLink, setInviteLink] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === 'undefined' ? true : window.innerWidth > 820)
  const [commentText, setCommentText] = useState('')
  const [commentAnchor, setCommentAnchor] = useState<Comment['anchor']>(null)
  const [commentParentId, setCommentParentId] = useState<string | null>(null)
  const [collaborators, setCollaborators] = useState<Array<{ clientId: number; name: string; color: string }>>([])
  const [collabStatus, setCollabStatus] = useState<CollabStatus>('connecting')
  const [expanded, setExpanded] = useState(true)
  const [commandOpen, setCommandOpen] = useState(false)
  const [homeView, setHomeView] = useState<'home' | 'search' | 'trash' | 'favorites'>('home')
  const [searchScope, setSearchScope] = useState<SearchScope>('all')
  const [commandIndex, setCommandIndex] = useState(0)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [moveDoc, setMoveDoc] = useState<Doc | null>(null)
  const [previewVersion, setPreviewVersion] = useState<Version | null>(null)
  const [renameDoc, setRenameDoc] = useState<Doc | null>(null)
  const [deleteDoc, setDeleteDoc] = useState<Doc | null>(null)
  const [purgeDoc, setPurgeDoc] = useState<Doc | null>(null)
  const [updatePrompt, setUpdatePrompt] = useState<UpdateInfo | null>(null)
  const [linkPrompt, setLinkPrompt] = useState<{ from: number; to: number } | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const saveTimer = useRef<number | undefined>(undefined)
  const importInput = useRef<HTMLInputElement | null>(null)


  const closeOverlays = useCallback(() => {
    setCommandOpen(false)
    setShowRight(false)
    setShowShare(false)
    setShowInvite(false)
    setMoveDoc(null)
    setPreviewVersion(null)
    setNewMenuOpen(false)
    setExportMenuOpen(false)
    setWorkspaceOpen(false)
  }, [])



  /** Draft key so an unsaved edit survives a reload, a crash or a conflict. */
  const draftKey = (id: string) => 'mdocs-draft-' + id

  const persist = useCallback((json: Record<string, unknown>, immediate = false) => {
    if (!token || !activeRef.current) return
    const flush = async () => {
      const doc = activeRef.current
      if (!doc) return
      setSaveStatus('saving')
      try {
        const result = await api.saveContent(token, doc.id, json, doc.version)
        setActive(result.document)
        setDocuments((items) => items.map((item) => item.id === result.document.id ? result.document : item))
        setSaveStatus('saved')
        // The server accepted this edit, so the local safety copy is stale.
        try { window.localStorage.removeItem(draftKey(doc.id)) } catch { /* private mode */ }
      } catch (error) {
        const failure = error as Error & { status?: number }
        setSaveStatus('error')
        // Keep the exact bytes either way: a reload must not be the price of a
        // failed save, and a conflict must not silently discard the local edit.
        try { window.localStorage.setItem(draftKey(doc.id), JSON.stringify(json)) } catch { /* quota */ }
        if (failure.status === 409) {
          setConflictDoc(doc)
        } else {
          setNotice('保存失败，已保留本地副本：' + failure.message)
        }
      }
    }
    window.clearTimeout(saveTimer.current)
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
    setConflictDoc(null)
    try {
      const latest = await api.document(token, doc.id)
      if (choice === 'theirs') {
        setActive(latest.document)
        setDocuments((items) => items.map((item) => item.id === latest.document.id ? latest.document : item))
        try { window.localStorage.removeItem(draftKey(doc.id)) } catch { /* ignore */ }
        setSaveStatus('saved')
        return
      }
      let draft: Record<string, unknown> | null = null
      try { const raw = window.localStorage.getItem(draftKey(doc.id)); draft = raw ? JSON.parse(raw) as Record<string, unknown> : null } catch { /* ignore */ }
      if (!draft) { setNotice('本地草稿已丢失，已载入服务器版本'); setActive(latest.document); return }
      const saved = await api.saveContent(token, doc.id, draft, latest.document.version)
      setActive(saved.document)
      setDocuments((items) => items.map((item) => item.id === saved.document.id ? saved.document : item))
      try { window.localStorage.removeItem(draftKey(doc.id)) } catch { /* ignore */ }
      setSaveStatus('saved')
      setNotice('已用你的版本覆盖服务器内容')
    } catch (error) {
      setSaveStatus('error')
      setNotice('处理冲突失败：' + (error as Error).message)
    }
    // setActive/setDocuments are stable setState identities; conflictDoc and token
    // are the real inputs.
  }, [conflictDoc, token]) // eslint-disable-line react-hooks/exhaustive-deps

  const exportActive = useCallback(async (format: ExportTarget) => {
    setExportMenuOpen(false)
    const doc = activeRef.current
    if (!doc || doc.kind === 'folder') { setNotice('请先打开一个文档'); return }
    if (format === 'print') {
      try {
        const result = await api.exportDocument(token, doc.id, 'html')
        printHtmlDocument(result.content)
      } catch (error) {
        setNotice('打印失败：' + (error as Error).message)
      }
      return
    }
    try {
      const result = await api.exportDocument(token, doc.id, format)
      const filename = result.filename || (doc.title || 'document') + '.' + EXPORT_MIME[format].ext
      downloadTextFile(filename, result.content, EXPORT_MIME[format].type)
      setNotice('已导出 ' + filename)
    } catch (error) {
      setNotice('导出失败：' + (error as Error).message)
    }
  }, [token])









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
    versions, setVersions,
    favoriteIds, favoriteSet, setFavorites,
    templates,
    stats, refreshStats, refreshDocuments,
    trashDocuments, setTrashDocuments,
    searchResults, searchLoading,
    adminMembers, adminMembersBusy,
    updateInfo, setUpdateInfo,
  } = workspaceData

  const clearToken = useCallback(() => {
    localStorage.removeItem('mdocs-token')
    setToken('')
    setUser(null)
    setActive(null)
    setDocuments([])
    setComments([])
    setVersions([])
    setWorkspaceView('documents')
  }, [setUser, setActive, setDocuments, setComments, setVersions])

  const startUpdate = useCallback(async () => {
    if (!token || !updateInfo || updateInfo.status === 'running') return
    setUpdatePrompt(null)
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

  // Keyboard shortcuts, viewport tracking, document title, and the
  // unsaved-changes guard. These belong to the shell: they describe how the
  // workspace behaves, not what it contains.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey
      if (modifier && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true); setCommandIndex(0) }
      else if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); window.dispatchEvent(new Event('mdoc-force-save')) }
      else if (modifier && event.shiftKey && event.key.toLowerCase() === 'e') { event.preventDefault(); void exportActive('markdown') }
      if (event.key === 'Escape') closeOverlays()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exportActive, closeOverlays])

  useEffect(() => {
    if (saveStatus !== 'saving') return
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

  useEffect(() => {
    const showNotice = (event: Event) => setNotice((event as CustomEvent<string>).detail)
    window.addEventListener('mdoc-notice', showNotice)
    return () => window.removeEventListener('mdoc-notice', showNotice)
  }, [])

  useEffect(() => {
    if (!token || !active || active.kind === 'folder') return
    let live = true
    api.document(token, active.id)
      .then(({ document: document }) => { if (live) setActive(document) })
      .catch((error) => { if (live) setNotice(error.message) })
    api.comments(token, active.id)
      .then(({ comments: rows }) => { if (live) setComments(rows || []) }).catch(() => undefined)
    api.versions(token, active.id)
      .then(({ versions: rows }) => { if (live) setVersions(rows || []) }).catch(() => undefined)
    return () => { live = false }
  }, [token, active?.id])

  // Refresh the side panel when its tab is opened so collaboration saves made
  // while the panel was closed show up without a page reload.
  useEffect(() => {
    if (!token || !active) return
    if (rightTab === 'history') {
      api.versions(token, active.id)
        .then(({ versions: rows }) => setVersions(rows || []))
        .catch(() => undefined)
    } else if (rightTab === 'comments') {
      api.comments(token, active.id)
        .then(({ comments: rows }) => setComments(rows || []))
        .catch(() => undefined)
    }
  }, [token, active?.id, rightTab])

  useEffect(() => {
    setSaveStatus('saved')
    setCollabStatus(COLLAB_URL ? 'connecting' : 'disconnected')
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
      else { payload.title = '未命名文档'; payload.content = emptyContent }
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
    window.dispatchEvent(new Event('mdoc-reload'))
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
    if (!commentText.trim() || !active) return
    try {
      const payload: Record<string, unknown> = { body: commentText.trim() }
      if (commentAnchor) payload.anchor = commentAnchor
      if (commentParentId) payload.parentId = commentParentId
      await api.addComment(token, active.id, payload)
      const result = await api.comments(token, active.id)
      setComments(result.comments || [])
      setCommentText('')
      setCommentAnchor(null)
      setCommentParentId(null)
    } catch (error) {
      setNotice('评论失败：' + (error as Error).message)
    }
  }

  async function updateCommentStatus(comment: Comment, status: 'open' | 'resolved') {
    if (!active) return
    try {
      await api.setCommentStatus(token, active.id, comment.id, status)
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

  async function loadShareLinks(docId: string) {
    try {
      const data = await api.shareLinks(token, docId)
      setShareLinks(data.shareLinks)
    } catch { setShareLinks([]) }
  }

  async function createShareLink(docId: string) {
    setShareBusy(true)
    try {
      const data = await api.createShareLink(token, docId, 'viewer')
      const url = window.location.origin + '/shared/' + data.shareLink.token
      setShareLinks((prev) => [{ id: data.shareLink.id, token: data.shareLink.token, permission: data.shareLink.permission, expiresAt: null }, ...prev])
      // Plain-HTTP deployments have no navigator.clipboard, so use the helper
      // and report the real outcome instead of claiming success.
      const copied = await copyText(url)
      setShareLinkCopied(copied)
      if (!copied) window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '链接已生成，但浏览器阻止了自动复制，请手动复制。' }))
      setTimeout(() => setShareLinkCopied(false), 2500)
    } catch (error) {
      console.error('[share] create failed', error)
      window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '创建分享链接失败：' + (error as Error).message }))
    } finally { setShareBusy(false) }
  }

  async function revokeShareLink(docId: string, linkId: string) {
    setShareBusy(true)
    try {
      await api.revokeShareLink(token, docId, linkId)
      setShareLinks((prev) => prev.filter((l) => l.id !== linkId))
    } catch (error) {
      window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '删除分享链接失败：' + (error as Error).message }))
    } finally { setShareBusy(false) }
  }

  async function openShareDialog() {
    if (!active || active.kind === 'folder') { setNotice('请先打开一个文档再设置共享权限'); return }
    setShowShare(true)
    setShareBusy(true)
    try {
      const [members, access] = await Promise.all([
        api.members(token),
        api.acl(token, active.id),
      ])
      setWorkspaceMembers(members.members || [])
      setDocumentPermissions(access.permissions || [])
      setDocumentRestricted(access.restricted)
      void loadShareLinks(active.id)
    } catch (error) {
      setNotice('共享设置加载失败：' + (error as Error).message)
      setShowShare(false)
    } finally {
      setShareBusy(false)
    }
  }

  async function saveDocumentPermission(member: WorkspaceMember, role: DocumentPermission['role'] | null) {
    if (!active) return
    setShareBusy(true)
    try {
      await api.setAcl(token, active.id, { userId: member.id, role, restricted: documentRestricted })
      setDocumentPermissions((current) => {
        const next = current.filter((permission) => permission.userId !== member.id)
        return role ? [...next, { userId: member.id, email: member.email, name: member.name || member.email, role }] : next
      })
    } catch (error) {
      setNotice('权限更新失败：' + (error as Error).message)
    } finally {
      setShareBusy(false)
    }
  }

  async function toggleDocumentRestriction(restricted: boolean) {
    if (!active) return
    setDocumentRestricted(restricted)
    setShareBusy(true)
    try {
      const owner = documentPermissions.find((permission) => permission.userId === user?.id)
      await api.setAcl(token, active.id, { userId: user!.id, role: owner?.role || 'owner', restricted })
    } catch (error) {
      setDocumentRestricted(!restricted)
      setNotice('共享范围更新失败：' + (error as Error).message)
    } finally {
      setShareBusy(false)
    }
  }

  async function createInvite(event: FormEvent) {
    event.preventDefault()
    setInviteError('')
    setInviteLink('')
    setInviteBusy(true)
    try {
      const { invite } = await api.invite(token, inviteEmail, inviteRole)
      const url = new URL(window.location.href)
      url.search = ''
      url.hash = ''
      url.searchParams.set('invite', invite.token)
      setInviteLink(url.toString())
    } catch (error) {
      setInviteError((error as Error).message)
    } finally {
      setInviteBusy(false)
    }
  }

  async function copyInviteLink() {
    if (!inviteLink) return
    const ok = await copyText(inviteLink)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } else {
      setInviteError('浏览器阻止了自动复制，请手动选中链接复制。')
    }
  }

  async function restoreVersion(versionId: string) {
    if (!active) return false
    try {
      const { document: restored } = await api.restoreVersion(token, active.id, versionId, active.version)
      setActive(restored)
      setDocuments((rows) => rows.map((row) => row.id === restored.id ? restored : row))
      setNotice('已恢复到此版本')
      api.versions(token, restored.id)
        .then(({ versions: rows }) => setVersions(rows || []))
        .catch(() => undefined)
      return true
    } catch (error) {
      setNotice('恢复失败：' + (error as Error).message)
      return false
    }
  }

  const treeQuery = query === '__favorites__' ? '' : query.trim().toLowerCase()
  const tree = useMemo(() => buildDocTree(documents), [documents])
  const visibleTree = useMemo(() => filterDocTree(tree, treeQuery), [tree, treeQuery])
  const selectedFolder = documents.find((doc) => doc.id === selectedFolderId && doc.kind === 'folder') || null
  const folderChildren = documents.filter((doc) => (doc.parentId || null) === selectedFolderId)
  const showingSearch = homeView === 'search' && !!treeQuery && treeQuery.length > 0

  if (!token || !user) return <LoginPage onLogin={login} onAccepted={({ token: acceptedToken, user: acceptedUser }) => { setToken(acceptedToken); setUser(acceptedUser) }} error={loginError} busy={busy} />
  if (workspaceView === 'admin' && user.role === 'admin') return <AdminWorkspace
    user={user}
    members={adminMembers}
    membersBusy={adminMembersBusy}
    updateInfo={updateInfo}
    notice={notice}
    showInvite={showInvite}
    onBack={() => setWorkspaceView('documents')}
    onOpenInvite={() => { setShowInvite(true); setInviteError(''); setInviteLink('') }}
    onStartUpdate={() => setUpdatePrompt(updateInfo)}
    onLogout={clearToken}
    onCloseInvite={() => setShowInvite(false)}
    inviteProps={{ email: inviteEmail, setEmail: setInviteEmail, role: inviteRole, setRole: setInviteRole, link: inviteLink, error: inviteError, busy: inviteBusy, copied, onSubmit: createInvite, onCopy: copyInviteLink }}
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
      templates={templates}
      query={query === '__favorites__' ? '' : query}
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
      onFavorites={() => { withViewTransition(() => { setHomeView('favorites'); setActive(null); setSelectedFolderId(null); setQuery('') }); if (narrow) setSidebarOpen(false) }}
      onTrash={() => { withViewTransition(() => { setHomeView('trash'); setActive(null); setSelectedFolderId(null); setQuery('') }); if (narrow) setSidebarOpen(false) }}
      onToggleTree={() => setExpanded((value) => !value)}
      onNewMenu={setNewMenuOpen}
      onCreateDocument={(templateId) => void createDocument('document', templateId)}
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
      onHelp={() => { setWorkspaceOpen(false); setHelpOpen(true) }}
      onLogout={() => { setWorkspaceOpen(false); clearToken() }}
    />}
    {narrow && sidebarOpen && <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />}
    <main className="main-area" id="main-content" tabIndex={-1} onPointerDown={() => { if (narrow && sidebarOpen) setSidebarOpen(false) }}>
      <TopBar
        userInitial={(user.name || user.email)[0].toUpperCase()}
        title={active?.title || selectedFolder?.title || (showingSearch ? '搜索' : '所有文档')}
        showRoot={!narrow}
        saveStatus={saveStatus}
        collabStatus={collabStatus}
        collaborators={collaborators}
        sidebarOpen={sidebarOpen}
        hasDocument={Boolean(active)}
        favorite={Boolean(active && favoriteSet.has(active.id))}
        exportOpen={exportMenuOpen}
        onOpenSidebar={() => setSidebarOpen(true)}
        onFavorite={() => { if (active) void handleDocumentAction('favorite', active) }}
        onExport={(format) => void exportActive(format)}
        onExportMenu={setExportMenuOpen}
        onHistory={() => { setRightTab('history'); setShowRight(true) }}
        onComments={() => { setRightTab('comments'); setShowRight(true) }}
        onShare={() => void openShareDialog()}
      />
      {active && COLLAB_URL && collabStatus === 'disconnected' && <div className="collab-banner motion-sink" role="status"><AlertCircle size={14} />实时协作连接已断开，正在尝试重连，期间的修改会保存在本地。</div>}
      {active ? <div className="workspace-content">
        {/* Keyed on the document so switching documents replays the canvas
            entry animation instead of silently swapping content in place. */}
        <section className="editor-column motion-enter" key={active.id}>
          <DocumentEditor
            key={active.id}
            doc={active}
            token={token}
            persist={persist}
            user={user}
            saveStatus={saveStatus}
            onSaveStatus={setSaveStatus}
            onAwareness={setCollaborators}
            onCollabStatus={setCollabStatus}
            onSelection={(anchor) => { setCommentAnchor(anchor) }}
            onExport={(format) => void exportActive(format)}
            onLink={(range) => setLinkPrompt(range)}
          />
        </section>
        {active && <DocumentPanel
          doc={active}
          token={token}
          open={showRight}
          tab={rightTab}
          comments={comments}
          versions={versions}
          commentText={commentText}
          commentAnchor={commentAnchor}
          onTab={setRightTab}
          onClose={() => setShowRight(false)}
          onCommentText={setCommentText}
          onClearAnchor={() => setCommentAnchor(null)}
          onSubmitComment={() => void addComment()}
          onReply={(comment) => { setCommentParentId(comment.id); setCommentText('@' + (comment.userName || '成员') + ' ') }}
          onCommentStatus={(comment, status) => void updateCommentStatus(comment, status)}
          onPreviewVersion={setPreviewVersion}
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
        documents={homeView === 'trash' ? trashDocuments : documents}
        favorites={favoriteSet}
        query={query === '__favorites__' ? '' : query}
        trash={homeView === 'trash'}
        favoritesView={homeView === 'favorites'}
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
      </div>
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
    {showShare && active && <ShareDialog title={active.title} members={workspaceMembers} permissions={documentPermissions} restricted={documentRestricted} busy={shareBusy} shareLinks={shareLinks} shareLinkCopied={shareLinkCopied} onCreateShareLink={() => void createShareLink(active.id)} onRevokeShareLink={(linkId: string) => void revokeShareLink(active.id, linkId)} onRestrictedChange={(value) => void toggleDocumentRestriction(value)} onPermissionChange={(member, role) => void saveDocumentPermission(member, role)} onClose={() => setShowShare(false)} />}
    {showInvite && <InviteDialog email={inviteEmail} setEmail={setInviteEmail} role={inviteRole} setRole={setInviteRole} link={inviteLink} error={inviteError} busy={inviteBusy} copied={copied} onSubmit={createInvite} onCopy={copyInviteLink} onClose={() => setShowInvite(false)} />}
    {moveDoc && <MoveDialog doc={moveDoc} documents={documents} busy={busy} onMove={(parentId) => void moveDocument(moveDoc, parentId)} onClose={() => setMoveDoc(null)} />}
    {previewVersion && active && <VersionPreview token={token} documentId={active.id} version={previewVersion} onRestore={restoreVersion} onClose={() => setPreviewVersion(null)} />}
    <input ref={importInput} className="visually-hidden" type="file" accept=".md,.markdown,.txt" aria-label="导入 Markdown 文件" onChange={(event) => void handleImport(event)} />
    <ShellDialogs
      renameDoc={renameDoc}
      deleteDoc={deleteDoc}
      purgeDoc={purgeDoc}
      updatePrompt={updatePrompt}
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
      onConfirmUpdate={async () => { setUpdatePrompt(null); await startUpdate() }}
      onCancelUpdate={() => setUpdatePrompt(null)}
      onCloseHelp={() => setHelpOpen(false)}
      onInsertLink={(range, href) => window.dispatchEvent(new CustomEvent('mdoc-insert-link', { detail: { from: range.from, to: range.to, href } }))}
      onCancelLink={() => setLinkPrompt(null)}
    />
  </div>
}

export default App
