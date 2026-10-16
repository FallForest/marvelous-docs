import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TextStyle from '@tiptap/extension-text-style'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import './update.css'
import {
  AlertCircle, ArrowDownToLine, Bold, Check, ChevronDown, ChevronRight,
  Clock3, Code2, Copy, FilePlus2, FileText, Folder, FolderPlus, History, Italic,
  List, ListOrdered, LogOut, Mail, MessageCircle, MoreHorizontal, PanelLeftClose,
  Plus, Search, Send, Share2, Sparkles, Underline as UnderlineIcon, UserPlus, Users, X,
  CheckSquare, Home, Star, Trash2, Table2, Link as LinkIcon, Highlighter as HighlightIcon, Palette, Undo2, Redo2,
} from 'lucide-react'

type DocJson = { schemaVersion: 1; doc: Record<string, unknown> }
type Doc = { id: string; title: string; kind?: 'folder' | 'document'; parentId?: string | null; content: DocJson; version: number; updatedAt?: string }
type DocNode = { doc: Doc; children: DocNode[] }
type User = { id: string; name?: string; email: string }
type Comment = { id: string; body: string; userId: string; userName: string; createdAt?: string; anchor?: { from?: number; to?: number; text?: string; blockId?: string } | null; parentId?: string | null; status?: 'open' | 'resolved'; resolvedAt?: string; resolvedBy?: string }
type Version = { id: string; version: number; createdAt?: string; createdBy: string; title?: string }
const emptyContent: DocJson = { schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph' }] } }
const API = import.meta.env.VITE_API_URL ?? ''
const COLLAB_URL = import.meta.env.VITE_COLLAB_URL

function buildDocTree(documents: Doc[]): DocNode[] {
  const nodes = new Map(documents.map((doc) => [doc.id, { doc, children: [] as DocNode[] }]))
  const roots: DocNode[] = []
  documents.forEach((doc) => {
    const node = nodes.get(doc.id)!
    const parent = doc.parentId ? nodes.get(doc.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  })
  const sort = (items: DocNode[]) => { items.sort((a, b) => Number(a.doc.kind !== 'folder') - Number(b.doc.kind !== 'folder') || a.doc.title.localeCompare(b.doc.title)); items.forEach((item) => sort(item.children)) }
  sort(roots)
  return roots
}

function filterDocTree(nodes: DocNode[], query: string): DocNode[] {
  if (!query) return nodes
  return nodes.flatMap((node) => {
    const children = filterDocTree(node.children, query)
    return node.doc.title.toLowerCase().includes(query) || children.length ? [{ ...node, children }] : []
  })
}

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}/api/v1${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const error = new Error(body.message || body.error?.message || body.error || `请求失败 (${response.status})`) as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return response.status === 204 ? undefined as T : response.json()
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('mdocs-token') || '')
  const [user, setUser] = useState<User | null>(null)
  const [loginError, setLoginError] = useState('')
  const [documents, setDocuments] = useState<Doc[]>([])
  const [active, setActive] = useState<Doc | null>(null)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set())
  const [comments, setComments] = useState<Comment[]>([])
  const [versions, setVersions] = useState<Version[]>([])
  const [rightTab, setRightTab] = useState<'comments' | 'history'>('comments')
  const [showRight, setShowRight] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member')
  const [inviteLink, setInviteLink] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [updateInfo, setUpdateInfo] = useState<{ version: string; url?: string; status: 'available' | 'running' | 'failed' | 'completed' } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [commentText, setCommentText] = useState('')
  const [commentAnchor, setCommentAnchor] = useState<Comment['anchor']>(null)
  const [commentParentId, setCommentParentId] = useState<string | null>(null)
  const [collaborators, setCollaborators] = useState<Array<{ clientId: number; name: string; color: string }>>([])
  const [collabStatus, setCollabStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [expanded, setExpanded] = useState(true)
  const [commandOpen, setCommandOpen] = useState(false)
  const [homeView, setHomeView] = useState<'home' | 'search' | 'trash'>('home')
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => JSON.parse(localStorage.getItem('mdocs-favorites') || '[]'))
  const [trashDocuments, setTrashDocuments] = useState<Doc[]>([])
  const [searchResults, setSearchResults] = useState<Doc[]>([])
  const [commandIndex, setCommandIndex] = useState(0)
  const saveTimer = useRef<number | undefined>(undefined)
  const activeRef = useRef<Doc | null>(null)
  activeRef.current = active

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const setFavorites = useCallback((next: string[]) => { setFavoriteIds(next); localStorage.setItem('mdocs-favorites', JSON.stringify(next)) }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true); setCommandIndex(0) }
      if (event.key === 'Escape') { setCommandOpen(false); setShowRight(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const clearToken = useCallback(() => {
    localStorage.removeItem('mdocs-token'); setToken(''); setUser(null); setActive(null); setDocuments([])
  }, [])

  const startUpdate = useCallback(async () => {
    if (!token || !updateInfo || updateInfo.status === 'running') return
    if (!window.confirm(`确认更新到 ${updateInfo.version}？系统会先备份数据库并短暂重启服务。`)) return
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
            setNotice(`更新失败：${result.update.error || '请查看服务器日志'}`)
          } else if (attempts < 90) window.setTimeout(poll, 2000)
        } catch {
          if (attempts < 90) window.setTimeout(poll, 2000)
        }
      }
      window.setTimeout(poll, 2000)
    } catch (error) {
      setUpdateInfo((current) => current ? { ...current, status: 'failed' } : current)
      setNotice(`更新启动失败：${(error as Error).message}`)
    }
  }, [token, updateInfo])

  useEffect(() => {
    if (!token) return
    let live = true
    Promise.all([request<{ user: User }>('/me', token), request<{ documents: Doc[] }>('/documents', token), request<{ documents: Doc[] }>('/documents/favorites', token)])
      .then(([me, docs, favorites]) => {
        if (!live) return
        setUser(me.user); setDocuments(docs.documents || [])
        const favoriteRows = favorites.documents || []
        setFavoriteIds(favoriteRows.map((doc) => doc.id)); localStorage.setItem('mdocs-favorites', JSON.stringify(favoriteRows.map((doc) => doc.id)))
        if (!activeRef.current && docs.documents?.length) setActive(docs.documents[0])
      })
      .catch(() => { if (live) clearToken() })
    return () => { live = false }
  }, [token, clearToken])

  useEffect(() => {
    if (!token || homeView !== 'trash') return
    let live = true
    request<{ documents: Doc[] }>('/documents/trash', token).then(({ documents: rows }) => { if (live) setTrashDocuments(rows || []) }).catch((error) => { if (live) setNotice(`回收站加载失败：${error.message}`) })
    return () => { live = false }
  }, [token, homeView])

  useEffect(() => {
    if (!token || !commandOpen || query.trim().length < 2 || query === '__favorites__') { setSearchResults([]); return }
    let live = true
    const timer = window.setTimeout(() => {
      request<{ results: Array<{ id: string; title: string; kind: 'document' | 'folder'; parentId?: string | null; version: number; updatedAt?: string }> }>(`/documents/search?q=${encodeURIComponent(query.trim())}`, token)
        .then(({ results }) => { if (live) setSearchResults(results.map((result) => ({ ...result, content: emptyContent }))) })
        .catch(() => { if (live) setSearchResults([]) })
    }, 180)
    return () => { live = false; window.clearTimeout(timer) }
  }, [token, commandOpen, query])

  useEffect(() => {
    if (!token) { setUpdateInfo(null); return }
    let live = true
    request<{ updateAvailable: boolean; latestVersion?: string | null; manifest?: { releaseUrl?: string } | null }>('/system/update-check', token)
      .then((result) => {
        if (live && result.updateAvailable && result.latestVersion) setUpdateInfo({ version: result.latestVersion, url: result.manifest?.releaseUrl, status: 'available' })
      })
      .catch(() => undefined)
    return () => { live = false }
  }, [token])

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
    if (!token || !active) return
    let live = true
    request<{ document: Doc }>(`/documents/${active.id}`, token)
      .then(({ document }) => { if (live) setActive(document) })
      .catch((error) => { if (live) setNotice(error.message) })
    request<{ comments: Comment[] }>(`/documents/${active.id}/comments`, token)
      .then(({ comments: rows }) => { if (live) setComments(rows || []) }).catch(() => {})
    request<{ versions: Version[] }>(`/documents/${active.id}/versions`, token)
      .then(({ versions: rows }) => { if (live) setVersions(rows || []) }).catch(() => {})
    return () => { live = false }
  }, [token, active?.id])

  const persist = useCallback((json: Record<string, unknown>) => {
    if (!token || !activeRef.current) return
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(async () => {
      const doc = activeRef.current
      if (!doc) return
      try {
        const result = await request<{ document: Doc }>(`/documents/${doc.id}`, token, {
          method: 'PUT', body: JSON.stringify({ content: { schemaVersion: 1, doc: json }, expectedVersion: doc.version }),
        })
        setActive(result.document)
        setDocuments((items) => items.map((item) => item.id === result.document.id ? result.document : item))
        setNotice('所有更改已保存')
      } catch (error) {
        const err = error as Error & { status?: number }
        setNotice(err.status === 409 ? '文档已在其他位置更新，请刷新后继续。' : `保存失败：${err.message}`)
      }
    }, 700)
  }, [token])

  async function login(email: string, password: string) {
    setLoginError(''); setBusy(true)
    try {
      const result = await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      const body = await result.json()
      if (!result.ok) throw new Error(body.error?.message || body.message || '邮箱或密码错误')
      localStorage.setItem('mdocs-token', body.token); setToken(body.token); setUser(body.user)
    } catch (error) { setLoginError((error as Error).message) }
    finally { setBusy(false) }
  }

  async function createDocument(kind: 'folder' | 'document' = 'document') {
    if (!token) return
    try {
      const parentId = selectedFolderId || undefined
      const payload: Record<string, unknown> = { kind, parentId, title: kind === 'folder' ? '新建文件夹' : '未命名文档' }
      if (kind === 'document') payload.content = emptyContent
      const { document } = await request<{ document: Doc }>('/documents', token, { method: 'POST', body: JSON.stringify(payload) })
      setDocuments((items) => [document, ...items])
      setShowRight(false)
      if (kind === 'folder') {
        setActive(null); setSelectedFolderId(document.id)
        setExpandedFolders((folders) => new Set([...folders, document.id, ...(parentId ? [parentId] : [])]))
      } else {
        setActive(document)
      }
    } catch (error) { setNotice(`创建失败：${(error as Error).message}`) }
  }

  async function updateDocument(doc: Doc, fields: { title?: string; parentId?: string | null }) {
    try {
      const result = await request<{ document: Doc }>(`/documents/${doc.id}`, token, { method: 'PUT', body: JSON.stringify({ ...fields, expectedVersion: doc.version }) })
      setDocuments((rows) => rows.map((row) => row.id === doc.id ? result.document : row))
      setActive((current) => current?.id === doc.id ? result.document : current)
      setNotice('文档已更新')
    } catch (error) { setNotice(`更新失败：${(error as Error).message}`) }
  }

  async function handleDocumentAction(action: string, doc: Doc) {
    if (action === 'favorite') {
      if (doc.kind === 'folder') return
      const favorite = !favoriteSet.has(doc.id)
      try {
        await request(`/documents/${doc.id}/favorite`, token, { method: 'PUT', body: JSON.stringify({ favorite }) })
        setFavorites(favorite ? [...favoriteIds, doc.id] : favoriteIds.filter((id) => id !== doc.id))
      } catch (error) { setNotice(`收藏失败：${(error as Error).message}`) }
      return
    }
    if (action === 'rename') {
      const title = window.prompt('重命名', doc.title)
      if (title && title.trim() && title.trim() !== doc.title) await updateDocument(doc, { title: title.trim() })
      return
    }
    if (action === 'move') {
      const target = window.prompt('移动到文件夹 ID（留空表示根目录）', doc.parentId || '')
      if (target !== null) await updateDocument(doc, { parentId: target.trim() || null })
      return
    }
    if (action === 'delete') {
      if (!window.confirm(`将“${doc.title}”移到回收站？`)) return
      try {
        await request(`/documents/${doc.id}`, token, { method: 'DELETE' })
        setDocuments((rows) => rows.filter((row) => row.id !== doc.id))
        if (active?.id === doc.id) setActive(null)
        setNotice('已移到回收站')
      } catch (error) { setNotice(`删除失败：${(error as Error).message}`) }
    }
  }

  async function addComment() {
    if (!commentText.trim() || !active) return
    try {
      await request(`/documents/${active.id}/comments`, token, { method: 'POST', body: JSON.stringify({ body: commentText.trim(), anchor: commentAnchor, parentId: commentParentId }) })
      const result = await request<{ comments: Comment[] }>(`/documents/${active.id}/comments`, token)
      setComments(result.comments || []); setCommentText(''); setCommentAnchor(null); setCommentParentId(null)
    } catch (error) { setNotice(`评论失败：${(error as Error).message}`) }
  }

  async function updateCommentStatus(comment: Comment, status: 'open' | 'resolved') {
    if (!active) return
    try {
      await request(`/documents/${active.id}/comments/${comment.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      setComments((rows) => rows.map((row) => row.id === comment.id ? { ...row, status } : row))
      setNotice(status === 'resolved' ? '评论已解决' : '评论已重新打开')
    } catch (error) { setNotice(`评论更新失败：${(error as Error).message}`) }
  }

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; status?: 'open' | 'resolved' }>).detail
      const comment = comments.find((row) => row.id === detail?.id)
      if (comment && detail?.status) void updateCommentStatus(comment, detail.status)
    }
    const clickHandler = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const button = target.closest('button')
      const commentElement = button?.closest('.comment')
      if (!button || !commentElement) return
      const index = Array.from(commentElement.parentElement?.children || []).indexOf(commentElement)
      const comment = comments[index]
      if (!comment) return
      const label = button.textContent?.trim()
      if (label === '回复') {
        setCommentParentId(comment.id)
        setCommentText(`@${comment.userName || '成员'} `)
      } else if (label === '解决' || label === '重新打开') {
        void updateCommentStatus(comment, label === '解决' ? 'resolved' : 'open')
      }
    }
    window.addEventListener('mdoc-comment-status', handler)
    document.addEventListener('click', clickHandler)
    return () => { window.removeEventListener('mdoc-comment-status', handler); document.removeEventListener('click', clickHandler) }
  }, [comments, active])

  async function createInvite(event: React.FormEvent) {
    event.preventDefault()
    setInviteError(''); setInviteLink(''); setInviteBusy(true)
    try {
      const { invite } = await request<{ invite: { token: string; email: string; role: string; expires_at: string } }>('/invites', token, {
        method: 'POST', body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })
      const url = new URL(window.location.href)
      url.search = ''; url.hash = ''; url.searchParams.set('invite', invite.token)
      setInviteLink(url.toString())
    } catch (error) {
      setInviteError((error as Error).message)
    } finally { setInviteBusy(false) }
  }

  async function copyInviteLink() {
    if (!inviteLink) return
    try { await navigator.clipboard.writeText(inviteLink); setCopied(true); window.setTimeout(() => setCopied(false), 1800) }
    catch { setInviteError('无法访问剪贴板，请手动复制链接。') }
  }

  async function restoreVersion(versionId: string) {
    if (!active) return
    try {
      const { document } = await request<{ document: Doc }>(`/documents/${active.id}/versions/${versionId}/restore`, token, { method: 'POST', body: JSON.stringify({ expectedVersion: active.version }) })
      setActive(document); setDocuments((rows) => rows.map((row) => row.id === document.id ? document : row)); setNotice('已恢复到此版本')
    } catch (error) { setNotice(`恢复失败：${(error as Error).message}`) }
  }

  const tree = useMemo(() => buildDocTree(documents), [documents])
  const visibleTree = useMemo(() => filterDocTree(tree, query.trim().toLowerCase()), [tree, query])
  const selectedFolder = documents.find((doc) => doc.id === selectedFolderId && doc.kind === 'folder') || null
  const folderChildren = documents.filter((doc) => (doc.parentId || null) === selectedFolderId)

  if (!token || !user) return <Login onLogin={login} onAccepted={({ token: acceptedToken, user: acceptedUser }) => { setToken(acceptedToken); setUser(acceptedUser) }} error={loginError} busy={busy} />
  return <div className="app-shell">
    {sidebarOpen && <aside className="sidebar">
      <div className="brand-row"><div className="brand-mark"><Sparkles size={16} /></div><span>Marvelous Docs</span><button className="icon-btn push" title="收起侧边栏" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={17} /></button></div>
      <button className="workspace"><div className="workspace-avatar">M</div><span className="workspace-copy"><b>Marvelous 团队</b><small>工作区</small></span><ChevronDown size={16} /></button>
      <div className="sidebar-actions"><button className="action-row" onClick={() => { setCommandOpen(true); setCommandIndex(0) }}><Search size={16} /><input aria-label="搜索文档" placeholder="搜索文档" value={query === '__favorites__' ? '' : query} onChange={(e) => { setQuery(e.target.value); setCommandOpen(true) }} onFocus={() => setCommandOpen(true)} /><kbd>⌘ K</kbd></button></div>
      <div className="nav-label">工作区</div>
      <button className={`nav-row ${homeView === 'home' && !active && !selectedFolderId ? 'nav-active' : ''}`} onClick={() => { setHomeView('home'); setActive(null); setSelectedFolderId(null) }}><Home size={16} />首页</button>
      <button className="nav-row" onClick={() => { setShowInvite(true); setInviteError(''); setInviteLink('') }}><Users size={16} />成员</button>
      <button className="nav-row" onClick={() => { setHomeView('home'); setActive(null); setSelectedFolderId(null); setQuery('__favorites__') }}><Star size={16} />收藏 <span className="nav-count">{favoriteIds.length || ''}</span></button>
      <button className="nav-row" onClick={() => { setHomeView('trash'); setActive(null); setSelectedFolderId(null) }}><Trash2 size={16} />回收站</button>
      <div className="tree-heading"><button onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<span>文档</span></button><div><button className="tiny-btn" title="新建文件夹" onClick={() => createDocument('folder')}><FolderPlus size={15} /></button><button className="tiny-btn" title="新建文档" onClick={() => createDocument('document')}><Plus size={16} /></button></div></div>
      {expanded && <div className="doc-tree"><button className={`root-folder ${selectedFolderId === null ? 'selected' : ''}`} onClick={() => { setSelectedFolderId(null); setActive(null); setHomeView('home'); setQuery('') }}><Folder size={15} /><span>所有文档</span></button>{visibleTree.map((node) => <TreeItem key={node.doc.id} node={node} depth={0} activeId={active?.id || null} selectedFolderId={selectedFolderId} expandedFolders={expandedFolders} onToggle={(id) => setExpandedFolders((folders) => { const next = new Set(folders); next.has(id) ? next.delete(id) : next.add(id); return next })} onSelectFolder={(folder) => { setSelectedFolderId(folder.id); setActive(null); setHomeView('home'); setShowRight(false) }} onSelectDocument={(doc) => { setActive(doc); setSelectedFolderId(doc.parentId || null); setHomeView('home'); setShowRight(false) }} onAction={handleDocumentAction} favoriteIds={favoriteSet} />)}{visibleTree.length === 0 && <div className="empty-tree">{query ? '没有匹配的文档' : '暂无文档或文件夹'}</div>}</div>}
      <div className="sidebar-bottom"><div className="help-row"><span className="help-dot">?</span><span>帮助与反馈</span><MoreHorizontal size={17} /></div><div className="profile-row"><div className="avatar">{(user.name || user.email)[0].toUpperCase()}</div><div className="profile-copy"><b>{user.name || user.email.split('@')[0]}</b><small>{user.email}</small></div><button className="icon-btn" title="退出登录" onClick={clearToken}><LogOut size={16} /></button></div></div>
    </aside>}
    <main className="main-area">{updateInfo && <div className={`update-banner ${updateInfo.status}`} role="status"><span>{updateInfo.status === 'running' ? `正在更新到 ${updateInfo.version}…` : updateInfo.status === 'completed' ? '更新完成' : updateInfo.status === 'failed' ? `更新失败（${updateInfo.version}）` : `发现新版本 ${updateInfo.version}`}</span>{updateInfo.status === 'available' && <button className="update-action" onClick={() => void startUpdate()}>立即更新</button>}{updateInfo.status === 'failed' && <button className="update-action" onClick={() => void startUpdate()}>重试</button>}</div>}
      <header className="topbar">{!sidebarOpen && <button className="icon-btn" title="展开侧边栏" onClick={() => setSidebarOpen(true)}><PanelLeftClose size={17} /></button>}<div className="breadcrumbs"><span>我的文档</span><ChevronRight size={14} /><strong>{active?.title || selectedFolder?.title || '所有文档'}</strong></div><div className="top-actions">{updateInfo && <a className="update-link" href={updateInfo.url || '#'} target="_blank" rel="noreferrer">新版本 {updateInfo.version}</a>}<span className={`save-state ${notice.includes('失败') || notice.includes('冲突') ? 'save-error' : ''}`}><span className="save-dot" />{notice || '已同步'}</span><div className="collaborators" aria-label="在线成员"><div className="presence-stack"><div className="mini-avatar green" title="你">{(user.name || user.email)[0].toUpperCase()}</div>{collaborators.slice(0, 3).map((person) => <div key={person.clientId} className="mini-avatar" title={person.name} style={{ background: person.color + '24', color: person.color }}>{person.name[0]?.toUpperCase()}</div>)}{collaborators.length > 3 && <span className="presence-more">+{collaborators.length - 3}</span>}</div><span className={`connection-state ${collabStatus}`} aria-live="polite">{collabStatus === 'connected' ? '已连接' : collabStatus === 'connecting' ? '连接中' : '已断开'}</span><button className="share-btn" onClick={() => { setShowInvite(true); setInviteError(''); setInviteLink('') }}><Share2 size={15} />共享</button><button className="icon-btn" title="文档历史" onClick={() => { setRightTab('history'); setShowRight(true) }}><History size={17} /></button><button className="icon-btn" title="评论" onClick={() => { setRightTab('comments'); setShowRight(true) }}><MessageCircle size={17} /></button><button className="icon-btn" title="更多操作"><MoreHorizontal size={18} /></button></div></div></header>
      {active && <div className="workspace-content"><section className="editor-column"><DocumentEditor key={active.id} doc={active} token={token} persist={persist} user={user} onAwareness={setCollaborators} onCollabStatus={setCollabStatus} onSelection={(anchor) => { setCommentAnchor(anchor); setRightTab('comments'); setShowRight(true) }} /></section>
      {showRight && active && <aside className="right-panel"><div className="panel-tabs"><button className={rightTab === 'comments' ? 'active' : ''} onClick={() => setRightTab('comments')}><MessageCircle size={15} />评论</button><button className={rightTab === 'history' ? 'active' : ''} onClick={() => setRightTab('history')}><History size={15} />历史</button><button className="icon-btn close-panel" title="关闭面板" onClick={() => setShowRight(false)}><X size={16} /></button></div>{rightTab === 'comments' ? <div className="panel-body"><div className="panel-intro"><b>讨论</b><span>{comments.length} 条评论</span></div>{comments.length === 0 ? <div className="panel-empty"><MessageCircle size={21} /><b>还没有评论</b><span>选中文本后点击评论开始讨论</span></div> : <div className="comment-list">{comments.map((comment) => <div className={`comment ${comment.status === 'resolved' ? 'comment-resolved' : ''}`} key={comment.id}><div className="comment-head"><div className="avatar small-avatar">{(comment.userName || '?')[0].toUpperCase()}</div><div><b>{comment.userName || '成员'}</b><small>{formatDate(comment.createdAt)}{comment.status === 'resolved' ? ' · 已解决' : ''}</small></div></div>{comment.anchor?.text && <button className="comment-anchor" title="定位到引用" onClick={() => window.dispatchEvent(new CustomEvent('mdoc-focus-anchor', { detail: comment.anchor }))}>“{comment.anchor.text.slice(0, 80)}”</button>}<p>{comment.body}</p><div className="comment-actions"><button onClick={() => setCommentText(`@${comment.userName || '成员'} `)}>回复</button>{comment.status !== 'resolved' && <button onClick={() => setNotice('评论线程需要服务端状态接口支持。')}>解决</button>}</div></div>)}</div>}<div className="comment-compose">{commentAnchor?.text && <div className="anchor-preview">引用：“{commentAnchor.text.slice(0, 90)}” <button aria-label="移除引用" onClick={() => setCommentAnchor(null)}><X size={12} /></button></div>}<textarea aria-label="评论内容" placeholder="添加评论..." value={commentText} onChange={(e) => setCommentText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addComment() }} /><div><span>Ctrl + Enter 发送</span><button className="send-btn" title="发送评论" onClick={addComment} disabled={!commentText.trim()}><Send size={15} /></button></div></div></div> : <div className="panel-body"><div className="panel-intro"><b>版本历史</b><span>{versions.length} 个版本</span></div>{versions.length === 0 ? <div className="panel-empty"><Clock3 size={21} /><b>暂无历史记录</b><span>文档更改后会保留版本</span></div> : <div className="version-list">{versions.map((version) => <div className="version-item" key={version.id}><div className="version-line"><span className="version-dot" /><div><b>版本 {version.version}</b><small>{version.createdBy || '成员'} · {formatDate(version.createdAt)}</small></div></div><button onClick={() => { if (window.confirm(`确认恢复到版本 ${version.version}？当前内容会先保存为新版本。`)) void restoreVersion(version.id) }}>恢复</button></div>)}</div>}</div>}</aside>}</div>}
      {!active && (selectedFolder ? <div className="folder-overview"><div className="folder-overview-head"><div className="folder-large-icon"><Folder size={23} /></div><div><h1>{selectedFolder.title}</h1><p>{folderChildren.length} 个项目</p></div><button className="primary-btn" onClick={() => createDocument('document')}><FilePlus2 size={15} />新建文档</button></div>{folderChildren.length ? <div className="folder-items">{folderChildren.map((child) => <button key={child.id} className="folder-item" onClick={() => child.kind === 'folder' ? (setSelectedFolderId(child.id), setActive(null)) : (setActive(child), setSelectedFolderId(child.parentId || null))}><span className={`folder-item-icon ${child.kind === 'folder' ? 'is-folder' : ''}`}>{child.kind === 'folder' ? <Folder size={17} /> : <FileText size={17} />}</span><span>{child.title}</span><ChevronRight size={15} /></button>)}</div> : <div className="folder-empty"><div className="folder-empty-icon"><Folder size={22} /></div><h2>此文件夹为空</h2><p>在这里创建文档，或新建子文件夹来整理内容。</p><div><button className="primary-btn" onClick={() => createDocument('document')}><FilePlus2 size={15} />新建文档</button><button className="secondary-btn" onClick={() => createDocument('folder')}><FolderPlus size={15} />新建子文件夹</button></div></div>}</div> : <HomeDashboard documents={homeView === 'trash' ? trashDocuments : documents} favorites={favoriteSet} query={query === '__favorites__' ? '' : query} trash={homeView === 'trash'} onOpen={(doc) => { setActive(doc); setSelectedFolderId(doc.parentId || null) }} onCreate={() => createDocument('document')} onRestore={async (doc) => { await request(`/documents/${doc.id}/restore`, token, { method: 'POST' }); setTrashDocuments((rows) => rows.filter((row) => row.id !== doc.id)); setNotice('文档已恢复') }} onPermanentDelete={async (doc) => { if (!window.confirm(`永久删除“${doc.title}”？`)) return; await request(`/documents/${doc.id}/permanent`, token, { method: 'DELETE' }); setTrashDocuments((rows) => rows.filter((row) => row.id !== doc.id)); setNotice('文档已永久删除') }} />)}
    {commandOpen && <CommandPalette query={query} setQuery={setQuery} index={commandIndex} setIndex={setCommandIndex} documents={searchResults.length ? searchResults : documents} onClose={() => setCommandOpen(false)} onOpen={(doc) => { setActive(doc); setSelectedFolderId(doc.parentId || null); setCommandOpen(false) }} onCreate={() => { setCommandOpen(false); createDocument('document') }} onHome={() => { setActive(null); setSelectedFolderId(null); setHomeView('home'); setCommandOpen(false) }} />}
    </main>
    {showInvite && <InviteDialog email={inviteEmail} setEmail={setInviteEmail} role={inviteRole} setRole={setInviteRole} link={inviteLink} error={inviteError} busy={inviteBusy} copied={copied} onSubmit={createInvite} onCopy={copyInviteLink} onClose={() => setShowInvite(false)} />}
  </div>
}

function HomeDashboard({ documents, favorites, query, trash, onOpen, onCreate, onRestore, onPermanentDelete }: { documents: Doc[]; favorites: Set<string>; query: string; trash: boolean; onOpen: (doc: Doc) => void; onCreate: () => void; onRestore: (doc: Doc) => Promise<void>; onPermanentDelete: (doc: Doc) => Promise<void> }) {
  const visible = documents.filter((doc) => !query || doc.title.toLowerCase().includes(query.toLowerCase()))
  if (trash) return <div className="home-dashboard"><div className="home-hero"><div><span className="eyebrow">文档管理</span><h1>回收站</h1><p>恢复误删的文档，或永久清理不再需要的内容。</p></div></div><section className="home-section"><div className="home-section-head"><h2><Trash2 size={16} />已删除文档</h2><span>{visible.length} 项</span></div>{visible.length ? <div className="home-grid">{visible.map((doc) => <div className="home-card" key={doc.id}><button className="home-card-main" onClick={() => onOpen(doc)}><span className="home-card-icon"><FileText size={17} /></span><span><b>{doc.title}</b><small>已移入回收站</small></span></button><span className="home-card-actions"><button title="恢复" onClick={() => void onRestore(doc)}>恢复</button><button title="永久删除" onClick={() => void onPermanentDelete(doc)}>删除</button></span></div>)}</div> : <div className="home-empty">回收站为空</div>}</section></div>
  const favoriteDocs = visible.filter((doc) => favorites.has(doc.id))
  const recent = [...visible].sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()).slice(0, 6)
  const sections = [{ title: '最近访问', icon: Clock3, items: recent }, { title: '收藏', icon: Star, items: favoriteDocs }, { title: '我创建的', icon: FileText, items: visible.filter((doc) => doc.kind !== 'folder').slice(0, 6) }]
  return <div className="home-dashboard"><div className="home-hero"><div><span className="eyebrow">工作区</span><h1>欢迎回来</h1><p>继续处理你的文档，或创建一个新的知识空间。</p></div><button className="primary-btn" onClick={onCreate}><FilePlus2 size={16} />新建文档</button></div>{sections.map(({ title, icon: Icon, items }) => <section className="home-section" key={title}><div className="home-section-head"><h2><Icon size={16} />{title}</h2><span>{items.length} 项</span></div>{items.length ? <div className="home-grid">{items.map((doc) => <button className="home-card" key={doc.id} onClick={() => onOpen(doc)}><span className={`home-card-icon ${doc.kind === 'folder' ? 'folder' : ''}`}>{doc.kind === 'folder' ? <Folder size={17} /> : <FileText size={17} />}</span><span><b>{doc.title || '未命名文档'}</b><small>{doc.kind === 'folder' ? '文件夹' : `更新于 ${formatDate(doc.updatedAt) || '刚刚'}`}</small></span><ChevronRight size={15} /></button>)}</div> : <div className="home-empty">{title === '收藏' ? '收藏的文档会显示在这里' : '暂时没有内容'}</div>}</section>)}</div>
}

function CommandPalette({ query, setQuery, index, setIndex, documents, onClose, onOpen, onCreate, onHome }: { query: string; setQuery: (value: string) => void; index: number; setIndex: (value: number) => void; documents: Doc[]; onClose: () => void; onOpen: (doc: Doc) => void; onCreate: () => void; onHome: () => void }) {
  const items = useMemo(() => [{ key: 'home', label: '打开首页', icon: Home }, { key: 'create', label: '新建文档', icon: Plus }, ...documents.filter((doc) => doc.title.toLowerCase().includes(query.toLowerCase())).slice(0, 8).map((doc) => ({ key: doc.id, label: doc.title, icon: doc.kind === 'folder' ? Folder : FileText, doc }))], [documents, query])
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(Math.min(index + 1, items.length - 1)) } if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(Math.max(index - 1, 0)) } if (event.key === 'Escape') onClose(); if (event.key === 'Enter') { event.preventDefault(); const item = items[index]; if (!item) return; if (item.key === 'home') onHome(); else if (item.key === 'create') onCreate(); else if ('doc' in item) onOpen(item.doc) } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler) }, [index, items, onClose, onCreate, onHome, onOpen, setIndex])
  return <div className="command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="command-palette" role="dialog" aria-modal="true" aria-label="命令面板"><div className="command-input"><Search size={17} /><input autoFocus placeholder="搜索文档或输入命令" value={query === '__favorites__' ? '' : query} onChange={(event) => setQuery(event.target.value)} /><kbd>ESC</kbd></div><div className="command-list">{items.map((item, itemIndex) => { const Icon = item.icon; return <button key={item.key} className={itemIndex === index ? 'active' : ''} onMouseEnter={() => setIndex(itemIndex)} onClick={() => item.key === 'home' ? onHome() : item.key === 'create' ? onCreate() : 'doc' in item && onOpen(item.doc)}><Icon size={16} /><span>{item.label}</span>{item.key === 'create' && <kbd>⌘ N</kbd>}</button> })}{!items.length && <div className="command-empty">没有匹配的文档</div>}</div><div className="command-footer"><span><kbd>↑↓</kbd> 导航</span><span><kbd>Enter</kbd> 打开</span></div></section></div>
}

function Login({ onLogin, onAccepted, error, busy }: { onLogin: (email: string, password: string) => void; onAccepted: (result: { token: string; user: User }) => void; error: string; busy: boolean }) {
  const inviteToken = useMemo(() => new URLSearchParams(window.location.search).get('invite') || '', [])
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState(''); const [inviteError, setInviteError] = useState(''); const [inviteBusy, setInviteBusy] = useState(false)
  async function acceptInvite(event: React.FormEvent) {
    event.preventDefault(); setInviteError(''); setInviteBusy(true)
    try {
      const response = await fetch(`${API}/api/v1/auth/accept-invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteToken, password, name }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message || body.message || '邀请链接无效或已过期')
      localStorage.setItem('mdocs-token', body.token)
      window.history.replaceState(null, '', window.location.pathname)
      onAccepted(body)
    } catch (error) { setInviteError((error as Error).message) }
    finally { setInviteBusy(false) }
  }
  return <div className="login-screen"><div className="login-card"><div className="login-brand"><div className="brand-mark"><Sparkles size={17} /></div><span>Marvelous Docs</span></div>{inviteToken ? <><h1>加入团队</h1><p>设置你的账户以加入工作区</p><form onSubmit={acceptInvite}><label>姓名<input autoComplete="name" placeholder="你的姓名" value={name} onChange={(e) => setName(e.target.value)} required /></label><label>设置密码<input type="password" autoComplete="new-password" placeholder="至少 12 个字符" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>{inviteError && <div className="login-error"><AlertCircle size={15} />{inviteError}</div>}<button className="primary-btn login-submit" disabled={inviteBusy}>{inviteBusy ? '正在加入...' : '接受邀请'}<ChevronRight size={16} /></button></form></> : <><h1>欢迎回来</h1><p>登录你的团队工作区</p><form onSubmit={(e) => { e.preventDefault(); onLogin(email, password) }}><label>邮箱地址<input type="email" autoComplete="username" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><label>密码<input type="password" autoComplete="current-password" placeholder="输入密码" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>{error && <div className="login-error"><AlertCircle size={15} />{error}</div>}<button className="primary-btn login-submit" disabled={busy}>{busy ? '正在登录...' : '登录'}<ChevronRight size={16} /></button></form></>}<div className="login-foot">私有部署 · 团队知识空间</div></div></div>
}

