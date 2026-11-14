import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Clock3, RefreshCw } from 'lucide-react'
import { api } from '../../lib/endpoints'
import { historyDay, historyEventLabel, historyRole } from '../../lib/history'
import type { HistoryItem, Version } from '../../lib/types'
import ArtIcon from '../ui/ArtIcon'

type Props = {
  token: string
  documentId: string
  refreshKey?: string | number
  active?: boolean
  onPreviewVersion: (version: Version) => void
}

export default function HistoryPanel({ token, documentId, refreshKey, active = true, onPreviewVersion }: Props) {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const pending = useRef(false)
  const initialized = useRef(false)
  const previousRefresh = useRef(refreshKey)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const invalidateLoad = useCallback(() => {
    generation.current++
    pending.current = false
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
  }, [])

  const load = useCallback(async (next?: string | null) => {
    if (pending.current) return
    const run = ++generation.current
    pending.current = true
    setLoading(true); setError('')
    try {
      const page = await api.history(token, documentId, next)
      if (run !== generation.current) return
      setItems(previous => {
        const merged = next ? [...previous, ...page.items] : [...page.items, ...previous]
        const unique = new Map<string, HistoryItem>()
        for (const item of merged) if (!unique.has(item.id)) unique.set(item.id, item)
        return [...unique.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      })
      if (next || !initialized.current) setCursor(page.nextCursor)
      initialized.current = true
    } catch (cause) {
      if (run === generation.current) setError((cause as Error).message)
    } finally {
      if (run === generation.current) { pending.current = false; setLoading(false) }
    }
  }, [token, documentId])

  useEffect(() => {
    setItems([]); setCursor(null); initialized.current = false; pending.current = false
    void load()
    return invalidateLoad
  }, [load, invalidateLoad])

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => { refreshTimer.current = null; void load() }, 700)
  }, [load])

  useEffect(() => {
    if (previousRefresh.current === refreshKey) return
    previousRefresh.current = refreshKey
    scheduleRefresh()
  }, [refreshKey, scheduleRefresh])

  useEffect(() => {
    const updated = (event: Event) => {
      if ((event as CustomEvent<{ id?: string }>).detail?.id === documentId) scheduleRefresh()
    }
    window.addEventListener('mdoc-updated', updated)
    return () => window.removeEventListener('mdoc-updated', updated)
  }, [documentId, scheduleRefresh])

  useEffect(() => {
    if (!active) return
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60_000)
    return () => window.clearInterval(timer)
  }, [active, load])

  const groups = new Map<string, HistoryItem[]>()
  for (const item of items) {
    const day = historyDay(item.createdAt)
    if (!groups.has(day)) groups.set(day, [])
    groups.get(day)!.push(item)
  }

  return <div className="panel-body history-panel motion-enter" role="tabpanel" id="panel-history" aria-labelledby="tab-history">
    <div className="panel-intro history-intro"><div><b>文档历史</b><span>版本与重要变更</span></div><button type="button" className="icon-btn" aria-label="刷新历史" title="刷新历史" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /></button></div>
    {loading && !items.length ? <div className="panel-empty" role="status"><Clock3 size={22} /><b>正在加载历史</b></div>
      : !items.length && !error ? <div className="panel-empty"><ArtIcon name="history" fallback={<Clock3 size={22} />} /><b>还没有历史记录</b><span>文档编辑后会自动保留快照，改名和权限等重要变化也会显示在这里。</span></div>
        : <div className="history-groups">{[...groups].map(([day, entries]) => <details className="history-day" key={day} open>
          <summary><ChevronRight size={13} /><span>{day}</span><small>{entries.length} 条</small></summary>
          <ol className="history-timeline">{entries.map(item => <li key={item.id} className={'history-entry history-' + item.kind} data-history-id={item.id}>
            <span className="history-avatar" aria-hidden="true">{(item.userName || '成').slice(0, 1).toUpperCase()}</span>
            <div className="history-entry-copy"><div className="history-entry-meta"><b>{item.userName || '成员'}</b><time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString('zh-CN')}>{new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div>
              {item.kind === 'snapshot' ? <button type="button" className="history-snapshot" aria-label={'预览版本 ' + item.version} onClick={() => onPreviewVersion({ id: item.versionId, version: item.version, title: item.title, createdAt: item.createdAt, createdBy: item.userId, createdByName: item.userName, summary: item.summary, reason: item.reason })}>
                <span>{historyEventLabel(item)}</span><small>版本 {item.version}{item.summary?.added ? ` · +${item.summary.added}` : ''}{item.summary?.removed ? ` · −${item.summary.removed}` : ''}</small><ChevronRight size={14} />
              </button> : <><p className="history-event-label">{historyEventLabel(item)}</p>{item.details?.sourceVersion !== undefined && <small className="history-event-detail">来源：版本 {item.details.sourceVersion}</small>}{item.details?.beforeRole !== undefined && <small className="history-event-detail">{historyRole(item.details.beforeRole)} → {historyRole(item.details.afterRole)}</small>}{item.details?.afterRestricted !== undefined && <small className="history-event-detail">{item.details.afterRestricted ? '仅指定成员可访问' : '工作区成员可访问'}</small>}</>}
            </div>
          </li>)}</ol>
        </details>)}</div>}
    {error && <div className="history-load-error" role="alert"><span>历史加载失败：{error}</span><button type="button" className="secondary-btn" disabled={loading} onClick={() => void load(items.length ? cursor : null)}>重试</button></div>}
    {cursor && !error && <button type="button" className="secondary-btn history-load-more" onClick={() => void load(cursor)} disabled={loading}>{loading ? '正在加载…' : '加载更早记录'}</button>}
    {!!items.length && !cursor && !loading && <p className="history-end">已显示全部历史</p>}
  </div>
}
