import { useEffect, useRef, useState } from 'react'
import { History, MessageCircle, Send, X } from 'lucide-react'
import HistoryPanel from './HistoryPanel'
import ArtIcon from '../ui/ArtIcon'
import { Dialog } from '../ui/Dialog'
import { formatDate } from '../../lib/format'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { commentThreads, filterCommentThreads } from '../../lib/comments'
import type { RightTab } from '../../lib/app-types'
import type { Comment, CommentAnchorLocation, Doc, Version } from '../../lib/types'

type DocumentPanelProps = {
  doc: Doc
  token: string
  open: boolean
  tab: RightTab
  comments: Comment[]
  historyRefreshKey?: string | number
  commentText: string
  commentAnchor: Comment['anchor']
  commentLocations?: Record<string, CommentAnchorLocation>
  commentSending?: boolean
  replyTo?: Comment | null
  onCancelReply?: () => void
  currentUserId?: string
  onEditComment?: (comment: Comment, body: string) => Promise<void>
  onDeleteComment?: (comment: Comment) => Promise<void>
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
 * Right-hand document panel: comments and one combined document history.
 *
 * It owns no state — the shell keeps comment drafts and version selection so
 * closing the panel never discards what the user typed.
 *
 * The panel stays mounted and slides off-canvas instead of unmounting: a panel
 * that vanishes between frames reads as a glitch, while a 140ms slide out reads
 * as putting it away.
 */
export default function DocumentPanel(props: DocumentPanelProps) {
  const { doc, token, open, tab, comments, commentText, commentAnchor, activeCommentId } = props
  const reduced = useReducedMotion()
  const panelRef = useRef<HTMLElement | null>(null)
  /** Cards by comment id, so an opened thread can be scrolled to. */
  const cards = useRef<Map<string, HTMLDivElement>>(new Map())
  const known = useRef<Set<string>>(new Set())
  const [freshId, setFreshId] = useState('')
  const [filter, setFilter] = useState('all')
  const [author, setAuthor] = useState('all')
  const threads = commentThreads(comments)
  const visible = filterCommentThreads(threads, filter, author, props.commentLocations)
  const authors = [...new Map(comments.map((comment) => [comment.userId, comment.userName || '成员'])).entries()]

  useEffect(() => { setFilter('all'); setAuthor('all') }, [doc.id])
  // A marker press must reveal a thread even when the current filter hides it.
  useEffect(() => { if (activeCommentId) { setFilter('all'); setAuthor('all') } }, [activeCommentId])

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
        <button type="button" role="tab" id="tab-comments" aria-controls="panel-comments" aria-selected={tab === 'comments'} className={tab === 'comments' ? 'active' : ''} onClick={() => props.onTab('comments')}><ArtIcon name="comment" fallback={<MessageCircle size={15} />} />评论</button>
        <button type="button" role="tab" id="tab-history" aria-controls="panel-history" aria-selected={tab === 'history'} className={tab === 'history' ? 'active' : ''} onClick={() => props.onTab('history')}><ArtIcon name="history" fallback={<History size={15} />} />历史</button>
      </div>
      <button type="button" className="icon-btn close-panel" aria-label="关闭面板" title="关闭面板" onClick={props.onClose}><X size={16} /></button>
    </div>

    {tab === 'comments' ? <div className="panel-body motion-enter" key="comments" role="tabpanel" id="panel-comments" aria-labelledby="tab-comments">
      <div className="panel-intro"><b>讨论</b><span>{threads.length + ' 个讨论 · ' + comments.length + ' 条评论'}</span></div>
      {comments.length > 0 && <label className="comment-filter">显示<select aria-label="筛选评论" value={filter} onChange={(event) => setFilter(event.target.value)}>
        <option value="all">全部讨论</option><option value="open">未解决</option><option value="resolved">已解决</option><option value="detached">原文失效</option>
      </select></label>}
      {comments.length > 0 && <label className="comment-filter">作者<select aria-label="按作者筛选评论" value={author} onChange={(event) => setAuthor(event.target.value)}>
        <option value="all">所有人</option>{authors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>}
      {comments.length === 0
        ? <div className="panel-empty"><ArtIcon name="comment" fallback={<MessageCircle size={21} />} /><b>还没有评论</b><span>选中文本后点击评论开始讨论</span></div>
        : <div className="comment-list">{visible.length === 0 && <div className="panel-empty"><b>没有符合条件的讨论</b><span>试试其他筛选条件</span></div>}{visible.map(({ root: comment, replies }) => <div
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
            disabled={props.commentLocations?.[comment.id]?.status !== 'attached'}
            title={props.commentLocations?.[comment.id]?.status === 'attached' ? '定位到引用' : '原文已删除或已更改，保留引用快照'}
            onClick={(event) => {
              // The card's own click already marks this thread active; stopping
              // propagation here would leave the button and the card disagreeing
              // about which thread is open.
              event.stopPropagation()
              props.onActiveComment(comment.id)
              window.dispatchEvent(new CustomEvent('mdoc-focus-anchor', { detail: { id: comment.id } }))
            }}
          >“{comment.anchor.text.slice(0, 80)}”</button>}
          {comment.anchor && props.commentLocations?.[comment.id]?.status !== 'attached' && <small className="comment-anchor-state">{props.commentLocations?.[comment.id]?.status === 'deleted' ? '原文已删除 · 讨论仍保留' : '原文已删除或已更改 · 无法定位'}</small>}
          <CommentBody comment={comment} currentUserId={props.currentUserId} onEdit={props.onEditComment} onDelete={props.onDeleteComment} />
          <div className="comment-actions">
            {comment.status !== 'resolved' && <button type="button" onClick={() => props.onReply(comment)}>回复</button>}
            {comment.status !== 'resolved' && <button type="button" onClick={() => props.onCommentStatus(comment, 'resolved')}>解决</button>}
            {comment.status === 'resolved' && <button type="button" onClick={() => props.onCommentStatus(comment, 'open')}>重新打开</button>}
          </div>
          {replies.length > 0 && <div className="comment-replies">{replies.map((reply) => <div className="comment-reply" key={reply.id}>
            <div className="comment-head"><b>{reply.userName || '成员'}</b><small>{formatDate(reply.createdAt)}</small></div>
            <CommentBody comment={reply} currentUserId={props.currentUserId} onEdit={props.onEditComment} onDelete={props.onDeleteComment} />
          </div>)}</div>}
        </div>)}</div>}
      <div className="comment-compose">
        {props.replyTo && <div className="anchor-preview">回复 {props.replyTo.userName || '成员'} 的讨论<button type="button" aria-label="取消回复" onClick={props.onCancelReply}><X size={12} /></button></div>}
        {commentAnchor?.text && <div className="anchor-preview motion-disclose">引用：“{commentAnchor.text.slice(0, 90)}” <button type="button" aria-label="移除引用" onClick={props.onClearAnchor}><X size={12} /></button></div>}
        <textarea
          aria-label="评论内容"
          placeholder="添加评论..."
          value={commentText}
          maxLength={10000}
          disabled={props.commentSending}
          onChange={(event) => props.onCommentText(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); if (!props.commentSending) props.onSubmitComment() } }}
        />
        <div><span>{props.commentSending ? '发送中…' : 'Ctrl + Enter 发送'}</span><button type="button" className="send-btn sketch-frame" aria-label="发送评论" title="发送评论" onClick={props.onSubmitComment} disabled={!commentText.trim() || props.commentSending}><Send size={15} /></button></div>
      </div>
    </div> : <HistoryPanel token={token} documentId={doc.id} refreshKey={props.historyRefreshKey} active={open} onPreviewVersion={props.onPreviewVersion} />}
  </aside>
}

