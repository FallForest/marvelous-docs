# Deployment

Marvelous Docs runs as one Docker Compose stack: Caddy for TLS, nginx for the
static client, the API/collaboration process, PostgreSQL 16, and an internal
update agent. This guide covers a single-server production install, configuration
reference, TLS, updates, backup/restore, upgrades and rollback, and observability.

## Prerequisites

- Linux host (x86-64 or arm64) with Docker Engine 24+ and the Compose plugin.
- 2 vCPU, 2 GB RAM, and disk for the database plus uploads.
- A DNS `A`/`AAAA` record pointing at the host (needed for automatic TLS).
- Ports 80 and 443 reachable from the internet.

## Install

```sh
git clone <repository-url> /srv/marvelous-docs
cd /srv/marvelous-docs
cp .env.example .env
${EDITOR:-vi} .env
docker compose up -d --build
docker compose ps
```

Fill in every required value first: `DOCS_DOMAIN`, `POSTGRES_PASSWORD`,
`JWT_SECRET`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`,
`UPDATE_AGENT_TOKEN`. Generate secrets with `openssl rand -hex 32` (hex avoids URL
escaping inside `DATABASE_URL`).

Verify:

```sh
curl -fsS "https://$DOCS_DOMAIN/api/v1/system/version"
curl -fsS "https://$DOCS_DOMAIN/healthz"
docker compose logs --tail=50 api
```

Then open `https://$DOCS_DOMAIN` and sign in with the bootstrap account. Rotate
`BOOTSTRAP_ADMIN_PASSWORD` out of `.env` once the account exists; the bootstrap
block only runs when the e-mail is unknown.

## Configuration reference

| Variable | Required | Purpose |
| --- | --- | --- |
| `DOCS_DOMAIN` | yes | Host Caddy serves and requests a certificate for (`localhost` for a local instance). |
| `POSTGRES_DB`, `POSTGRES_USER` | yes | Database and role created on first start. |
| `POSTGRES_PASSWORD` | yes | Password for `POSTGRES_USER`; also interpolated into the API's `DATABASE_URL`. |
| `DATABASE_URL` | host tooling | Only used by processes outside Compose (`pnpm dev:server`, psql scripts). |
| `JWT_SECRET` | yes | HS256 signing key for 12-hour access tokens. Changing it signs everyone out. |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` / `BOOTSTRAP_ADMIN_NAME` | first start | First workspace administrator. |
| `CORS_ORIGIN` | no | Comma-separated allowed browser origins. Empty means same-origin only, which is correct for the bundled client. |
| `COLLAB_PORT` | no | Container port for y-websocket (default 1234). |
| `UPLOAD_DIR` | no | Upload directory inside the API container (default `/data/uploads`, a volume). |
| `APP_VERSION` | no | Version reported by `GET /api/v1/system/version`; keep equal to the image tag. |
| `TRASH_RETENTION_DAYS` | no | Days a deleted document stays recoverable (default `30`, clamped to 1–365). The bin is swept at boot and every 15 minutes. `0` is treated as `1`, not "keep forever". |
| `UPDATE_MANIFEST_URL` | no | HTTPS URL of `latest.json`; empty disables update checks. |
| `UPDATE_AGENT_URL`, `UPDATE_AGENT_TOKEN` | with updates | Internal agent address (`http://updater:8080`) and its shared secret. |
| `API_IMAGE`, `WEB_IMAGE` | no | Image names; set released tags to pull instead of building. |
| `VITE_COLLAB_URL` | no | WebSocket base URL baked into the bundle when the client is not served from the API origin. |
| `COMPOSE_FILE` | no | Compose file used by the update agent and scripts (default `docker-compose.yml`). |

`.env` is git-ignored; keep it `chmod 600` and owned by the deploy user.

## Services and networking

```
caddy     :80, :443 published -> web:80
web       static bundle, /api -> api:3000, /collab -> api:1234
api       :3000 REST, :1234 WebSocket, /data/uploads volume, waits for postgres healthy
postgres  private, /var/lib/postgresql/data volume
updater   private, /var/run/docker.sock and the project directory
```

Only Caddy publishes ports. Never publish `api` (3000/1234), `postgres` (5432), or
`updater` (8080): the collaboration port trusts JWTs, and the updater controls the
Docker socket.

The images are built from the repository root because the pnpm workspace and
`pnpm-lock.yaml` are required. The server image runs `pnpm deploy --prod --legacy`
(`--legacy` because the workspace does not set `inject-workspace-packages`), so the
runtime layer contains production dependencies only:

```sh
docker build -f apps/server/Dockerfile -t marvelous-docs-api:local .
docker build -f apps/web/Dockerfile --build-arg VITE_COLLAB_URL= -t marvelous-docs-web:local .
```

## TLS

