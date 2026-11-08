import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import './update.css'
import {
  Activity, AlertCircle, ArrowDownToLine, ArrowLeft, Bold, CheckSquare, ChevronDown, ChevronRight,
  Clock3, Code2, Copy, FilePlus2, FileText, Folder, FolderPlus, Highlighter as HighlightIcon, History,
  Home, Italic, LayoutDashboard, Link as LinkIcon, List, ListOrdered, LogOut, Mail, MessageCircle,
  Palette, PanelLeftClose, Plus, Redo2, Search, Send, Share2, ShieldCheck, Sparkles, Star, Table2,
  Trash2, Underline as UnderlineIcon, Undo2, Upload, UserPlus, Users, X,
} from 'lucide-react'
import { API, request } from './lib/api'
import { COLLAB_URL } from './lib/collab'
import { buildEditorExtensions } from './lib/editor'
import { buildDocTree, filterDocTree } from './lib/tree'
import { formatDate, wordCount } from './lib/format'
import { emptyContent } from './lib/types'
import type {
  Comment, Doc, DocumentPermission, ExportTarget, SaveStatus, SearchHit, SearchScope, Template,
  TreeAction, User, Version, WorkspaceMember, WorkspaceStats,
} from './lib/types'
import ActivityPanel from './components/ActivityPanel'
import CommandPalette from './components/CommandPalette'
import ExportMenu from './components/ExportMenu'
import MoveDialog from './components/MoveDialog'
import SearchPage from './components/SearchPage'
import StatsCards from './components/StatsCards'
import TemplateMenu, { templateLabel } from './components/TemplateMenu'
import TreeItem from './components/TreeItem'
import VersionPreview from './components/VersionPreview'
import { Dialog, PromptDialog } from './components/Dialog'
import Popover from './components/Popover'

type UpdateInfo = { version: string; url?: string; status: 'available' | 'running' | 'failed' | 'completed' }
type CollabStatus = 'connecting' | 'connected' | 'disconnected'
type RightTab = 'comments' | 'history' | 'activity'

const EXPORT_MIME: Record<'markdown' | 'html' | 'json', { ext: string; type: string }> = {
  markdown: { ext: 'md', type: 'text/markdown;charset=utf-8' },
  html: { ext: 'html', type: 'text/html;charset=utf-8' },
  json: { ext: 'json', type: 'application/json' },
}

