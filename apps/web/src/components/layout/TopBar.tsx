import { ArrowDownToLine, ChevronRight, History, MessageCircle, PanelLeftClose, Share2, Star } from 'lucide-react'
import ExportMenu from '../layout/ExportMenu'
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
      <strong>{props.title}</strong>
    </div>
    <div className="top-actions">
      <span className={'save-state save-' + props.saveStatus} role="status" aria-live="polite">
        <span className="save-dot" />{props.saveStatus === 'saving' ? '保存中…' : props.saveStatus === 'error' ? '保存失败' : '已保存'}
      </span>
      <span className="top-divider" aria-hidden="true" />
      <div className="collaborators" role="group" aria-label="在线成员">
        <div className="presence-stack">
          <div className="mini-avatar green" title="你">{props.userInitial}</div>
          {props.collaborators.slice(0, 3).map((person) => <div key={person.clientId} className="mini-avatar" title={person.name} style={{ background: person.color + '24', color: person.color }}>{person.name[0]?.toUpperCase()}</div>)}
          {props.collaborators.length > 3 && <span className="presence-more">{'+' + (props.collaborators.length - 3)}</span>}
        </div>
        <span className={'connection-dot ' + props.collabStatus} aria-hidden="true" />
        <span className="visually-hidden" role="status" aria-live="polite">
          {props.collabStatus === 'connected' ? '实时协作已连接' : props.collabStatus === 'connecting' ? '实时协作连接中' : '实时协作已断开'}
        </span>
      </div>
      <span className="top-divider" aria-hidden="true" />
      <div className="icon-group">
        {props.hasDocument && <button type="button" className={'icon-btn favorite-btn' + (props.favorite ? ' is-favorite' : '')} aria-label={props.favorite ? '取消收藏' : '收藏文档'} aria-pressed={props.favorite} title={props.favorite ? '取消收藏' : '收藏文档'} onClick={props.onFavorite}><Star size={16} fill={props.favorite ? 'currentColor' : 'none'} /></button>}
        <div className="menu-anchor">
          <button type="button" className="icon-btn" aria-label="导出文档" title="导出文档" aria-haspopup="menu" aria-expanded={props.exportOpen} disabled={!props.hasDocument} onClick={() => props.onExportMenu(!props.exportOpen)}><ArrowDownToLine size={16} /></button>
          <ExportMenu open={props.exportOpen} onSelect={props.onExport} onClose={() => props.onExportMenu(false)} />
        </div>
        <button type="button" className="icon-btn" aria-label="版本历史" title="版本历史" onClick={props.onHistory}><History size={16} /></button>
        <button type="button" className="icon-btn" aria-label="评论" title="评论" onClick={props.onComments}><MessageCircle size={16} /></button>
      </div>
      {props.hasDocument && <button type="button" className="share-btn" onClick={props.onShare}><Share2 size={14} />共享</button>}
    </div>
  </header>
}
