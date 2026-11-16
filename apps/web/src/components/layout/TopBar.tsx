import { ChevronRight, FileText, MessageCircle, PanelLeftClose, Share2 } from 'lucide-react'
import type { CSSProperties } from 'react'
import DocumentMenu from '../layout/DocumentMenu'
import ArtIcon from '../ui/ArtIcon'
import type { CollabStatus } from '../../lib/app-types'
import type { ExportTarget, SaveStatus } from '../../lib/types'

type Presence = { clientId: number; name: string; color: string }

type TopBarProps = {
  userInitial: string
  title: string
  showRoot: boolean
  /** Folders above the open document, root first; empty at the workspace root. */
  trail: Array<{ id: string; title: string }>
  onOpenTrail: (id: string) => void
  collabStatus: CollabStatus
  collaborators: Presence[]
  sidebarOpen: boolean
  /**
   * Whether a document is mounted. This is the whole contract of the bar: when it
   * is false there is nothing for save state, presence, history, comments, share
   * or export to act on, so none of them render.
   */
  hasDocument: boolean
  favorite: boolean
  saveStatus: SaveStatus
  /** 文档“更多”, which now owns export/print/history/favourite/move/info. */
  documentMenuOpen: boolean
  onDocumentMenu: (open: boolean) => void
  onOpenSidebar: () => void
  onFavorite: () => void
  onExport: (format: ExportTarget) => void
  onHistory: () => void
  onComments: () => void
  onShare: () => void
  onMove: () => void
  onInfo: () => void
}

/**
 * Folds a long ancestor trail down to its last three entries.
 *
 * Three is the number of levels a breadcrumb can carry beside a title before the
 * title starts to truncate at the common 1280px width. The fold is marked with a
 * collapsed segment rather than silently dropping the head, so the reader can
 * tell the difference between "at the root" and "deep in a tree".
 */
function foldTrail(trail: TopBarProps['trail']): Array<{ id: string | null; title: string }> {
  if (trail.length <= 3) return trail.map((entry) => ({ id: entry.id, title: entry.title }))
  const tail = trail.slice(-2)
  return [{ id: null, title: '' }, ...tail.map((entry) => ({ id: entry.id, title: entry.title }))]
}
/**
 * Top bar: breadcrumb, save state, live presence, then document actions.
 *
 * The bar renders only what can act on the mounted screen. On home, a folder, the
 * search results and the trash there is no document, so the save state, the
 * presence stack, 版本历史, 评论, 共享, 收藏 and 导出 are all absent — not disabled.
 * A row of grey icons is a claim that the actions exist and are temporarily
 * unavailable; they do not exist there at all. What remains is what does work
 * everywhere: the sidebar toggle, the path, and the page title.
 *
 * 外观 is not here any more. It is a browser-wide preference, so it belongs beside
 * the account in the sidebar, and having it on a document bar implied it was a
 * document setting.
 *
 * The two document actions that stay on the bar are the two a writer reaches for
 * mid-sentence — 评论 and 共享 — with 评论 next to 共享 as the audit asks. Everything
 * else with a document destination moved into 更多, which is why the narrow
 * viewport no longer has to shrink five icons to fit: it renders three controls.
 */
export default function TopBar(props: TopBarProps) {
  return <header className="topbar">
    {!props.sidebarOpen && <button type="button" className="icon-btn" aria-label="展开侧边栏" title="展开侧边栏" onClick={props.onOpenSidebar}><PanelLeftClose size={17} /></button>}
    <div className="breadcrumbs">
      {props.showRoot && <><span className="crumb-root">我的文档</span><ChevronRight size={13} className="crumb-sep" /></>}
      {/*
       * The path, not just the parent: `parentId` is on every row, so the whole
       * chain costs one walk. A deep path is folded from the left - the folder the
       * reader came from matters more than the one at the top, and a breadcrumb
       * that pushes the title off the bar has stopped being useful.
       */}
      {foldTrail(props.trail).map((crumb, index) => <span key={crumb.id ?? 'gap-' + index} className="crumb-branch">
        {crumb.id
          ? <button type="button" className="crumb-link" onClick={() => props.onOpenTrail(crumb.id!)}>{crumb.title}</button>
          : <span className="crumb-link is-folded" aria-hidden="true">…</span>}
        <ChevronRight size={13} className="crumb-sep" />
      </span>)}
      <strong><span className="theme-decoration crumb-title-art" aria-hidden="true"><ArtIcon name={props.hasDocument ? 'document' : 'folder'} fallback={<FileText size={17} />} /></span><span className="crumb-title-copy">{props.title}</span></strong>
    </div>
    <div className="top-actions">
      {/*
       * Save state and presence describe this document and this session. Both are
       * per-document facts — "已保存" for a screen with no body is meaningless, and
       * a presence stack for a folder page says people are editing a folder.
       */}
      {props.hasDocument && <>
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
        {/*
         * 评论 then 共享, in that order: comment is the write-while-reading action
         * and shared is the end state of the document. Both are reachable with one
         * press at every width because they are not duplicated in 更多.
         */}
        <div className="icon-group document-actions">
          <button type="button" className="icon-btn" aria-label="评论" title="评论" onClick={props.onComments}><ArtIcon name="comment" fallback={<MessageCircle size={16} />} /></button>
          <DocumentMenu
            open={props.documentMenuOpen}
            favorite={props.favorite}
            onOpenMenu={props.onDocumentMenu}
            onExport={props.onExport}
            onHistory={props.onHistory}
            onFavorite={props.onFavorite}
            onMove={props.onMove}
            onInfo={props.onInfo}
            onClose={() => props.onDocumentMenu(false)}
          />
        </div>
        <button type="button" className="share-btn sketch-frame" onClick={props.onShare}><ArtIcon name="share" fallback={<Share2 size={14} />} />共享</button>
      </>}
    </div>
  </header>
}
