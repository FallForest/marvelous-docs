import { useEffect, useRef, useState } from 'react'
import { Clock3, History, MessageCircle, Send, Activity, X } from 'lucide-react'
import ActivityPanel from '../panels/ActivityPanel'
import { formatDate } from '../../lib/format'
import { staggerDelay } from '../../lib/motion'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import type { RightTab } from '../../lib/app-types'
import type { Comment, Doc, Version } from '../../lib/types'

type DocumentPanelProps = {
  doc: Doc
  token: string
  open: boolean
  tab: RightTab
  comments: Comment[]
  versions: Version[]
  commentText: string
  commentAnchor: Comment['anchor']
  /** The thread open in the text, highlighted here and scrolled into view. */
  activeCommentId: string | null
  onTab: (tab: RightTab) => void
  onClose: () => void
  onCommentText: (value: string) => void
  onClearAnchor: () => void
  onSubmitComment: () => void
  onActiveComment: (id: string | null) => void
  onReply: (comment: Comment) => void
  onCommentStatus: (comment: Comment, status: 'open' | 'resolved') => void
  onPreviewVersion: (version: Version) => void
}

/**
 * Right-hand document panel: comments, version history, and activity.
 *
 * It owns no state — the shell keeps comment drafts and version selection so
 * closing the panel never discards what the user typed.
 *
 * The panel stays mounted and slides off-canvas instead of unmounting: a panel
 * that vanishes between frames reads as a glitch, while a 140ms slide out reads
 * as putting it away.
 */
