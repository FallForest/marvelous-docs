# Development

How to run, test, and change Marvelous Docs locally.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 22 or newer | The server uses `--env-file`, `node --test`, and native `fetch`. |
| pnpm | 11 or newer | `packageManager` pins `pnpm@11.25.0`; `corepack enable` picks it up. |
| Docker Compose | current | Only needed for PostgreSQL locally and for the image builds. |
| PostgreSQL | 16 | Provided by the `postgres` compose service. |

`pnpm install` refuses to run with a mismatched pnpm major. If `corepack` is
unavailable, install pnpm with `npm i -g pnpm@11.25.0`.

## Install

```sh
git clone <repository-url> && cd marvelous-docs
pnpm install
cp .env.example .env
```

`pnpm-lock.yaml` is the only lockfile; npm/yarn lockfiles are not tracked. Never
edit the lockfile by hand - change a manifest and run `pnpm install` so the
lockfile diff is reviewable.

## Environment

The API reads its settings from the process environment. For local development
`pnpm dev:server` loads the repository-root `.env` through
`node --env-file=../../.env`; Compose injects the same variables in production.

Minimum for a working local server:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `postgresql://marvelous_docs:<password>@localhost:5432/marvelous_docs` |
| `JWT_SECRET` | 32+ random bytes (`openssl rand -hex 32`) |
| `BOOTSTRAP_ADMIN_EMAIL` | Your login e-mail; the account is created on first start. |
| `BOOTSTRAP_ADMIN_PASSWORD` | 12+ characters. |

Optional: `PORT` (3000), `HOST` (0.0.0.0), `COLLAB_PORT` (1234),
`UPLOAD_DIR`, `CORS_ORIGIN`, `APP_VERSION`,
`UPDATE_MANIFEST_URL`, `UPDATE_AGENT_URL`, `UPDATE_AGENT_TOKEN`.
[`../apps/server/.env.example`](../apps/server/.env.example) lists the API contract;
[`../.env.example`](../.env.example) is the deployment template. Compose always
mounts the uploads volume at `/data/uploads`; when running the API on the host,
point `UPLOAD_DIR` at a writable local directory such as `./.tmp/uploads`
(git-ignored).

## Run

```sh
docker compose up -d postgres   # database only
pnpm dev                        # API :3000/:1234 and Vite :5173 in parallel
```

Separate terminals are equivalent and easier to read:

```sh
pnpm dev:server                 # tsx --watch, restarts on change
pnpm dev:web                    # vite, hot module replacement
```

The Vite dev server proxies `/api` to `http://127.0.0.1:3000` and `/collab` to
`ws://127.0.0.1:1234`, so the browser only needs the Vite URL. Sign in with the
bootstrap account; invites are returned as tokens by `POST /api/v1/invites` and
redeemed at `/accept-invite`.

## Test

```sh
pnpm test        # pnpm -r test: every package's suite
pnpm test:cli    # packages/cli only
```

Every suite is plain `node --test`; the runner differs only in how TypeScript is
loaded:

| Package | Script | Suites |
| --- | --- | --- |
| `apps/server` | `tsx --test test/*.test.ts` | pure unit tests for Markdown conversion, templates, version handling, and the login rate limiter |
| `apps/web` | `node --import tsx --test test/*.test.ts` | pure helper tests for the collaboration URL, formatting, and tree building |
| `packages/cli` | `node --test test/*.test.mjs` | argument validation plus mock-server integration tests |

Adding a suite needs no runner configuration: create the file in the package's
`test/` directory and keep it free of live PostgreSQL or browser requirements. A
test that needs the database should create its own schema or skip when
`DATABASE_URL` is unset.

## Lint and typecheck

```sh
pnpm lint        # eslint . (flat config, see ../eslint.config.mjs)
pnpm lint:fix    # eslint . --fix
pnpm typecheck   # pnpm -r typecheck (server/cli --noEmit, web tsc -b)
pnpm build       # pnpm -r build
```

`eslint.config.mjs` applies `@eslint/js` recommended plus typescript-eslint
recommended (non-type-checked) to `**/*.{ts,tsx,mjs}`, with Node globals for the
server, CLI, and scripts, browser globals plus react-hooks for the web app.
`node_modules`, `dist`, `coverage`, `*.tsbuildinfo`, and `pnpm-lock.yaml` are
ignored.

