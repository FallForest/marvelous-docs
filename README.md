# Marvelous Docs

Self-hosted collaborative cloud documents for small teams. The monorepo contains a React web client, a Node.js API and collaboration service, and the `mdocs` CLI.

## Local development

Requirements: Node.js 22+, pnpm 11+, and Docker Compose. Copy `.env.example` to `.env`, replace the example secrets, and install dependencies:

```powershell
pnpm install
docker compose up -d postgres
pnpm dev:server
pnpm dev:web
```

The Vite development server proxies API requests and Yjs WebSocket traffic to the local server. Open the URL printed by Vite.

## Linux deployment

Install Docker Engine and the Compose plugin. Point a DNS name at the server, copy the configuration, and replace every example secret before starting the stack:

```sh
cp .env.example .env
```

Set `DOCS_DOMAIN`, `POSTGRES_PASSWORD`, `JWT_SECRET`, `BOOTSTRAP_ADMIN_EMAIL`, and `BOOTSTRAP_ADMIN_PASSWORD` in `.env`. Use long random secrets (hex values avoid URL encoding issues in the database URL). Then start the services:

```sh
docker compose up -d --build
docker compose ps
```

For releases, set `API_IMAGE`, `WEB_IMAGE`, `APP_VERSION`, and `UPDATE_MANIFEST_URL` in `.env`. Use the stable manifest URL `https://github.com/OWNER/marvelous-docs/releases/latest/download/latest.json`. The API exposes `/api/v1/system/update-check` for authenticated clients. The recommended upgrade command is `./scripts/update.sh`; it creates a database backup, pulls the configured GHCR images, runs migrations, restarts the stack, and verifies `/healthz`.

Caddy serves HTTPS and obtains certificates for a public domain automatically. For a local-only instance, use `localhost` and open `https://localhost` (Caddy uses its local CA). The database and uploaded files live in named Docker volumes.

## Backups

Create a compressed PostgreSQL backup and archive uploaded files before moving or upgrading the server:

```sh
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > marvelous-docs.sql
docker compose cp api:/data/uploads ./uploads-backup
```

Restore the database while the application is stopped:

```sh
  docker compose stop api web
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' < marvelous-docs.sql
docker compose cp ./uploads-backup/. api:/data/uploads
docker compose up -d
```

Store backups outside the server and test restores periodically. Do not commit `.env` or backup files.

## CLI

The CLI package lives in `packages/cli`; build it with `pnpm --filter @marvelous-docs/cli build`. To use it from this checkout, run `pnpm cli -- --help` or `pnpm cli -- login --server https://docs.example.com --email you@example.com --password '...'`. It stores the token in the user config directory; do not pass credentials through shell history on shared systems. Document commands accept versioned Tiptap JSON files and `-` for standard input/output. `mdocs update` requires `--expected-version`; a concurrent write returns a conflict and must be reread before retrying.
