import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import {
  ChevronRight, Clock3, FilePlus2, FileText, Folder, FolderPlus, Star, Trash2, Upload,
} from 'lucide-react'
import StatsCards from '../components/ui/StatsCards'
import ArtIcon from '../components/ui/ArtIcon'
import { staggerItemProps } from '../components/ui/Stagger'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { formatDate } from '../lib/format'
import { isExpired, trashExpiryLabel } from '../lib/trash'
import type { Doc, WorkspaceStats } from '../lib/types'

/**
 * Counter-drift for the hero decoration.
 *
 * Each page scrolls inside its own box, so the offset comes from that element
 * rather than the window. Only a decorative layer reads the resulting variable:
 * sliding the text under a fixed reading position is what makes parallax look
 * cheap. The listener is skipped under reduced motion, where no CSS fallback
 * can stand in for a JS-driven offset.
 */
function useHeroShift(reduced: boolean, key: string): RefObject<HTMLDivElement> {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root || reduced) return
    let frame = 0
    const apply = () => {
      frame = 0
      // A few pixels reads as depth; more turns a short hero into a moving target.
      root.style.setProperty('--hero-shift', Math.min(root.scrollTop * 0.06, 8).toFixed(2) + 'px')
    }
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(apply) }
    apply()
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      root.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [reduced, key])

  return rootRef
}

/** Eyebrow, title and subtitle enter one step apart, so the hero reads as a block. */
function heroLine(index: number, className = '') {
  return staggerItemProps(index, className)
}

export type HomeDashboardProps = {
  documents: Doc[]
  favorites: Set<string>
  query: string
  trash: boolean
  favoritesView: boolean
  stats: WorkspaceStats | null
  /** Days the server keeps a trashed row; 0 or undefined hides the countdown. */
  trashRetentionDays?: number
  onOpen: (doc: Doc) => void
  onCreate: () => void
  onImport: () => void
  onCreateFolder: () => void
  onRestore: (doc: Doc) => Promise<void>
  onPermanentDelete: (doc: Doc) => Promise<void>
  onEmptyTrash: () => void
}