Caddy reads `Caddyfile` and obtains a Let's Encrypt certificate for
`DOCS_DOMAIN` automatically once DNS resolves and ports 80/443 are open. Use
`DOCS_DOMAIN=localhost` for a private instance; Caddy then issues a certificate
from its local CA (import `caddy_data`'s root certificate or accept the browser
warning).

Behind an existing load balancer, point it at Caddy, keep the WebSocket path
`/collab` intact, and set `CORS_ORIGIN` only if the browser origin differs from
`DOCS_DOMAIN`.

## Updates

Two supported paths, both ending in the same verification:

**In-app update (recommended).** Set `UPDATE_MANIFEST_URL` to the stable release
manifest, for example
`https://github.com/OWNER/marvelous-docs/releases/latest/download/latest.json`, and
a random `UPDATE_AGENT_TOKEN`. A workspace administrator then sees the version and
can start the update. The `updater` container backs up the database, runs
`docker compose pull`, applies migrations, restarts `api`/`web`/`caddy`, and polls
`/healthz`.

**Manual update from the host.**

```sh
./scripts/backup.sh
./scripts/update.sh            # backup, pull, migrate, restart, health check
```

`scripts/update.sh` honours `COMPOSE_FILE` and `BACKUP_DIR`. If the health check
fails it exits non-zero, prints the dump path, and you roll back the image tags.

The release workflow publishes multi-arch images
(`ghcr.io/<owner>/marvelous-docs-api`, `...-web`) tagged with the version and
`latest`, plus `latest.json` with `version`, `releaseUrl`, `apiImage`, and
`webImage`.

## Backup and restore

```sh
./scripts/backup.sh
# -> ./backups/marvelous-docs-<timestamp>.sql
# -> ./backups/uploads-<timestamp>.tar.gz

./scripts/restore.sh backups/marvelous-docs-<timestamp>.sql backups/uploads-<timestamp>.tar.gz
```

`backup.sh` dumps with `pg_dump --clean --if-exists` and archives the uploads
volume through a throwaway Alpine container (falling back to
`docker compose cp api:/data/uploads`). `restore.sh` stops `api` and `web`, applies
the dump with `psql -v ON_ERROR_STOP=1`, extracts the uploads archive, restarts
the stack, and waits for `/healthz`.

Without the scripts:

```sh
docker compose exec -T postgres sh -c 'pg_dump --clean --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB"' > dump.sql
docker compose cp api:/data/uploads ./uploads-backup
docker compose stop api web
docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"' < dump.sql
docker compose cp ./uploads-backup/. api:/data/uploads
docker compose up -d api web
```

Schedule backups with cron, copy them off the host (`rclone`, object storage),
and rehearse a restore on a spare instance. Backups contain password hashes and
document content: encrypt at rest and restrict access.

## Upgrade and rollback

1. Back up (`./scripts/backup.sh`).
2. Pin new tags in `.env`: `API_IMAGE=ghcr.io/<owner>/marvelous-docs-api:<version>`,
   `WEB_IMAGE=...:<version>`, `APP_VERSION=<version>`.
3. `docker compose pull && docker compose up -d`.
4. Verify `/healthz` and `/api/v1/system/version`.

Rollback: restore the previous tags in `.env`, run `docker compose up -d`, and
restore the pre-upgrade dump if the new version migrated data incompatibly.
Migrations are additive and idempotent, so a previous application version keeps
working against a migrated schema; restoring the dump is only needed when data
itself must revert.

## Observability

- **Health**: `GET /healthz` returns `{"status":"ok"}` or `503 DATABASE_UNAVAILABLE`;
  Compose health checks gate `api` and `caddy`.
- **Logs**: `docker compose logs -f api` (JSON via Fastify) and
  `docker compose logs -f caddy` (access logs).
- **Version and updates**: `GET /api/v1/system/version`,
  `GET /api/v1/system/update-check`, `GET /api/v1/system/update-status` (admin).
- **Statistics**: `GET /api/v1/workspace/stats` for documents, folders, members,
  open comments, trashed documents, and version count.
- **Disk**: watch the `postgres_data` and `uploads_data` volumes;
  `docker system df -v` shows their size.
- **Errors**: the API returns the `{ error: { code, message } }` envelope; alert on
  5xx rates and on `DATABASE_UNAVAILABLE`.

## Housekeeping

- `docker compose down` keeps volumes; `docker compose down -v` deletes the
  database and uploads - only for a disposable instance.
- Rotate `UPDATE_AGENT_TOKEN` by changing it in `.env` and running
  `docker compose up -d api updater`.
- Authorization queries join the `memberships` table, so deleting a membership
  row blocks that user's next authorized request; the JWT itself stays valid
  until it expires. Rotating `JWT_SECRET` invalidates every issued token at once.
