# Architecture

Marvelous Docs is a single-tenant, self-hosted document workspace. One deployment
serves one workspace with several members; documents are organised in a tree,
edited collaboratively, versioned on write, and shared through per-document ACLs.

The wire contract is [API.md](API.md). This document explains how the pieces fit
together and where to extend them. Directory ownership and the rules for where a
new file belongs are in [STRUCTURE.md](STRUCTURE.md).

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

React 18, Vite 6, Tiptap 2. `App.tsx` is the workspace shell: it owns session,
document list, and overlay state, and renders `pages/*` for route-level screens.
The editor lives in `components/editor/`, dialogs in `components/dialogs/`, and
styling in `styles/` as ordered CSS layers (see [STRUCTURE.md](STRUCTURE.md)).
Collaboration uses `@tiptap/extension-collaboration` with a `y-websocket`
provider; when `VITE_COLLAB_URL` is empty the editor still edits locally and
saves through the REST API with optimistic version checks.

The bundle is built into `apps/web/dist` and served by nginx, which also proxies
`/api` to `api:3000` and `/collab` to `api:1234`.

### API and collaboration service (`apps/server`)

A single Node.js process serves three surfaces:

| Surface | Port | Purpose |
| --- | --- | --- |
| REST | `PORT` (3000) | `/api/v1` document, comment, version, ACL, upload, and system routes; `/healthz`. |
| WebSocket | `COLLAB_PORT` (1234) | y-websocket v2 rooms for live editing. |
| Migrations | - | Applies `migrations/*.sql` at startup, idempotently. |

`index.ts` only assembles the process. REST resources live one-per-module in
`src/routes/` and are registered by `routes/index.ts`; room lifecycle and the
socket protocol live in `src/collaboration/`. A route module receives the Fastify
instance plus `RouteDeps`, so nothing in `routes/` imports `index.ts` and the
module graph stays acyclic. `test/routes.test.ts` asserts that every documented
endpoint is still registered after such a change.

Between the routes and the pure helpers sit two layers: `src/core/` (configuration,
the pool, the error envelope, password hashing, shared types) and `src/domain/`
(effective role, document JSON shapes, the route guards). The direction is
`routes → domain → core → lib`, and `test/structure.test.ts` fails the build when
an import points back up it.

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

### Update agent (`apps/updater`)

An internal-only container with the Docker socket and the compose project bound.
The API exposes `/api/v1/system/update` to workspace admins, which forwards to the
agent with `UPDATE_AGENT_TOKEN`. The agent runs the same procedure as
`scripts/deploy/update.sh`: database backup, `docker compose pull`, schema migration,
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
| `documents` | Documents and folders: `kind`, `parent_id`, `title`, Tiptap `content` JSONB, `yjs_state` bytea, `version`, `acl_restricted`, `deleted_at`, and the two generated search columns. |
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

### Full-text search

`migrations/003_full_text_search.sql` adds two stored generated `tsvector`
columns — `search_title` and `search_vector` — each with a GIN index, so the
index is maintained by PostgreSQL on every write and no application code has to
remember to update it. Search then ranks instead of scanning.

Three details are load-bearing:

- **`simple` dictionary.** One workspace holds notes in several languages, and a
  stemming dictionary silently discards every word it does not know.
- **`marvelous_cjk_tokens`.** CJK has no word boundaries and `simple` does not
  segment, so every ideograph is surrounded by a space: `写作方法` becomes four
  lexemes. `buildTsQuery` (`src/lib/search.ts`) then asks for them as a phrase
  (`'写' <-> '作'`), which is what keeps `写作` from matching `作文`.
- **`strict $.**.text`.** The extraction path is `strict` on purpose: the
  non-strict form applies `.text` at every level of a text node's ancestry and
  returned each paragraph's words once per level, tripling its `ts_rank`.

Query building and the statement live in `src/lib/search.ts`, apart from the
route, because the parsing is where the subtle failures live (an operator
character reaching `to_tsquery` unquoted, a prefix match on a single ideograph)
and it is unit-tested without a database. `test/search.test.ts` also runs the
statement against a real PostgreSQL engine (PGlite) with the project's own
migrations applied.

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
| New REST resource | Add a module in `apps/server/src/routes/`, register it in `routes/index.ts`, extend the schema in a new `migrations/NNN_*.sql`, add the route to `test/routes.test.ts`, document it in [API.md](API.md). |
| New editor node or mark | Add the Tiptap extension to `apps/web/src/lib/editor.ts` and to the server schema in `apps/server/src/lib/schema.ts`, then handle it in Markdown import/export. |
| New template | Extend `apps/server/src/lib/templates.ts`; documents accept `templateId`. |
| New web screen | Add a file under `apps/web/src/pages/` and render it from `App.tsx`. |
| New export format | Add it to `ExportTarget`; server-side formats extend `exportResponse` in `lib/markdown/export.ts`, client-side ones follow `lib/export/pdf.ts` (build from the existing `html` export rather than adding a server endpoint). |
| A new block command | Add it to the `COMMANDS` table in `components/editor/BlockHandle.tsx`; the gutter menu and any keyboard flavour read the same table. |
| New CLI command | Add a module under `packages/cli/src/commands/`, register it in `commands/index.ts`, and add a test in `packages/cli/test`. |
| Multiple API instances | Replace the in-memory room map in `apps/server/src/collaboration/rooms.ts` with a shared store (for example Redis-backed y-websocket persistence) and route by document id. |
| Object storage for uploads | Swap the local filesystem in `apps/server/src/routes/uploads.ts` for an S3-compatible client and keep `GET /uploads/:name` as a redirect. |
| Notifications or e-mail | Hook `apps/server/src/routes/auth.ts` (invite creation); tokens are already returned to the caller for delivery by the operator. |
| Audit or metrics | Extend `document_activity`; add a `/metrics` route in `routes/system.ts` reading the same pool. |
