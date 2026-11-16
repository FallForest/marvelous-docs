import { useEffect, useRef, useState } from 'react'
import { Copy, Share2, X } from 'lucide-react'
import { usePresence } from '../../hooks/usePresence'
import type { DocumentPermission, ShareLinkPermission, WorkspaceMember } from '../../lib/types'
import type { ShareLink } from '../../lib/endpoints'
import Select from '../ui/Select'

type ShareDialogProps = {
  title: string
  members: WorkspaceMember[]
  permissions: DocumentPermission[]
  restricted: boolean
  busy: boolean
  loadError: string
  shareLinks: ShareLink[]
  shareLinkCopied: boolean
  onCreateShareLink: (permission: ShareLinkPermission, expiresInDays: number | null) => void
  onCopyShareLink: (link: ShareLink) => void
  onRetry: () => void
  onRevokeShareLink: (linkId: string) => void
  onRestrictedChange: (restricted: boolean) => void
  onPermissionChange: (member: WorkspaceMember, role: DocumentPermission['role'] | null) => void
  onClose: () => void
}

/** Per-document ACL editor plus public share-link management. */
export default function ShareDialog({ title, members, permissions, restricted, busy, loadError, shareLinks, shareLinkCopied, onCreateShareLink, onCopyShareLink, onRetry, onRevokeShareLink, onRestrictedChange, onPermissionChange, onClose }: ShareDialogProps) {
  const [expiresInDays, setExpiresInDays] = useState<number | null>(7)
  const panel = useRef<HTMLElement>(null)
  const disabled = busy || Boolean(loadError)
  const permissionMap = new Map(permissions.map((permission) => [permission.userId, permission]))
  const { closing, requestClose, onAnimationEnd } = usePresence(onClose)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const focusables = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('button, input, select, a[href]') || [])
      .filter((element) => !element.hasAttribute('disabled') && element.offsetParent !== null)
    focusables()[0]?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); requestClose(); return }
      if (event.key !== 'Tab') return
      const items = focusables()
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) { event.preventDefault(); return }
      if (!panel.current?.contains(document.activeElement)) { event.preventDefault(); first.focus(); return }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true); previous?.focus({ preventScroll: true }) }
  }, [requestClose])
  return <div className={'modal-backdrop' + (closing ? ' is-closing' : '')} onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose() }}>
    <section
      ref={panel}
      className={'share-modal modal-panel' + (closing ? ' is-closing' : '')}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-title"
      onAnimationEnd={onAnimationEnd}
    >
      <header><div><div className="invite-icon"><Share2 size={17} /></div><h2 id="share-title">共享文档</h2><p>{title}</p></div><button className="icon-btn" aria-label="关闭共享设置" title="关闭" onClick={requestClose}><X size={17} /></button></header>
      {loadError && <div className="share-load-error" role="alert"><p>{loadError}</p><button type="button" className="secondary-btn" disabled={busy} onClick={onRetry}>重新加载共享设置</button></div>}
      <label className="share-restriction"><span><b>仅指定成员可访问</b><small>{restricted ? '指定成员、拥有上级文件夹权限的成员和管理员可访问' : '未单独设置权限的工作区成员可编辑；上级文件夹限制仍然适用'}</small></span><input type="checkbox" checked={restricted} disabled={disabled} onChange={(event) => onRestrictedChange(event.target.checked)} /></label>
      <div className="share-link-section">
        <b>分享链接</b>
        <p className="share-link-hint">任何拥有公开链接的人都可查看文档。成员权限变更不会撤销链接，请在下方单独撤销。</p>
        <div className="share-link-actions">
          <Select
            className="share-link-permission"
            label="分享链接有效期"
            value={expiresInDays === null ? 'never' : String(expiresInDays)}
            disabled={disabled}
            onValueChange={(value) => setExpiresInDays(value === 'never' ? null : Number(value))}
            options={[
              { value: '1', label: '1 天后到期' }, { value: '7', label: '7 天后到期' },
              { value: '30', label: '30 天后到期' }, { value: '90', label: '90 天后到期' },
              { value: '365', label: '365 天后到期' }, { value: 'never', label: '永不过期' },
            ]}
          />
          <button type="button" className="primary-btn" onClick={() => onCreateShareLink('viewer', expiresInDays)} disabled={disabled}>
            <Copy size={14} />{shareLinkCopied ? '已复制链接' : '生成并复制链接'}
          </button>
        </div>
        {shareLinks.length > 0 && <div className="share-link-list">
          {shareLinks.map((link) => <div key={link.id} className="share-link-item">
            <div className="share-link-info">
              <b>{link.permission === 'commenter' ? '仅查看（旧评论链接）' : '仅查看'}</b>
              <small>{link.expiresAt ? (new Date(link.expiresAt).getTime() <= Date.now() ? '已过期：' : '到期：') + new Date(link.expiresAt).toLocaleString('zh-CN') : '永不过期'}</small>
              {link.token ? <label className="share-link-copy">公开链接<input aria-label="公开链接地址" readOnly value={(typeof window === 'undefined' ? '' : window.location.origin) + '/shared/' + link.token} onFocus={(event) => event.currentTarget.select()} /></label> : <small>链接仅在创建时显示，请使用之前保存的地址，或撤销后重新生成。</small>}
            </div>
            <div className="share-link-buttons">{link.token && <button type="button" className="secondary-btn" disabled={disabled} onClick={() => onCopyShareLink(link)}>复制</button>}<button type="button" className="danger-btn" onClick={() => onRevokeShareLink(link.id)} disabled={disabled}>撤销</button></div>
          </div>)}
        </div>}
      </div>
      <div className="share-members-heading"><b>工作区成员</b><span>{members.length + ' 人'}</span></div>
      <div className="share-members">{members.map((member) => {
        const permission = permissionMap.get(member.id)
        return <div className="share-member" key={member.id}>
          <div className="avatar">{(member.name || member.email)[0].toUpperCase()}</div>
          <div className="share-member-copy"><b>{member.name || member.email.split('@')[0]}</b><small>{member.email}</small></div>
          {member.role === 'admin' ? <span className="share-admin">管理员</span> : <Select
            label={(member.name || member.email) + '的文档权限'} value={permission?.role || 'none'} disabled={disabled}
            onValueChange={(value) => onPermissionChange(member, value === 'none' ? null : value as DocumentPermission['role'])}
            options={[
              { value: 'none', label: restricted ? '无直接授权（可能继承）' : '使用默认或继承权限' },
              { value: 'viewer', label: '可查看' }, { value: 'editor', label: '可编辑' }, { value: 'owner', label: '管理权限' },
            ]}
          />}
        </div>
      })}{members.length === 0 && <div className="share-empty">{busy ? '正在加载成员…' : loadError ? '成员列表未加载' : '工作区暂无其他成员'}</div>}</div>
      <footer><span>权限更改会立即生效</span><button className="primary-btn" onClick={requestClose}>完成</button></footer>
    </section>
  </div>
}
