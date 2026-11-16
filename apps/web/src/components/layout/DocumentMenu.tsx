import { Clock3, FolderInput, History, Info, MoreHorizontal, Star } from 'lucide-react'
import Popover from '../ui/Popover'
import ArtIcon from '../ui/ArtIcon'
import { ExportMenuItems } from './ExportMenu'
import type { ExportTarget } from '../../lib/types'

type DocumentMenuProps = {
  open: boolean
  favorite: boolean
  onOpenMenu: (open: boolean) => void
  onExport: (format: ExportTarget) => void
  onHistory: () => void
  onFavorite: () => void
  onMove: () => void
  onInfo: () => void
  onClose: () => void
}

/**
 * 文档“更多”: the document actions that do not earn a standing icon.
 *
 * The top bar used to carry five of them as peer icons — favourite, export,
 * history, comments, share — and on a narrow viewport they still had to fit
 * beside the save state and the presence stack. The audit's rule is that document
 * actions which no longer fit move into one menu rather than shrinking into a row
 * of grey 30px buttons, so this menu is the destination: 导出 (all five targets,
 * from the same list the old export popover uses), 打印, 版本历史, 收藏, 移动 and
 * 文档信息. 共享 and 评论 stay on the bar, because they are the two the writer
 * reaches for mid-sentence.
 *
 * Order is by reach: writing first (export/print), then the record of the writing
 * (history), then organisation (favourite/move), then reference (info).
 */
export default function DocumentMenu(props: DocumentMenuProps) {
  return <div className="menu-anchor document-menu-anchor">
    <button
      type="button"
      className="icon-btn document-more-btn"
      aria-label="更多文档操作"
      title="更多文档操作"
      aria-haspopup="menu"
      aria-expanded={props.open}
      onClick={() => props.onOpenMenu(!props.open)}
    ><MoreHorizontal size={17} /></button>
    <Popover open={props.open} onClose={props.onClose} label="更多文档操作" className="document-menu">
      <div className="menu-heading">导出</div>
      <ExportMenuItems onSelect={(format) => { props.onClose(); props.onExport(format) }} />
      <hr className="menu-divider" />
      <button type="button" role="menuitem" className="menu-item" onClick={() => { props.onClose(); props.onHistory() }}>
        <ArtIcon name="history" fallback={<History size={15} />} /><span>版本历史</span>
      </button>
      <button type="button" role="menuitem" className="menu-item" onClick={() => { props.onClose(); props.onFavorite() }}>
        <ArtIcon name="favorite-star" fallback={<Star size={15} />} /><span>{props.favorite ? '取消收藏' : '收藏'}</span>
      </button>
      <button type="button" role="menuitem" className="menu-item" onClick={() => { props.onClose(); props.onMove() }}>
        <FolderInput size={15} /><span>移动…</span>
      </button>
      <hr className="menu-divider" />
      <button type="button" role="menuitem" className="menu-item" onClick={() => { props.onClose(); props.onInfo() }}>
        <Info size={15} /><span>文档信息</span>
      </button>
    </Popover>
  </div>
}

type DocumentInfoProps = {
  /** Title of the open document, so the panel can name what it describes. */
  title: string
  createdAt?: string
  updatedAt?: string
  /** Word count of the stored body; undefined when the body is not loaded. */
  words?: number
  /** The server's version counter, which is what "版本 N" in history refers to. */
  version: number
  docId: string
  parentTitle: string | null
}

/**
 * 文档信息: the facts about the document, from data the shell already has.
 *
 * Deliberately not a second editor footer: it shows only what no other surface in
 * this screen shows — the id (for support and for reading a URL), the creation
 * time alongside the update time, and the version counter that version history
 * numbers. The word count is the same measure as the editor footer, computed the
 * same way (`lib/format.wordCount`), so the two can never disagree.
 *
 * Every field here comes from the `Doc` the shell holds or from its own body; none
 * of it is invented, and a field with no data says so rather than guessing.
 */
export function DocumentInfoPanel({ title, createdAt, updatedAt, words, version, docId, parentTitle }: DocumentInfoProps) {
  return <div className="document-info">
    <div className="document-info-head"><Clock3 size={15} /><b>{title || '未命名文档'}</b></div>
    <dl className="document-info-list">
      <div><dt>创建时间</dt><dd>{createdAt ? new Date(createdAt).toLocaleString('zh-CN') : '未提供'}</dd></div>
      <div><dt>最后编辑</dt><dd>{updatedAt ? new Date(updatedAt).toLocaleString('zh-CN') : '未提供'}</dd></div>
      <div><dt>字数</dt><dd>{typeof words === 'number' ? words + ' 字' : '正文未加载'}</dd></div>
      <div><dt>版本</dt><dd>{'第 ' + version + ' 版'}</dd></div>
      <div><dt>所在位置</dt><dd>{parentTitle || '工作区根目录'}</dd></div>
      <div><dt>文档 ID</dt><dd className="document-info-id">{docId}</dd></div>
    </dl>
  </div>
}
