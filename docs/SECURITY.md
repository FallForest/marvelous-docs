# Security

Marvelous Docs is a single-tenant, self-hosted deployment: one workspace, a small
known member list, and an operator who controls the host. The model below assumes
you run the Compose stack as documented in [DEPLOYMENT.md](DEPLOYMENT.md).

## Authentication

- Passwords are hashed with scrypt (`node:crypto`, 64-byte key) and stored as
  `scrypt:<hex salt>:<hex key>`; the hash never leaves the server and is excluded
  from every response. Verification recomputes the key for the stored salt and
  compares it in constant time.
- `POST /api/v1/auth/login` returns a 12-hour HS256 JWT signed with `JWT_SECRET`.
  Claims: `sub` (user id), `email`, `workspaceId`.
- Clients send `Authorization: Bearer <jwt>`. Browsers authenticate the
  collaboration WebSocket with `?token=<jwt>` because a WebSocket handshake
  cannot set a custom header.
- The JWT is not a session record: nothing is revoked server-side, so a token
  stays valid until it expires. Rotate `JWT_SECRET` to invalidate every token at
  once (that signs everyone out).
- Invites are one-time tokens: 24+ character random strings, stored as SHA-256
  hashes, valid for seven days, burned inside the same transaction that creates
  the account. `POST /auth/accept-invite` requires a password of at least 12
  characters. The e-mail cannot already have an account (`409 ACCOUNT_EXISTS`).
- The token is stateless: Fastify verifies the signature and claims without a
  database round trip, so deleting a user does not invalidate an issued token by
  itself. Authorization queries (document access, listings, admin checks) join
  `memberships`, which means removing a member takes effect on their next
  authorized query while the token's identity claims remain valid until expiry.

## Roles and ACL

Workspace roles:

| Role | Capabilities |
| --- | --- |
| `admin` | Manage members, invites, workspace statistics, update check and update trigger; owner-level access to every document. |
| `member` | Access documents according to document ACL and defaults. |

Document roles (`document_acl`):

| Role | Capabilities |
| --- | --- |
| `viewer` | Read content, export, activity, comments read; receives Yjs state and may publish awareness, but sync updates are ignored. |
| `editor` | Viewer plus content writes, comments, and collaboration updates. |
| `owner` | Editor plus delete, permanent delete, duplication decisions, and ACL management. |

Effective role is the workspace admin override (`owner`), otherwise the explicit
ACL row when present, otherwise the default (`editor` for workspace members when
the document is not restricted). An explicit `viewer` therefore stays read-only
even on an unrestricted document. Setting or removing an ACL entry turns on `restricted`, after which
only listed users and workspace admins can see the document. Owners cannot
remove their own owner role, which prevents an orphaned document.

Folders carry no content, comments, versions, or collaboration endpoints; only
folders may be a `parentId`. Endpoints that mutate content reject folder ids.

## Uploads

- `PUT /api/v1/uploads` accepts a raw body with an allow-listed `Content-Type`:
  `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `application/pdf`,
  `application/octet-stream`.
- Maximum size is 20 MB, enforced after reading the body (Fastify's own body limit
  is higher, so the API returns `413 FILE_TOO_LARGE` deliberately).
- File names are sanitised and prefixed with 32 random hex characters, so the
  URL cannot be guessed and cannot overwrite another upload.
- Files are written to `UPLOAD_DIR` (a Docker volume) and are **not** executed or
  parsed by the server. `GET /uploads/:filename` is anonymous by design: the
  unguessable name is the capability, which is what makes embedded images work in
  exported documents. Treat the uploads volume as public content.

## Rate limiting and abuse

`POST /api/v1/auth/login` is throttled by an in-process sliding-window limiter
(`apps/server/src/lib/rate-limit.ts`): ten failed attempts per bucket inside a
fifteen-minute window block further attempts with `429 RATE_LIMITED` and a
`Retry-After` header in seconds. Both the client IP (`ip:<address>`) and the
lower-cased e-mail (`email:<address>`) are tracked as separate buckets, so one
attacker cannot lock out an account from a different address, and rotating
e-mails does not bypass the IP bucket. A successful login clears both buckets,
and the limiter caps its bucket map at 5000 entries and sweeps expired windows
periodically.

Because the limiter is per process, a multi-instance deployment would need a
shared store. Keep a second line of defence at the edge, for example in Caddy:

```
rate_limit {
    zone login {
        key {remote_host}
        events 20
        window 1m
    }
}
```

Uploads and document writes are bounded by the 20 MB and body-limit checks; the
workspace member list is the real authorization boundary, so keep it small and
review it (`GET /api/v1/workspace/members`).

## Secrets

| Secret | Where | Notes |
| --- | --- | --- |
| `JWT_SECRET` | `.env` | 32+ random bytes; rotating signs everyone out. |
| `POSTGRES_PASSWORD` | `.env` | Hex keeps `DATABASE_URL` free of escaping problems. |
| `BOOTSTRAP_ADMIN_PASSWORD` | `.env` | Only needed for the first start; remove it afterwards. |
| `UPDATE_AGENT_TOKEN` | `.env` | Shared secret between API and updater; random, never reused. |

`.env` is git-ignored (only `.env.example` is tracked). Generate values with
`openssl rand -hex 32`, keep the file `chmod 600`, and never put secrets in
images, compose files, or the repository. `.dockerignore` keeps `.env*` out of
build contexts.

## Hardening checklist

- [ ] Only Caddy publishes ports; `api` (3000/1234), `postgres` (5432), and
      `updater` (8080) stay on the private network.
- [ ] `JWT_SECRET`, `POSTGRES_PASSWORD`, and `UPDATE_AGENT_TOKEN` are unique random
      values, not the examples.
- [ ] `BOOTSTRAP_ADMIN_*` removed from `.env` after the first successful login.
- [ ] TLS enabled with a real certificate; HTTP redirects to HTTPS (Caddy default).
- [ ] `CORS_ORIGIN` left empty for same-origin deployments, or pinned to the exact
      front-end origin.
- [ ] Docker socket access limited to the `updater` service; the updater is never
      exposed through the proxy.
- [ ] Backups encrypted, stored off-host, and access-controlled (they contain
      password hashes and document content).
- [ ] Host patched, Docker and PostgreSQL images updated, Compose stack restarted
      after image updates.
- [ ] `/healthz` monitored; failures alert the operator.
- [ ] Uploads volume treated as public content and excluded from public backups
      if documents are confidential.
- [ ] Member list reviewed; former members removed (membership removal takes
      effect on their next request).

## Threat notes

- **Stolen JWT**: valid up to 12 hours, no server-side revocation. Mitigate with
  HTTPS everywhere, short-lived deployment sessions, and `JWT_SECRET` rotation.
- **Guessable upload URLs**: prevented by 32 random hex characters; do not shorten
  file names or proxy uploads through a directory listing.
- **Permission bugs**: the ACL is computed per request from SQL; when adding an
  endpoint, always resolve the role first and branch on the ranking
  `viewer < editor < owner`.
- **Update agent**: holds the Docker socket, so its token is effectively host
  root. Keep it internal, rotate the token, and audit `/api/v1/system/update-status`.

## Reporting

Report vulnerabilities privately to the maintainers of the deployment you run
(for example through the repository security advisory form) with a reproduction
and affected version from `GET /api/v1/system/version`. Do not open a public
issue for an unfixed vulnerability, and do not test against instances you do not
own.