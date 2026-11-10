import { AlertCircle, ChevronRight, Copy, Mail, UserPlus, X } from 'lucide-react'
import type { AdminInviteProps } from '../../lib/app-types'

/** Creates a one-time invite link and shows it for the operator to send. */
export default function InviteDialog({ email, setEmail, role, setRole, link, error, busy, copied, onSubmit, onCopy, onClose }: AdminInviteProps & { onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="invite-modal" role="dialog" aria-modal="true" aria-labelledby="invite-title">
      <header><div><div className="invite-icon"><UserPlus size={17} /></div><h2 id="invite-title">邀请成员</h2><p>邀请同事加入这个工作区。</p></div><button className="icon-btn" aria-label="关闭邀请" title="关闭" onClick={onClose}><X size={17} /></button></header>
      <form onSubmit={onSubmit}>
        <label>邮箱地址<div className="invite-input"><Mail size={15} /><input type="email" placeholder="name@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></div></label>
        <label>工作区角色<select value={role} onChange={(event) => setRole(event.target.value as 'member' | 'admin')}><option value="member">成员</option><option value="admin">管理员</option></select></label>
        {error && <div className="invite-error"><AlertCircle size={15} />{error}</div>}
        {link ? <div className="invite-result"><b>邀请链接已创建</b><p>链接有效期为 7 天。发送给 {email} 完成注册。</p><div className="link-copy"><input readOnly value={link} onFocus={(event) => event.currentTarget.select()} aria-label="邀请链接" /><button type="button" className="primary-btn" onClick={onCopy}><Copy size={14} />{copied ? '已复制' : '复制链接'}</button></div></div>
          : <button className="primary-btn invite-submit" disabled={busy}>{busy ? '正在创建...' : '创建邀请'}<ChevronRight size={15} /></button>}
      </form>
    </section>
  </div>
}
