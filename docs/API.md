# Marvelous Docs API

The HTTP API is versioned under `/api/v1`. Requests and responses use JSON unless noted. All timestamps are ISO-8601 strings in UTC; all identifiers are UUIDs.

## Conventions

- **Base URL**: `https://<host>/api/v1`. The Vite development proxy and the production nginx container forward `/api` to the API service.
- **Authentication**: `Authorization: Bearer <jwt>`. Tokens are issued by `POST /auth/login` or `POST /auth/accept-invite` and expire after 12 hours.
- **Content type**: send `Content-Type: application/json` for JSON bodies. Uploads use the raw file body with a supported `Content-Type`.
- **Optimistic concurrency**: `PUT /documents/:id` and version restore require `expectedVersion` and return `409 VERSION_CONFLICT` when the stored version moved on.
- **Errors**: every failure returns a JSON envelope; clients must branch on `error.code`, not on the message text.

```json
{ "error": { "code": "FORBIDDEN", "message": "You do not have permission for this operation." } }
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | Request body or query failed validation. |
| 400 | `INVALID_ID` | A path or request identifier is not a UUID. |
| 400 | `INVALID_CONTENT` | Tiptap JSON does not match the server editor schema, or content was sent to a folder. |
| 400 | `INVALID_PARENT` | The requested parent is not a folder, is the node itself, or is one of its descendants. |
| 404 | `NOT_A_DOCUMENT` | The operation requires a document but the id points at a folder. |
| 401 | `UNAUTHENTICATED` | Missing, invalid, or expired bearer token. |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password. |
| 403 | `FORBIDDEN` | Authenticated but lacking the required document or workspace role. |
| 403 | `ADMIN_REQUIRED` | Workspace administrator role required. |
| 404 | `NOT_FOUND` | Document, folder, version, comment, or upload not found. |
| 404 | `INVITE_INVALID` | Invite token is unknown or expired. |
| 409 | `VERSION_CONFLICT` | `expectedVersion` does not match the current version. |
| 409 | `ACCOUNT_EXISTS` | The invite email already has an account. |
| 413 | `FILE_TOO_LARGE` | Upload exceeds 20 MB. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Upload type is not allowed. |
| 429 | `RATE_LIMITED` | Too many failed login attempts; retry after the `Retry-After` header. |
| 503 | `DATABASE_UNAVAILABLE` | Health check could not reach PostgreSQL. |
| 503 | `UPDATER_UNAVAILABLE` | The update agent is not configured or unreachable. |

Document content is versioned Tiptap JSON:

```json
{ "schemaVersion": 1, "doc": { "type": "doc", "content": [{ "type": "paragraph" }] } }
```

The server schema matches the web editor: StarterKit (headings, lists, blockquote, code block, horizontal rule, hard break, bold, italic, strike, code), underline, link, text style, color, highlight, task lists, and tables. Content that the schema cannot represent is rejected with `400 INVALID_CONTENT`.

### Roles

Document access is the highest of:

- workspace `admin` → `owner` for every document in the workspace;
- explicit document ACL (`owner`, `editor`, `viewer`), which takes precedence over the default;
- default workspace access (`editor` when the document is not restricted and the user is a member).

Ranking: `viewer < editor < owner`. A restricted document is visible only to listed users and workspace admins. Folders have no content, comments, history, or collaboration endpoints; only folders can be a `parentId`.

## Authentication and workspace

### `POST /auth/login`

```json
{ "email": "admin@example.com", "password": "..." }
```

`200` → `{ "token": "<jwt>", "user": { "id", "email", "name", "role" } }`. Ten failed attempts per IP within 15 minutes trigger `429 RATE_LIMITED` with `Retry-After` seconds.

### `POST /auth/accept-invite`

```json
{ "inviteToken": "<one-time token>", "name": "Ada", "password": "at-least-12-chars" }
```

`200` → `{ "token": "<jwt>", "user": { ... } }`. Creates the account and workspace membership, then burns the invite.

### `GET /me`

`200` → `{ "user": { "id", "email", "name", "role" } }` for the active workspace.

### `GET /workspace/members`

`200` → `{ "members": [{ "id", "email", "name", "role" }] }`.

### `GET /workspace/stats`

`200` →

```json
{ "stats": { "documents": 12, "folders": 3, "members": 4, "openComments": 5, "trashed": 1, "versions": 42 } }
```

### `POST /invites`

Workspace administrators only.

```json
{ "email": "new@example.com", "role": "member" }
```

`201` → `{ "invite": { "id", "email", "role", "expiresAt", "token" } }`. The API returns the one-time token; delivery is up to the operator. Tokens expire after seven days.

## Documents

### `GET /documents`

Returns every document and folder visible to the caller, newest first.

`200` → `{ "documents": [Document] }`.

```ts
type Document = {
  id: string
  title: string
  kind: 'document' | 'folder'
  parentId: string | null
  content: { schemaVersion: 1; doc: Record<string, unknown> }
  version: number
  createdBy: string
  updatedBy: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}
