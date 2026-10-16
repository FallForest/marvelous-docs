import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import Underline from '@tiptap/extension-underline'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import './update.css'
import {
  AlertCircle, Archive, ArrowDownToLine, Bold, Check, ChevronDown, ChevronRight,
  Clock3, Code2, Copy, FilePlus2, FileText, Folder, FolderPlus, History, Italic,
  List, ListOrdered, LogOut, Mail, MessageCircle, MoreHorizontal, PanelLeftClose,
  Plus, Search, Send, Share2, Sparkles, Underline as UnderlineIcon, UserPlus, Users, X,
} from 'lucide-react'

type DocJson = { schemaVersion: 1; doc: Record<string, unknown> }
type Doc = { id: string; title: string; kind?: 'folder' | 'document'; parentId?: string | null; content: DocJson; version: number; updatedAt?: string }
type DocNode = { doc: Doc; children: DocNode[] }
type User = { id: string; name?: string; email: string }
type Comment = { id: string; body: string; userId: string; userName: string; createdAt?: string; anchor?: unknown }
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
  const [updateInfo, setUpdateInfo] = useState<{ version: string; url?: string } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [commentText, setCommentText] = useState('')
  const [expanded, setExpanded] = useState(true)
  const saveTimer = useRef<number | undefined>(undefined)
  const activeRef = useRef<Doc | null>(null)
  activeRef.current = active

  const clearToken = useCallback(() => {
    localStorage.removeItem('mdocs-token'); setToken(''); setUser(null); setActive(null); setDocuments([])
  }, [])

  useEffect(() => {
    if (!token) return
    let live = true
    Promise.all([request<{ user: User }>('/me', token), request<{ documents: Doc[] }>('/documents', token)])
      .then(([me, docs]) => {
        if (!live) return
        setUser(me.user); setDocuments(docs.documents || [])
        if (!activeRef.current && docs.documents?.length) setActive(docs.documents[0])
      })
      .catch(() => { if (live) clearToken() })
    return () => { live = false }
  }, [token, clearToken])

  useEffect(() => {
    if (!token) { setUpdateInfo(null); return }
    let live = true
    request<{ updateAvailable: boolean; latestVersion?: string | null; manifest?: { releaseUrl?: string } | null }>('/system/update-check', token)
      .then((result) => {
        if (live && result.updateAvailable && result.latestVersion) setUpdateInfo({ version: result.latestVersion, url: result.manifest?.releaseUrl })
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

  async function addComment() {
    if (!commentText.trim() || !active) return
    try {
      await request(`/documents/${active.id}/comments`, token, { method: 'POST', body: JSON.stringify({ body: commentText.trim() }) })
      const result = await request<{ comments: Comment[] }>(`/documents/${active.id}/comments`, token)
      setComments(result.comments || []); setCommentText('')
    } catch (error) { setNotice(`评论失败：${(error as Error).message}`) }
  }

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
      <div className="sidebar-actions"><button className="action-row"><Search size={16} /><input aria-label="搜索文档" placeholder="搜索文档" value={query} onChange={(e) => setQuery(e.target.value)} /><kbd>⌘ K</kbd></button></div>
      <div className="nav-label">工作区</div>
      <button className="nav-row" onClick={() => { setShowInvite(true); setInviteError(''); setInviteLink('') }}><Users size={16} />成员</button>
      <button className="nav-row"><Archive size={16} />收藏</button>
      <div className="tree-heading"><button onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<span>文档</span></button><div><button className="tiny-btn" title="新建文件夹" onClick={() => createDocument('folder')}><FolderPlus size={15} /></button><button className="tiny-btn" title="新建文档" onClick={() => createDocument('document')}><Plus size={16} /></button></div></div>
      {expanded && <div className="doc-tree"><button className={`root-folder ${selectedFolderId === null ? 'selected' : ''}`} onClick={() => { setSelectedFolderId(null); setActive(null) }}><Folder size={15} /><span>所有文档</span></button>{visibleTree.map((node) => <TreeItem key={node.doc.id} node={node} depth={0} activeId={active?.id || null} selectedFolderId={selectedFolderId} expandedFolders={expandedFolders} onToggle={(id) => setExpandedFolders((folders) => { const next = new Set(folders); next.has(id) ? next.delete(id) : next.add(id); return next })} onSelectFolder={(folder) => { setSelectedFolderId(folder.id); setActive(null); setShowRight(false) }} onSelectDocument={(doc) => { setActive(doc); setSelectedFolderId(doc.parentId || null); setShowRight(false) }} />)}{visibleTree.length === 0 && <div className="empty-tree">{query ? '没有匹配的文档' : '暂无文档或文件夹'}</div>}</div>}
      <div className="sidebar-bottom"><div className="help-row"><span className="help-dot">?</span><span>帮助与反馈</span><MoreHorizontal size={17} /></div><div className="profile-row"><div className="avatar">{(user.name || user.email)[0].toUpperCase()}</div><div className="profile-copy"><b>{user.name || user.email.split('@')[0]}</b><small>{user.email}</small></div><button className="icon-btn" title="退出登录" onClick={clearToken}><LogOut size={16} /></button></div></div>
    </aside>}
    <main className="main-area">
      <header className="topbar">{!sidebarOpen && <button className="icon-btn" title="展开侧边栏" onClick={() => setSidebarOpen(true)}><PanelLeftClose size={17} /></button>}<div className="breadcrumbs"><span>我的文档</span><ChevronRight size={14} /><strong>{active?.title || selectedFolder?.title || '所有文档'}</strong></div><div className="top-actions">{updateInfo && <a className="update-link" href={updateInfo.url || '#'} target="_blank" rel="noreferrer">新版本 {updateInfo.version}</a>}<span className={`save-state ${notice.includes('失败') || notice.includes('冲突') ? 'save-error' : ''}`}><span className="save-dot" />{notice || '已同步'}</span><div className="collaborators"><div className="mini-avatar green">{(user.name || user.email)[0].toUpperCase()}</div><button className="share-btn" onClick={() => { setShowInvite(true); setInviteError(''); setInviteLink('') }}><Share2 size={15} />共享</button><button className="icon-btn" title="文档历史" onClick={() => { setRightTab('history'); setShowRight(true) }}><History size={17} /></button><button className="icon-btn" title="评论" onClick={() => { setRightTab('comments'); setShowRight(true) }}><MessageCircle size={17} /></button><button className="icon-btn" title="更多操作"><MoreHorizontal size={18} /></button></div></div></header>
      {active && <div className="workspace-content"><section className="editor-column"><DocumentEditor key={active.id} doc={active} token={token} persist={persist} /></section>
      {showRight && active && <aside className="right-panel"><div className="panel-tabs"><button className={rightTab === 'comments' ? 'active' : ''} onClick={() => setRightTab('comments')}><MessageCircle size={15} />评论</button><button className={rightTab === 'history' ? 'active' : ''} onClick={() => setRightTab('history')}><History size={15} />历史</button><button className="icon-btn close-panel" title="关闭面板" onClick={() => setShowRight(false)}><X size={16} /></button></div>{rightTab === 'comments' ? <div className="panel-body"><div className="panel-intro"><b>讨论</b><span>{comments.length} 条评论</span></div>{comments.length === 0 ? <div className="panel-empty"><MessageCircle size={21} /><b>还没有评论</b><span>在这里开始讨论这篇文档</span></div> : <div className="comment-list">{comments.map((comment) => <div className="comment" key={comment.id}><div className="comment-head"><div className="avatar small-avatar">{(comment.userName || '?')[0].toUpperCase()}</div><div><b>{comment.userName || '成员'}</b><small>{formatDate(comment.createdAt)}</small></div></div><p>{comment.body}</p></div>)}</div>}<div className="comment-compose"><textarea placeholder="添加评论..." value={commentText} onChange={(e) => setCommentText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addComment() }} /><div><span>Ctrl + Enter 发送</span><button className="send-btn" title="发送评论" onClick={addComment} disabled={!commentText.trim()}><Send size={15} /></button></div></div></div> : <div className="panel-body"><div className="panel-intro"><b>版本历史</b><span>{versions.length} 个版本</span></div>{versions.length === 0 ? <div className="panel-empty"><Clock3 size={21} /><b>暂无历史记录</b><span>文档更改后会保留版本</span></div> : <div className="version-list">{versions.map((version) => <div className="version-item" key={version.id}><div className="version-line"><span className="version-dot" /><div><b>版本 {version.version}</b><small>成员 · {formatDate(version.createdAt)}</small></div></div><button onClick={() => restoreVersion(version.id)}>恢复</button></div>)}</div>}</div>}</aside>}</div>}
      {!active && (selectedFolder ? <div className="folder-overview"><div className="folder-overview-head"><div className="folder-large-icon"><Folder size={23} /></div><div><h1>{selectedFolder.title}</h1><p>{folderChildren.length} 个项目</p></div><button className="primary-btn" onClick={() => createDocument('document')}><FilePlus2 size={15} />新建文档</button></div>{folderChildren.length ? <div className="folder-items">{folderChildren.map((child) => <button key={child.id} className="folder-item" onClick={() => child.kind === 'folder' ? (setSelectedFolderId(child.id), setActive(null)) : (setActive(child), setSelectedFolderId(child.parentId || null))}><span className={`folder-item-icon ${child.kind === 'folder' ? 'is-folder' : ''}`}>{child.kind === 'folder' ? <Folder size={17} /> : <FileText size={17} />}</span><span>{child.title}</span><ChevronRight size={15} /></button>)}</div> : <div className="folder-empty"><div className="folder-empty-icon"><Folder size={22} /></div><h2>此文件夹为空</h2><p>在这里创建文档，或新建子文件夹来整理内容。</p><div><button className="primary-btn" onClick={() => createDocument('document')}><FilePlus2 size={15} />新建文档</button><button className="secondary-btn" onClick={() => createDocument('folder')}><FolderPlus size={15} />新建子文件夹</button></div></div>}</div> : <div className="welcome"><div className="welcome-mark"><FileText size={23} /></div><h1>把想法写下来</h1><p>创建文档，开始与团队协作。</p><button className="primary-btn" onClick={() => createDocument('document')}><FilePlus2 size={16} />新建文档</button></div>)}
    </main>
    {showInvite && <InviteDialog email={inviteEmail} setEmail={setInviteEmail} role={inviteRole} setRole={setInviteRole} link={inviteLink} error={inviteError} busy={inviteBusy} copied={copied} onSubmit={createInvite} onCopy={copyInviteLink} onClose={() => setShowInvite(false)} />}
  </div>
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

function TreeItem({ node, depth, activeId, selectedFolderId, expandedFolders, onToggle, onSelectFolder, onSelectDocument }: { node: DocNode; depth: number; activeId: string | null; selectedFolderId: string | null; expandedFolders: Set<string>; onToggle: (id: string) => void; onSelectFolder: (doc: Doc) => void; onSelectDocument: (doc: Doc) => void }) {
  const isFolder = node.doc.kind === 'folder'
  const expanded = expandedFolders.has(node.doc.id)
  return <div className="tree-node"><button className={`tree-doc ${isFolder ? 'tree-folder' : ''} ${activeId === node.doc.id || selectedFolderId === node.doc.id ? 'selected' : ''}`} style={{ paddingLeft: `${9 + depth * 15}px` }} onClick={() => isFolder ? onSelectFolder(node.doc) : onSelectDocument(node.doc)}>{isFolder ? <span role="button" tabIndex={0} className="tree-expand" aria-label={expanded ? '收起文件夹' : '展开文件夹'} onClick={(event) => { event.stopPropagation(); onToggle(node.doc.id) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onToggle(node.doc.id) } }}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span> : <span className="tree-indent" />}{isFolder ? <Folder size={15} /> : <FileText size={15} />}<span>{node.doc.title || (isFolder ? '未命名文件夹' : '未命名文档')}</span></button>{isFolder && expanded && node.children.map((child) => <TreeItem key={child.doc.id} node={child} depth={depth + 1} activeId={activeId} selectedFolderId={selectedFolderId} expandedFolders={expandedFolders} onToggle={onToggle} onSelectFolder={onSelectFolder} onSelectDocument={onSelectDocument} />)}</div>
}

function DocumentEditor({ doc, token, persist }: { doc: Doc; token: string; persist: (json: Record<string, unknown>) => void }) {
  const ydoc = useMemo(() => COLLAB_URL ? new Y.Doc() : null, [doc.id])
  const provider = useMemo(() => ydoc && COLLAB_URL ? new WebsocketProvider(COLLAB_URL, doc.id, ydoc, { params: { token } }) : null, [ydoc, doc.id, token])
  useEffect(() => () => { provider?.destroy(); ydoc?.destroy() }, [provider, ydoc])
  const editor = useEditor({
    extensions: [StarterKit.configure(provider ? { history: false } : {}), Underline, Placeholder.configure({ placeholder: '从这里开始写作…' }), ...(provider ? [Collaboration.configure({ document: ydoc! })] : [])],
    content: doc.content?.doc || emptyContent.doc,
    onUpdate: ({ editor: instance }) => { if (!provider) persist(instance.getJSON()) },
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
  return <><div className="editor-toolbar"><ToolButton title="加粗" onClick={() => editor?.chain().focus().toggleBold().run()} active={!!editor?.isActive('bold')}><Bold size={16} /></ToolButton><ToolButton title="斜体" onClick={() => editor?.chain().focus().toggleItalic().run()} active={!!editor?.isActive('italic')}><Italic size={16} /></ToolButton><ToolButton title="下划线" onClick={() => editor?.chain().focus().toggleUnderline().run()} active={!!editor?.isActive('underline')}><UnderlineIcon size={16} /></ToolButton><span className="tool-separator" /><ToolButton title="项目符号列表" onClick={() => editor?.chain().focus().toggleBulletList().run()} active={!!editor?.isActive('bulletList')}><List size={16} /></ToolButton><ToolButton title="编号列表" onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={!!editor?.isActive('orderedList')}><ListOrdered size={16} /></ToolButton><span className="tool-separator" /><button className="toolbar-format" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>标题 <ChevronDown size={14} /></button><div className="toolbar-spacer" /><button className="icon-btn" title="导出 JSON" onClick={() => { const blob = new Blob([JSON.stringify({ schemaVersion: 1, doc: editor?.getJSON() }, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${title || 'document'}.json`; link.click(); URL.revokeObjectURL(link.href) }}><ArrowDownToLine size={16} /></button><button className="icon-btn" title="代码块" onClick={() => editor?.chain().focus().toggleCodeBlock().run()}><Code2 size={16} /></button></div><div className="paper"><div className="document-heading"><input aria-label="文档标题" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={(e) => { if (e.target.value !== doc.title) void saveTitle(e.target.value) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }} /><div className="doc-meta"><span>最后编辑于 {formatDate(doc.updatedAt) || '刚刚'}</span><span className="meta-divider" /><span><Check size={13} />所有更改已保存</span></div></div><EditorContent editor={editor} />{provider && <div className="collab-status"><span className="save-dot" />实时协作已连接</div>}</div></>
}

function ToolButton({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick?: () => void; active?: boolean }) { return <button className={`tool-btn ${active ? 'tool-active' : ''}`} title={title} onClick={onClick}>{children}</button> }
function formatDate(value?: string) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }

export default App
