export type DocJson = { schemaVersion: 1; doc: Record<string, unknown> }

export type Doc = {
  id: string
  title: string
  kind?: 'folder' | 'document'
  parentId?: string | null
  content: DocJson
  version: number
  updatedAt?: string
  createdAt?: string
}

export type DocNode = { doc: Doc; children: DocNode[] }

export type User = { id: string; name?: string; email: string; role: 'admin' | 'member' }

export type WorkspaceMember = User

export type DocumentPermission = { userId: string; email: string; name: string; role: 'owner' | 'editor' | 'viewer' }

export type Comment = {
  id: string
  body: string
  userId: string
  userName: string
  createdAt?: string
  anchor?: { from?: number; to?: number; text?: string; blockId?: string } | null
  parentId?: string | null
  status?: 'open' | 'resolved'
  resolvedAt?: string
  resolvedBy?: string
}

export type Version = {
  id: string
  version: number
  createdAt?: string
  createdBy: string
  title?: string
  createdByName?: string
  content?: DocJson
}

export type ActivityEntry = { id: string; userId: string; userName: string; action: string; createdAt: string }

export type WorkspaceStats = {
  documents: number
  folders: number
  members: number
  openComments: number
  trashed: number
  versions?: number
}

export type Template = { id: string; name: string; description?: string; content?: DocJson }

export type SearchHit = Doc & { snippet?: string; titleMatch?: number }

export type SaveStatus = 'saving' | 'saved' | 'error'

export type SearchScope = 'all' | 'title' | 'content'

export type TreeAction = 'rename' | 'move' | 'favorite' | 'duplicate' | 'delete'

export type ExportFormat = 'markdown' | 'html' | 'json'

export type ExportTarget = ExportFormat | 'print'

export const emptyContent: DocJson = { schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph' }] } }