function CommentBody({ comment, currentUserId, onEdit, onDelete }: {
  comment: Comment; currentUserId?: string
  onEdit?: (comment: Comment, body: string) => Promise<void>
  onDelete?: (comment: Comment) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(comment.body)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (comment.deletedAt) return <p className="comment-deleted">此评论已由作者删除</p>
  const submit = async () => {
    const body = value.trim()
    if (!body || busy || !onEdit) return
    setBusy(true)
    setError('')
    try { await onEdit(comment, body); setEditing(false) }
    catch (failure) { setError('保存失败：' + (failure as Error).message) }
    finally { setBusy(false) }
  }
  return <>
    {editing ? <div className="comment-edit" onClick={(event) => event.stopPropagation()}>
      <textarea aria-label="编辑评论内容" maxLength={10000} value={value} disabled={busy} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submit() }
        if (event.key === 'Escape' && !busy) { event.stopPropagation(); setEditing(false) }
      }} autoFocus />
      <div className="comment-actions"><button type="button" disabled={busy || !value.trim()} onClick={() => void submit()}>{busy ? '保存中…' : '保存修改'}</button><button type="button" disabled={busy} onClick={() => { setEditing(false); setError('') }}>取消</button></div>
    </div> : <p>{comment.body}</p>}
    {!editing && currentUserId === comment.userId && <div className="comment-actions" onClick={(event) => event.stopPropagation()}>
      {onEdit && <button type="button" onClick={() => { setValue(comment.body); setError(''); setEditing(true) }}>编辑</button>}
      {onDelete && <button type="button" onClick={() => { setError(''); setDeleting(true) }}>删除</button>}
    </div>}
    {error && <p className="dialog-error" role="alert">{error}</p>}
    {deleting && <Dialog title="删除这条评论？" description="评论内容将被移除。讨论和其他人的回复会保留，并显示删除占位。" confirmLabel="删除评论" danger busy={busy} onClose={() => { if (!busy) setDeleting(false) }} onConfirm={async () => {
      if (busy || !onDelete) return
      setBusy(true)
      setError('')
      try { await onDelete(comment); setDeleting(false) }
      catch (failure) { setError('删除失败：' + (failure as Error).message); setDeleting(false) }
      finally { setBusy(false) }
    }} />}
  </>
}
