# Architecture

Marvelous Docs is a single-tenant, self-hosted document workspace. One deployment
serves one workspace with several members; documents are organised in a tree,
edited collaboratively, versioned on write, and shared through per-document ACLs.

The wire contract is [API.md](API.md). This document explains how the pieces fit
together and where to extend them.

## Components

```
+-------------------+        +-------------------+        +---------------------+
|  apps/web         |        |  apps/server      |        |  PostgreSQL 16      |
|  React 18 + Vite  |  HTTP  |  Fastify 5        |  SQL   |  schema in          |
|  Tiptap 2 editor  | <----> |  REST /api/v1     | <----> |  apps/server/       |
|  Yjs + y-websocket|        |  y-websocket v2   |        |  migrations         |
+-------------------+        +-------------------+        +---------------------+
        |                             |                            |
        |  WebSocket /collab/<id>     |  uploads on disk           |
        +-----------------------------+  /data/uploads              |
                                                                    |
+-------------------+        +-------------------+        +--------+------------+
|  packages/cli     |        |  apps/updater     |        |  Caddy + nginx      |
|  mdocs (REST)     |        |  update agent     |        |  TLS + static files |
+-------------------+        +-------------------+        +---------------------+
```

### Web client (`apps/web`)

React 18, Vite 6, Tiptap 2. `App.tsx` holds the workspace shell: document tree,
editor, comments panel, history, templates, search, trash, favorites, admin, and
the update dialog. Collaboration uses `@tiptap/extension-collaboration` with a
`y-websocket` provider; when `VITE_COLLAB_URL` is empty the editor still edits
locally and saves through the REST API with optimistic version checks.

The bundle is built into `apps/web/dist` and served by nginx, which also proxies
`/api` to `api:3000` and `/collab` to `api:1234`.

### API and collaboration service (`apps/server`)

A single Node.js process serves three surfaces:

| Surface | Port | Purpose |
| --- | --- | --- |
| REST | `PORT` (3000) | `/api/v1` document, comment, version, ACL, upload, and system routes; `/healthz`. |
| WebSocket | `COLLAB_PORT` (1234) | y-websocket v2 rooms for live editing. |
| Migrations | - | Applies `migrations/*.sql` at startup, idempotently. |

Content is versioned Tiptap JSON (`{ schemaVersion: 1, doc }`). The server keeps a
Tiptap schema that mirrors the client extensions (StarterKit, underline, link,
text style, colour, highlight, task lists, tables) and rejects anything it cannot
represent with `400 INVALID_CONTENT`, so exports and history never contain
content the editor cannot render.

### CLI (`packages/cli`)

