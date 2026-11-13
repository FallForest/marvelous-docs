import { useCallback, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../lib/endpoints'
import { copyText } from '../lib/clipboard'
import type { AdminInviteProps } from '../lib/app-types'

/**
 * The invite form: address, role, the one-time link, and the copy feedback.
 *
 * The same form is rendered twice — as a dialog in the document shell and inside
 * the admin page — and both need identical behaviour, including the plain-HTTP
 * fallback for the clipboard. Keeping the state here is what lets the two hosts
 * share one contract (`AdminInviteProps`) instead of duplicating six setters.
 */
export function useInvite(token: string): AdminInviteProps & { reset: () => void } {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const reset = useCallback(() => {
    setError('')
    setLink('')
  }, [])

  const onSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setLink('')
    setBusy(true)
    try {
      const { invite } = await api.invite(token, email, role)
      const url = new URL(window.location.href)
      url.search = ''
      url.hash = ''
      url.searchParams.set('invite', invite.token)
      setLink(url.toString())
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }, [token, email, role])

  const onCopy = useCallback(async () => {
    if (!link) return
    const ok = await copyText(link)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } else {
      // navigator.clipboard is absent on plain HTTP; say so instead of leaving
      // the button looking broken.
      setError('浏览器阻止了自动复制，请手动选中链接复制。')
    }
  }, [link])

  return { email, setEmail, role, setRole, link, error, busy, copied, onSubmit, onCopy, reset }
}
