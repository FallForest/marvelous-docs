import { ArrowDownToLine, ChevronRight, FileText, History, MessageCircle, Palette, PanelLeftClose, Share2, Star } from 'lucide-react'
import type { CSSProperties } from 'react'
import ExportMenu from '../layout/ExportMenu'
import ThemeMenu from '../layout/ThemeMenu'
import ArtIcon from '../ui/ArtIcon'
import type { CollabStatus } from '../../lib/app-types'
import type { ExportTarget, SaveStatus } from '../../lib/types'

type Presence = { clientId: number; name: string; color: string }

type TopBarProps = {
  userInitial: string
  title: string
  showRoot: boolean
  saveStatus: SaveStatus
  collabStatus: CollabStatus
  collaborators: Presence[]
  sidebarOpen: boolean
  hasDocument: boolean
  favorite: boolean
  exportOpen: boolean
  /** Current appearance id, and whether the appearance menu is open. */
  themeId: string
  themeOpen: boolean
  onThemeMenu: (open: boolean) => void
  onTheme: (id: string) => void
  onOpenSidebar: () => void
  onFavorite: () => void
  onExport: (format: ExportTarget) => void
  onExportMenu: (open: boolean) => void
  onHistory: () => void
  onComments: () => void
  onShare: () => void
}

/**
 * Top bar: breadcrumb, save state, live presence, then document actions.
 *
 * The share button is the only filled control in the row, which keeps the
 * primary action visually distinct from the icon group beside it.
 */
export default function TopBar(props: TopBarProps) {
  return <header className="topbar">
    {!props.sidebarOpen && <button type="button" className="icon-btn" aria-label="展开侧边栏" title="展开侧边栏" onClick={props.onOpenSidebar}><PanelLeftClose size={17} /></button>}
    <div className="breadcrumbs">
      {props.showRoot && <><span className="crumb-root">我的文档</span><ChevronRight size={13} className="crumb-sep" /></>}
      <strong><span className="handdrawn-only crumb-title-art" aria-hidden="true"><ArtIcon name="document" fallback={<FileText size={17} />} /></span><span className="crumb-title-copy">{props.title}</span></strong>
    </div>
    <div className="top-actions">
      <span className={'save-state sketch-frame save-' + props.saveStatus} role="status" aria-live="polite">
        <span className="save-dot" />{props.saveStatus === 'saving' ? '保存中…' : props.saveStatus === 'error' ? '保存失败' : '已保存'}
      </span>
      <span className="top-divider" aria-hidden="true" />
      <div className="collaborators sketch-frame" role="group" aria-label="在线成员">
        <div className="presence-stack">
          <div className="mini-avatar green" title="你"><span className="presence-letter">{props.userInitial}</span></div>
          {props.collaborators.slice(0, 3).map((person, index) => <div
            key={person.clientId}
            className="mini-avatar presence-enter"
            title={person.name}
            // Arriving collaborators pop in one step apart; a stable key means
            // only the new avatar animates, not the whole stack.
            style={{ background: person.color + '24', color: person.color, '--i': index } as CSSProperties}
          ><span className="presence-letter">{person.name[0]?.toUpperCase()}</span></div>)}
          {props.collaborators.length > 3 && <span className="presence-more">{'+' + (props.collaborators.length - 3)}</span>}
        </div>
        <span className={'connection-dot ' + props.collabStatus} aria-hidden="true" />
        <span className="visually-hidden" role="status" aria-live="polite">
          {props.collabStatus === 'connected' ? '实时协作已连接' : props.collabStatus === 'connecting' ? '实时协作连接中' : '实时协作已断开'}
        </span>
      </div>
      <span className="top-divider" aria-hidden="true" />
      <div className="icon-group">
        {props.hasDocument && <button type="button" className={'icon-btn favorite-btn' + (props.favorite ? ' is-favorite' : '')} aria-label={props.favorite ? '取消收藏' : '收藏文档'} aria-pressed={props.favorite} title={props.favorite ? '取消收藏' : '收藏文档'} onClick={props.onFavorite}><ArtIcon name="favorite-star" fallback={<Star size={16} fill={props.favorite ? 'currentColor' : 'none'} />} /></button>}
        <div className="menu-anchor">
          <button
            type="button"
            className="icon-btn theme-btn sketch-frame"
            aria-label="切换主题"
            title="切换主题"
            aria-haspopup="menu"
            aria-expanded={props.themeOpen}
            onClick={() => props.onThemeMenu(!props.themeOpen)}
          ><ArtIcon name="palette" fallback={<Palette size={16} />} /><span className="theme-trigger-label handdrawn-only">外观</span></button>
          <ThemeMenu open={props.themeOpen} currentId={props.themeId} onPick={props.onTheme} onClose={() => props.onThemeMenu(false)} />
        </div>
        <div className="menu-anchor">
          <button type="button" className="icon-btn" aria-label="导出文档" title="导出文档" aria-haspopup="menu" aria-expanded={props.exportOpen} disabled={!props.hasDocument} onClick={() => props.onExportMenu(!props.exportOpen)}><ArtIcon name="download" fallback={<ArrowDownToLine size={16} />} /></button>
          <ExportMenu open={props.exportOpen} onSelect={props.onExport} onClose={() => props.onExportMenu(false)} />
        </div>
        <button type="button" className="icon-btn" aria-label="版本历史" title="版本历史" onClick={props.onHistory}><ArtIcon name="history" fallback={<History size={16} />} /></button>
        <button type="button" className="icon-btn" aria-label="评论" title="评论" onClick={props.onComments}><ArtIcon name="comment" fallback={<MessageCircle size={16} />} /></button>
      </div>
      {props.hasDocument && <button type="button" className="share-btn sketch-frame" onClick={props.onShare}><ArtIcon name="share" fallback={<Share2 size={14} />} />共享</button>}
    </div>
  </header>
}
