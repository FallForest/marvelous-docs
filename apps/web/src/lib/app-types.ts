/** Shared UI state unions and contracts used by the workspace shell and pages. */
import type { FormEvent } from 'react'

export type UpdateInfo = { version: string; url?: string; status: 'available' | 'running' | 'failed' | 'completed' }

export type CollabStatus = 'connecting' | 'connected' | 'disconnected'

export type RightTab = 'comments' | 'history'

/**
 * Which surface the main column shows when no document is open.
 *
 * Named here because three files (the shell, the data hook, the sidebar) each
 * declare their own copy of this union today; adding a view meant finding all
 * three or silently filtering it out of the sidebar's active state.
 *
 * `all` exists because the tree root row used to call the same handler as the
 * "首页" nav row. Two labels, one destination, 200px apart in the same column:
 * "所有文档" was not a place, it was a second button for the dashboard. The root
 * row now opens the flat document list it names, and the dashboard keeps the
 * roll-up it is actually for.
 */
export type HomeView = 'home' | 'search' | 'trash' | 'favorites' | 'recent' | 'all'

/**
 * Placeholder the shell writes into the shared query field when it opens the
 * favourites view, so that view does not filter the tree by its own name.
 *
 * It is named here rather than spelled inline because five call sites compared
 * against the literal and none of them wrote it: a rename would have had to find
 * all five, and a sixth reader could only guess where the value came from.
 */
export const FAVORITES_SCOPE = '__favorites__'

/**
 * Form contract for creating an invite.
 *
 * It lives here rather than in the admin page so the dialog and the page can
 * both depend on it without importing each other.
 */
export type AdminInviteProps = {
  email: string
  setEmail: (value: string) => void
  role: 'member' | 'admin'
  setRole: (value: 'member' | 'admin') => void
  link: string
  error: string
  busy: boolean
  copied: boolean
  onSubmit: (event: FormEvent) => void
  onCopy: () => void
}