function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function printHtmlDocument(html: string) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none'
  document.body.appendChild(frame)
  const fallback = () => {
    frame.remove()
    const popup = window.open('', '_blank')
    if (!popup) {
      window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: '浏览器阻止了打印窗口，请允许弹窗后重试' }))
      return
    }
    popup.document.write(html)
    popup.document.close()
    popup.focus()
    popup.print()
  }
  const frameDocument = frame.contentDocument
  if (!frameDocument) { fallback(); return }
  try {
    frameDocument.open()
    frameDocument.write(html)
    frameDocument.close()
  } catch {
    fallback()
    return
  }
  window.setTimeout(() => {
    try {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    } catch {
      fallback()
      return
    }
    window.setTimeout(() => frame.remove(), 4000)
  }, 150)
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('mdocs-token') || '')
  const [user, setUser] = useState<User | null>(null)
  const [workspaceView, setWorkspaceView] = useState<'documents' | 'admin'>('documents')
  const [adminMembers, setAdminMembers] = useState<WorkspaceMember[]>([])
  const [adminMembersBusy, setAdminMembersBusy] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [documents, setDocuments] = useState<Doc[]>([])
  const [active, setActive] = useState<Doc | null>(null)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set())
  const [comments, setComments] = useState<Comment[]>([])
  const [versions, setVersions] = useState<Version[]>([])
  const [rightTab, setRightTab] = useState<RightTab>('comments')
  const [showRight, setShowRight] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([])
  const [documentPermissions, setDocumentPermissions] = useState<DocumentPermission[]>([])
  const [documentRestricted, setDocumentRestricted] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member')
  const [inviteLink, setInviteLink] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === 'undefined' ? true : window.innerWidth > 820)
  const [commentText, setCommentText] = useState('')
  const [commentAnchor, setCommentAnchor] = useState<Comment['anchor']>(null)
  const [commentParentId, setCommentParentId] = useState<string | null>(null)
  const [collaborators, setCollaborators] = useState<Array<{ clientId: number; name: string; color: string }>>([])
  const [collabStatus, setCollabStatus] = useState<CollabStatus>('connecting')
  const [expanded, setExpanded] = useState(true)
  const [commandOpen, setCommandOpen] = useState(false)
  const [homeView, setHomeView] = useState<'home' | 'search' | 'trash'>('home')
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => JSON.parse(localStorage.getItem('mdocs-favorites') || '[]'))
  const [trashDocuments, setTrashDocuments] = useState<Doc[]>([])
  const [searchResults, setSearchResults] = useState<SearchHit[]>([])
  const [searchScope, setSearchScope] = useState<SearchScope>('all')
  const [searchLoading, setSearchLoading] = useState(false)
  const [commandIndex, setCommandIndex] = useState(0)
  const [templates, setTemplates] = useState<Template[]>([])
  const [stats, setStats] = useState<WorkspaceStats | null>(null)
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
  const [narrow, setNarrow] = useState(false)
  const saveTimer = useRef<number | undefined>(undefined)
  const importInput = useRef<HTMLInputElement | null>(null)
  const activeRef = useRef<Doc | null>(null)
  activeRef.current = active

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const setFavorites = useCallback((next: string[]) => {
    setFavoriteIds(next)
    localStorage.setItem('mdocs-favorites', JSON.stringify(next))
  }, [])

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

  const refreshStats = useCallback(async () => {
    if (!token) return
    try {
      const result = await request<{ stats: WorkspaceStats }>('/workspace/stats', token)
      setStats(result.stats)
    } catch {
      setStats(null)
    }
  }, [token])

  const refreshDocuments = useCallback(async () => {
    if (!token) return
    try {
      const result = await request<{ documents: Doc[] }>('/documents', token)
      setDocuments(result.documents || [])
    } catch {
      /* 保留现有列表 */
    }
  }, [token])

  const persist = useCallback((json: Record<string, unknown>, immediate = false) => {
    if (!token || !activeRef.current) return
    const flush = async () => {
      const doc = activeRef.current
      if (!doc) return
      setSaveStatus('saving')
      try {
        const result = await request<{ document: Doc }>('/documents/' + doc.id, token, {
          method: 'PUT',
          body: JSON.stringify({ content: { schemaVersion: 1, doc: json }, expectedVersion: doc.version }),
        })
        setActive(result.document)
        setDocuments((items) => items.map((item) => item.id === result.document.id ? result.document : item))
        setSaveStatus('saved')
      } catch (error) {
        const failure = error as Error & { status?: number }
        setSaveStatus('error')
        setNotice(failure.status === 409 ? '文档已在其他位置更新，请刷新后继续。' : '保存失败：' + failure.message)
      }
    }
    window.clearTimeout(saveTimer.current)
    if (immediate) { void flush(); return }
    setSaveStatus('saving')
    saveTimer.current = window.setTimeout(() => { void flush() }, 700)
  }, [token])

  const exportActive = useCallback(async (format: ExportTarget) => {
    setExportMenuOpen(false)
    const doc = activeRef.current
    if (!doc || doc.kind === 'folder') { setNotice('请先打开一个文档'); return }
    if (format === 'print') {
      try {
        const result = await request<{ content: string }>('/documents/' + doc.id + '/export?format=html', token)
        printHtmlDocument(result.content)
      } catch (error) {
        setNotice('打印失败：' + (error as Error).message)
      }
      return
    }
    try {
      const result = await request<{ filename?: string; content: string }>('/documents/' + doc.id + '/export?format=' + format, token)
      const filename = result.filename || (doc.title || 'document') + '.' + EXPORT_MIME[format].ext
      downloadTextFile(filename, result.content, EXPORT_MIME[format].type)
      setNotice('已导出 ' + filename)
    } catch (error) {
      setNotice('导出失败：' + (error as Error).message)
    }
  }, [token])

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

  const clearToken = useCallback(() => {
    localStorage.removeItem('mdocs-token')
    setToken('')
    setUser(null)
    setActive(null)
    setDocuments([])
    setWorkspaceView('documents')
  }, [])

  const startUpdate = useCallback(async () => {
    if (!token || !updateInfo || updateInfo.status === 'running') return
    setUpdatePrompt(null)
    setUpdateInfo((current) => current ? { ...current, status: 'running' } : current)
    try {
      await request('/system/update', token, { method: 'POST' })
      setNotice('更新已开始，正在备份并重启服务…')
      let attempts = 0
      const poll = async () => {
        attempts += 1
        try {
          const result = await request<{ update: { status: 'running' | 'completed' | 'failed'; error?: string } }>('/system/update-status', token)
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
  }, [token, updateInfo])

  useEffect(() => {
    if (!token) return
    let live = true
    Promise.all([
      request<{ user: User }>('/me', token),
      request<{ documents: Doc[] }>('/documents', token),
      request<{ documents: Doc[] }>('/documents/favorites', token),
    ])
      .then(([me, docs, favorites]) => {
        if (!live) return
        if (!me.user) { clearToken(); return }
        setUser(me.user)
        setDocuments(docs.documents || [])
        const favoriteRows = favorites.documents || []
        setFavoriteIds(favoriteRows.map((doc) => doc.id))
        localStorage.setItem('mdocs-favorites', JSON.stringify(favoriteRows.map((doc) => doc.id)))
        const firstDocument = docs.documents?.find((entry) => entry.kind !== 'folder')
        if (!activeRef.current && firstDocument) setActive(firstDocument)
      })
      .catch(() => { if (live) clearToken() })
    return () => { live = false }
  }, [token, clearToken])

  useEffect(() => {
    if (!token) { setTemplates([]); return }
    let live = true
    request<{ templates: Template[] }>('/templates', token)
      .then((result) => { if (live) setTemplates(result.templates || []) })
      .catch(() => { if (live) setTemplates([]) })
    return () => { live = false }
  }, [token])

  useEffect(() => {
    if (!token) { setStats(null); return }
    void refreshStats()
  }, [token, refreshStats])

  useEffect(() => {
    if (!token || workspaceView !== 'admin' || user?.role !== 'admin') return
    let live = true
    setAdminMembersBusy(true)
    request<{ members: WorkspaceMember[] }>('/workspace/members', token)
      .then(({ members }) => { if (live) setAdminMembers(members || []) })
      .catch((error) => { if (live) { setWorkspaceView('documents'); setNotice('管理权限验证失败：' + error.message) } })
      .finally(() => { if (live) setAdminMembersBusy(false) })
    return () => { live = false }
  }, [token, user?.role, workspaceView])

  useEffect(() => {
    if (!token || homeView !== 'trash') return
    let live = true
    request<{ documents: Doc[] }>('/documents/trash', token)
      .then(({ documents: rows }) => { if (live) setTrashDocuments(rows || []) })
      .catch((error) => { if (live) setNotice('回收站加载失败：' + error.message) })
    return () => { live = false }
  }, [token, homeView])

  useEffect(() => {
    const trimmed = query === '__favorites__' ? '' : query.trim()
    if (!token || (!commandOpen && homeView !== 'search') || trimmed.length < 1) { setSearchResults([]); setSearchLoading(false); return }
    let live = true
    setSearchLoading(true)
    const timer = window.setTimeout(() => {
      request<{ results: SearchHit[] }>('/documents/search?q=' + encodeURIComponent(trimmed) + '&scope=' + searchScope, token)
        .then(({ results }) => { if (live) setSearchResults((results || []).map((hit) => ({ ...hit, content: emptyContent }))) })
        .catch(() => { if (live) setSearchResults([]) })
        .finally(() => { if (live) setSearchLoading(false) })
    }, 180)
    return () => { live = false; window.clearTimeout(timer) }
  }, [token, commandOpen, homeView, query, searchScope])

  useEffect(() => {
    if (!token || user?.role !== 'admin') { setUpdateInfo(null); return }
    let live = true
    request<{ updateAvailable: boolean; latestVersion?: string | null; manifest?: { releaseUrl?: string } | null }>('/system/update-check', token)
      .then((result) => {
        if (live && result.updateAvailable && result.latestVersion) setUpdateInfo({ version: result.latestVersion, url: result.manifest?.releaseUrl, status: 'available' })
      })
      .catch(() => undefined)
    return () => { live = false }
  }, [token, user?.role])

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
    const showNotice = (event: Event) => setNotice((event as CustomEvent<string>).detail)
    window.addEventListener('mdoc-notice', showNotice)
    return () => window.removeEventListener('mdoc-notice', showNotice)
  }, [])

  useEffect(() => {
    if (!token || !active || active.kind === 'folder') return
    let live = true
    request<{ document: Doc }>('/documents/' + active.id, token)
      .then(({ document: document }) => { if (live) setActive(document) })
      .catch((error) => { if (live) setNotice(error.message) })
    request<{ comments: Comment[] }>('/documents/' + active.id + '/comments', token)
      .then(({ comments: rows }) => { if (live) setComments(rows || []) }).catch(() => undefined)
    request<{ versions: Version[] }>('/documents/' + active.id + '/versions', token)
      .then(({ versions: rows }) => { if (live) setVersions(rows || []) }).catch(() => undefined)
    return () => { live = false }
  }, [token, active?.id])

  // Refresh the side panel when its tab is opened so collaboration saves made
  // while the panel was closed show up without a page reload.
  useEffect(() => {
    if (!token || !active) return
    if (rightTab === 'history') {
      request<{ versions: Version[] }>('/documents/' + active.id + '/versions', token)
        .then(({ versions: rows }) => setVersions(rows || []))
        .catch(() => undefined)
    } else if (rightTab === 'comments') {
      request<{ comments: Comment[] }>('/documents/' + active.id + '/comments', token)
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
      const result = await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      const body = await result.json()
      if (!result.ok) throw new Error(body.error?.message || body.message || '邮箱或密码错误')
      localStorage.setItem('mdocs-token', body.token)
      setToken(body.token)
      setUser(body.user)
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
      const { document: created } = await request<{ document: Doc }>('/documents', token, { method: 'POST', body: JSON.stringify(payload) })
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
      const { document: imported } = await request<{ document: Doc }>('/documents/import', token, {
        method: 'POST',
        body: JSON.stringify({ format: 'markdown', markdown, parentId: selectedFolderId || null }),
      })
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
      const result = await request<{ document: Doc }>('/documents/' + doc.id, token, { method: 'PUT', body: JSON.stringify({ ...fields, expectedVersion: doc.version }) })
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
      const { document: copy } = await request<{ document: Doc }>('/documents/' + doc.id + '/duplicate', token, {
        method: 'POST',
        body: JSON.stringify({ parentId: doc.parentId ?? null }),
      })
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
        await request('/documents/' + doc.id + '/favorite', token, { method: 'PUT', body: JSON.stringify({ favorite }) })
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
      await request('/documents/' + active.id + '/comments', token, { method: 'POST', body: JSON.stringify(payload) })
      const result = await request<{ comments: Comment[] }>('/documents/' + active.id + '/comments', token)
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
      await request('/documents/' + active.id + '/comments/' + comment.id, token, { method: 'PATCH', body: JSON.stringify({ status }) })
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

  async function openShareDialog() {
    if (!active || active.kind === 'folder') { setNotice('请先打开一个文档再设置共享权限'); return }
    setShowShare(true)
    setShareBusy(true)
    try {
      const [members, access] = await Promise.all([
        request<{ members: WorkspaceMember[] }>('/workspace/members', token),
        request<{ restricted: boolean; permissions: DocumentPermission[] }>('/documents/' + active.id + '/acl', token),
      ])
      setWorkspaceMembers(members.members || [])
      setDocumentPermissions(access.permissions || [])
      setDocumentRestricted(access.restricted)
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
      await request('/documents/' + active.id + '/acl', token, { method: 'PUT', body: JSON.stringify({ userId: member.id, role, restricted: documentRestricted }) })
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
      await request('/documents/' + active.id + '/acl', token, { method: 'PUT', body: JSON.stringify({ userId: user!.id, role: owner?.role || 'owner', restricted }) })
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
      const { invite } = await request<{ invite: { token: string; email: string; role: string } }>('/invites', token, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })
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
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setInviteError('无法访问剪贴板，请手动复制链接。')
    }
  }

  async function restoreVersion(versionId: string) {
    if (!active) return false
    try {
      const { document: restored } = await request<{ document: Doc }>('/documents/' + active.id + '/versions/' + versionId + '/restore', token, {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: active.version }),
      })
      setActive(restored)
      setDocuments((rows) => rows.map((row) => row.id === restored.id ? restored : row))
      setNotice('已恢复到此版本')
      request<{ versions: Version[] }>('/documents/' + restored.id + '/versions', token)
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

  if (!token || !user) return <Login onLogin={login} onAccepted={({ token: acceptedToken, user: acceptedUser }) => { setToken(acceptedToken); setUser(acceptedUser) }} error={loginError} busy={busy} />
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
    {sidebarOpen && <aside className={'sidebar' + (narrow ? ' sidebar-floating' : '')} aria-label="文档导航">
      <div className="brand-row"><div className="brand-mark"><Sparkles size={16} /></div><span>Marvelous Docs</span><button className="icon-btn push" aria-label="收起侧边栏" title="收起侧边栏" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={17} /></button></div>
      <div className="workspace-anchor">
        <button type="button" className="workspace" aria-haspopup="menu" aria-expanded={workspaceOpen} onClick={() => setWorkspaceOpen((value) => !value)}><div className="workspace-avatar">M</div><span className="workspace-copy"><b>Marvelous 团队</b><small>工作区</small></span><ChevronDown size={16} /></button>
        <Popover open={workspaceOpen} onClose={() => setWorkspaceOpen(false)} label="工作区菜单" align="left" className="workspace-menu">
          <div className="workspace-menu-head"><b>Marvelous 团队</b><span>私有部署 · 单工作区</span></div>
          <div className="workspace-menu-user"><span className="avatar">{(user.name || user.email)[0].toUpperCase()}</span><div><b>{user.name || user.email.split('@')[0]}</b><small>{user.email}</small></div></div>
          <div className="menu-divider" />
          {user.role === 'admin' && <button type="button" role="menuitem" className="menu-item" onClick={() => { setWorkspaceOpen(false); setWorkspaceView('admin') }}><ShieldCheck size={15} /><span>管理中心</span></button>}
          <button type="button" role="menuitem" className="menu-item" onClick={() => { setWorkspaceOpen(false); setHelpOpen(true) }}><span className="menu-key">?</span><span>快捷键与帮助</span></button>
          <button type="button" role="menuitem" className="menu-item menu-item-danger" onClick={() => { setWorkspaceOpen(false); clearToken() }}><LogOut size={15} /><span>退出登录</span></button>
        </Popover>
      </div>
      <div className="sidebar-actions"><div className="action-row"><Search size={16} /><input
        aria-label="搜索文档"
        placeholder="搜索文档"
        value={query === '__favorites__' ? '' : query}
        onChange={(event) => {
          const next = event.target.value
          setQuery(next)
          setCommandIndex(0)
          if (next.trim()) { setHomeView('search'); setActive(null); setSelectedFolderId(null) }
          else if (homeView === 'search') setHomeView('home')
        }}
        onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); setHomeView('home') } }}
      /><kbd>⌘ K</kbd></div></div>
      <div className="nav-label">工作区</div>
      <button type="button" className={'nav-row ' + (homeView === 'home' && !active && !selectedFolderId ? 'nav-active' : '')} aria-current={homeView === 'home' && !active && !selectedFolderId ? 'page' : undefined} onClick={() => { setHomeView('home'); setActive(null); setSelectedFolderId(null); setQuery('') }}><Home size={16} />首页</button>
      {user.role === 'admin' && <button className="nav-row" onClick={() => setWorkspaceView('admin')}><ShieldCheck size={16} />管理中心</button>}
      <button type="button" className="nav-row" aria-current={query === '__favorites__' ? 'page' : undefined} onClick={() => { setHomeView('home'); setActive(null); setSelectedFolderId(null); setQuery('__favorites__') }}><Star size={16} />收藏 <span className="nav-count">{favoriteIds.length || ''}</span></button>
      <button type="button" className="nav-row" aria-current={homeView === 'trash' ? 'page' : undefined} onClick={() => { setHomeView('trash'); setActive(null); setSelectedFolderId(null); setQuery('') }}><Trash2 size={16} />回收站</button>
      <div className="tree-heading">
        <button aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<span>文档</span></button>
        <div className="new-menu-anchor">
          <button className="new-doc-btn" aria-haspopup="menu" aria-expanded={newMenuOpen} title="新建" onClick={() => setNewMenuOpen((value) => !value)}><Plus size={14} /><span>新建</span><ChevronDown size={12} /></button>
          <TemplateMenu
            open={newMenuOpen}
            templates={templates}
            onCreateBlank={() => void createDocument('document')}
            onCreateTemplate={(templateId) => void createDocument('document', templateId)}
            onImport={() => importInput.current?.click()}
            onNewFolder={() => void createDocument('folder')}
            onClose={() => setNewMenuOpen(false)}
          />
        </div>
      </div>
      {expanded && <div className="doc-tree">
        <button className={'root-folder ' + (selectedFolderId === null ? 'selected' : '')} onClick={() => { setSelectedFolderId(null); setActive(null); setHomeView('home'); setQuery('') }}><Folder size={15} /><span>所有文档</span></button>
        {visibleTree.map((node) => <TreeItem
          key={node.doc.id}
          node={node}
          depth={0}
          activeId={active?.id || null}
          selectedFolderId={selectedFolderId}
          expandedFolders={expandedFolders}
          favoriteIds={favoriteSet}
          onToggle={(id) => setExpandedFolders((folders) => { const next = new Set(folders); if (next.has(id)) next.delete(id); else next.add(id); return next })}
          onSelectFolder={(folder) => { setSelectedFolderId(folder.id); setActive(null); setHomeView('home'); setQuery(''); setShowRight(false); if (narrow) setSidebarOpen(false) }}
          onSelectDocument={(doc) => { setActive(doc); setSelectedFolderId(doc.parentId || null); setHomeView('home'); setQuery(''); setShowRight(false); if (narrow) setSidebarOpen(false) }}
          onAction={(action, doc) => void handleDocumentAction(action, doc)}
        />)}
        {visibleTree.length === 0 && <div className="empty-tree">{treeQuery ? '没有匹配的文档' : '暂无文档或文件夹'}</div>}
      </div>}
      <div className="sidebar-bottom">
        <button type="button" className="help-row" onClick={() => setHelpOpen(true)}><span className="help-dot">?</span><span>帮助与快捷键</span></button>
        <div className="profile-row"><div className="avatar">{(user.name || user.email)[0].toUpperCase()}</div><div className="profile-copy"><b>{user.name || user.email.split('@')[0]}</b><small>{user.email}</small></div><button className="icon-btn" aria-label="退出登录" title="退出登录" onClick={clearToken}><LogOut size={16} /></button></div>
      </div>
    </aside>}
    {narrow && sidebarOpen && <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />}
    <main className="main-area" id="main-content" tabIndex={-1}>
      <header className="topbar">
        {!sidebarOpen && <button className="icon-btn" aria-label="展开侧边栏" title="展开侧边栏" onClick={() => setSidebarOpen(true)}><PanelLeftClose size={17} /></button>}
        <div className="breadcrumbs"><span>我的文档</span><ChevronRight size={14} /><strong>{active?.title || selectedFolder?.title || (showingSearch ? '搜索' : '所有文档')}</strong></div>
        <div className="top-actions">
          <span className={'save-state save-' + saveStatus} role="status" aria-live="polite"><span className="save-dot" />{saveStatus === 'saving' ? '正在保存…' : saveStatus === 'error' ? '保存失败' : '已保存'}</span>
          <div className="collaborators" role="group" aria-label="在线成员">
            <div className="presence-stack">
              <div className="mini-avatar green" title="你">{(user.name || user.email)[0].toUpperCase()}</div>
              {collaborators.slice(0, 3).map((person) => <div key={person.clientId} className="mini-avatar" title={person.name} style={{ background: person.color + '24', color: person.color }}>{person.name[0]?.toUpperCase()}</div>)}
              {collaborators.length > 3 && <span className="presence-more">{'+' + (collaborators.length - 3)}</span>}
            </div>
            <span className={'connection-state ' + collabStatus} aria-live="polite">{collabStatus === 'connected' ? '已连接' : collabStatus === 'connecting' ? '连接中' : '已断开'}</span>
          </div>
          {active && <button className="share-btn" onClick={() => void openShareDialog()}><Share2 size={15} />共享</button>}
          <div className="menu-anchor">
            <button className="icon-btn" aria-label="导出文档" title="导出文档" aria-haspopup="menu" aria-expanded={exportMenuOpen} disabled={!active} onClick={() => setExportMenuOpen((value) => !value)}><ArrowDownToLine size={17} /></button>
            <ExportMenu open={exportMenuOpen} onSelect={(format) => void exportActive(format)} onClose={() => setExportMenuOpen(false)} />
          </div>
          <button className="icon-btn" aria-label="版本历史" title="版本历史" onClick={() => { setRightTab('history'); setShowRight(true) }}><History size={17} /></button>
          <button className="icon-btn" aria-label="评论" title="评论" onClick={() => { setRightTab('comments'); setShowRight(true) }}><MessageCircle size={17} /></button>
        </div>
      </header>
      {active && COLLAB_URL && collabStatus === 'disconnected' && <div className="collab-banner" role="status"><AlertCircle size={14} />实时协作连接已断开，正在尝试重连，期间的修改会保存在本地。</div>}
      {active ? <div className="workspace-content">
        <section className="editor-column">
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
            onSelection={(anchor) => { setCommentAnchor(anchor); setRightTab('comments'); setShowRight(true) }}
            onExport={(format) => void exportActive(format)}
            onLink={(range) => setLinkPrompt(range)}
          />
        </section>
        {showRight && <aside className="right-panel" aria-label="文档侧边栏">
          <div className="panel-tabbar">
            <div className="panel-tabs" role="tablist" aria-label="侧边栏标签">
              <button type="button" role="tab" id="tab-comments" aria-controls="panel-comments" aria-selected={rightTab === 'comments'} className={rightTab === 'comments' ? 'active' : ''} onClick={() => setRightTab('comments')}><MessageCircle size={15} />评论</button>
              <button type="button" role="tab" id="tab-history" aria-controls="panel-history" aria-selected={rightTab === 'history'} className={rightTab === 'history' ? 'active' : ''} onClick={() => setRightTab('history')}><History size={15} />历史</button>
              <button type="button" role="tab" id="tab-activity" aria-controls="panel-activity" aria-selected={rightTab === 'activity'} className={rightTab === 'activity' ? 'active' : ''} onClick={() => setRightTab('activity')}><Activity size={15} />动态</button>
            </div>
            <button type="button" className="icon-btn close-panel" aria-label="关闭面板" title="关闭面板" onClick={() => setShowRight(false)}><X size={16} /></button>
          </div>
          {rightTab === 'comments' ? <div className="panel-body" role="tabpanel" id="panel-comments" aria-labelledby="tab-comments">
            <div className="panel-intro"><b>讨论</b><span>{comments.length + ' 条评论'}</span></div>
            {comments.length === 0 ? <div className="panel-empty"><MessageCircle size={21} /><b>还没有评论</b><span>选中文本后点击评论开始讨论</span></div>
              : <div className="comment-list">{comments.map((comment) => <div className={'comment ' + (comment.status === 'resolved' ? 'comment-resolved' : '')} key={comment.id}>
                <div className="comment-head"><div className="avatar small-avatar">{(comment.userName || '?')[0].toUpperCase()}</div><div><b>{comment.userName || '成员'}</b><small>{formatDate(comment.createdAt)}{comment.status === 'resolved' ? ' · 已解决' : ''}</small></div></div>
                {comment.anchor?.text && <button className="comment-anchor" title="定位到引用" onClick={() => window.dispatchEvent(new CustomEvent('mdoc-focus-anchor', { detail: comment.anchor }))}>“{comment.anchor.text.slice(0, 80)}”</button>}
                <p>{comment.body}</p>
                <div className="comment-actions"><button onClick={() => { setCommentParentId(comment.id); setCommentText('@' + (comment.userName || '成员') + ' ') }}>回复</button>{comment.status !== 'resolved' && <button onClick={() => void updateCommentStatus(comment, 'resolved')}>解决</button>}{comment.status === 'resolved' && <button onClick={() => void updateCommentStatus(comment, 'open')}>重新打开</button>}</div>
              </div>)}</div>}
            <div className="comment-compose">
              {commentAnchor?.text && <div className="anchor-preview">引用：“{commentAnchor.text.slice(0, 90)}” <button aria-label="移除引用" onClick={() => setCommentAnchor(null)}><X size={12} /></button></div>}
              <textarea aria-label="评论内容" placeholder="添加评论..." value={commentText} onChange={(event) => setCommentText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void addComment() }} />
              <div><span>Ctrl + Enter 发送</span><button className="send-btn" aria-label="发送评论" title="发送评论" onClick={() => void addComment()} disabled={!commentText.trim()}><Send size={15} /></button></div>
            </div>
          </div> : rightTab === 'history' ? <div className="panel-body" role="tabpanel" id="panel-history" aria-labelledby="tab-history">
            <div className="panel-intro"><b>版本历史</b><span>{versions.length + ' 个版本'}</span></div>
            {versions.length === 0 ? <div className="panel-empty"><Clock3 size={21} /><b>暂无历史记录</b><span>文档更改后会保留版本</span></div>
              : <div className="version-list">{versions.map((version) => <div className="version-item" key={version.id}>
                <button className="version-line" onClick={() => setPreviewVersion(version)} aria-label={'预览版本 ' + version.version}>
                  <span className="version-dot" />
                  <span className="version-copy"><b>版本 {version.version}</b><small>{version.createdBy || '成员'} · {formatDate(version.createdAt)}</small></span>
                </button>
                <div className="version-actions">
                  <button type="button" onClick={() => setPreviewVersion(version)}>预览</button>
                  <button type="button" onClick={() => setPreviewVersion(version)}>恢复</button>
                </div>
              </div>)}</div>}
          </div> : <ActivityPanel token={token} documentId={active.id} />}
        </aside>}
      </div> : selectedFolder ? <FolderOverview
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
        documents={homeView === 'trash' ? trashDocuments : documents}
        favorites={favoriteSet}
        query={query === '__favorites__' ? '' : query}
        trash={homeView === 'trash'}
        stats={stats}
        onOpen={(doc) => { setActive(doc); setSelectedFolderId(doc.parentId || null) }}
        onCreate={() => void createDocument('document')}
        onImport={() => importInput.current?.click()}
        onCreateFolder={() => void createDocument('folder')}
        onRestore={async (doc) => {
          await request('/documents/' + doc.id + '/restore', token, { method: 'POST' })
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
      {notice && <div className="notice-toast" role="status" aria-live="polite">{notice}<button aria-label="关闭提示" title="关闭提示" onClick={() => setNotice('')}><X size={13} /></button></div>}
    </main>
    {showShare && active && <ShareDialog title={active.title} members={workspaceMembers} permissions={documentPermissions} restricted={documentRestricted} busy={shareBusy} onRestrictedChange={(value) => void toggleDocumentRestriction(value)} onPermissionChange={(member, role) => void saveDocumentPermission(member, role)} onClose={() => setShowShare(false)} />}
    {showInvite && <InviteDialog email={inviteEmail} setEmail={setInviteEmail} role={inviteRole} setRole={setInviteRole} link={inviteLink} error={inviteError} busy={inviteBusy} copied={copied} onSubmit={createInvite} onCopy={copyInviteLink} onClose={() => setShowInvite(false)} />}
    {moveDoc && <MoveDialog doc={moveDoc} documents={documents} busy={busy} onMove={(parentId) => void moveDocument(moveDoc, parentId)} onClose={() => setMoveDoc(null)} />}
    {previewVersion && active && <VersionPreview token={token} documentId={active.id} version={previewVersion} onRestore={restoreVersion} onClose={() => setPreviewVersion(null)} />}
    <input ref={importInput} className="visually-hidden" type="file" accept=".md,.markdown,.txt" aria-label="导入 Markdown 文件" onChange={(event) => void handleImport(event)} />
    {renameDoc && <PromptDialog
      title="重命名"
      description={renameDoc.kind === 'folder' ? '给文件夹换一个更清晰的名字。' : '标题会立即同步给所有协作者。'}
      label="名称"
      initialValue={renameDoc.title}
      confirmLabel="保存"
      validate={(value) => value ? (value.length > 120 ? '名称不能超过 120 个字符' : null) : '名称不能为空'}
      onSubmit={async (value) => { setRenameDoc(null); if (value !== renameDoc.title) await updateDocument(renameDoc, { title: value }) }}
      onClose={() => setRenameDoc(null)}
    />}
    {deleteDoc && <Dialog
      title="移到回收站？"
      description={'“' + (deleteDoc.title || '未命名文档') + '”会移到回收站，之后仍可恢复。'}
      confirmLabel="移到回收站"
      danger
      onConfirm={async () => {
        const doc = deleteDoc
        setDeleteDoc(null)
        try {
          await request('/documents/' + doc.id, token, { method: 'DELETE' })
          setDocuments((rows) => rows.filter((row) => row.id !== doc.id))
          if (active?.id === doc.id) setActive(null)
          setNotice('已移到回收站')
          void refreshStats()
        } catch (error) { setNotice('删除失败：' + (error as Error).message) }
      }}
      onClose={() => setDeleteDoc(null)}
    />}
    {purgeDoc && <Dialog
      title="永久删除？"
      description={'“' + (purgeDoc.title || '未命名文档') + '”将无法恢复，相关评论与历史也会一并删除。'}
      confirmLabel="永久删除"
      danger
      onConfirm={async () => {
        const doc = purgeDoc
        setPurgeDoc(null)
        try {
          await request('/documents/' + doc.id + '/permanent', token, { method: 'DELETE' })
          setTrashDocuments((rows) => rows.filter((row) => row.id !== doc.id))
          setNotice('文档已永久删除')
          void refreshStats()
        } catch (error) { setNotice('永久删除失败：' + (error as Error).message) }
      }}
      onClose={() => setPurgeDoc(null)}
    />}
    {updatePrompt && <Dialog
      title={'更新到 ' + updatePrompt.version + '？'}
      description="系统会先备份数据库，然后拉取新镜像并短暂重启服务。更新期间建议暂停编辑。"
      confirmLabel="开始更新"
      onConfirm={async () => { setUpdatePrompt(null); await startUpdate() }}
      onClose={() => setUpdatePrompt(null)}
    />}
    {helpOpen && <Dialog
      title="快捷键与帮助"
      description="少用鼠标，编辑更快。"
      confirmLabel="知道了"
      cancelLabel="关闭"
      onConfirm={() => setHelpOpen(false)}
      onClose={() => setHelpOpen(false)}
    >
      <dl className="shortcut-list">
        <div className="shortcut-row"><dt>搜索与命令面板</dt><dd><kbd>Ctrl</kbd><kbd>K</kbd></dd></div>
        <div className="shortcut-row"><dt>强制保存</dt><dd><kbd>Ctrl</kbd><kbd>S</kbd></dd></div>
        <div className="shortcut-row"><dt>导出 Markdown</dt><dd><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>E</kbd></dd></div>
        <div className="shortcut-row"><dt>关闭弹层 / 面板</dt><dd><kbd>Esc</kbd></dd></div>
        <div className="shortcut-row"><dt>发送评论</dt><dd><kbd>Ctrl</kbd><kbd>Enter</kbd></dd></div>
      </dl>
      <p className="help-note">协作连接断开时，编辑会保留在本地，恢复后自动同步。遇到界面异常可刷新页面，历史版本里能找回未同步内容。</p>
    </Dialog>}
    {linkPrompt && <PromptDialog
      title="添加链接"
      description="输入链接地址，选中文本会变成可点击链接。"
      label="链接地址"
      initialValue="https://"
      confirmLabel="添加链接"
      validate={(value) => {
        try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:' ? null : '只支持 http 或 https 链接' } catch { return '请输入完整的网址' }
      }}
      onSubmit={async (value) => { const range = linkPrompt; setLinkPrompt(null); window.dispatchEvent(new CustomEvent('mdoc-insert-link', { detail: { from: range.from, to: range.to, href: value } })) }}
      onClose={() => setLinkPrompt(null)}
    />}
  </div>
}

type AdminInviteProps = { email: string; setEmail: (value: string) => void; role: 'member' | 'admin'; setRole: (value: 'member' | 'admin') => void; link: string; error: string; busy: boolean; copied: boolean; onSubmit: (event: FormEvent) => void; onCopy: () => void }

type AdminWorkspaceProps = { user: User; members: WorkspaceMember[]; membersBusy: boolean; updateInfo: UpdateInfo | null; notice: string; showInvite: boolean; onBack: () => void; onOpenInvite: () => void; onStartUpdate: () => void; onLogout: () => void; onCloseInvite: () => void; inviteProps: AdminInviteProps }

function AdminWorkspace({ user, members, membersBusy, updateInfo, notice, showInvite, onBack, onOpenInvite, onStartUpdate, onLogout, onCloseInvite, inviteProps }: AdminWorkspaceProps) {
  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <div className="brand-row"><div className="brand-mark"><Sparkles size={16} /></div><span>Marvelous Docs</span></div>
      <div className="admin-sidebar-title"><ShieldCheck size={17} /><div><b>管理中心</b><small>工作区设置</small></div></div>
      <button className="admin-back" onClick={onBack}><ArrowLeft size={15} />返回文档</button>
      <div className="admin-sidebar-footer"><div className="profile-row"><div className="avatar">{(user.name || user.email)[0].toUpperCase()}</div><div className="profile-copy"><b>{user.name || user.email.split('@')[0]}</b><small>管理员</small></div><button className="icon-btn" aria-label="退出登录" title="退出登录" onClick={onLogout}><LogOut size={16} /></button></div></div>
    </aside>
    <main className="admin-main">
      <header className="admin-topbar"><div><span className="eyebrow">工作区管理</span><h1>管理中心</h1><p>管理成员、邀请和工作区服务。</p></div><span className="admin-status"><span className="save-dot" />管理员权限</span></header>
      <div className="admin-content">
        <section className="admin-section">
          <div className="admin-section-head"><div><h2><Users size={18} />成员管理</h2><p>管理工作区成员并邀请新的协作者。</p></div><button className="primary-btn" onClick={onOpenInvite}><UserPlus size={15} />邀请成员</button></div>
          <div className="admin-member-list">{membersBusy ? <div className="admin-empty">正在加载成员…</div> : members.length ? members.map((member) => <div className="admin-member-row" key={member.id}>
            <div className="avatar">{(member.name || member.email)[0].toUpperCase()}</div>
            <div className="admin-member-copy"><b>{member.name || member.email.split('@')[0]}</b><small>{member.email}</small></div>
            <span className={'role-badge ' + member.role}>{member.role === 'admin' ? '管理员' : '成员'}</span>
          </div>) : <div className="admin-empty">暂无工作区成员</div>}</div>
        </section>
        <section className="admin-section">
          <div className="admin-section-head"><div><h2><LayoutDashboard size={18} />系统更新</h2><p>检查并部署 Marvelous Docs 的新版本。</p></div>{updateInfo?.url && <a className="admin-release-link" href={updateInfo.url} target="_blank" rel="noreferrer">查看发布说明</a>}</div>
          <div className="admin-update-card">
            <div className="admin-update-icon"><Sparkles size={19} /></div>
            <div className="admin-update-copy">
              <b>{updateInfo?.status === 'available' ? '发现新版本 ' + updateInfo.version : updateInfo?.status === 'running' ? '正在更新到 ' + updateInfo.version : updateInfo?.status === 'failed' ? '更新失败（' + updateInfo.version + '）' : '当前使用最新版本'}</b>
              <span>{notice || '系统会在更新前自动备份数据库。'}</span>
            </div>
            {(updateInfo?.status === 'available' || updateInfo?.status === 'failed') && <button className="secondary-btn" onClick={onStartUpdate}>{updateInfo.status === 'failed' ? '重试' : '立即更新'}</button>}
          </div>
        </section>
      </div>
    </main>
    {showInvite && <InviteDialog {...inviteProps} onClose={onCloseInvite} />}
  </div>
}

type HomeDashboardProps = {
  documents: Doc[]
  favorites: Set<string>
  query: string
  trash: boolean
  stats: WorkspaceStats | null
  onOpen: (doc: Doc) => void
  onCreate: () => void
  onImport: () => void
  onCreateFolder: () => void
  onRestore: (doc: Doc) => Promise<void>
  onPermanentDelete: (doc: Doc) => Promise<void>
}

function HomeDashboard({ documents, favorites, query, trash, stats, onOpen, onCreate, onImport, onCreateFolder, onRestore, onPermanentDelete }: HomeDashboardProps) {
  const visible = documents.filter((doc) => !query || doc.title.toLowerCase().includes(query.toLowerCase()))
  if (trash) return <div className="home-dashboard">
    <div className="home-hero"><div><span className="eyebrow">文档管理</span><h1>回收站</h1><p>恢复误删的文档，或永久清理不再需要的内容。</p></div></div>
    <section className="home-section">
      <div className="home-section-head"><h2><Trash2 size={16} />已删除文档</h2><span>{visible.length + ' 项'}</span></div>
      {visible.length ? <div className="home-grid">{visible.map((doc) => <div className="home-card" key={doc.id}>
        <button className="home-card-main" onClick={() => onOpen(doc)}><span className="home-card-icon"><FileText size={17} /></span><span><b>{doc.title}</b><small>已移入回收站</small></span></button>
        <span className="home-card-actions"><button onClick={() => void onRestore(doc)}>恢复</button><button onClick={() => void onPermanentDelete(doc)}>删除</button></span>
      </div>)}</div> : <div className="home-empty">回收站为空</div>}
    </section>
  </div>
  const favoriteDocs = visible.filter((doc) => favorites.has(doc.id))
  const recent = [...visible].sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()).slice(0, 6)
  const sections = [
    { title: '最近访问', icon: Clock3, items: recent },
    { title: '收藏', icon: Star, items: favoriteDocs },
    { title: '我创建的', icon: FileText, items: visible.filter((doc) => doc.kind !== 'folder').slice(0, 6) },
  ]
  return <div className="home-dashboard">
    <div className="home-hero">
      <div><span className="eyebrow">工作区</span><h1>欢迎回来</h1><p>继续处理你的文档，或创建一个新的知识空间。</p></div>
      <div className="hero-actions">
        <button className="secondary-btn" onClick={onImport}><Upload size={15} />导入 Markdown</button>
        <button className="secondary-btn" onClick={onCreateFolder}><FolderPlus size={15} />新建文件夹</button>
        <button className="primary-btn" onClick={onCreate}><FilePlus2 size={16} />新建文档</button>
      </div>
    </div>
    <StatsCards stats={stats} />
    {sections.map(({ title, icon: Icon, items }) => <section className="home-section" key={title}>
      <div className="home-section-head"><h2><Icon size={16} />{title}</h2><span>{items.length + ' 项'}</span></div>
      {items.length ? <div className="home-grid">{items.map((doc) => <button className="home-card" key={doc.id} onClick={() => onOpen(doc)}>
        <span className={'home-card-icon ' + (doc.kind === 'folder' ? 'folder' : '')}>{doc.kind === 'folder' ? <Folder size={17} /> : <FileText size={17} />}</span>
        <span><b>{doc.title || '未命名文档'}</b><small>{doc.kind === 'folder' ? '文件夹' : '更新于 ' + (formatDate(doc.updatedAt) || '刚刚')}</small></span>
        <ChevronRight size={15} />
      </button>)}</div> : <div className="home-empty">{title === '收藏' ? '收藏的文档会显示在这里' : '暂时没有内容'}</div>}
    </section>)}
  </div>
}

