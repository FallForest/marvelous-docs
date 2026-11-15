import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/endpoints'
import type { ShareLink } from '../lib/endpoints'
import { copyText } from '../lib/clipboard'
import type { Doc, DocumentPermission, ShareLinkPermission, WorkspaceMember } from '../lib/types'

type Options = {
  token: string
  userId: string | null
  notify: (message: string) => void
}

/** Owns sharing state, discarding responses from a previously opened document. */
export function useSharing({ token, userId, notify }: Options) {
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [permissions, setPermissions] = useState<DocumentPermission[]>([])
  const [restricted, setRestricted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([])
  const [linkCopied, setLinkCopied] = useState(false)
  const documentId = useRef<string | null>(null)
  const generation = useRef(0)
  const copiedTimer = useRef<number | null>(null)
  const notifyRef = useRef(notify)
  notifyRef.current = notify

  useEffect(() => {
    generation.current += 1
    documentId.current = null
    setMembers([])
    setPermissions([])
    setShareLinks([])
    setLoadError('')
    setRestricted(false)
    setLinkCopied(false)
    setBusy(false)
  }, [token, userId])

  useEffect(() => () => {
    generation.current += 1
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
  }, [])

  const showCopied = useCallback((copied: boolean) => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
    setLinkCopied(copied)
    copiedTimer.current = copied ? window.setTimeout(() => setLinkCopied(false), 2500) : null
  }, [])

  const load = useCallback(async (doc: Doc) => {
    const current = ++generation.current
    const sameDocument = documentId.current === doc.id
    documentId.current = doc.id
    setBusy(true)
    setLoadError('')
    setMembers([])
    setPermissions([])
    setRestricted(false)
    if (!sameDocument) setShareLinks([])
    showCopied(false)
    try {
      const [memberList, access, links] = await Promise.all([
        api.members(token), api.acl(token, doc.id), api.shareLinks(token, doc.id),
      ])
      if (current !== generation.current) return
      setMembers(memberList.members || [])
      setPermissions(access.permissions || [])
      setRestricted(access.restricted)
      // Preserve plaintext minted in this dialog; the server never returns it again.
      setShareLinks((previous) => {
        const known = new Map(previous.map((link) => [link.id, link.token]))
        return links.shareLinks.map((link) => ({ ...link, token: sameDocument ? known.get(link.id) : undefined }))
      })
    } catch (error) {
      if (current !== generation.current) return
      setShareLinks([])
      setLoadError('共享设置加载失败：' + (error as Error).message)
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }, [token, showCopied])

  const copyLink = useCallback(async (link: ShareLink) => {
    if (!link.token) return
    const current = generation.current
    const copied = await copyText(window.location.origin + '/shared/' + link.token)
    if (current !== generation.current) return
    showCopied(copied)
    notifyRef.current(copied ? '链接已复制' : '浏览器阻止了自动复制，请在链接框中手动复制。')
  }, [showCopied])

  const createLink = useCallback(async (doc: Doc, permission: ShareLinkPermission = 'viewer', expiresInDays: number | null = null) => {
    if (documentId.current !== doc.id || loadError) return
    const current = generation.current
    setBusy(true)
    try {
      const data = await api.createShareLink(token, doc.id, permission, expiresInDays)
      if (current !== generation.current) return
      setShareLinks((previous) => [data.shareLink, ...previous])
      await copyLink(data.shareLink)
    } catch (error) {
      if (current === generation.current) notifyRef.current('创建分享链接失败：' + (error as Error).message)
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }, [token, loadError, copyLink])

  const revokeLink = useCallback(async (doc: Doc, linkId: string) => {
    if (documentId.current !== doc.id || loadError) return
    const current = generation.current
    setBusy(true)
    try {
      await api.revokeShareLink(token, doc.id, linkId)
      if (current === generation.current) setShareLinks((previous) => previous.filter((link) => link.id !== linkId))
    } catch (error) {
      if (current === generation.current) notifyRef.current('删除分享链接失败：' + (error as Error).message)
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }, [token, loadError])

  const setPermission = useCallback(async (doc: Doc, member: WorkspaceMember, role: DocumentPermission['role'] | null) => {
    if (documentId.current !== doc.id || loadError) return
    const current = generation.current
    setBusy(true)
    try {
      await api.setAcl(token, doc.id, { userId: member.id, role, restricted })
      if (current !== generation.current) return
      setPermissions((previous) => {
        const next = previous.filter((permission) => permission.userId !== member.id)
        return role ? [...next, { userId: member.id, email: member.email, name: member.name || member.email, role }] : next
      })
    } catch (error) {
      if (current === generation.current) notifyRef.current('权限更新失败：' + (error as Error).message)
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }, [token, restricted, loadError])

  const setRestriction = useCallback(async (doc: Doc, next: boolean) => {
    if (!userId || documentId.current !== doc.id || loadError) return
    const current = generation.current
    setRestricted(next)
    setBusy(true)
    try {
      const own = permissions.find((permission) => permission.userId === userId)
      await api.setAcl(token, doc.id, { userId, role: own?.role || 'owner', restricted: next })
    } catch (error) {
      if (current !== generation.current) return
      setRestricted(!next)
      notifyRef.current('共享范围更新失败：' + (error as Error).message)
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }, [token, userId, permissions, loadError])

  return {
    members, permissions, restricted, busy, loadError, shareLinks, linkCopied,
    load, createLink, copyLink, revokeLink, setPermission, setRestriction,
  }
}
