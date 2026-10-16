# Marvelous Docs server

Fastify REST API for the self-hosted workspace. The service applies the SQL schema on startup and requires PostgreSQL.

The service also runs a y-websocket-compatible Yjs collaboration endpoint on port `1234`. Yjs state and its Tiptap JSON projection are persisted in PostgreSQL.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET` | production | Long random signing secret; development has an insecure fallback |
| `BOOTSTRAP_ADMIN_EMAIL` | first startup | Creates the first workspace administrator |
| `BOOTSTRAP_ADMIN_PASSWORD` | first startup | Initial administrator password |
| `BOOTSTRAP_ADMIN_NAME` | no | Initial administrator display name |
| `PORT` | no | HTTP port, defaults to `3000` |
| `COLLAB_PORT` | no | y-websocket HTTP upgrade port, defaults to `1234` |
| `HOST` | no | Bind address, defaults to `0.0.0.0` |
| `CORS_ORIGIN` | no | Comma-separated allowed browser origins; defaults to any origin |
| `APP_VERSION` | no | Version returned by the update checker; defaults to `0.1.0` |
| `UPDATE_MANIFEST_URL` | no | HTTPS JSON manifest URL for checking newer releases |

Legacy `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_NAME` are also accepted for bootstrap. Bootstrap only runs when the configured email does not already exist. Set secrets through the deployment environment; do not commit them.

## API

All application routes use `/api/v1`; pass `Authorization: Bearer <token>` after login. Login returns a 12-hour JWT. Document content is JSON with `schemaVersion: 1` and a Tiptap-compatible `doc` object. Writes require `expectedVersion`; a stale version returns HTTP 409 with `VERSION_CONFLICT`.

- `POST /api/v1/auth/login` with `{ "email", "password" }`
- `POST /api/v1/auth/accept-invite` with `{ "inviteToken", "name", "password" }`
- `GET /api/v1/me`
- `POST /api/v1/invites` (workspace admin; returns a one-time token for delivery)
- `GET|POST /api/v1/documents`
- `GET|PUT /api/v1/documents/:id`
- `GET|POST /api/v1/documents/:id/comments`
- `GET /api/v1/documents/:id/versions`
- `POST /api/v1/documents/:id/versions/:versionId/restore` with `{ "expectedVersion" }`
- `GET|PUT /api/v1/documents/:id/acl` (document owner)
- `GET /healthz`
- `GET /api/v1/system/version`
- `GET /api/v1/system/update-check` (authenticated)

`POST /documents` accepts `kind: "document"` (default) or `kind: "folder"`. Folder content is always an empty versioned JSON document; only folders may be used as `parentId`. Document editing, comments, history, restore, and collaboration endpoints reject folder IDs.

## Live collaboration

Set the browser provider base URL to `wss://<host>/collab` (the provider adds `/<documentId>`). Authenticate with `?token=<JWT>` because browsers cannot set custom WebSocket headers; the endpoint also accepts `Authorization: Bearer <JWT>` from non-browser clients. Each room name must be the document UUID. The server implements y-websocket v2 binary sync and awareness messages, uses the Tiptap `default` XML fragment, and loads its initial Y.Doc by converting the stored `content.doc` through the server's StarterKit plus Underline schema.

The server checks workspace membership and document ACL before upgrading. Owners and editors can submit Yjs sync updates; viewers can receive state and publish awareness, while sync-step-2 and update messages from viewers are ignored and answered with the authoritative server state. Yjs changes are persisted after a 500 ms idle debounce as a PostgreSQL Yjs state update plus a Tiptap JSON snapshot and version-history entry. `GET /documents/:id` and version history flush any pending room changes before responding. REST content updates and version restores rebuild the `default` fragment and persist its corresponding Yjs state, so later WebSocket loads match the REST JSON. Existing room clients receive the REST change through ordinary Yjs updates.

The collaboration process is in-memory per document and intended for the single API instance in the Compose deployment. It retains empty rooms for five minutes after the last client disconnects, then evicts them; PostgreSQL remains the durable state.

Workspace members can access documents by default. Once explicit document permissions exist, only listed users and workspace admins can access that document. Admins can always read and edit workspace documents. Invite tokens expire after seven days. Email delivery is intentionally delegated to the operator: the API returns the token so it can be sent through the deployment's chosen channel.

## Local development

Install workspace dependencies with pnpm, set `DATABASE_URL` and a `JWT_SECRET` in the repository-root `.env`, then run `pnpm --filter @marvelous-docs/server dev`. Node 22 loads that root file through `--env-file`; Compose injects deployment settings directly. The schema is applied automatically at startup; `pnpm --filter @marvelous-docs/server db:migrate` can apply it separately.
