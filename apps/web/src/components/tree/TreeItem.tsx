import { useState } from 'react'
import { ChevronRight, FileText, Folder, MoreHorizontal } from 'lucide-react'
import Popover from '../ui/Popover'
import { staggerStyle } from '../../lib/motion'
import type { Doc, DocNode, TreeAction } from '../../lib/types'

/** Past this index every row shares the last delay, so a deep folder still
 *  finishes opening as one gesture instead of a long trailing ribbon. */
const STAGGER_LIMIT = 8

type TreeItemProps = {
  node: DocNode
  depth: number
  /** Position among its siblings; only feeds the entry stagger. */
  index?: number
  activeId: string | null
  selectedFolderId: string | null
  expandedFolders: Set<string>
  favoriteIds: Set<string>
  onToggle: (id: string) => void
  onSelectFolder: (doc: Doc) => void
  onSelectDocument: (doc: Doc) => void
  onAction: (action: TreeAction, doc: Doc) => void
  /** Multi-select: when non-null, rows render a checkbox instead of opening. */
  checkedIds: Set<string> | null
  onToggleChecked: (doc: Doc) => void
  /**
   * Roving tabindex: only one row in the tree is a tab stop, so Tab moves past
   * the tree instead of through three buttons per document. Arrow keys move
   * between rows, as a tree widget is expected to behave.
   */
  focusId?: string | null
  onFocusRow?: (id: string) => void
  level?: number
}

/**
 * One tree row: [chevron slot][icon][label][overflow].
 * The chevron is a sibling button rather than an absolutely positioned
 * overlay, so folder and document rows share the exact same baselines and
 * the label never slides underneath the toggle.
 */
export default function TreeItem(props: TreeItemProps) {
  const { node, depth, index = 0, activeId, selectedFolderId, expandedFolders, favoriteIds, onToggle, onSelectFolder, onSelectDocument, onAction, checkedIds, onToggleChecked, focusId, onFocusRow, level = 1 } = props
  const selecting = checkedIds !== null
  const checked = checkedIds?.has(node.doc.id) ?? false
  const [menuOpen, setMenuOpen] = useState(false)
  const isFolder = node.doc.kind === 'folder'
  const expanded = expandedFolders.has(node.doc.id)
  /** A folder is only highlighted when it is the selection itself — opening a
   *  document inside it must not light up two rows at once. */
  const selected = activeId ? activeId === node.doc.id : selectedFolderId === node.doc.id
  const title = node.doc.title || (isFolder ? '未命名文件夹' : '未命名文档')
  const run = (action: TreeAction) => {
    setMenuOpen(false)
    onAction(action, node.doc)
  }
  const tabStop = focusId ? focusId === node.doc.id : activeId === node.doc.id || (!activeId && selectedFolderId === node.doc.id)
  return <div className="tree-node stagger" style={staggerStyle(Math.min(index, STAGGER_LIMIT))} role="none">
    <div
      className={'tree-entry' + (selected ? ' is-selected' : '') + (checked ? ' is-checked' : '') + (selecting ? ' is-selecting' : '')}
      role="treeitem"
      data-doc-id={node.doc.id}
      aria-level={level}
      aria-selected={selected}
      aria-expanded={isFolder ? expanded : undefined}
      tabIndex={tabStop ? 0 : -1}
      onFocus={() => onFocusRow?.(node.doc.id)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' && isFolder && !expanded) { event.preventDefault(); onToggle(node.doc.id); return }
        if (event.key === 'ArrowLeft' && isFolder && expanded) { event.preventDefault(); onToggle(node.doc.id); return }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (selecting) onToggleChecked(node.doc)
          else if (isFolder) onSelectFolder(node.doc)
          else onSelectDocument(node.doc)
        }
      }}
    >
      {selecting
        ? <input
          type="checkbox"
          className="tree-check"
          checked={checked}
          aria-label={'选择 ' + title}
          onChange={() => onToggleChecked(node.doc)}
          onClick={(event) => event.stopPropagation()}
        />
        : isFolder
        ? <button
          type="button"
          className="tree-chevron"
          aria-label={expanded ? '收起文件夹 ' + title : '展开文件夹 ' + title}
          aria-expanded={expanded}
          tabIndex={-1}
          onClick={(event) => { event.stopPropagation(); onToggle(node.doc.id) }}
        ><ChevronRight size={12} className="chevron-rotate" /></button>
        : <span className="tree-chevron is-leaf" aria-hidden="true" />}
      <button
        type="button"
        className={'tree-doc' + (isFolder ? ' tree-folder' : '')}
        title={title}
        tabIndex={-1}
        onClick={() => {
          if (selecting) { onToggleChecked(node.doc); return }
          if (isFolder) onSelectFolder(node.doc)
          else onSelectDocument(node.doc)
        }}
      >
        {isFolder ? <Folder size={14} /> : <FileText size={14} />}
        <span className="tree-label">{title}</span>
      </button>
      {!selecting && <div className="tree-menu-anchor">
        <button
          type="button"
          className="tree-more"
          tabIndex={-1}
          aria-label={title + ' 更多操作'}
          title="更多操作"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => { event.stopPropagation(); setMenuOpen((value) => !value) }}
        ><MoreHorizontal size={14} /></button>
        <Popover open={menuOpen} onClose={() => setMenuOpen(false)} label={title + ' 操作'} className="tree-menu">
          <button type="button" role="menuitem" className="menu-item" onClick={() => run('rename')}>重命名</button>
          {!isFolder && <button type="button" role="menuitem" className="menu-item" onClick={() => run('duplicate')}>创建副本</button>}
          <button type="button" role="menuitem" className="menu-item" onClick={() => run('favorite')}>{favoriteIds.has(node.doc.id) ? '取消收藏' : '收藏'}</button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => run('move')}>移动到…</button>
          <button type="button" role="menuitem" className="menu-item menu-item-danger" onClick={() => run('delete')}>移到回收站</button>
        </Popover>
      </div>}
    </div>
    {isFolder && expanded && <div className="tree-children">{node.children.map((child, childIndex) => <TreeItem
      key={child.doc.id}
      node={child}
      depth={depth + 1}
      index={childIndex}
      activeId={activeId}
      selectedFolderId={selectedFolderId}
      expandedFolders={expandedFolders}
      favoriteIds={favoriteIds}
      onToggle={onToggle}
      onSelectFolder={onSelectFolder}
      onSelectDocument={onSelectDocument}
      onAction={onAction}
      checkedIds={checkedIds}
      onToggleChecked={onToggleChecked}
      focusId={focusId}
      onFocusRow={onFocusRow}
      level={level + 1}
    />)}</div>}
  </div>
}