function InviteDialog({ email, setEmail, role, setRole, link, error, busy, copied, onSubmit, onCopy, onClose }: { email: string; setEmail: (value: string) => void; role: 'member' | 'admin'; setRole: (value: 'member' | 'admin') => void; link: string; error: string; busy: boolean; copied: boolean; onSubmit: (event: React.FormEvent) => void; onCopy: () => void; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="invite-modal" role="dialog" aria-modal="true" aria-labelledby="invite-title"><header><div><div className="invite-icon"><UserPlus size={17} /></div><h2 id="invite-title">邀请成员</h2><p>邀请同事加入这个工作区。</p></div><button className="icon-btn" title="关闭" onClick={onClose}><X size={17} /></button></header><form onSubmit={onSubmit}><label>邮箱地址<div className="invite-input"><Mail size={15} /><input type="email" placeholder="name@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></div></label><label>工作区角色<select value={role} onChange={(event) => setRole(event.target.value as 'member' | 'admin')}><option value="member">成员</option><option value="admin">管理员</option></select></label>{error && <div className="invite-error"><AlertCircle size={15} />{error}</div>}{link ? <div className="invite-result"><b>邀请链接已创建</b><p>链接有效期为 7 天。发送给 {email} 完成注册。</p><div className="link-copy"><input readOnly value={link} onFocus={(event) => event.currentTarget.select()} /><button type="button" className="primary-btn" onClick={onCopy}><Copy size={14} />{copied ? '已复制' : '复制链接'}</button></div></div> : <button className="primary-btn invite-submit" disabled={busy}>{busy ? '正在创建...' : '创建邀请'}<ChevronRight size={15} /></button>}</form></section></div>
}

function TreeItem({ node, depth, activeId, selectedFolderId, expandedFolders, onToggle, onSelectFolder, onSelectDocument, onAction, favoriteIds }: { node: DocNode; depth: number; activeId: string | null; selectedFolderId: string | null; expandedFolders: Set<string>; onToggle: (id: string) => void; onSelectFolder: (doc: Doc) => void; onSelectDocument: (doc: Doc) => void; onAction: (action: string, doc: Doc) => void; favoriteIds: Set<string> }) {
  const isFolder = node.doc.kind === 'folder'
  const expanded = expandedFolders.has(node.doc.id)
  return <div className="tree-node"><div className={`tree-entry ${activeId === node.doc.id || selectedFolderId === node.doc.id ? 'selected' : ''}`} style={{ paddingLeft: `${depth * 15}px` }}><button className={`tree-doc ${isFolder ? 'tree-folder' : ''}`} onClick={() => isFolder ? onSelectFolder(node.doc) : onSelectDocument(node.doc)}>{isFolder ? <span role="button" tabIndex={0} className="tree-expand" aria-label={expanded ? '收起文件夹' : '展开文件夹'} onClick={(event) => { event.stopPropagation(); onToggle(node.doc.id) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onToggle(node.doc.id) } }}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span> : <span className="tree-indent" />}{isFolder ? <Folder size={15} /> : <FileText size={15} />}<span>{node.doc.title || (isFolder ? '未命名文件夹' : '未命名文档')}</span></button><button className="tree-more" aria-label={`${node.doc.title} 更多操作`} title="更多操作" onClick={() => { const action = window.prompt('操作：rename 重命名 / move 移动 / favorite 收藏 / delete 删除', favoriteIds.has(node.doc.id) ? 'favorite' : 'rename'); if (action) onAction(action, node.doc) }}><MoreHorizontal size={14} /></button></div>{isFolder && expanded && node.children.map((child) => <TreeItem key={child.doc.id} node={child} depth={depth + 1} activeId={activeId} selectedFolderId={selectedFolderId} expandedFolders={expandedFolders} onToggle={onToggle} onSelectFolder={onSelectFolder} onSelectDocument={onSelectDocument} onAction={onAction} favoriteIds={favoriteIds} />)}</div>
}

