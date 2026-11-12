import {
  ArrowLeft, LayoutDashboard, LogOut, ShieldCheck, Sparkles, UserPlus, Users,
} from 'lucide-react'
import InviteDialog from '../components/dialogs/InviteDialog'
import { staggerItemProps } from '../components/ui/Stagger'
import type { AdminInviteProps, UpdateInfo } from '../lib/app-types'
import type { User, WorkspaceMember } from '../lib/types'

export type AdminWorkspaceProps = { user: User; members: WorkspaceMember[]; membersBusy: boolean; updateInfo: UpdateInfo | null; notice: string; showInvite: boolean; onBack: () => void; onOpenInvite: () => void; onStartUpdate: () => void; onLogout: () => void; onCloseInvite: () => void; inviteProps: AdminInviteProps }

export default function AdminWorkspace({ user, members, membersBusy, updateInfo, notice, showInvite, onBack, onOpenInvite, onStartUpdate, onLogout, onCloseInvite, inviteProps }: AdminWorkspaceProps) {
  return <div className="admin-shell motion-enter" data-vt-scope="main">
    <aside className="admin-sidebar">
      <div className="brand-row"><div className="brand-mark"><Sparkles size={16} /></div><span>Marvelous Docs</span></div>
      <div className="admin-sidebar-title"><ShieldCheck size={17} /><div><b>管理中心</b><small>工作区设置</small></div></div>
      <button className="admin-back" onClick={onBack}><ArrowLeft size={15} />返回文档</button>
      <div className="admin-sidebar-footer"><div className="profile-row"><div className="avatar">{(user.name || user.email)[0].toUpperCase()}</div><div className="profile-copy"><b>{user.name || user.email.split('@')[0]}</b><small>管理员</small></div><button className="icon-btn" aria-label="退出登录" title="退出登录" onClick={onLogout}><LogOut size={16} /></button></div></div>
    </aside>
    <main className="admin-main">
      <header className="admin-topbar"><div><span {...staggerItemProps(0, 'eyebrow')}>工作区管理</span><h1 {...staggerItemProps(1)}>管理中心</h1><p {...staggerItemProps(2)}>管理成员、邀请和工作区服务。</p></div><span className="admin-status"><span className="save-dot" />管理员权限</span></header>
      <div className="admin-content">
        <section {...staggerItemProps(0, 'admin-section')}>
          <div className="admin-section-head"><div><h2><Users size={18} />成员管理</h2><p>管理工作区成员并邀请新的协作者。</p></div><button className="primary-btn" onClick={onOpenInvite}><UserPlus size={15} />邀请成员</button></div>
          <div className="admin-member-list">{membersBusy ? <div className="admin-empty">正在加载成员…</div> : members.length ? members.map((member) => <div className="admin-member-row" key={member.id}>
            <div className="avatar">{(member.name || member.email)[0].toUpperCase()}</div>
            <div className="admin-member-copy"><b>{member.name || member.email.split('@')[0]}</b><small>{member.email}</small></div>
            <span className={'role-badge ' + member.role}>{member.role === 'admin' ? '管理员' : '成员'}</span>
          </div>) : <div className="admin-empty">暂无工作区成员</div>}</div>
        </section>
        <section {...staggerItemProps(1, 'admin-section')}>
          <div className="admin-section-head"><div><h2><LayoutDashboard size={18} />系统更新</h2><p>检查并部署 Marvelous Docs 的新版本。</p></div>{updateInfo?.url && <a className="admin-release-link" href={updateInfo.url} target="_blank" rel="noreferrer">查看发布说明</a>}</div>
          <div className="admin-update-card">
            <div className={'admin-update-icon' + (updateInfo?.status === 'running' ? ' is-running' : '')}><Sparkles size={19} /></div>
            <div className="admin-update-copy">
              <b>{updateInfo?.status === 'available' ? '发现新版本 ' + updateInfo.version : updateInfo?.status === 'running' ? '正在更新到 ' + updateInfo.version : updateInfo?.status === 'failed' ? '更新失败（' + updateInfo.version + '）' : '当前使用最新版本'}</b>
              <span>{notice || '系统会在更新前自动备份数据库。'}</span>
            </div>
            {(updateInfo?.status === 'available' || updateInfo?.status === 'failed') && <button className="secondary-btn" onClick={onStartUpdate}>{updateInfo.status === 'failed' ? '重试' : '立即更新'}</button>}
          </div>
        </section>
      </div>
    </main>
    {/*
      The admin page returns before the document shell, so it never rendered that
      shell's toast. An update that failed therefore reported nothing: the inline
      line at the top only shows the *current* status text, not the result of the
      action the user just took.
    */}
    {notice && <div className="notice-toast" role="status" aria-live="polite">
      {notice}
    </div>}
    {showInvite && <InviteDialog {...inviteProps} onClose={onCloseInvite} />}
  </div>
}
