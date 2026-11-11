import { useMemo, useState } from 'react'
import { Folder, X } from 'lucide-react'
import { buildDocTree, descendantIds, flatten, treeDepth } from '../../lib/tree'
import { usePresence } from '../ui/usePresence'
import { staggerDelay } from '../../lib/motion'
import type { Doc } from '../../lib/types'

type MoveDialogProps = {
  doc: Doc
  documents: Doc[]
  busy?: boolean
  onMove: (parentId: string | null) => void
  onClose: () => void
}

export default function MoveDialog({ doc, documents, busy, onMove, onClose }: MoveDialogProps) {
  const [target, setTarget] = useState<string | null>(doc.parentId || null)
  const { closing, requestClose, onAnimationEnd } = usePresence(onClose)
  const blocked = useMemo(() => descendantIds(doc.id, documents), [doc.id, documents])
  const rows = useMemo(() => {
    const folders = documents.filter((item) => item.kind === 'folder' && item.id !== doc.id && !blocked.has(item.id))
    const byId = new Map(folders.map((item) => [item.id, item]))
    return flatten(buildDocTree(folders)).map((folder) => ({ doc: folder, depth: treeDepth(folder, byId) }))
  }, [documents, doc.id, blocked])
  const unchanged = target === (doc.parentId || null)
  return <div className={'modal-backdrop' + (closing ? ' is-closing' : '')} onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose() }}>
    <section
      className={'move-modal modal-panel' + (closing ? ' is-closing' : '')}
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-title"
      onAnimationEnd={onAnimationEnd}
    >
      <header>
        <div>
          <div className="move-icon"><Folder size={17} /></div>
          <h2 id="move-title">移动到</h2>
          <p>{doc.title || '未命名文档'}</p>
        </div>
        <button className="icon-btn" aria-label="关闭" title="关闭" onClick={requestClose}><X size={17} /></button>
      </header>
      <div className="move-list" role="listbox" aria-label="选择目标文件夹">
        <button
          role="option"
          aria-selected={target === null}
          className={'move-row ' + (target === null ? 'selected' : '')}
          onClick={() => setTarget(null)}
        ><Folder size={15} /><span>根目录</span></button>
        {rows.map(({ doc: folder, depth }, index) => <button
          key={folder.id}
          role="option"
          aria-selected={target === folder.id}
          className={'move-row stagger ' + (target === folder.id ? 'selected' : '')}
          style={{ paddingLeft: 12 + depth * 14 + 'px', animationDelay: staggerDelay(index) + 'ms' }}
          onClick={() => setTarget(folder.id)}
        ><Folder size={15} /><span>{folder.title || '未命名文件夹'}</span></button>)}
        {!rows.length && <div className="move-empty">暂无可用的目标文件夹</div>}
      </div>
      <footer>
        <span>目标：{target === null ? '根目录' : (documents.find((item) => item.id === target)?.title || '文件夹')}</span>
        <div>
          <button className="secondary-btn" onClick={requestClose}>取消</button>
          <button className="primary-btn" disabled={unchanged || !!busy} onClick={() => onMove(target)}>移动</button>
        </div>
      </footer>
    </section>
  </div>
}