function DocumentEditor({ doc, token, persist, user, onAwareness, onCollabStatus, onSelection }: { doc: Doc; token: string; persist: (json: Record<string, unknown>) => void; user: User; onAwareness: (users: Array<{ clientId: number; name: string; color: string }>) => void; onCollabStatus: (status: 'connecting' | 'connected' | 'disconnected') => void; onSelection: (anchor: { from: number; to: number; text: string }) => void }) {
  const ydoc = useMemo(() => COLLAB_URL ? new Y.Doc() : null, [doc.id])
  const provider = useMemo(() => ydoc && COLLAB_URL ? new WebsocketProvider(COLLAB_URL, doc.id, ydoc, { params: { token } }) : null, [ydoc, doc.id, token])
  useEffect(() => {
    if (!provider) { onCollabStatus('disconnected'); return }
    const color = ['#4677c8', '#b15c9b', '#4b8b6b', '#c17a3c'][Math.abs(user.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 4]
    provider.awareness.setLocalStateField('user', { name: user.name || user.email.split('@')[0], color })
    const publish = () => {
      const people: Array<{ clientId: number; name: string; color: string }> = []
      provider.awareness.getStates().forEach((state, clientId) => {
        const person = state.user as { name?: string; color?: string } | undefined
        if (clientId !== provider.awareness.clientID && person?.name) people.push({ clientId, name: person.name, color: person.color || '#64748b' })
      })
      onAwareness(people)
    }
    const status = ({ status }: { status: string }) => onCollabStatus(status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'disconnected')
    provider.on('status', status); provider.awareness.on('change', publish); publish()
    return () => { provider.off('status', status); provider.awareness.off('change', publish); onAwareness([]); provider.destroy(); ydoc?.destroy() }
  }, [provider, user.id, user.name, user.email, onAwareness, onCollabStatus, ydoc])
  const editor = useEditor({
    extensions: [
      StarterKit.configure(provider ? { history: false } : {}),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: '从这里开始写作…' }),
      ...(provider ? [Collaboration.configure({ document: ydoc! })] : []),
    ],
    content: doc.content?.doc || emptyContent.doc,
    onUpdate: ({ editor: instance }) => { if (!provider) persist(instance.getJSON()) },
    onSelectionUpdate: ({ editor: instance }) => {
      const { from, to } = instance.state.selection
      if (to > from) onSelection({ from, to, text: instance.state.doc.textBetween(from, to, ' ').slice(0, 500) })
    },
    editorProps: { attributes: { class: 'tiptap-content' } },
  }, [doc.id, provider])
  const [title, setTitle] = useState(doc.title)
  useEffect(() => { setTitle(doc.title) }, [doc.id, doc.title])
  async function saveTitle(next: string) {
    const clean = next.trim() || '未命名文档'; setTitle(clean)
    try {
      const latest = await request<{ document: Doc }>(`/documents/${doc.id}`, token)
      const result = await request<{ document: Doc }>(`/documents/${doc.id}`, token, { method: 'PUT', body: JSON.stringify({ title: clean, expectedVersion: latest.document.version }) })
      window.dispatchEvent(new CustomEvent('mdoc-updated', { detail: result.document }))
    } catch (error) { setTitle(doc.title); window.dispatchEvent(new CustomEvent('mdoc-notice', { detail: `标题保存失败：${(error as Error).message}` })) }
  }
  return <><div className="editor-toolbar"><ToolButton title="加粗" onClick={() => editor?.chain().focus().toggleBold().run()} active={!!editor?.isActive('bold')}><Bold size={16} /></ToolButton><ToolButton title="斜体" onClick={() => editor?.chain().focus().toggleItalic().run()} active={!!editor?.isActive('italic')}><Italic size={16} /></ToolButton><ToolButton title="下划线" onClick={() => editor?.chain().focus().toggleUnderline().run()} active={!!editor?.isActive('underline')}><UnderlineIcon size={16} /></ToolButton><span className="tool-separator" /><ToolButton title="项目符号列表" onClick={() => editor?.chain().focus().toggleBulletList().run()} active={!!editor?.isActive('bulletList')}><List size={16} /></ToolButton><ToolButton title="编号列表" onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={!!editor?.isActive('orderedList')}><ListOrdered size={16} /></ToolButton><ToolButton title="任务列表" onClick={() => editor?.chain().focus().toggleTaskList().run()} active={!!editor?.isActive('taskList')}><CheckSquare size={16} /></ToolButton><span className="tool-separator" /><button className="toolbar-format" onClick={() => editor?.chain().focus().toggleHeading({ level: editor?.isActive('heading', { level: 1 }) ? 2 : 1 }).run()}>标题 <ChevronDown size={14} /></button><ToolButton title="插入表格" onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 size={16} /></ToolButton><ToolButton title="添加链接" onClick={() => { const url = window.prompt('链接地址'); if (url) editor?.chain().focus().setLink({ href: url }).run() }}><LinkIcon size={16} /></ToolButton><ToolButton title="高亮" onClick={() => editor?.chain().focus().toggleHighlight().run()} active={!!editor?.isActive('highlight')}><HighlightIcon size={16} /></ToolButton><ToolButton title="文字颜色" onClick={() => editor?.chain().focus().setColor('#3370ff').run()} active={!!editor?.isActive('textStyle', { color: '#3370ff' })}><Palette size={16} /></ToolButton><ToolButton title="对选中文本添加评论" onClick={() => { const selection = editor?.state.selection; if (selection && selection.to > selection.from) { onSelection({ from: selection.from, to: selection.to, text: editor.state.doc.textBetween(selection.from, selection.to, ' ').slice(0, 500) }) } }}><MessageCircle size={16} /></ToolButton><div className="toolbar-spacer" /><ToolButton title="撤销" onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={16} /></ToolButton><ToolButton title="重做" onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={16} /></ToolButton><button className="icon-btn" title="导出 JSON" onClick={() => { const blob = new Blob([JSON.stringify({ schemaVersion: 1, doc: editor?.getJSON() }, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${title || 'document'}.json`; link.click(); URL.revokeObjectURL(link.href) }}><ArrowDownToLine size={16} /></button><button className="icon-btn" title="代码块" onClick={() => editor?.chain().focus().toggleCodeBlock().run()}><Code2 size={16} /></button></div><div className="paper"><div className="document-heading"><input aria-label="文档标题" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={(e) => { if (e.target.value !== doc.title) void saveTitle(e.target.value) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }} /><div className="doc-meta"><span>最后编辑于 {formatDate(doc.updatedAt) || '刚刚'}</span><span className="meta-divider" /><span><Check size={13} />所有更改已保存</span></div></div><EditorContent editor={editor} />{provider && <div className="collab-status"><span className="save-dot" />实时协作</div>}</div></>
}

function ToolButton({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick?: () => void; active?: boolean }) { return <button className={`tool-btn ${active ? 'tool-active' : ''}`} title={title} onClick={onClick}>{children}</button> }
function formatDate(value?: string) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }

export default App
