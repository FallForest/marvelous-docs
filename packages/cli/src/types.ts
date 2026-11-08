export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Versioned Tiptap document payload stored by the API. */
export type DocJson = {
  schemaVersion: 1;
  doc: { type: 'doc'; content: JsonValue[] };
};

export type DocumentKind = 'document' | 'folder';

export type Document = {
  id: string;
  title: string;
  kind: DocumentKind;
  parentId: string | null;
  content: DocJson;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type User = {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
};

export type Comment = {
  id: string;
  parentId: string | null;
  body: string;
  anchor: unknown;
  status: 'open' | 'resolved';
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
  userName: string;
};

export type DocumentVersion = {
  id: string;
  version: number;
  title: string;
  content: DocJson;
  createdBy: string;
  createdAt: string;
  createdByName?: string;
};

export type Template = {
  id: string;
  name: string;
  description: string;
  content: DocJson;
};

export type Stats = {
  documents: number;
  folders: number;
  members: number;
  openComments: number;
  trashed: number;
  versions: number;
};

export type ActivityEntry = {
  id: string;
  userId: string;
  userName: string;
  action: 'view' | 'edit' | 'restore' | string;
  createdAt: string;
};

export type SearchResult = {
  id: string;
  title: string;
  kind: DocumentKind;
  parentId: string | null;
  version: number;
  updatedAt: string;
  titleMatch?: number;
  snippet?: string | null;
};

export type ExportPayload = {
  documentId: string;
  format: 'markdown' | 'html' | 'json';
  filename: string;
  content: string;
};

export type UploadFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  uploadedBy: string;
};

export type Invite = {
  id: string;
  email: string;
  role: 'admin' | 'member';
  expiresAt: string;
  token: string;
};

export type AclPermission = {
  userId: string;
  email: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
};

export type AclResponse = {
  restricted: boolean;
  permissions: AclPermission[];
};

export type LoginResponse = {
  token: string;
  user: User;
};