export default function HomeDashboard({ documents, favorites, query, trash, favoritesView, stats, trashRetentionDays, onOpen, onCreate, onImport, onCreateFolder, onRestore, onPermanentDelete, onEmptyTrash }: HomeDashboardProps) {
  const reduced = useReducedMotion()
  const view = trash ? 'trash' : favoritesView ? 'favorites' : 'home'
  const rootRef = useHeroShift(reduced, view)
  const visible = documents.filter((doc) => !query || doc.title.toLowerCase().includes(query.toLowerCase()))
  if (trash) return <div className="home-dashboard" data-vt-scope="main" ref={rootRef}>
    <div className="home-hero"><div className="home-hero-copy">
      <span {...heroLine(0, 'eyebrow')}>文档管理</span>
      <h1 {...heroLine(1)}>回收站</h1>
      {/* The window is stated where the deadline bites, not buried in settings. */}
      <p {...heroLine(2)}>{trashRetentionDays
        ? '恢复误删的文档。删除满 ' + trashRetentionDays + ' 天后会自动永久删除，也可以现在一次清空。'
        : '恢复误删的文档，或永久清理不再需要的内容。'}</p>
    </div>
    <span className="handdrawn-only home-hero-art" aria-hidden="true"><ArtIcon name="trash" fallback={<Trash2 size={48} />} /></span>
    {visible.length > 0 && <button className="secondary-btn" onClick={onEmptyTrash}><Trash2 size={15} />清空回收站</button>}</div>
    <section className="home-section">
      <div className="home-section-head"><h2><Trash2 size={16} />已删除文档</h2><span>{visible.length + ' 项'}</span></div>
      {visible.length ? <div className="home-grid">{visible.map((doc, index) => <div {...staggerItemProps(index, 'home-card')} key={doc.id}>
        <button className="home-card-main" onClick={() => onOpen(doc)}><span className="home-card-icon"><ArtIcon name="document" fallback={<FileText size={17} />} /></span><span>
          <b>{doc.title}</b>
          {/*
            Two facts on one line: it is in the bin, and when it leaves it.
            A row the sweep has not reached yet says so instead of showing a
            countdown of zero, which would look like a stuck timer.
          */}
          <small className={isExpired(doc.expiresAt) ? 'is-expired' : undefined}>
            {'已移入回收站' + (trashExpiryLabel(doc.expiresAt) ? ' · ' + trashExpiryLabel(doc.expiresAt) : '')}
          </small>
        </span></button>
        <span className="home-card-actions"><button onClick={() => void onRestore(doc)}>恢复</button><button onClick={() => void onPermanentDelete(doc)}>删除</button></span>
      </div>)}</div> : <div className="home-empty">回收站为空</div>}
    </section>
  </div>
  const favoriteDocs = visible.filter((doc) => favorites.has(doc.id))
  if (favoritesView) return <div className="home-dashboard" data-vt-scope="main" ref={rootRef}>
    <div className="home-hero"><div className="home-hero-copy"><span {...heroLine(0, 'eyebrow')}>我的收藏</span><h1 {...heroLine(1)}>收藏</h1><p {...heroLine(2)}>标星过的文档和文件夹集中在这里，方便随时回到常用内容。</p></div><span className="handdrawn-only home-hero-art" aria-hidden="true"><ArtIcon name="favorite-star" fallback={<Star size={48} />} /></span></div>
    <section className="home-section">
      <div className="home-section-head"><h2><Star size={16} />已收藏</h2><span>{favoriteDocs.length + ' 项'}</span></div>
      {favoriteDocs.length ? <div className="home-grid">{favoriteDocs.map((doc, index) => <button {...staggerItemProps(index, 'home-card')} key={doc.id} onClick={() => onOpen(doc)}>
        <span className={'home-card-icon ' + (doc.kind === 'folder' ? 'folder' : '')}>{doc.kind === 'folder' ? <ArtIcon name="folder" fallback={<Folder size={17} />} /> : <ArtIcon name="document" fallback={<FileText size={17} />} />}</span>
        <span><b>{doc.title || '未命名文档'}</b><small>{doc.kind === 'folder' ? '文件夹' : '更新于 ' + (formatDate(doc.updatedAt) || '刚刚')}</small></span>
        <ChevronRight size={15} />
      </button>)}</div> : <div className="home-empty">还没有收藏。打开任意文档，点击右上角的星标即可加入收藏。</div>}
    </section>
  </div>
  const recent = [...visible].sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()).slice(0, 6)
  const sections = [
    { title: '最近访问', icon: Clock3, items: recent },
    { title: '收藏', icon: Star, items: favoriteDocs },
    { title: '我创建的', icon: FileText, items: visible.filter((doc) => doc.kind !== 'folder').slice(0, 6) },
  ]
  return <div className="home-dashboard" data-vt-scope="main" ref={rootRef}>
    <div className="home-hero">
      <div className="home-hero-copy"><span {...heroLine(0, 'eyebrow')}>工作区</span><h1 {...heroLine(1)}>欢迎回来</h1><p {...heroLine(2)}>继续处理你的文档，或创建一个新的知识空间。</p></div>
      <span className="handdrawn-only home-hero-art" aria-hidden="true"><ArtIcon name="notebook" fallback={<FileText size={48} />} /></span>
      <div className="hero-actions">
        <button className="secondary-btn" onClick={onImport}><Upload size={15} />导入 Markdown</button>
        <button className="secondary-btn" onClick={onCreateFolder}><FolderPlus size={15} />新建文件夹</button>
        <button className="primary-btn" onClick={onCreate}><FilePlus2 size={16} />新建文档</button>
      </div>
    </div>
    <StatsCards stats={stats} />
    {sections.map(({ title, icon: Icon, items }) => <section className="home-section" key={title}>
      <div className="home-section-head"><h2><Icon size={16} />{title}</h2><span>{items.length + ' 项'}</span></div>
      {items.length ? <div className="home-grid">{items.map((doc, index) => <button {...staggerItemProps(index, 'home-card')} key={doc.id} onClick={() => onOpen(doc)}>
        <span className={'home-card-icon ' + (doc.kind === 'folder' ? 'folder' : '')}>{doc.kind === 'folder' ? <ArtIcon name="folder" fallback={<Folder size={17} />} /> : <ArtIcon name="document" fallback={<FileText size={17} />} />}</span>
        <span><b>{doc.title || '未命名文档'}</b><small>{doc.kind === 'folder' ? '文件夹' : '更新于 ' + (formatDate(doc.updatedAt) || '刚刚')}</small></span>
        <ChevronRight size={15} />
      </button>)}</div> : <div className="home-empty">{title === '收藏' ? '收藏的文档会显示在这里' : '暂时没有内容'}</div>}
    </section>)}
  </div>
}

export function FolderOverview({ folder, items, onCreate, onImport, onCreateFolder, onOpen }: { folder: Doc; items: Doc[]; onCreate: () => void; onImport: () => void; onCreateFolder: () => void; onOpen: (doc: Doc) => void }) {
  const rootRef = useHeroShift(useReducedMotion(), folder.id)
  return <div className="folder-overview" data-vt-scope="main" ref={rootRef}>
    <div className="folder-overview-head">
      <div className="folder-large-icon"><ArtIcon name="folder" fallback={<Folder size={23} />} /></div>
      <div><h1 {...heroLine(1)}>{folder.title}</h1><p {...heroLine(2)}>{items.length + ' 个项目'}</p></div>
      <div className="folder-head-actions">
        <button className="secondary-btn" onClick={onImport}><Upload size={15} />导入 Markdown</button>
        <button className="primary-btn" onClick={onCreate}><FilePlus2 size={15} />新建文档</button>
      </div>
    </div>
    {items.length ? <div className="folder-items">{items.map((child, index) => <button {...staggerItemProps(index, 'folder-item')} key={child.id} onClick={() => onOpen(child)}>
      <span className={'folder-item-icon ' + (child.kind === 'folder' ? 'is-folder' : '')}>{child.kind === 'folder' ? <ArtIcon name="folder" fallback={<Folder size={17} />} /> : <ArtIcon name="document" fallback={<FileText size={17} />} />}</span>
      <span>{child.title}</span>
      <ChevronRight size={15} />
    </button>)}</div> : <div className="folder-empty">
      <div className="folder-empty-icon"><ArtIcon name="folder" fallback={<Folder size={22} />} /></div>
      <h2>此文件夹为空</h2>
      <p>在这里创建文档，或新建子文件夹来整理内容。</p>
      <div>
        <button className="primary-btn" onClick={onCreate}><FilePlus2 size={15} />新建文档</button>
        <button className="secondary-btn" onClick={onCreateFolder}><FolderPlus size={15} />新建子文件夹</button>
      </div>
    </div>}
  </div>
}
