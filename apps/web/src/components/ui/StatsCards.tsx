import { FileText, Folder, MessageCircle, Trash2, Users } from 'lucide-react'
import type { WorkspaceStats } from '../../lib/types'

const CARDS: Array<{ key: keyof WorkspaceStats; label: string; icon: typeof FileText; tone: string }> = [
  { key: 'documents', label: '文档', icon: FileText, tone: 'doc' },
  { key: 'folders', label: '文件夹', icon: Folder, tone: 'folder' },
  { key: 'members', label: '成员', icon: Users, tone: 'member' },
  { key: 'openComments', label: '待处理评论', icon: MessageCircle, tone: 'comment' },
  { key: 'trashed', label: '回收站', icon: Trash2, tone: 'trash' },
]

export default function StatsCards({ stats }: { stats: WorkspaceStats | null }) {
  return <section className="stats-grid" aria-label="工作区统计">
    {CARDS.map((card) => {
      const Icon = card.icon
      const value = stats ? stats[card.key] : undefined
      return <div className={'stat-card ' + card.tone} key={card.key}>
        <span className="stat-icon"><Icon size={16} /></span>
        <span className="stat-copy">
          <b>{typeof value === 'number' ? value : '—'}</b>
          <small>{card.label}</small>
        </span>
      </div>
    })}
  </section>
}