```

### `POST /documents`

```json
{
  "title": "Quarterly plan",
  "kind": "document",
  "parentId": null,
  "content": { "schemaVersion": 1, "doc": { "type": "doc", "content": [] } }
}
```

Provide either `content` or `templateId` (never both) for documents. `title` is required unless `templateId` is supplied, in which case it defaults to the template name. `kind` defaults to `document`. Folders must not send `content` or `templateId`; the server stores an empty document so folder exports are deterministic. `201` → `{ "document": Document }`.

### `POST /documents/import`

```json
{ "format": "markdown", "title": "Optional title", "parentId": null, "markdown": "# Heading\n\nBody" }
```

Converts Markdown (headings, paragraphs, emphasis, links, lists, task lists, blockquotes, fenced and indented code, tables, horizontal rules, images as link text) into Tiptap JSON and creates the document. When `title` is omitted the first level-one heading is used, falling back to `Imported document`. `markdown` is limited to 2 MB. `201` → `{ "document": Document }`.

### `GET /documents/:id`

Flushes pending collaboration state, records a `view` activity entry, and returns `200 { "document": Document }`.

### `PUT /documents/:id`

Editors and owners only.

```json
{ "title": "New title", "parentId": null, "content": { "schemaVersion": 1, "doc": {} }, "expectedVersion": 3 }
```

At least one of `title`, `parentId`, `content` is required. The previous state is appended to version history. Returns `200 { "document": Document }`, or `409 VERSION_CONFLICT`.

Folders accept `title` and `parentId` (rename and move), reject `content` with `400 INVALID_CONTENT`, and cannot be moved into themselves or a descendant (`400 INVALID_PARENT`).

### `DELETE /documents/:id`

Owners only. Moves the document to the trash. Trashing a folder also trashes every descendant. `200 { "ok": true }`.

### `POST /documents/:id/restore`

Restores a trashed document or folder. Allowed for document owners, editors, and workspace administrators. Restoring a folder also restores every descendant that is currently in the trash. `200 { "ok": true }`. Untrashed nodes return `404`.

### `DELETE /documents/:id/permanent`

Permanently deletes a trashed document or folder subtree. Owners and workspace administrators only. `200 { "ok": true }`.

### `POST /documents/:id/duplicate`

```json
{ "title": "Optional copy title", "parentId": null }
```

Copies the document content, title (default `"<title> (copy)"`), and parent. Requires viewer access to the source. `201 { "document": Document }`. Folders cannot be duplicated (`400 NOT_A_DOCUMENT`).

### `PUT /documents/:id/favorite`

`{ "favorite": true }` → `200 { "favorite": true }`. Works for documents and folders.

### `GET /documents/search?q=...&scope=all|title|content&limit=20`

Case-insensitive title and content search. `limit` is 1–100 (default 20). `200` →

```json
{
  "results": [
    { "id": "...", "title": "...", "kind": "document", "parentId": null, "version": 4, "updatedAt": "...", "titleMatch": 1, "snippet": "..." }
  ]
}
```

`snippet` is a plain-text excerpt centred on the first content match (generated by the API from the Tiptap document, so no highlighting markup or JSON fragments leak into the UI). Collapse whitespace before rendering.

### `GET /documents/trash`, `GET /documents/recent`, `GET /documents/favorites`

`200 { "documents": [Document] }`. Recent returns the 50 documents the caller opened most recently.

### `GET /documents/:id/export?format=markdown|html|json`

Viewer access. `200` →

```json
{ "documentId": "...", "format": "markdown", "filename": "quarterly-plan.md", "content": "# Quarterly plan\n" }
```

- `markdown` (default): CommonMark-flavoured output with ATX headings, `-` bullets, `1.` ordered lists, fenced code, pipe tables, and `[text](url)` links.
- `html`: a complete, escaped HTML document suitable for printing or pasting.
- `json`: pretty-printed Tiptap JSON as a string.

`filename` is a slug of the title plus `.md`, `.html`, or `.json`.

### `GET /documents/:id/activity?limit=20`

Viewer access. `limit` is 1–100. `200` →

```json
{ "activity": [{ "id": "...", "userId": "...", "userName": "Ada", "action": "view", "createdAt": "..." }] }
```

Actions: `view`, `edit`, `restore`.

### `GET|PUT /documents/:id/acl`

Owners only. GET → `{ "restricted": true, "permissions": [{ "userId", "email", "name", "role" }] }`. PUT with `{ "userId", "role": "owner"|"editor"|"viewer"|null, "restricted"?: boolean }`; `role: null` removes the explicit entry. Setting or removing a role turns on `restricted` unless `restricted` is supplied. Owners cannot remove their own owner role.

## Comments

- `GET /documents/:id/comments` → `{ "comments": [Comment] }`.
- `POST /documents/:id/comments` with `{ "body", "anchor"?: unknown, "parentId"?: uuid }` → `201 { "comment": Comment }`.
- `PATCH /documents/:id/comments/:commentId` with `{ "body"?: string, "status"?: "open"|"resolved" }` → `{ "comment": Comment }`. Authors and workspace admins can update.

```ts
type Comment = {
  id: string; parentId: string | null; body: string; anchor: unknown
  status: 'open' | 'resolved'; resolvedAt: string | null; resolvedBy: string | null
  createdAt: string; updatedAt: string; userId: string; userName: string
}
```

## Versions

Every REST content update, version restore, and persisted collaboration edit appends the pre-change snapshot to history.

- `GET /documents/:id/versions` → `{ "versions": [{ "id", "version", "title", "content", "createdBy", "createdAt" }] }` (newest first).
- `GET /documents/:id/versions/:versionId` → `{ "version": { ... , "createdByName" } }`.
- `POST /documents/:id/versions/:versionId/restore` with `{ "expectedVersion" }` → `200 { "document": Document }`; `409 VERSION_CONFLICT` when the document moved on.

## Templates

### `GET /templates`

`200` → `{ "templates": [{ "id", "name", "description", "content" }] }`. Built-in IDs:

| ID | Purpose |
| --- | --- |
| `blank` | Empty document. |
| `meeting-notes` | Agenda, decisions, action items. |
| `weekly-report` | Weekly summary with metrics and risks. |
| `project-plan` | Goals, milestones, owners, risks. |
| `product-spec` | Problem, users, scope, success metrics. |
| `release-notes` | Highlights, fixes, upgrade notes. |

`POST /documents` accepts `templateId` instead of `content`.

## Uploads

- `PUT /uploads` — raw body, `Content-Type` one of `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `application/pdf`, or `application/octet-stream`; optional `X-File-Name`. Max 20 MB. `201` → `{ "file": { "id", "name", "mimeType", "size", "url", "uploadedBy" } }`.
- `GET /uploads/:filename` — anonymous read of an uploaded file (unguessable 32-hex prefix plus the sanitized name).

