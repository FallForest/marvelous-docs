# Marvelous Docs

Self-hosted collaborative cloud documents for small teams. One pnpm monorepo holds the React web client, the Fastify API with its Yjs collaboration service, and the `mdocs` command line client. Everything runs on one Docker Compose stack behind Caddy, stores data in PostgreSQL, and speaks a versioned JSON API documented in [docs/API.md](docs/API.md).

## Features

- **Documents and folders** - nested tree, drag-free move by `parentId`, folders keep documents organised.
- **Real-time collaboration** - Yjs CRDT editing over the `/collab` WebSocket; the server persists Yjs state and a Tiptap JSON projection.
- **Rich Tiptap editor** - headings, lists, task lists, tables, code blocks, links, colours, highlights, underline, plus a template picker, export menu, and move dialog.
- **Command palette and workspace views** - keyboard-driven command palette, search page, activity panel, version preview, workspace statistics cards.
- **Comments** - threaded, anchored, resolvable; open/ resolved status per thread.
- **Version history** - every REST write, version restore, and persisted collaboration snapshot appends a snapshot; restore with optimistic concurrency.
- **Search** - case-insensitive title and content search with highlighted snippets.
- **Favorites, recent, trash** - favourite documents and folders, 50 most recently opened documents, and a trash that empties itself: delete is recoverable for `TRASH_RETENTION_DAYS` (default 30), the sweep runs at boot and every 15 minutes, and the bin can still be emptied in one click.
- **Templates** - built-in meeting notes, weekly report, project plan, product spec, release notes.
- **Markdown import and export** - import Markdown to Tiptap JSON, export Markdown, standalone HTML, or raw JSON.
- **Sharing and ACL** - workspace roles (`admin`, `member`) plus per-document `owner`/`editor`/`viewer` ACL with restriction per document.
- **Admin and updates** - invite-based onboarding, workspace statistics, in-app update check and one-click update through the internal update agent.
- **CLI** - `mdocs` covers documents, folders, templates, import/export, comments, versions, sharing, favorites, trash, search, activity, workspace stats, members, invites, uploads, and shell completion; the full command reference is [packages/cli/README.md](packages/cli/README.md).

## Architecture

```
                        Internet
                           |
                    +------+-------+
                    |    Caddy     |  TLS termination, automatic certificates
                    |  :80 / :443  |
                    +------+-------+
                           |
                    +------+-------+
                    |    nginx     |  static web bundle (apps/web/dist)
                    |     :80      |  proxies /api -> api:3000, /collab -> api:1234
                    +------+-------+
                           |
        +------------------+------------------+
        |                                    |
+-------+-------+                    +-------+--------+
|  api          |                    |   postgres     |
|  Fastify :3000|  <---+             |   :5432        |
|  y-websocket  |      |             |  documents,    |
|  :1234        |      |             |  versions,     |
+-------+-------+      |             |  comments, acl |
        |              |             +----------------+
        |              |
        |        +-----+----------------+
        |        | /data/uploads volume |
        |        +----------------------+
        |
+-------+----------------+
|  updater :8080         |  internal only, docker socket + compose project
|  update.sh equivalent  |
+------------------------+
```

The browser talks to the API through nginx on the same origin, so no CORS
configuration is required for the bundled client. Browsers authenticate the
WebSocket with `?token=<jwt>` because WebSocket handshakes cannot carry a
custom header.

## Quick start (development)

Requirements: Node.js 22+, pnpm 11+, Docker Compose.

```sh
git clone <repository-url> && cd marvelous-docs
corepack enable            # or: npm i -g pnpm@11
pnpm install
cp .env.example .env       # fill in the required secrets
docker compose up -d postgres
pnpm dev                   # API on :3000/:1234 and Vite on :5173 in parallel
```

Set at least `DATABASE_URL`, `JWT_SECRET`, `BOOTSTRAP_ADMIN_EMAIL`, and
`BOOTSTRAP_ADMIN_PASSWORD` in `.env` before the first start; the schema is
applied automatically and the bootstrap administrator is created once. Vite
proxies `/api` and `/collab` to the local API, so open the URL it prints and
sign in with the bootstrap account.

Prefer separate terminals? `pnpm dev:server` and `pnpm dev:web` do the same
thing without `--parallel`. Details and troubleshooting: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Production deployment

```sh
cp .env.example .env       # DOCS_DOMAIN, POSTGRES_PASSWORD, JWT_SECRET, admin, UPDATE_AGENT_TOKEN
docker compose up -d --build
docker compose ps
```

Caddy obtains a certificate for `DOCS_DOMAIN` (use `localhost` for a local
instance and its local CA). Database rows live in the `postgres_data` volume and
uploads in `uploads_data`. To run released images instead of local builds, set
`API_IMAGE`/`WEB_IMAGE`/`APP_VERSION` and use `docker compose pull && docker compose up -d`.
The internal `updater` service performs the same backup, pull, migration,
restart, and `/healthz` verification as `scripts/deploy/update.sh`; it is never
exposed through Caddy.

