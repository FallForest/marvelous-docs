/** Shared UI state unions and contracts used by the workspace shell and pages. */
import type { FormEvent } from 'react'

export type UpdateInfo = { version: string; url?: string; status: 'available' | 'running' | 'failed' | 'completed' }

export type CollabStatus = 'connecting' | 'connected' | 'disconnected'

export type RightTab = 'comments' | 'history' | 'activity'

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