Rules that only duplicate the compiler or fight the existing code are tuned down
rather than rewritten in sources: `no-explicit-any`, `no-empty`, and
`ban-ts-comment` are off, and `react-hooks/exhaustive-deps` is a warning because
several effects intentionally key on ids instead of whole objects. Unused symbols
are reported by `@typescript-eslint/no-unused-vars`. `lint` therefore fails on
real problems and stays green on the pre-existing findings.

Type checking is owned by each package: `apps/server` and `packages/cli` expose
`typecheck: tsc -p tsconfig.json --noEmit`, and `apps/web` uses `tsc -b` (the
same project build its bundle step runs). The root `typecheck` script is
`pnpm -r typecheck`, so a new package only needs a `typecheck` script to join the
gate.

## Conventions

- **Language**: code, comments, commit messages, and docs are English. Chinese
  appears only in UI copy that is already Chinese.
- **Formatting**: 2 spaces, LF, final newline, UTF-8 (`.editorconfig`,
  `.gitattributes`). Scripts are `sh` with `set -eu`; PowerShell helpers use CRLF.
- **Server**: semicolons, single quotes, explicit error codes from the API
  contract. `src/index.ts` only assembles the process; REST routes live one
  resource per module in `src/routes/`, collaboration code in
  `src/collaboration/`, and pure helpers in `src/lib/` so they can be
  unit-tested without PostgreSQL.
- **Web**: no semicolons, single quotes, function components with hooks. Screens
  go in `src/pages/`, editor pieces in `src/components/editor/`, dialogs in
  `src/components/dialogs/`, primitives in `src/components/ui/`, pure logic in
  `src/lib/`, and styles in the matching `src/styles/*.css` layer.
- **Imports**: Node built-ins with the `node:` prefix, ESM everywhere.
- **Secrets**: never commit `.env`, tokens, dumps, or uploads; all of them are
  git-ignored.
- **Scope**: do not run workspace-wide installs to fix a single package; edit the
  manifest and let the lockfile update once.

Where a new file belongs, and which imports each layer may use, is in
[STRUCTURE.md](STRUCTURE.md).

## Migrations

- SQL lives in `apps/server/migrations/NNN_description.sql`, applied in filename
  order at startup and by `pnpm db:migrate`.
- Every statement must be idempotent (`CREATE TABLE IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`, ...) because the runner replays the directory on
  each boot.
- Add a migration instead of editing an applied one. Keep the file additive and
  safe to run against a populated database.
- `apps/server/src/migrate.ts` applies the directory and exits; the API process
  applies it before listening.

## Debugging

| Need | Command |
| --- | --- |
| API logs in a terminal | `pnpm dev:server` and watch the Fastify output. |
| Container logs | `docker compose logs -f api web caddy` |
| Health | `curl -s http://127.0.0.1:3000/healthz` |
| Version | `curl -s http://127.0.0.1:3000/api/v1/system/version` |
| Database shell | `docker compose exec postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"` |
| Compose rendering | `docker compose config` (needs the required variables set) |
| Node inspector | `node --inspect --env-file=.env --import tsx apps/server/src/index.ts` |

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Cannot find module .../.env` on start | `--env-file` is strict: create the root `.env` or start the server with your own environment. |
| `DATABASE_UNAVAILABLE` on `/healthz` | PostgreSQL is not reachable: check `docker compose ps postgres` and `DATABASE_URL`. |
| Login returns 401 right after bootstrap | The bootstrap account is only created when the e-mail does not exist; re-check `BOOTSTRAP_ADMIN_EMAIL` and restart the API. |
| WebSocket connects then edits do not sync | `/collab` is not proxied. In dev, Vite must reach `127.0.0.1:1234`; in production, nginx must proxy to `api:1234`. |
| `409 VERSION_CONFLICT` from the CLI | Another writer moved the document. Re-read it, review the diff, retry with the new version. |
| `ERR_PNPM_OUTDATED_LOCKFILE` | A manifest changed without a lockfile update; run `pnpm install` and commit the lockfile. |
| Lint fails on `react-hooks/exhaustive-deps` | It is a warning; check for a genuine stale-closure bug before suppressing. |
| Vite port already in use | Stop the other dev server or pass `--port`. |
| Docker build fails at `pnpm install` | The build context must be the repository root (`docker build -f apps/server/Dockerfile .`); a package-scoped context has no lockfile. |