Full guide - TLS, updates, upgrades, rollback, observability: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## CLI quick start

```sh
pnpm --filter @marvelous-docs/cli build
pnpm cli -- login --server https://docs.example.com --email you@example.com
pnpm cli -- whoami
pnpm cli -- tree
pnpm cli -- create --title "Weekly report" --template weekly-report
pnpm cli -- import notes.md --parent <folder-id>
pnpm cli -- search "quarterly" --scope all
pnpm cli -- update <document-id> --expected-version 3 --input doc.json
pnpm cli -- export <document-id> --format markdown --output notes.md
pnpm cli -- comments add <document-id> --body "Can we split this section?"
pnpm cli -- versions list <document-id>
pnpm cli -- share grant <document-id> --user <member-id> --role viewer
pnpm cli -- trash <document-id>
```

The token is stored in the platform config directory (`%APPDATA%\mdocs` on
Windows, `~/.config/mdocs` elsewhere); `MDOCS_SERVER`, `MDOCS_TOKEN`,
`MDOCS_PASSWORD`, `MDOCS_PROFILE`, and `MDOCS_CONFIG_DIR` override it in
automation. `mdocs --help` lists every command; the reference lives in
[packages/cli/README.md](packages/cli/README.md) and the endpoint mapping in
[docs/API.md](docs/API.md#cli-mapping).

## Testing and linting

```sh
pnpm lint        # eslint . (flat config, whole monorepo)
pnpm lint:fix    # same, with --fix
pnpm typecheck   # pnpm -r typecheck (tsc per package, no bundles)
pnpm test        # pnpm -r test (node:test suites in every package)
pnpm test:server # server unit tests only
pnpm test:web    # web helper tests only
pnpm test:cli    # CLI tests only
pnpm build       # type-check and bundle every package
pnpm clean       # remove dist output and tsbuildinfo files
```

CI runs exactly these steps on every push and pull request
(`.github/workflows/ci.yml`).

## Repository layout

```
apps/
  server/          Fastify API, Yjs collaboration server, SQL migrations, Dockerfile
                   src/core (config, pool, http, security) + src/domain (rules) + src/routes
  web/             React + Vite + Tiptap client, nginx config, Dockerfile
  updater/         Internal update agent: Dockerfile + update-agent.mjs
packages/
  cli/             mdocs command line client (published package)
docs/
  API.md           authoritative HTTP + WebSocket API contract
  ARCHITECTURE.md  components, data model, collaboration, security, deployment
  STRUCTURE.md     directory map and the rule for where a new file belongs
  DEVELOPMENT.md   local setup, conventions, migrations, debugging
  DEPLOYMENT.md    compose, TLS, updates, backup/restore, upgrades, observability
  SECURITY.md      authentication, ACL, uploads, rate limits, hardening
scripts/
  deploy/          backup.sh, restore.sh, update.sh — host-side operations
  release/         publish-images.sh — build/push the release images
  verify/          verify-pdf.mjs, verify-blocks.mjs, verify-trash.mjs — real-browser checks
release/
  latest.json      committed release manifest served to the update agent
Caddyfile          reverse proxy and TLS for the compose stack
docker-compose.yml postgres, api, updater, web, caddy
```

## Backups and restore

```sh
./scripts/deploy/backup.sh                           # pg_dump + uploads archive into ./backups
./scripts/deploy/restore.sh backups/<dump>.sql [uploads.tar.gz]
```

The scripts wrap the documented commands; both are POSIX `sh` and safe to call
from cron. Without them:

```sh
docker compose exec -T postgres sh -c 'pg_dump --clean --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB"' > marvelous-docs.sql
docker compose cp api:/data/uploads ./uploads-backup
```

Restore while the application is stopped, then start it again and verify
`/healthz`. Keep copies off the server and test a restore periodically. Never
commit `.env` or backup files - both are ignored by git.

## Documentation

- [docs/API.md](docs/API.md) - HTTP and WebSocket contract (authoritative)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - components, data model, conflict model, extension points
- [docs/STRUCTURE.md](docs/STRUCTURE.md) - directory map and the rules for where a new file belongs
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - prerequisites, scripts, conventions, migrations, debugging
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) - production, TLS, updates, backup, upgrades
- [docs/SECURITY.md](docs/SECURITY.md) - auth, roles, uploads, rate limiting, hardening
- [CONTRIBUTING.md](CONTRIBUTING.md) - workflow, commit style, checks
- [CHANGELOG.md](CHANGELOG.md) - release notes
- [packages/cli/README.md](packages/cli/README.md) - CLI reference

## License

Proprietary, all rights reserved unless the repository states otherwise.