import { useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Folder, Home, LogOut, PanelLeftClose, Plus, Search, ShieldCheck, Sparkles, Star, Trash2 } from 'lucide-react'
import TemplateMenu from '../layout/TemplateMenu'
import TreeItem from '../tree/TreeItem'
import Popover from '../ui/Popover'
import type { Doc, DocNode, Template, TreeAction, User } from '../../lib/types'

type SidebarProps = {
  user: User
  tree: DocNode[]
  favoriteSet: Set<string>
  activeId: string | null
  selectedFolderId: string | null
  expandedFolders: Set<string>
  homeView: 'home' | 'search' | 'trash' | 'favorites'
  emptyMessage: string
  templates: Template[]
  query: string
  narrow: boolean
  floating: boolean
  workspaceOpen: boolean
  newMenuOpen: boolean
  treeExpanded: boolean
  onClose: () => void
  onWorkspaceMenu: (open: boolean) => void
  onSearch: (value: string) => void
  onHome: () => void
  onAdmin: () => void
  onFavorites: () => void
  onTrash: () => void
  /** Multi-select state; null when the sidebar is not in selection mode. */
  checkedIds: Set<string> | null
  onToggleChecked: (doc: Doc) => void
  onEnterSelection: () => void
  onExitSelection: () => void
  onBatchDelete: () => void
  onBatchFavorite: () => void
  batchBusy: boolean
  onToggleTree: () => void
  onNewMenu: (open: boolean) => void
  onCreateDocument: (templateId?: string) => void
  onCreateFolder: () => void
  onImport: () => void
  onToggleFolder: (id: string) => void
  onSelectFolder: (doc: Doc) => void
  onSelectDocument: (doc: Doc) => void
  onDocumentAction: (action: TreeAction, doc: Doc) => void
  onHelp: () => void
  onLogout: () => void
}

/**
 * Left sidebar: workspace switcher, search, workspace nav, and the document
 * tree. It is a pure projection of the shell's state — every interaction is a
 * callback, so the shell stays the only place that mutates state.
 */