function FolderOverview({ folder, items, onCreate, onImport, onCreateFolder, onOpen }: { folder: Doc; items: Doc[]; onCreate: () => void; onImport: () => void; onCreateFolder: () => void; onOpen: (doc: Doc) => void }) {
  return <div className="folder-overview">
    <div className="folder-overview-head">
      <div className="folder-large-icon"><Folder size={23} /></div>
      <div><h1>{folder.title}</h1><p>{items.length + ' 个项目'}</p></div>
      <div className="folder-head-actions">
        <button className="secondary-btn" onClick={onImport}><Upload size={15} />导入 Markdown</button>
        <button className="primary-btn" onClick={onCreate}><FilePlus2 size={15} />新建文档</button>
      </div>
    </div>
    {items.length ? <div className="folder-items">{items.map((child) => <button key={child.id} className="folder-item" onClick={() => onOpen(child)}>
      <span className={'folder-item-icon ' + (child.kind === 'folder' ? 'is-folder' : '')}>{child.kind === 'folder' ? <Folder size={17} /> : <FileText size={17} />}</span>
      <span>{child.title}</span>
      <ChevronRight size={15} />
    </button>)}</div> : <div className="folder-empty">
      <div className="folder-empty-icon"><Folder size={22} /></div>
      <h2>此文件夹为空</h2>
      <p>在这里创建文档，或新建子文件夹来整理内容。</p>
      <div>
        <button className="primary-btn" onClick={onCreate}><FilePlus2 size={15} />新建文档</button>
        <button className="secondary-btn" onClick={onCreateFolder}><FolderPlus size={15} />新建子文件夹</button>
      </div>
    </div>}
  </div>
}

