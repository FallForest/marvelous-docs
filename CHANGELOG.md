# Changelog

All notable changes to Marvelous Docs are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.15] - 2026-11-08

### Fixed

- The document tree context menu now renders as a real popover (surface,
  border, shadow, padding and readable 12px rows) instead of bare text floating
  over the sidebar, which made 重命名/收藏/移动到/移到回收站 hard to read.

## [0.1.14] - 2026-11-08

### Fixed

- CI builds the CLI `dist` before running `node --test`; the test script now
  compiles first so a clean checkout passes.

## [0.1.13] - 2026-11-08

### Added

- **API**: folders as first-class tree nodes (`kind: folder`), with folders as the
  only valid `parentId`; folders can be renamed and moved (cycle safe), favourited,
  and trashed/restored/purged as a subtree, while content endpoints reject folder ids.
- **API**: threaded comments with anchors, `open`/`resolved` status, resolver
  tracking (`PATCH /documents/:id/comments/:commentId`), and document activity
  (`view`, `edit`, `restore`) exposed through `GET /documents/:id/activity`.
- **API**: version history for every REST write, version restore, and persisted
  collaboration edit, with `GET /documents/:id/versions` and
  `POST /documents/:id/versions/:versionId/restore`.
- **API**: search (`GET /documents/search` with `scope`, `limit`, highlighted
  snippets), favorites (`PUT /documents/:id/favorite`, `GET /documents/favorites`),
  recent (`GET /documents/recent`), and trash (`GET /documents/trash`,
  `POST /documents/:id/restore`, `DELETE /documents/:id/permanent`).
- **API**: Markdown import (`POST /documents/import`) and export
  (`GET /documents/:id/export?format=markdown|html|json`).
- **API**: built-in templates (`GET /templates`) and `templateId` on document
  creation.
- **API**: per-document ACL (`GET|PUT /documents/:id/acl`) with `owner`,
  `editor`, `viewer`, restriction per document, document duplication, and
  optimistic concurrency (`expectedVersion`, `409 VERSION_CONFLICT`).
- **API**: login throttling through an in-process sliding-window limiter (ten failed
  attempts per IP and per e-mail within fifteen minutes) returning
  `429 RATE_LIMITED` with `Retry-After`.
- **API**: uploads (`PUT /uploads`, `GET /uploads/:filename`) with MIME allow-list,
  20 MB limit, and random names; workspace statistics; invites with one-time
  tokens; update check, trigger, and status through the internal agent.
- **Collaboration**: y-websocket v2 rooms over `COLLAB_PORT`, JWT auth via
  `?token=`, viewer read-only enforcement, 500 ms idle persistence into
  `documents.yjs_state` and `documents.content`, and pending-state flush before
  REST reads.
- **Web**: sidebar tree with folders, favourites and recent views, search page,
  command palette, editor toolbar, activity panel, stats cards, version preview
  and restore, template picker, export menu, move dialog, Markdown import, share
  dialog with ACL management, trash view, error boundary, and in-app update check.
- **CLI**: `mdocs` client covering authentication (`login`, `logout`, `whoami`,
  `doctor`), documents (`list`, `tree`, `search`, `create`, `read`, `export`,
  `import`, `update`, `duplicate`, `mkdir`, `trash`, `restore`, `purge`, `favorite`),
  comments, versions, sharing, workspace (`members`, `invite`, `templates`,
  `stats`, `activity`, `upload`), shell completion, profiles, and `--json` output.
- **Infra**: repository-root pnpm Docker builds for the API and web images
  (`corepack`, frozen workspace lockfile, `pnpm deploy --prod`), root
  `.dockerignore`, and Compose build contexts pointing at the root.
- **Infra**: CI workflow running lint, typecheck, test, and build on push and pull
  request; release workflow builds multi-arch images and `latest.json` from the
  root context.
- **Infra**: flat ESLint configuration for the whole monorepo,
  `.editorconfig`, `.gitattributes`, and an expanded `.gitignore` for build
  metadata, backups, and scratch directories.
- **Scripts**: `scripts/backup.sh` and `scripts/restore.sh` wrapping the documented
  `pg_dump`, uploads archive, restore, and health-check flow.
- **Docs**: rewritten README with architecture diagram and quick starts, plus
  `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `docs/DEPLOYMENT.md`,
  `docs/SECURITY.md`, and `CONTRIBUTING.md`.

### Changed

- Root scripts now cover the full workflow: `dev`, `dev:server`, `dev:web`,
  `build`, `typecheck`, `lint`, `lint:fix`, `test`, `test:cli`, `cli`,
  `db:migrate`, and `clean`; `engines` requires Node 22+ and pnpm 11+.
- Docker images build from the repository root so `pnpm-lock.yaml` and the
  workspace manifests are part of the build; package-scoped `npm` builds are gone.
- Compose passes `CORS_ORIGIN`, `COLLAB_PORT`, `UPLOAD_DIR`,
  `BOOTSTRAP_ADMIN_NAME`, and `UPDATE_MANIFEST_URL` to the API, keeping the
  environment in sync with the server contract.
- `.env.example` and `apps/server/.env.example` document every variable with
  required/optional markers and secret-generation hints.

### Removed

- Tracked `package-lock.json` files in `apps/server`, `apps/web`, and
  `packages/cli`; `pnpm-lock.yaml` is the single lockfile.
- Tracked `apps/web/tsconfig.tsbuildinfo`; TypeScript build metadata is ignored.

## [0.1.0]

### Added

- Initial release of the self-hosted workspace: Fastify API under `/api/v1`,
  PostgreSQL schema with workspaces, users, memberships, documents, versions, and
  comments, scrypt password hashing with 12-hour JWTs, invite-based onboarding, and
  a React/Tiptap editor with Yjs collaboration.
- Docker Compose stack with PostgreSQL, the API, the nginx web client, Caddy for
  TLS, and an internal update agent.
- `mdocs` CLI package and the API contract in `docs/API.md`.