export default function Sidebar(props: SidebarProps) {
  /**
   * Roving focus for the tree. A document row is a single tab stop; arrow keys
   * move between rows, so a long tree does not put hundreds of stops in the tab
   * order.
   */
  const [focusId, setFocusId] = useState<string | null>(null)
  const treeRef = useRef<HTMLDivElement | null>(null)

  /** Moves focus to the next or previous focusable row in DOM order. */
  const moveFocus = (from: string, delta: number) => {
    const root = treeRef.current
    if (!root) return
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]'))
    const index = rows.findIndex((row: HTMLElement) => row.getAttribute('data-doc-id') === from)
    const next = rows[Math.min(Math.max(index + delta, 0), rows.length - 1)]
    const id = next?.getAttribute('data-doc-id')
    if (id) { setFocusId(id); next?.focus() }
  }

  const { user, tree, favoriteSet, activeId, selectedFolderId, expandedFolders, homeView, floating } = props
  const initial = (user.name || user.email)[0]!.toUpperCase()

  return <aside className={'sidebar' + (floating ? ' sidebar-floating' : '')} aria-label="文档导航">
    <div className="brand-row">
      <div className="brand-mark"><Sparkles size={16} /></div>
      <span className="brand-name">Marvelous Docs</span>
      <button type="button" className="icon-btn push" aria-label="收起侧边栏" title="收起侧边栏" onClick={props.onClose}><PanelLeftClose size={17} /></button>
    </div>

    {/* Floating on a narrow viewport, the sidebar overlaps the page instead of
        shrinking it, so it needs its own readable surface rather than the
        translucent one it has as a static column. */}
    <div className="sidebar-scroll">
      <div className="workspace-anchor">
        <button type="button" className="workspace" aria-haspopup="menu" aria-expanded={props.workspaceOpen} onClick={() => props.onWorkspaceMenu(!props.workspaceOpen)}>
          <div className="workspace-avatar">M</div>
          <span className="workspace-copy"><b>Marvelous 团队</b><small>工作区</small></span>
          <ChevronDown size={16} />
        </button>
        <Popover open={props.workspaceOpen} onClose={() => props.onWorkspaceMenu(false)} label="工作区菜单" align="left" className="workspace-menu">
          <div className="workspace-menu-head"><b>Marvelous 团队</b><span>私有部署 · 单工作区</span></div>
          <div className="workspace-menu-user"><span className="avatar">{initial}</span><div><b>{user.name || user.email.split('@')[0]}</b><small>{user.email}</small></div></div>
          <div className="menu-divider" />
          {user.role === 'admin' && <button type="button" role="menuitem" className="menu-item" onClick={props.onAdmin}><ShieldCheck size={15} /><span>管理中心</span></button>}
          <button type="button" role="menuitem" className="menu-item" onClick={props.onHelp}><span className="menu-key">?</span><span>快捷键与帮助</span></button>
          <button type="button" role="menuitem" className="menu-item menu-item-danger" onClick={props.onLogout}><LogOut size={15} /><span>退出登录</span></button>
        </Popover>
      </div>

      <div className="sidebar-actions">
        <div className="action-row">
          <Search size={16} />
          <input
            aria-label="搜索文档"
            placeholder="搜索文档"
            value={props.query}
            onChange={(event) => props.onSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') props.onSearch('') }}
          />
          <kbd>⌘ K</kbd>
        </div>
      </div>

      <div className="nav-label">导航</div>
      <nav className="nav-list" aria-label="工作区导航">
        <button type="button" className="nav-row" aria-current={homeView === 'home' && !activeId && !selectedFolderId ? 'page' : undefined} onClick={props.onHome}><Home size={16} />首页</button>
        {user.role === 'admin' && <button type="button" className="nav-row" onClick={props.onAdmin}><ShieldCheck size={16} />管理中心</button>}
        <button type="button" className="nav-row" aria-current={homeView === 'favorites' ? 'page' : undefined} onClick={props.onFavorites}><Star size={16} />收藏 {favoriteSet.size > 0 && <span className="nav-count">{favoriteSet.size}</span>}</button>
        <button type="button" className="nav-row" aria-current={homeView === 'trash' ? 'page' : undefined} onClick={props.onTrash}><Trash2 size={16} />回收站</button>
      </nav>

      <div className="tree-heading">
        <button type="button" className="tree-heading-toggle" aria-expanded={props.treeExpanded} onClick={props.onToggleTree}>
          {props.treeExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span>文档</span>
        </button>
        <button
          type="button"
          className={'tree-select-toggle' + (props.checkedIds ? ' is-active' : '')}
          aria-pressed={Boolean(props.checkedIds)}
          title={props.checkedIds ? '退出多选' : '多选文档'}
          onClick={() => props.checkedIds ? props.onExitSelection() : props.onEnterSelection()}
        >{props.checkedIds ? '取消' : '选择'}</button>
        <div className="new-menu-anchor">
          <button type="button" className="new-doc-btn" aria-haspopup="menu" aria-expanded={props.newMenuOpen} title="新建" onClick={() => props.onNewMenu(!props.newMenuOpen)}><Plus size={14} /><span>新建</span><ChevronDown size={12} /></button>
          <TemplateMenu
            open={props.newMenuOpen}
            templates={props.templates}
            onCreateBlank={() => props.onCreateDocument()}
            onCreateTemplate={(templateId) => props.onCreateDocument(templateId)}
            onImport={props.onImport}
            onNewFolder={props.onCreateFolder}
            onClose={() => props.onNewMenu(false)}
          />
        </div>
      </div>

      {props.treeExpanded && <div className="doc-tree-shell">
        {/* The "所有文档" shortcut is a sibling action, not a node of the tree,
            so it lives outside role="tree" — a tree may only contain treeitems
            and groups. */}
        <button type="button" className="root-folder" onClick={props.onHome}><Folder size={15} /><span>所有文档</span></button>
        <div
        className="doc-tree"
        ref={treeRef}
        role="tree"
        aria-label="文档树"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          const active = document.activeElement
          const id = active?.getAttribute('data-doc-id')
          if (!id) return
          event.preventDefault()
          moveFocus(id, event.key === 'ArrowDown' ? 1 : -1)
        }}
      >
        {tree.map((node, rowIndex) => <TreeItem
          key={node.doc.id}
          node={node}
          depth={0}
          index={rowIndex}
          activeId={activeId}
          selectedFolderId={selectedFolderId}
          expandedFolders={expandedFolders}
          favoriteIds={favoriteSet}
          onToggle={props.onToggleFolder}
          onSelectFolder={props.onSelectFolder}
          onSelectDocument={props.onSelectDocument}
          onAction={props.onDocumentAction}
          checkedIds={props.checkedIds}
          onToggleChecked={props.onToggleChecked}
          focusId={focusId}
          onFocusRow={setFocusId}
        />)}
        {tree.length === 0 && <div className="empty-tree">{props.emptyMessage}</div>}
        </div>
      </div>}
    </div>

    {props.checkedIds && <div className="batch-bar" role="toolbar" aria-label="批量操作">
      <span className="batch-count">已选 {props.checkedIds.size} 项</span>
      <button type="button" className="batch-action" onClick={props.onBatchFavorite} disabled={props.checkedIds.size === 0 || props.batchBusy}>收藏</button>
      <button type="button" className="batch-action danger" onClick={props.onBatchDelete} disabled={props.checkedIds.size === 0 || props.batchBusy}>{props.batchBusy ? '处理中…' : '移到回收站'}</button>
    </div>}

    <div className="sidebar-bottom">
      <button type="button" className="help-row" onClick={props.onHelp}><span className="help-dot">?</span><span>帮助与快捷键</span></button>
      <div className="profile-row">
        <div className="avatar">{initial}</div>
        <div className="profile-copy"><b>{user.name || user.email.split('@')[0]}</b><small>{user.email}</small></div>
        <button type="button" className="icon-btn" aria-label="退出登录" title="退出登录" onClick={props.onLogout}><LogOut size={16} /></button>
      </div>
    </div>
  </aside>
}