function Login({ onLogin, onAccepted, error, busy }: { onLogin: (email: string, password: string) => void; onAccepted: (result: { token: string; user: User }) => void; error: string; busy: boolean }) {
  const inviteToken = useMemo(() => new URLSearchParams(window.location.search).get('invite') || '', [])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  async function acceptInvite(event: FormEvent) {
    event.preventDefault()
    setInviteError('')
    setInviteBusy(true)
    try {
      const response = await fetch(API + '/api/v1/auth/accept-invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteToken, password, name }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message || body.message || '邀请链接无效或已过期')
      localStorage.setItem('mdocs-token', body.token)
      window.history.replaceState(null, '', window.location.pathname)
      onAccepted(body)
    } catch (inviteFailure) {
      setInviteError((inviteFailure as Error).message)
    } finally {
      setInviteBusy(false)
    }
  }
  return <div className="login-screen"><div className="login-card">
    <div className="login-brand"><div className="brand-mark"><Sparkles size={17} /></div><span>Marvelous Docs</span></div>
    {inviteToken ? <>
      <h1>加入团队</h1><p>设置你的账户以加入工作区</p>
      <form onSubmit={acceptInvite}>
        <label>姓名<input autoComplete="name" placeholder="你的姓名" value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label>设置密码<input type="password" autoComplete="new-password" placeholder="至少 12 个字符" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {inviteError && <div className="login-error"><AlertCircle size={15} />{inviteError}</div>}
        <button className="primary-btn login-submit" disabled={inviteBusy}>{inviteBusy ? '正在加入...' : '接受邀请'}<ChevronRight size={16} /></button>
      </form>
    </> : <>
      <h1>欢迎回来</h1><p>登录你的团队工作区</p>
      <form onSubmit={(event) => { event.preventDefault(); onLogin(email, password) }}>
        <label>邮箱地址<input type="email" autoComplete="username" placeholder="name@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>密码<input type="password" autoComplete="current-password" placeholder="输入密码" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error && <div className="login-error"><AlertCircle size={15} />{error}</div>}
        <button className="primary-btn login-submit" disabled={busy}>{busy ? '正在登录...' : '登录'}<ChevronRight size={16} /></button>
      </form>
    </>}
    <div className="login-foot">私有部署 · 团队知识空间</div>
  </div></div>
}

function ShareDialog({ title, members, permissions, restricted, busy, onRestrictedChange, onPermissionChange, onClose }: { title: string; members: WorkspaceMember[]; permissions: DocumentPermission[]; restricted: boolean; busy: boolean; onRestrictedChange: (restricted: boolean) => void; onPermissionChange: (member: WorkspaceMember, role: DocumentPermission['role'] | null) => void; onClose: () => void }) {
  const permissionMap = new Map(permissions.map((permission) => [permission.userId, permission]))
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <header><div><div className="invite-icon"><Share2 size={17} /></div><h2 id="share-title">共享文档</h2><p>{title}</p></div><button className="icon-btn" aria-label="关闭共享设置" title="关闭" onClick={onClose}><X size={17} /></button></header>
      <label className="share-restriction"><span><b>仅指定成员可访问</b><small>{restricted ? '只有下方名单中的成员可以打开此文档' : '工作区所有成员均可查看和编辑'}</small></span><input type="checkbox" checked={restricted} disabled={busy} onChange={(event) => onRestrictedChange(event.target.checked)} /></label>
      <div className="share-members-heading"><b>工作区成员</b><span>{members.length + ' 人'}</span></div>
      <div className="share-members">{members.map((member) => {
        const permission = permissionMap.get(member.id)
        const role = permission?.role || (restricted ? null : 'editor')
        return <div className="share-member" key={member.id}>
          <div className="avatar">{(member.name || member.email)[0].toUpperCase()}</div>
          <div className="share-member-copy"><b>{member.name || member.email.split('@')[0]}</b><small>{member.email}</small></div>
          {member.role === 'admin' ? <span className="share-admin">管理员</span> : <select aria-label={(member.name || member.email) + '的文档权限'} value={role || 'none'} disabled={busy} onChange={(event) => onPermissionChange(member, event.target.value === 'none' ? null : event.target.value as DocumentPermission['role'])}>
            <option value="none">无权限</option>
            <option value="viewer">可查看</option>
            <option value="editor">可编辑</option>
            <option value="owner">管理权限</option>
          </select>}
        </div>
      })}{members.length === 0 && <div className="share-empty">工作区暂无其他成员</div>}</div>
      <footer><span>权限更改会立即生效</span><button className="primary-btn" onClick={onClose}>完成</button></footer>
    </section>
  </div>
}

function InviteDialog({ email, setEmail, role, setRole, link, error, busy, copied, onSubmit, onCopy, onClose }: AdminInviteProps & { onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="invite-modal" role="dialog" aria-modal="true" aria-labelledby="invite-title">
      <header><div><div className="invite-icon"><UserPlus size={17} /></div><h2 id="invite-title">邀请成员</h2><p>邀请同事加入这个工作区。</p></div><button className="icon-btn" aria-label="关闭邀请" title="关闭" onClick={onClose}><X size={17} /></button></header>
      <form onSubmit={onSubmit}>
        <label>邮箱地址<div className="invite-input"><Mail size={15} /><input type="email" placeholder="name@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></div></label>
        <label>工作区角色<select value={role} onChange={(event) => setRole(event.target.value as 'member' | 'admin')}><option value="member">成员</option><option value="admin">管理员</option></select></label>
        {error && <div className="invite-error"><AlertCircle size={15} />{error}</div>}
        {link ? <div className="invite-result"><b>邀请链接已创建</b><p>链接有效期为 7 天。发送给 {email} 完成注册。</p><div className="link-copy"><input readOnly value={link} onFocus={(event) => event.currentTarget.select()} aria-label="邀请链接" /><button type="button" className="primary-btn" onClick={onCopy}><Copy size={14} />{copied ? '已复制' : '复制链接'}</button></div></div>
          : <button className="primary-btn invite-submit" disabled={busy}>{busy ? '正在创建...' : '创建邀请'}<ChevronRight size={15} /></button>}
      </form>
    </section>
  </div>
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
  onSelection: (anchor: { from: number; to: number; text: string }) => void
  onExport: (format: 'markdown' | 'html' | 'json') => void
  onLink: (range: { from: number; to: number }) => void
}

function DocumentEditor({ doc, token, persist, user, saveStatus, onSaveStatus, onAwareness, onCollabStatus, onSelection, onExport, onLink }: DocumentEditorProps) {
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null)
  const [provider, setProvider] = useState<WebsocketProvider | null>(null)
  const [title, setTitle] = useState(doc.title)
  const [words, setWords] = useState(0)
  const statusTimer = useRef<number | undefined>(undefined)

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



  const editor = useEditor({
    extensions: buildEditorExtensions({ ydoc: provider ? ydoc : null, placeholder: '从这里开始写作…' }),
    content: doc.content?.doc || emptyContent.doc,
    onUpdate: ({ editor: instance }) => {
      setWords(wordCount(instance.getText()))
      if (provider) {
        onSaveStatus('saving')
        window.clearTimeout(statusTimer.current)
        statusTimer.current = window.setTimeout(() => onSaveStatus('saved'), 900)
      } else {
        persist(instance.getJSON())
      }
    },
    onCreate: ({ editor: instance }) => setWords(wordCount(instance.getText())),
    onSelectionUpdate: ({ editor: instance }) => {
      const { from, to } = instance.state.selection
      if (to > from) onSelection({ from, to, text: instance.state.doc.textBetween(from, to, ' ').slice(0, 500) })
    },
    editorProps: { attributes: { class: 'tiptap-content' } },
  }, [doc.id, provider])

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
    <div className="editor-toolbar" role="toolbar" aria-label="格式工具">
      <ToolButton title="加粗" onClick={() => editor?.chain().focus().toggleBold().run()} active={!!editor?.isActive('bold')}><Bold size={16} /></ToolButton>
      <ToolButton title="斜体" onClick={() => editor?.chain().focus().toggleItalic().run()} active={!!editor?.isActive('italic')}><Italic size={16} /></ToolButton>
      <ToolButton title="下划线" onClick={() => editor?.chain().focus().toggleUnderline().run()} active={!!editor?.isActive('underline')}><UnderlineIcon size={16} /></ToolButton>
      <span className="tool-separator" />
      <ToolButton title="项目符号列表" onClick={() => editor?.chain().focus().toggleBulletList().run()} active={!!editor?.isActive('bulletList')}><List size={16} /></ToolButton>
      <ToolButton title="编号列表" onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={!!editor?.isActive('orderedList')}><ListOrdered size={16} /></ToolButton>
      <ToolButton title="任务列表" onClick={() => editor?.chain().focus().toggleTaskList().run()} active={!!editor?.isActive('taskList')}><CheckSquare size={16} /></ToolButton>
      <span className="tool-separator" />
      <button className="toolbar-format" onClick={() => editor?.chain().focus().toggleHeading({ level: editor?.isActive('heading', { level: 1 }) ? 2 : 1 }).run()}>标题 <ChevronDown size={14} /></button>
      <ToolButton title="插入表格" onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 size={16} /></ToolButton>
      <ToolButton title="添加链接" onClick={() => { const selection = editor?.state.selection; onLink({ from: selection?.from ?? 0, to: selection?.to ?? 0 }) }}><LinkIcon size={16} /></ToolButton>
      <ToolButton title="高亮" onClick={() => editor?.chain().focus().toggleHighlight().run()} active={!!editor?.isActive('highlight')}><HighlightIcon size={16} /></ToolButton>
      <ToolButton title="文字颜色" onClick={() => editor?.chain().focus().setColor('#3370ff').run()} active={!!editor?.isActive('textStyle', { color: '#3370ff' })}><Palette size={16} /></ToolButton>
      <ToolButton title="对选中文本添加评论" onClick={() => {
        const selection = editor?.state.selection
        if (selection && selection.to > selection.from) onSelection({ from: selection.from, to: selection.to, text: editor.state.doc.textBetween(selection.from, selection.to, ' ').slice(0, 500) })
      }}><MessageCircle size={16} /></ToolButton>
      <div className="toolbar-spacer" />
      <ToolButton title="撤销" onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={16} /></ToolButton>
      <ToolButton title="重做" onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={16} /></ToolButton>
      <button className="icon-btn" aria-label="导出 JSON" title="导出 JSON" onClick={() => onExport('json')}><ArrowDownToLine size={16} /></button>
      <button className="icon-btn" aria-label="代码块" title="代码块" onClick={() => editor?.chain().focus().toggleCodeBlock().run()}><Code2 size={16} /></button>
    </div>
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
      <EditorContent editor={editor} />
    </div>
    <div className="editor-footer">
      <span>字数 {words}</span>
      <span className="meta-divider" />
      <span className={'footer-save ' + saveStatus}>{saveStatus === 'saving' ? '正在保存…' : saveStatus === 'error' ? '保存失败' : '已保存'}</span>
      <span className="footer-spacer" />
      <span className="footer-hint">{provider ? '实时协作已开启 · Ctrl/⌘+S 强制保存' : 'Ctrl/⌘+S 保存 · Ctrl/⌘+Shift+E 导出 Markdown'}</span>
    </div>
  </>
}

function ToolButton({ children, title, onClick, active }: { children: ReactNode; title: string; onClick?: () => void; active?: boolean }) {
  return <button
    type="button"
    className={'tool-btn ' + (active ? 'tool-active' : '')}
    title={title}
    aria-label={title}
    aria-pressed={active}
    onMouseDown={(event) => event.preventDefault()}
    onClick={() => {
      try { onClick?.() } catch { window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: title + '操作失败，请刷新后重试' })) }
    }}
  >{children}</button>
}

export default App