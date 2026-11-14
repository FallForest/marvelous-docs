import type { WebSocket } from 'ws'
import type { FastifyRequest } from 'fastify'
import type * as awarenessProtocol from 'y-protocols/awareness'
import type * as Y from 'yjs'
import type { TitleMode } from '../lib/document-title.js'

/** JWT payload: the user, their workspace, and nothing else. */
export type Claims = { sub: string; email: string; workspaceId: string }

/** Request narrowed to the point where the auth hook has run. */
export type AuthRequest = FastifyRequest & { user: Claims }

export type DocumentRow = {
  id: string; workspace_id: string; parent_id: string | null; title: string; title_mode: TitleMode; kind: 'document' | 'folder';
  content: unknown; version: number; acl_restricted: boolean; deleted_at: Date | null;
  created_by: string; updated_by: string; created_at: Date; updated_at: Date; access_role?: string;
}

/** One live collaboration room; at most one per document per process. */
export type Room = {
  id: string
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  clients: Map<WebSocket, { userId: string; canWrite: boolean; clientIds: Set<number> }>
  timer?: NodeJS.Timeout
  disposeTimer?: NodeJS.Timeout
  saveQueue: Promise<void>
  suppressSave: boolean
  dirty: boolean
  /**
   * `content` lags `yjs_state`.
   *
   * The projection is derived data and expensive to write (it rebuilds the search
   * indexes), so it is refreshed on a slower clock than the durable state. Anything
   * that reads `content` has to go through `flushRoom`, which forces a projection.
   */
  projectionDirty: boolean
  /** When `content` was last written, for the projection interval. */
  projectedAt: number
  changeSeq: number
  lastActor?: string
  historyTimer?: NodeJS.Timeout
}

export type UpdateManifest = { version: string; releaseUrl?: string; notesUrl?: string; apiImage?: string; webImage?: string; sha256?: string }
