import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, ChevronRight, Sparkles } from 'lucide-react'
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
  return <div className="login-screen"><div className="login-card">
    <div className="login-brand"><div className="brand-mark"><Sparkles size={17} /></div><span>Marvelous Docs</span></div>
    {inviteToken ? <>
      <h1>加入团队</h1><p>设置你的账户以加入工作区</p>
      <form onSubmit={acceptInvite}>
        <label>姓名<input autoComplete="name" placeholder="你的姓名" value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label>设置密码<input type="password" autoComplete="new-password" placeholder="至少 12 个字符" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {inviteError && <div className="login-error"><AlertCircle size={15} />{inviteError}</div>}
        <button className="primary-btn login-submit" disabled={inviteBusy}>{inviteBusy ? '正在加入...' : '接受邀请'}<ChevronRight size={16} /></button>
      </form>
    </> : <>
      <h1>欢迎回来</h1><p>登录你的团队工作区</p>
      <form onSubmit={(event) => { event.preventDefault(); onLogin(email, password) }}>
        <label>邮箱地址<input type="email" autoComplete="username" placeholder="name@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>密码<input type="password" autoComplete="current-password" placeholder="输入密码" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error && <div className="login-error"><AlertCircle size={15} />{error}</div>}
        <button className="primary-btn login-submit" disabled={busy}>{busy ? '正在登录...' : '登录'}<ChevronRight size={16} /></button>
      </form>
    </>}
    <div className="login-foot">私有部署 · 团队知识空间</div>
  </div></div>
}
