import { Copy, Share2, X } from 'lucide-react'
import { usePresence } from '../ui/usePresence'
import type { DocumentPermission, WorkspaceMember } from '../../lib/types'

type ShareDialogProps = {
  title: string
  members: WorkspaceMember[]
  permissions: DocumentPermission[]
  restricted: boolean
  busy: boolean
  shareLinks: Array<{ id: string; token: string; permission: string; expiresAt: string | null }>
  shareLinkCopied: boolean
  onCreateShareLink: () => void
  onRevokeShareLink: (linkId: string) => void
  onRestrictedChange: (restricted: boolean) => void
  onPermissionChange: (member: WorkspaceMember, role: DocumentPermission['role'] | null) => void
  onClose: () => void
}

/** Per-document ACL editor plus public share-link management. */
export default function ShareDialog({ title, members, permissions, restricted, busy, shareLinks, shareLinkCopied, onCreateShareLink, onRevokeShareLink, onRestrictedChange, onPermissionChange, onClose }: ShareDialogProps) {
  const permissionMap = new Map(permissions.map((permission) => [permission.userId, permission]))
  const { closing, requestClose, onAnimationEnd } = usePresence(onClose)
  return <div className={'modal-backdrop' + (closing ? ' is-closing' : '')} onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose() }}>
    <section
      className={'share-modal modal-panel' + (closing ? ' is-closing' : '')}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-title"
      onAnimationEnd={onAnimationEnd}
    >
      <header><div><div className="invite-icon"><Share2 size={17} /></div><h2 id="share-title">共享文档</h2><p>{title}</p></div><button className="icon-btn" aria-label="关闭共享设置" title="关闭" onClick={requestClose}><X size={17} /></button></header>
      <label className="share-restriction"><span><b>仅指定成员可访问</b><small>{restricted ? '只有下方名单中的成员可以打开此文档' : '工作区所有成员均可查看和编辑'}</small></span><input type="checkbox" checked={restricted} disabled={busy} onChange={(event) => onRestrictedChange(event.target.checked)} /></label>
      <div className="share-link-section">
        <b>分享链接</b>
        <p className="share-link-hint">生成公开链接，任何拥有链接的人可查看文档。</p>
        <div className="share-link-actions">
          <button type="button" className="primary-btn" onClick={onCreateShareLink} disabled={busy}>
            <Copy size={14} />{shareLinkCopied ? '已复制链接' : '生成并复制链接'}
          </button>
        </div>
        {shareLinks.length > 0 && <div className="share-link-list">
          {shareLinks.map((link) => <div key={link.id} className="share-link-item">
            <div className="share-link-info">
              <b>{link.permission === 'commenter' ? '可评论' : '仅查看'}</b>
              {link.expiresAt && <small>到期：{new Date(link.expiresAt).toLocaleDateString()}</small>}
            </div>
            <button type="button" className="danger-btn" onClick={() => onRevokeShareLink(link.id)} disabled={busy}>撤销</button>
          </div>)}
        </div>}
      </div>
      <div className="share-members-heading"><b>工作区成员</b><span>{members.length + ' 人'}</span></div>
      <div className="share-members">{members.map((member) => {
        const permission = permissionMap.get(member.id)
        const role = permission?.role || (restricted ? null : 'editor')
        return <div className="share-member" key={member.id}>
          <div className="avatar">{(member.name || member.email)[0].toUpperCase()}</div>
          <div className="share-member-copy"><b>{member.name || member.email.split('@')[0]}</b><small>{member.email}</small></div>
          {member.role === 'admin' ? <span className="share-admin">管理员</span> : <select aria-label={(member.name || member.email) + '的文档权限'} value={role || 'none'} disabled={busy} onChange={(event) => onPermissionChange(member, event.target.value === 'none' ? null : event.target.value as DocumentPermission['role'])}>
            <option value="none">无权限</option>
            <option value="viewer">可查看</option>
            <option value="editor">可编辑</option>
            <option value="owner">管理权限</option>
          </select>}
        </div>
      })}{members.length === 0 && <div className="share-empty">工作区暂无其他成员</div>}</div>
      <footer><span>权限更改会立即生效</span><button className="primary-btn" onClick={requestClose}>完成</button></footer>
    </section>
  </div>
}