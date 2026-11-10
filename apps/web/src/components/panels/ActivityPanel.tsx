import { useCallback, useEffect, useState } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { request } from '../../lib/api'
import { relativeTime } from '../../lib/format'
import type { ActivityEntry } from '../../lib/types'

const ACTION_LABELS: Record<string, string> = { view: '查看了文档', edit: '编辑了文档', restore: '恢复了历史版本' }

export default function ActivityPanel({ token, documentId }: { token: string; documentId: string }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await request<{ activity: ActivityEntry[] }>('/documents/' + documentId + '/activity?limit=20', token)
      setEntries(result.activity || [])
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setLoading(false)
    }
  }, [token, documentId])

  useEffect(() => { void load() }, [load])

  return <div className="panel-body">
    <div className="panel-intro">
      <b>动态</b>
      <span className="panel-intro-actions">
        {entries.length ? entries.length + ' 条记录' : '暂无记录'}
        <button className="icon-btn" aria-label="刷新动态" title="刷新动态" onClick={() => void load()} disabled={loading}><RefreshCw size={13} /></button>
      </span>
    </div>
    {loading ? <div className="panel-empty"><RefreshCw size={21} /><b>正在加载动态</b><span>稍等一下</span></div>
      : error ? <div className="panel-empty"><Activity size={21} /><b>动态加载失败</b><span>{error}</span></div>
        : entries.length === 0 ? <div className="panel-empty"><Activity size={21} /><b>还没有动态</b><span>打开或编辑文档后会记录在这里</span></div>
          : <ol className="activity-list">{entries.map((entry) => <li className="activity-item" key={entry.id}>
            <span className="activity-avatar">{(entry.userName || '?').slice(0, 1).toUpperCase()}</span>
            <div className="activity-copy">
              <b>{entry.userName || '成员'}</b>
              <span>{ACTION_LABELS[entry.action] || entry.action}</span>
              <small>{relativeTime(entry.createdAt) || '刚刚'}</small>
            </div>
          </li>)}</ol>}
  </div>
}
