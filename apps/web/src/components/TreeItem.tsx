import { useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, MoreHorizontal } from 'lucide-react'
import type { Doc, DocNode, TreeAction } from '../lib/types'

type TreeItemProps = {
  node: DocNode
  depth: number
  activeId: string | null
  selectedFolderId: string | null
  expandedFolders: Set<string>
  favoriteIds: Set<string>
  onToggle: (id: string) => void
  onSelectFolder: (doc: Doc) => void
  onSelectDocument: (doc: Doc) => void
  onAction: (action: TreeAction, doc: Doc) => void
}

export default function TreeItem(props: TreeItemProps) {
  const { node, depth, activeId, selectedFolderId, expandedFolders, favoriteIds, onToggle, onSelectFolder, onSelectDocument, onAction } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const isFolder = node.doc.kind === 'folder'
  const expanded = expandedFolders.has(node.doc.id)
  const title = node.doc.title || (isFolder ? '未命名文件夹' : '未命名文档')
  const run = (action: TreeAction) => {
    setMenuOpen(false)
    onAction(action, node.doc)
  }
  return <div className="tree-node">
    <div className={'tree-entry ' + (activeId === node.doc.id || selectedFolderId === node.doc.id ? 'selected' : '')} style={{ paddingLeft: depth * 15 + 'px' }}>
      <button className={'tree-doc ' + (isFolder ? 'tree-folder' : '')} onClick={() => isFolder ? onSelectFolder(node.doc) : onSelectDocument(node.doc)}>
        {isFolder ? <span
          role="button"
          tabIndex={0}
          className="tree-expand"
          aria-label={expanded ? '收起文件夹' : '展开文件夹'}
          onClick={(event) => { event.stopPropagation(); onToggle(node.doc.id) }}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onToggle(node.doc.id) } }}
        >{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span> : <span className="tree-indent" />}
        {isFolder ? <Folder size={15} /> : <FileText size={15} />}
        <span>{title}</span>
      </button>
      <button
        className="tree-more"
        aria-label={title + ' 更多操作'}
        title="更多操作"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(event) => { event.stopPropagation(); setMenuOpen((value) => !value) }}
      ><MoreHorizontal size={14} /></button>
      {menuOpen && <>
        <div className="menu-scrim" onClick={() => setMenuOpen(false)} />
        <div className="tree-menu" role="menu" aria-label={title + ' 操作'}>
          <button role="menuitem" onClick={() => run('rename')}>重命名</button>
          {!isFolder && <button role="menuitem" onClick={() => run('duplicate')}>创建副本</button>}
          <button role="menuitem" onClick={() => run('favorite')}>{favoriteIds.has(node.doc.id) ? '取消收藏' : '收藏'}</button>
          <button role="menuitem" onClick={() => run('move')}>移动到…</button>
          <button role="menuitem" className="menu-danger" onClick={() => run('delete')}>移到回收站</button>
        </div>
      </>}
    </div>
    {isFolder && expanded && node.children.map((child) => <TreeItem
      key={child.doc.id}
      node={child}
      depth={depth + 1}
      activeId={activeId}
      selectedFolderId={selectedFolderId}
      expandedFolders={expandedFolders}
      favoriteIds={favoriteIds}
      onToggle={onToggle}
      onSelectFolder={onSelectFolder}
      onSelectDocument={onSelectDocument}
      onAction={onAction}
    />)}
  </div>
}
