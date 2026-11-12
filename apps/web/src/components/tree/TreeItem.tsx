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
  /** Called when a dragged row is dropped onto a folder row (null = tree root). */
  onDropInto?: (dragged: Doc, target: Doc | null) => void
  /** Every document in the workspace, used to resolve a drag payload by id. */
  allDocs?: Doc[]
}

/**
 * One tree row: [chevron slot][icon][label][overflow].
 * The chevron is a sibling button rather than an absolutely positioned
 * overlay, so folder and document rows share the exact same baselines and
 * the label never slides underneath the toggle.
 */
export default function TreeItem(props: TreeItemProps) {
  const { node, depth, index = 0, activeId, selectedFolderId, expandedFolders, favoriteIds, onToggle, onSelectFolder, onSelectDocument, onAction, checkedIds, onToggleChecked, focusId, onFocusRow, level = 1, onDropInto } = props
  /*
   * Drag and drop is HTML5-native rather than a pointer-based implementation:
   * the tree is a plain list of rows, the interactivity is "move this node into
   * that folder", and native drag gives us the drag image, auto-scroll and the
   * Escape-to-cancel behaviour for free.
   *
   * Only folders accept a drop, and a folder may not receive itself or one of its
   * own ancestors — the server rejects a cycle with 400, but refusing locally
   * means the row simply does not highlight instead of failing after the drop.
   */
  const selecting = checkedIds !== null
  const checked = checkedIds?.has(node.doc.id) ?? false
  const [menuOpen, setMenuOpen] = useState(false)
  const isFolder = node.doc.kind === 'folder'
  const expanded = expandedFolders.has(node.doc.id)
  /** A folder is only highlighted when it is the selection itself — opening a
   *  document inside it must not light up two rows at once. */
  const selected = activeId ? activeId === node.doc.id : selectedFolderId === node.doc.id
  const title = node.doc.title || (isFolder ? '未命名文件夹' : '未命名文档')
  const [dragOver, setDragOver] = useState(false)
  const canAcceptDrop = isFolder && Boolean(onDropInto)

  /** Resolves a dragged id against the flat list the sidebar already holds. */
  const findDoc = (id: string) => props.allDocs?.find((doc) => doc.id === id) ?? null

  /**
   * True when `candidate` sits inside `folder`, walking parents upward.
   *
   * The server rejects a folder moved into its own subtree, but detecting it here
   * keeps the row from highlighting as a valid target and avoids a failed request.
   */
  const isDescendantOf = (folderId: string, candidate: Doc) => {
    let cursor: string | null = candidate.parentId ?? null
    const byId = new Map((props.allDocs ?? []).map((doc) => [doc.id, doc]))
    // Bounded by the list size, so a malformed cycle in the data cannot spin.
    for (let guard = 0; guard <= (props.allDocs?.length ?? 0); guard += 1) {
      if (!cursor) return false
      if (cursor === folderId) return true
      cursor = byId.get(cursor)?.parentId ?? null
    }
    return true
  }
  const run = (action: TreeAction) => {
    setMenuOpen(false)
    onAction(action, node.doc)
  }
  const tabStop = focusId ? focusId === node.doc.id : activeId === node.doc.id || (!activeId && selectedFolderId === node.doc.id)
  return <div
    className="tree-node stagger"
    style={staggerStyle(Math.min(index, STAGGER_LIMIT))}
    role="treeitem"
    data-doc-id={node.doc.id}
    aria-level={level}
    aria-selected={selected}
    aria-expanded={isFolder ? expanded : undefined}
    tabIndex={tabStop ? 0 : -1}
    draggable={!selecting}
    onDragStart={(event) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('application/x-mdocs-doc', node.doc.id)
      // Firefox will not begin a drag unless some text payload is present.
      event.dataTransfer.setData('text/plain', node.doc.id)
    }}
    onDragOver={(event) => {
      if (!canAcceptDrop) return
      // Only react to our own payload, so dragging a file or text from outside
      // does not highlight rows as drop targets.
      if (!event.dataTransfer.types.includes('application/x-mdocs-doc')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (!dragOver) setDragOver(true)
    }}
    onDragLeave={() => setDragOver(false)}
    onDrop={(event) => {
      setDragOver(false)
      if (!canAcceptDrop) return
      event.preventDefault()
      const draggedId = event.dataTransfer.getData('application/x-mdocs-doc') || event.dataTransfer.getData('text/plain')
      if (!draggedId || draggedId === node.doc.id) return
      const source = findDoc(draggedId)
      if (!source) return
      // Refuse to move a folder into its own subtree; the server would 400.
      if (source.kind === 'folder' && isDescendantOf(node.doc.id, source)) return
      onDropInto?.(source, node.doc)
    }}
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
    <div className={'tree-entry' + (selected ? ' is-selected' : '') + (checked ? ' is-checked' : '') + (selecting ? ' is-selecting' : '') + (dragOver ? ' is-drop-target' : '')}>
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
    {isFolder && expanded && <div className="tree-children" role="group">{node.children.map((child, childIndex) => <TreeItem
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
      onDropInto={onDropInto}
      allDocs={props.allDocs}
    />)}</div>}
  </div>
}