export default function DocumentPanel(props: DocumentPanelProps) {
  const { doc, token, open, tab, comments, versions, commentText, commentAnchor, activeCommentId } = props
  const reduced = useReducedMotion()
  const panelRef = useRef<HTMLElement | null>(null)
  /** Cards by comment id, so an opened thread can be scrolled to. */
  const cards = useRef<Map<string, HTMLDivElement>>(new Map())
  const known = useRef<Set<string>>(new Set())
  const [freshId, setFreshId] = useState('')

  // Only the comment that is new since the previous render animates, so a list
  // refresh from the server never re-plays the entry animation on old rows.
  useEffect(() => {
    const seen = known.current
    const added = comments.filter((comment) => !seen.has(comment.id))
    comments.forEach((comment) => seen.add(comment.id))
    if (reduced || added.length === 0 || added.length === comments.length) return
    const latest = added[added.length - 1]
    if (!latest) return
    setFreshId(latest.id)
    const timer = window.setTimeout(() => setFreshId(''), 600)
    return () => window.clearTimeout(timer)
  }, [comments, reduced])

  /**
   * Brings the open thread into view.
   *
   * The tint can start from either side: pressing the marked text scrolls the
   * card up, and pointing at a card lights the sentence. Scrolling is smooth
   * only when the user has not asked for reduced motion — the panel slide is
   * already a cross-fade in that mode, and a long scroll would be the one
   * movement left that ignores the preference.
   */
  useEffect(() => {
    if (!activeCommentId || !open) return
    const card = cards.current.get(activeCommentId)
    if (!card) return
    card.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }, [activeCommentId, open, reduced])

  /**
   * inert, not just aria-hidden: the panel stays mounted so it can slide out, and
   * a mounted-but-hidden panel would still expose its buttons to Tab. `inert`
   * removes the whole subtree from the tab order and the accessibility tree,
   * which is what `display:none` would do without breaking the transition.
   *
   * Set through the DOM rather than JSX: React 18 does not recognise `inert` as a
   * boolean attribute, so a JSX prop of `false` would still render `inert=""`
   * and disable the open panel.
   */
  useEffect(() => {
    const node = panelRef.current
    if (!node) return
    if (open) node.removeAttribute('inert')
    else node.setAttribute('inert', '')
  }, [open])

  return <aside
    ref={panelRef}
    className={'right-panel' + (open ? ' is-open' : ' is-closed')}
    aria-label="文档侧边栏"
    aria-hidden={open ? undefined : true}
  >
    <div className="panel-tabbar">
      <div className="panel-tabs" role="tablist" aria-label="侧边栏标签">
        <button type="button" role="tab" id="tab-comments" aria-controls="panel-comments" aria-selected={tab === 'comments'} className={tab === 'comments' ? 'active' : ''} onClick={() => props.onTab('comments')}><MessageCircle size={15} />评论</button>
        <button type="button" role="tab" id="tab-history" aria-controls="panel-history" aria-selected={tab === 'history'} className={tab === 'history' ? 'active' : ''} onClick={() => props.onTab('history')}><History size={15} />历史</button>
        <button type="button" role="tab" id="tab-activity" aria-controls="panel-activity" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'active' : ''} onClick={() => props.onTab('activity')}><Activity size={15} />动态</button>
      </div>
      <button type="button" className="icon-btn close-panel" aria-label="关闭面板" title="关闭面板" onClick={props.onClose}><X size={16} /></button>
    </div>

    {tab === 'comments' ? <div className="panel-body motion-enter" key="comments" role="tabpanel" id="panel-comments" aria-labelledby="tab-comments">
      <div className="panel-intro"><b>讨论</b><span>{comments.length + ' 条评论'}</span></div>
      {comments.length === 0
        ? <div className="panel-empty"><MessageCircle size={21} /><b>还没有评论</b><span>选中文本后点击评论开始讨论</span></div>
        : <div className="comment-list">{comments.map((comment) => <div
          className={'comment'
            + (comment.status === 'resolved' ? ' comment-resolved' : '')
            + (comment.id === freshId ? ' stagger' : '')
            + (comment.id === activeCommentId ? ' is-active' : '')}
          style={comment.id === freshId ? { animationDelay: '0ms' } : undefined}
          key={comment.id}
          ref={(node) => {
            if (node) cards.current.set(comment.id, node)
            else cards.current.delete(comment.id)
          }}
          /* Selecting a card is what ties the panel to the page: the sentence it
             is about lights up in the text at the same moment. */
          onClick={() => props.onActiveComment(comment.id)}
        >
          <div className="comment-head">
            <div className="avatar small-avatar">{(comment.userName || '?')[0]!.toUpperCase()}</div>
            <div><b>{comment.userName || '成员'}</b><small>{formatDate(comment.createdAt)}{comment.status === 'resolved' ? ' · 已解决' : ''}</small></div>
          </div>
          {comment.anchor?.text && <button
            type="button"
            className="comment-anchor"
            title="定位到引用"
            onClick={(event) => {
              // The card's own click already marks this thread active; stopping
              // propagation here would leave the button and the card disagreeing
              // about which thread is open.
              event.stopPropagation()
              props.onActiveComment(comment.id)
              window.dispatchEvent(new CustomEvent('mdoc-focus-anchor', { detail: comment.anchor }))
            }}
          >“{comment.anchor.text.slice(0, 80)}”</button>}
          <p>{comment.body}</p>
          <div className="comment-actions">
            <button type="button" onClick={() => props.onReply(comment)}>回复</button>
            {comment.status !== 'resolved' && <button type="button" onClick={() => props.onCommentStatus(comment, 'resolved')}>解决</button>}
            {comment.status === 'resolved' && <button type="button" onClick={() => props.onCommentStatus(comment, 'open')}>重新打开</button>}
          </div>
        </div>)}</div>}
      <div className="comment-compose">
        {commentAnchor?.text && <div className="anchor-preview motion-disclose">引用：“{commentAnchor.text.slice(0, 90)}” <button type="button" aria-label="移除引用" onClick={props.onClearAnchor}><X size={12} /></button></div>}
        <textarea
          aria-label="评论内容"
          placeholder="添加评论..."
          value={commentText}
          onChange={(event) => props.onCommentText(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) props.onSubmitComment() }}
        />
        <div><span>Ctrl + Enter 发送</span><button type="button" className="send-btn" aria-label="发送评论" title="发送评论" onClick={props.onSubmitComment} disabled={!commentText.trim()}><Send size={15} /></button></div>
      </div>
    </div> : tab === 'history' ? <div className="panel-body motion-enter" key="history" role="tabpanel" id="panel-history" aria-labelledby="tab-history">
      <div className="panel-intro"><b>版本历史</b><span>{versions.length + ' 个版本'}</span></div>
      {versions.length === 0
        ? <div className="panel-empty"><Clock3 size={21} /><b>暂无历史记录</b><span>文档更改后会保留版本</span></div>
        : <div className="version-list">{versions.map((version, index) => <div
          className="version-item stagger"
          style={{ animationDelay: staggerDelay(index) + 'ms' }}
          key={version.id}
        >
          <button type="button" className="version-line" onClick={() => props.onPreviewVersion(version)} aria-label={'预览版本 ' + version.version}>
            <span className="version-dot" />
            <span className="version-copy"><b>版本 {version.version}</b><small>{version.createdBy || '成员'} · {formatDate(version.createdAt)}</small></span>
          </button>
          <div className="version-actions">
            <button type="button" onClick={() => props.onPreviewVersion(version)}>预览</button>
            <button type="button" onClick={() => props.onPreviewVersion(version)}>恢复</button>
          </div>
        </div>)}</div>}
    </div> : <ActivityPanel token={token} documentId={doc.id} />}
  </aside>
}