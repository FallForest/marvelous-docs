import { useCallback, useRef, useState } from 'react'
import { api } from '../lib/endpoints'
import { copyText } from '../lib/clipboard'
import type { Doc, DocumentPermission, WorkspaceMember } from '../lib/types'

type ShareLink = { id: string; token: string; permission: string; expiresAt: string | null }

type Options = {
  token: string
  /** The signed-in user, needed to keep their own role when the scope changes. */
  userId: string | null
  notify: (message: string) => void
}

/**
 * Data and actions behind the share dialog.
 *
 * Every value here is one round trip behind a dialog that is closed most of the
 * time — the member list, the ACL, the public links — so none of it belongs in
 * the workspace shell. The shell keeps the boolean "is it open"; this hook keeps
 * what the dialog shows and does. The two rules that are easy to get wrong live
 * here instead of in the render tree: a folder has no ACL, and a failed load
 * reports rather than leaving stale permissions on screen.
 */
export function useSharing({ token, userId, notify }: Options) {
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [permissions, setPermissions] = useState<DocumentPermission[]>([])
  const [restricted, setRestricted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([])
  const [linkCopied, setLinkCopied] = useState(false)

  // Callers pass an inline notify; holding it in a ref stops every action below
  // from being rebuilt on each render of the shell.
  const notifyRef = useRef(notify)
  notifyRef.current = notify

  const loadLinks = useCallback(async (documentId: string) => {
    try {
      const data = await api.shareLinks(token, documentId)
      setShareLinks(data.shareLinks)
    } catch { setShareLinks([]) }
  }, [token])

  /** Fills the dialog for `doc`. Callers check the kind before opening it. */
  const load = useCallback(async (doc: Doc) => {
    setBusy(true)
    try {
      const [memberList, access] = await Promise.all([api.members(token), api.acl(token, doc.id)])
      setMembers(memberList.members || [])
      setPermissions(access.permissions || [])
      setRestricted(access.restricted)
      void loadLinks(doc.id)
    } catch (error) {
      notifyRef.current('共享设置加载失败：' + (error as Error).message)
    } finally {
      setBusy(false)
    }
  }, [token, loadLinks])

  const createLink = useCallback(async (doc: Doc) => {
    setBusy(true)
    try {
      const data = await api.createShareLink(token, doc.id, 'viewer')
      const url = window.location.origin + '/shared/' + data.shareLink.token
      setShareLinks((previous) => [
        { id: data.shareLink.id, token: data.shareLink.token, permission: data.shareLink.permission, expiresAt: null },
        ...previous,
      ])
      // Plain-HTTP deployments have no navigator.clipboard, so the helper
      // reports the real outcome instead of claiming success.
      const copied = await copyText(url)
      setLinkCopied(copied)
      if (!copied) notifyRef.current('链接已生成，但浏览器阻止了自动复制，请手动复制。')
      window.setTimeout(() => setLinkCopied(false), 2500)
    } catch (error) {
      notifyRef.current('创建分享链接失败：' + (error as Error).message)
    } finally {
      setBusy(false)
    }
  }, [token])

  const revokeLink = useCallback(async (doc: Doc, linkId: string) => {
    setBusy(true)
    try {
      await api.revokeShareLink(token, doc.id, linkId)
      setShareLinks((previous) => previous.filter((link) => link.id !== linkId))
    } catch (error) {
      notifyRef.current('删除分享链接失败：' + (error as Error).message)
    } finally {
      setBusy(false)
    }
  }, [token])

  const setPermission = useCallback(async (doc: Doc, member: WorkspaceMember, role: DocumentPermission['role'] | null) => {
    setBusy(true)
    try {
      await api.setAcl(token, doc.id, { userId: member.id, role, restricted })
      setPermissions((current) => {
        const next = current.filter((permission) => permission.userId !== member.id)
        return role ? [...next, { userId: member.id, email: member.email, name: member.name || member.email, role }] : next
      })
    } catch (error) {
      notifyRef.current('权限更新失败：' + (error as Error).message)
    } finally {
      setBusy(false)
    }
  }, [token, restricted])

  const setRestriction = useCallback(async (doc: Doc, next: boolean) => {
    if (!userId) return
    setRestricted(next)
    setBusy(true)
    try {
      // The caller's own row carries the role the server checks; 'owner' is the
      // fallback for a document whose owner has no explicit ACL row.
      const own = permissions.find((permission) => permission.userId === userId)
      await api.setAcl(token, doc.id, { userId, role: own?.role || 'owner', restricted: next })
    } catch (error) {
      setRestricted(!next)
      notifyRef.current('共享范围更新失败：' + (error as Error).message)
    } finally {
      setBusy(false)
    }
  }, [token, userId, permissions])

  return {
    members, permissions, restricted, busy, shareLinks, linkCopied,
    load, createLink, revokeLink, setPermission, setRestriction,
  }
}