A dependency-free Node.js client over the REST API. It stores the server URL and
JWT under the platform config directory and maps commands to endpoints. See
[API.md](API.md#cli-mapping) for the stable mapping and
[`packages/cli/README.md`](../packages/cli/README.md) for usage.

### Update agent (`apps/updater`, `scripts/update-agent.mjs`)

An internal-only container with the Docker socket and the compose project bound.
The API exposes `/api/v1/system/update` to workspace admins, which forwards to the
agent with `UPDATE_AGENT_TOKEN`. The agent runs the same procedure as
`scripts/update.sh`: database backup, `docker compose pull`, schema migration,
service restart, and a `/healthz` check. It is not routed through Caddy.

## Data model

`apps/server/migrations/001_initial.sql` creates the schema; every statement is
idempotent so the same file can run at startup on every boot.

| Table | Purpose |
| --- | --- |
| `workspaces` | Deployment workspace (created with the bootstrap admin, name `Marvelous Docs`). |
| `users` | Accounts: unique e-mail, display name, scrypt password hash (`scrypt:<hex salt>:<hex key>`). |
| `memberships` | `(workspace_id, user_id)` with role `admin` or `member`. |
| `invites` | One-time invite tokens (hashed, 7-day expiry) plus the intended role. |
| `documents` | Documents and folders: `kind`, `parent_id`, `title`, Tiptap `content` JSONB, `yjs_state` bytea, `version`, `acl_restricted`, `deleted_at`. |
| `document_acl` | Explicit per-document roles (`owner`, `editor`, `viewer`). |
| `document_versions` | Immutable snapshots keyed by `(document_id, version)`. |
| `comments` | Threaded comments with `anchor` JSONB, `status` `open`/`resolved`, resolver, timestamps. |
| `document_favorites` | Favourites per user. |
| `document_activity` | `view`, `edit`, `restore` audit trail per user and document. |

Folders reuse `documents` with `kind = 'folder'` and an empty document body so
exports and listings stay uniform; only folders may be used as `parent_id`.
Uploads are files on disk (`UPLOAD_DIR`) with a random 32-hex prefix and are
therefore not represented in SQL.

Indexes cover the hot paths: `documents(workspace_id, updated_at DESC)` for the
tree and recent list, `documents(workspace_id, deleted_at)` for trash,
`comments(document_id, parent_id, created_at)` for threads, and
`document_activity(user_id, created_at DESC)` for recent documents.

## Request flow

1. Caddy terminates TLS and proxies to the nginx container.
2. nginx serves the SPA and forwards `/api/*` and `/collab/*` to the API service.
3. Fastify verifies the bearer JWT, resolves the workspace membership, computes
   the caller's document role, and runs the handler inside a PostgreSQL
   transaction when it mutates more than one row (content plus history plus
   activity, for example).
4. Errors use the `{ error: { code, message } }` envelope listed in
   [API.md](API.md#conventions); clients branch on `code`.

## Collaboration protocol and persistence

- Transport: y-websocket v2 binary messages (`sync`, `sync-step-1`,
  `sync-step-2`, `update`, `awareness`), one room per document UUID.
- Authentication: `?token=<jwt>` for browsers, `Authorization: Bearer <jwt>` for
  other clients. The upgrade is rejected unless the caller is a workspace member
  and holds at least viewer access to the room's document.
- Room lifetime: created on first join from the stored Tiptap JSON converted to a
  Y.Doc with the server schema; kept in memory, evicted five minutes after the
  last client disconnects. PostgreSQL is always the durable copy.
- Write path: Yjs updates are applied in memory immediately and persisted after a
  500 ms idle debounce. Persistence writes `documents.yjs_state`, the projected
  Tiptap JSON in `documents.content`, bumps `version`, and appends the previous
  state to `document_versions`.
- Read path: `GET /documents/:id` and version-history reads flush pending room
  state first, so REST readers never observe a stale document.
- Authorization: viewers receive sync step 1 and may publish awareness, but their
  sync step 2 and update messages are ignored and answered with the authoritative
  server state; editors and owners may publish updates.
- REST writes and version restores rebuild the `default` fragment and persist the
  matching Yjs state, then broadcast the change to connected clients as an
  ordinary Yjs update.

Because rooms live in process memory, the deployment runs exactly one API
instance. Horizontal scaling would need a shared persistence layer or sticky
sessions plus awareness fan-out (see Extension points).

## Conflict model

Two mechanisms coexist:

1. **Optimistic concurrency for REST writes.** `PUT /documents/:id` and version
   restore require `expectedVersion`; a mismatch returns
   `409 VERSION_CONFLICT` with the current document available through a fresh
   `GET`. Clients must re-read and re-apply. This protects scripted and CLI
   writers from silently overwriting concurrent edits.
2. **CRDT convergence for live editing.** Concurrent WebSocket edits merge without
   conflicts; the persisted document is the Yjs projection after quiescence, so
   two browser sessions never lose keystrokes.

Mixing both is deliberate: the collaboration layer is authoritative for content
while clients are connected, and REST remains a safe, version-checked escape
hatch for automation. A REST write during a live session is broadcast to the room,
so connected editors converge on the new state.

## Security model

- **Identity**: e-mail and an scrypt password hash, then a 12-hour HS256 JWT
  signed with `JWT_SECRET`. The token is stateless, and login failures are
  throttled per client IP and per e-mail.
- **Workspace roles**: `admin` (manage members, invites, workspace stats,
  updates, every document) and `member` (documents subject to ACL).
- **Document roles**: `viewer < editor < owner`. Effective role is the maximum of
  the workspace admin override, the explicit `document_acl` row, and the default
  workspace access (`editor`) when the document is not restricted. A restricted
  document is visible only to listed users and workspace admins.
- **Invites**: one-time, hashed at rest, seven-day expiry, redeemed through
  `POST /auth/accept-invite`, which creates the account and burns the token.
- **Uploads**: allow-listed MIME types, 20 MB cap, random prefix, sanitised name;
  reads are anonymous by unguessable URL, matching typical image embedding.
- **Transport**: TLS at Caddy; the API and database ports are not published.
- **Secrets**: `JWT_SECRET`, `UPDATE_AGENT_TOKEN`, database credentials, and the
  bootstrap password come from the environment and are never logged.

Details and hardening checklist: [SECURITY.md](SECURITY.md).

## Deployment topology

```
docker compose
  caddy      :80/:443 published, TLS, proxies to web
  web        nginx, static bundle, proxies /api and /collab to api
  api        Fastify + y-websocket, uploads volume, depends on postgres healthy
  postgres   private network, postgres_data volume
  updater    private network, docker socket, compose project bind mount
```

Only Caddy publishes ports. `api` waits for the PostgreSQL health check; `caddy`
waits for `web`. Images are built from the repository root with pnpm so the
workspace lockfile is respected, and the server image ships a `pnpm deploy --prod`
output (production dependencies only).

## Extension points

| Goal | Where to start |
| --- | --- |
| New REST resource | Add routes in `apps/server/src/index.ts`, extend the schema in a new `migrations/NNN_*.sql`, document it in [API.md](API.md). |
| New editor node or mark | Add the Tiptap extension to the client schema and to the server schema in `apps/server/src/index.ts`, then handle it in Markdown import/export. |
| New template | Extend the template list returned by `GET /templates`; documents accept `templateId`. |
| New CLI command | Add a dispatch branch in `packages/cli/src/index.ts` and a test in `packages/cli/test`. |
| Multiple API instances | Replace the in-memory room map with a shared store (for example a Redis-backed y-websocket persistence) and route by document id. |
| Object storage for uploads | Swap the local filesystem in the upload handlers for an S3-compatible client and keep `GET /uploads/:name` as a redirect. |
| Notifications or e-mail | Hook the invite creation path; tokens are already returned to the caller for delivery by the operator. |
| Audit or metrics | Extend `document_activity`; add a `/metrics` route reading the same pool. |
