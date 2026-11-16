import { FileText, Folder, Search, Star } from 'lucide-react'
import { useMemo } from 'react'
import ArtIcon from '../components/ui/ArtIcon'
import DocumentCreatedTime from '../components/ui/DocumentCreatedTime'
import { staggerItemProps } from '../components/ui/Stagger'
import { formatDate, untitledCreatedTime } from '../lib/format'
import type { Doc } from '../lib/types'

type DocumentListProps = {
  documents: Doc[]
  query: string
  favorites: Set<string>
  onOpen: (doc: Doc) => void
  onCreate: () => void
}

/**
 * The flat list behind the tree's "所有文档" root row.
 *
 * The root row of a tree names the whole set the tree is a view of, so pressing
 * it has to show that set. It previously opened the home dashboard — the same
 * handler as the "首页" nav row — which meant the sidebar carried two buttons
 * for one destination and the label "所有文档" was the only thing that was not
 * true. This screen is the destination the label promises: every document, one
 * flat table, with its folder so a row can be placed without the tree.
 *
 * It is deliberately not a second dashboard: no hero roll-up, no stat cards, no
 * "recent" slices. Those belong to 首页, and repeating them here is how the app
 * ended up with two screens that show the same six documents in different
 * arrangements.
 */
export default function DocumentList({ documents, query, favorites, onOpen, onCreate }: DocumentListProps) {
  /*
   * Folders are excluded: the list answers "where is that document", and a
   * folder row here would either duplicate a tree branch or offer a second way
   * to navigate to a folder the tree already shows. The folder is still visible
   * on each row, as the path a reader would otherwise have to walk.
   */
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return documents
      .filter((doc) => doc.kind !== 'folder')
      .filter((doc) => !needle || doc.title.toLowerCase().includes(needle))
      .map((doc) => ({
        doc,
        folder: doc.parentId ? documents.find((entry) => entry.id === doc.parentId) ?? null : null,
      }))
      // Newest first: a flat list has no tree structure to carry the order, and
      // "what did we touch last" is the one ordering that is useful without it.
      .sort((a, b) => new Date(b.doc.updatedAt || 0).getTime() - new Date(a.doc.updatedAt || 0).getTime())
  }, [documents, query])

  if (!documents.some((doc) => doc.kind !== 'folder')) {
    return <div className="document-list" data-vt-scope="main">
      <div className="home-hero"><div className="home-hero-copy">
        <span {...staggerItemProps(0, 'eyebrow')}>工作区</span>
        <h1 {...staggerItemProps(1)}>所有文档</h1>
        <p {...staggerItemProps(2)}>这里会按更新时间列出工作区的全部文档。</p>
      </div></div>
      <div className="home-empty"><ArtIcon name="folder" fallback={<Folder size={16} />} />还没有文档。<button type="button" className="secondary-btn" onClick={onCreate}>新建一篇</button></div>
    </div>
  }

  return <div className="document-list" data-vt-scope="main">
    <div className="document-list-head">
      <div>
        <span className="eyebrow">工作区</span>
        <h1>所有文档</h1>
        <p>{query.trim() ? '匹配 “' + query.trim() + '” 的文档，共 ' + rows.length + ' 篇。' : '全部 ' + rows.length + ' 篇文档，按最近更新排序。'}</p>
      </div>
    </div>
    {rows.length === 0 ? <div className="home-empty"><ArtIcon name="search" fallback={<Search size={16} />} />没有匹配的文档，换一个关键词试试。</div>
      : <ul className="document-list-rows">
        {rows.map((row, index) => <li {...staggerItemProps(index, 'document-list-row')} key={row.doc.id}>
          <button type="button" className="document-list-main" onClick={() => onOpen(row.doc)}>
            <span className="home-card-icon"><ArtIcon name="document" fallback={<FileText size={17} />} /></span>
            <span className="document-list-copy">
              <b>{row.doc.title || '未命名文档'}</b>
              <small>{row.folder ? row.folder.title || '未命名文件夹' : '工作区根目录'}</small>
            </span>
            {favorites.has(row.doc.id) && <span className="document-list-star" aria-label="已收藏"><ArtIcon name="favorite-star" fallback={<Star size={18} />} /></span>}
            {/* The timestamp says which of two similarly named rows is the live
                one; the created time already has its own component. */}
            <small className="document-list-time">{untitledCreatedTime(row.doc) ? <DocumentCreatedTime doc={row.doc} /> : '更新于 ' + (formatDate(row.doc.updatedAt) || '刚刚')}</small>
          </button>
        </li>)}
      </ul>}
  </div>
}
