import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, ChevronRight, FileText, Sparkles } from 'lucide-react'
import ArtIcon from '../components/ui/ArtIcon'
import { staggerItemProps } from '../components/ui/Stagger'
import { API } from '../lib/api'
import type { User } from '../lib/types'

type LoginPageProps = {
  onLogin: (email: string, password: string) => void
  onAccepted: (result: { token: string; user: User }) => void
  error: string
  busy: boolean
}

/** Sign-in screen; it also redeems ?invite= links in place. */
export default function LoginPage({ onLogin, onAccepted, error, busy }: LoginPageProps) {
  const inviteToken = useMemo(() => new URLSearchParams(window.location.search).get('invite') || '', [])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  async function acceptInvite(event: FormEvent) {
    event.preventDefault()
    setInviteError('')
    setInviteBusy(true)
    try {
      const response = await fetch(API + '/api/v1/auth/accept-invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteToken, password, name }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message || body.message || '邀请链接无效或已过期')
      localStorage.setItem('mdocs-token', body.token)
      window.history.replaceState(null, '', window.location.pathname)
      onAccepted(body)
    } catch (inviteFailure) {
      setInviteError((inviteFailure as Error).message)
    } finally {
      setInviteBusy(false)
    }
  }
  return <div className="login-screen" data-vt-scope="main">
  <aside className="handdrawn-only login-art-intro" aria-hidden="true">
    <ArtIcon name="notebook" fallback={<FileText size={64} />} />
    <span className="login-art-kicker">THE TEAM NOTEBOOK</span>
    <h2>让好想法，<br />在这里落笔。</h2>
    <p>记录、讨论，然后一起把事情做好。</p>
  </aside>
  <div className="login-card motion-rise">
    <div {...staggerItemProps(0, 'login-brand')}><div className="brand-mark"><ArtIcon name="brand-spark" fallback={<Sparkles size={17} />} /></div><span>Marvelous Docs</span></div>
    {inviteToken ? <>
      <h1 {...staggerItemProps(1)}>加入团队</h1><p {...staggerItemProps(2)}>设置你的账户以加入工作区</p>
      <form onSubmit={acceptInvite}>
        <label {...staggerItemProps(3)}>姓名<input autoComplete="name" placeholder="你的姓名" value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label {...staggerItemProps(4)}>设置密码<input type="password" autoComplete="new-password" placeholder="至少 12 个字符" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {inviteError && <div className="login-error motion-disclose"><AlertCircle size={15} />{inviteError}</div>}
        <button {...staggerItemProps(5, 'primary-btn login-submit')} disabled={inviteBusy} aria-busy={inviteBusy}>
          {/* The label keeps its width while working, so the button does not resize under the pointer. */}
          {inviteBusy && <span className="login-spinner" aria-hidden="true" />}
          {inviteBusy ? '正在加入...' : '接受邀请'}<ChevronRight size={16} />
        </button>
      </form>
    </> : <>
      <h1 {...staggerItemProps(1)}>欢迎回来</h1><p {...staggerItemProps(2)}>登录你的团队工作区</p>
      <form onSubmit={(event) => { event.preventDefault(); onLogin(email, password) }}>
        <label {...staggerItemProps(3)}>邮箱地址<input type="email" autoComplete="username" placeholder="name@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label {...staggerItemProps(4)}>密码<input type="password" autoComplete="current-password" placeholder="输入密码" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error && <div className="login-error motion-disclose"><AlertCircle size={15} />{error}</div>}
        <button {...staggerItemProps(5, 'primary-btn login-submit')} disabled={busy} aria-busy={busy}>
          {busy && <span className="login-spinner" aria-hidden="true" />}
          {busy ? '正在登录...' : '登录'}<ChevronRight size={16} />
        </button>
      </form>
    </>}
    <div {...staggerItemProps(6, 'login-foot')}>私有部署 · 团队知识空间</div>
  </div></div>
}