## System

- `GET /healthz` — `{ "status": "ok" } ` or `503 DATABASE_UNAVAILABLE`.
- `GET /system/version` — `{ "version": "0.1.27" }`.
- `GET /system/update-check` (authenticated) — `{ "currentVersion", "latestVersion", "updateAvailable", "manifest" }`.
- `POST /system/update` (workspace administrator) — starts the update agent; `202`.
- `GET /system/update-status` (workspace administrator) — `{ "update": { "status", "startedAt", "finishedAt", "output", "error" } }`.

## Collaboration WebSocket

The API process also listens on `COLLAB_PORT` (default `1234`) for y-websocket v2 clients:

```
wss://<host>/collab/<documentId>?token=<jwt>
```

Non-browser clients may send `Authorization: Bearer <jwt>` instead. The room name must be the document UUID. The document is loaded from its stored Tiptap JSON, and the server persists Yjs state and a Tiptap JSON snapshot 500 ms after edits go idle. Viewers receive state, may publish awareness, and have sync-step-2/update messages ignored. The REST API and the collaboration layer share the same PostgreSQL row; GET and version history flush pending room state first.

## CLI mapping

The `mdocs` CLI is a thin client over this API. Stable mappings:

| CLI | API |
| --- | --- |
| `mdocs login` | `POST /auth/login` |
| `mdocs whoami` | `GET /me` |
| `mdocs list` / `tree` / `search` | `GET /documents`, `/documents/search` |
| `mdocs create --template` | `GET /templates`, `POST /documents` |
| `mdocs import` | `POST /documents/import` |
| `mdocs export --format` | `GET /documents/:id/export` |
| `mdocs versions`, `comments`, `share`, `activity`, `stats` | matching API routes |
| `mdocs trash` / `restore` / `purge` | `DELETE /documents/:id`, `POST /documents/:id/restore`, `DELETE /documents/:id/permanent` |

Any endpoint not listed above is internal and may change without notice.