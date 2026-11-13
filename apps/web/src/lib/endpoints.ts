import { request } from './api'
import type {
  Comment, Doc, DocumentPermission, SearchHit, SearchScope, Template, User,
  Version, WorkspaceMember, WorkspaceStats,
} from './types'

/**
 * Typed API client.
 *
 * Every endpoint the web app calls is declared here once, so paths, methods,
 * and response shapes have a single source of truth instead of being spelled
 * out inline at each call site (which is how a path typo becomes a 404 nobody
 * notices). Callers pass the bearer token; nothing is cached at this layer.
 */

type Token = string

const doc = (id: string) => '/documents/' + encodeURIComponent(id)

export const api = {
  /* ---- session ---- */
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('/auth/login', '', { method: 'POST', body: JSON.stringify({ email, password }) }),
  acceptInvite: (inviteToken: string, password: string, name: string) =>
    request<{ token: string; user: User }>('/auth/accept-invite', '', { method: 'POST', body: JSON.stringify({ inviteToken, password, name }) }),
  me: (token: Token) => request<{ user: User }>('/me', token),

  /* ---- workspace ---- */
  stats: (token: Token) => request<{ stats: WorkspaceStats }>('/workspace/stats', token),
  members: (token: Token) => request<{ members: WorkspaceMember[] }>('/workspace/members', token),
  templates: (token: Token) => request<{ templates: Template[] }>('/templates', token),
  invite: (token: Token, email: string, role: 'member' | 'admin') =>
    request<{ invite: { token: string; email: string; role: string } }>('/invites', token, { method: 'POST', body: JSON.stringify({ email, role }) }),

  /* ---- documents: reads ---- */
  documents: (token: Token) => request<{ documents: Doc[] }>('/documents', token),
  trash: (token: Token) => request<{ documents: Doc[]; retentionDays?: number }>('/documents/trash', token),
  favorites: (token: Token) => request<{ documents: Doc[] }>('/documents/favorites', token),
  recent: (token: Token) => request<{ documents: Doc[] }>('/documents/recent', token),
  search: (token: Token, query: string, scope: SearchScope) =>
    request<{ results: SearchHit[] }>('/documents/search?q=' + encodeURIComponent(query) + '&scope=' + scope, token),
  document: (token: Token, id: string) => request<{ document: Doc }>(doc(id), token),

  /* ---- documents: writes ---- */
  createDocument: (token: Token, payload: Record<string, unknown>) =>
    request<{ document: Doc }>('/documents', token, { method: 'POST', body: JSON.stringify(payload) }),
  importMarkdown: (token: Token, markdown: string, parentId: string | null) =>
    request<{ document: Doc }>('/documents/import', token, { method: 'POST', body: JSON.stringify({ format: 'markdown', markdown, parentId }) }),
  updateDocument: (token: Token, id: string, fields: Record<string, unknown>) =>
    request<{ document: Doc }>(doc(id), token, { method: 'PUT', body: JSON.stringify(fields) }),
  saveContent: (token: Token, id: string, content: Record<string, unknown>, expectedVersion: number) =>
    request<{ document: Doc }>(doc(id), token, { method: 'PUT', body: JSON.stringify({ content: { schemaVersion: 1, doc: content }, expectedVersion }) }),
  duplicate: (token: Token, id: string, parentId: string | null) =>
    request<{ document: Doc }>(doc(id) + '/duplicate', token, { method: 'POST', body: JSON.stringify({ parentId }) }),
  favorite: (token: Token, id: string, favorite: boolean) =>
    request<{ favorite: boolean }>(doc(id) + '/favorite', token, { method: 'PUT', body: JSON.stringify({ favorite }) }),
  remove: (token: Token, id: string) => request<{ ok: true }>(doc(id), token, { method: 'DELETE' }),
  /** Empties the whole bin in one call; returns how many rows went. */
  emptyTrash: (token: Token) => request<{ ok: true; removed: number }>('/documents/trash', token, { method: 'DELETE' }),
  sweepTrash: (token: Token) =>
    request<{ ok: true; removed: number; retentionDays: number }>('/documents/trash/sweep', token, { method: 'POST' }),
  restoreFromTrash: (token: Token, id: string) => request<{ ok: true }>(doc(id) + '/restore', token, { method: 'POST' }),
  purge: (token: Token, id: string) => request<{ ok: true }>(doc(id) + '/permanent', token, { method: 'DELETE' }),

  /* ---- documents: export ---- */
  exportDocument: (token: Token, id: string, format: 'markdown' | 'html' | 'json') =>
    request<{ filename?: string; content: string }>(doc(id) + '/export?format=' + format, token),

  /* ---- comments ---- */
  comments: (token: Token, id: string) => request<{ comments: Comment[] }>(doc(id) + '/comments', token),
  addComment: (token: Token, id: string, payload: Record<string, unknown>) =>
    request<{ comment: Comment }>(doc(id) + '/comments', token, { method: 'POST', body: JSON.stringify(payload) }),
  setCommentStatus: (token: Token, id: string, commentId: string, status: 'open' | 'resolved') =>
    request<{ comment: Comment }>(doc(id) + '/comments/' + commentId, token, { method: 'PATCH', body: JSON.stringify({ status }) }),

  /* ---- versions ---- */
  versions: (token: Token, id: string) => request<{ versions: Version[] }>(doc(id) + '/versions', token),
  restoreVersion: (token: Token, id: string, versionId: string, expectedVersion: number) =>
    request<{ document: Doc }>(doc(id) + '/versions/' + versionId + '/restore', token, { method: 'POST', body: JSON.stringify({ expectedVersion }) }),

  /* ---- sharing ---- */
  acl: (token: Token, id: string) => request<{ restricted: boolean; permissions: DocumentPermission[] }>(doc(id) + '/acl', token),
  setAcl: (token: Token, id: string, payload: Record<string, unknown>) =>
    request<{ ok: true }>(doc(id) + '/acl', token, { method: 'PUT', body: JSON.stringify(payload) }),
  shareLinks: (token: Token, id: string) =>
    request<{ shareLinks: ShareLink[] }>(doc(id) + '/share-link', token),
  createShareLink: (token: Token, id: string, permission: 'viewer' | 'commenter') =>
    request<{ shareLink: ShareLink }>(doc(id) + '/share-link', token, { method: 'POST', body: JSON.stringify({ permission }) }),
  revokeShareLink: (token: Token, id: string, linkId: string) =>
    request<{ ok: true }>(doc(id) + '/share-link/' + linkId, token, { method: 'DELETE' }),

  /* ---- system / updates ---- */
  updateCheck: (token: Token) =>
    request<{ updateAvailable: boolean; latestVersion?: string | null; manifest?: { releaseUrl?: string } | null }>('/system/update-check', token),
  startUpdate: (token: Token) => request<{ update: unknown }>('/system/update', token, { method: 'POST' }),
  updateStatus: (token: Token) =>
    request<{ update: { status: 'running' | 'completed' | 'failed'; error?: string } }>('/system/update-status', token),

  /* ---- activity ---- */
  activity: (token: Token, id: string) => request<{ activity: unknown[] }>(doc(id) + '/activity', token),
}

export type ShareLink = { id: string; token: string; permission: string; expiresAt: string | null }
