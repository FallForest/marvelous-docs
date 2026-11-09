# Changelog

All notable changes to Marvelous Docs are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.23] - 2026-11-09

### Added

- Code block language badge and one-click copy button: hover a code block to
  reveal the copy button; the language tag shows in the top-left corner and
  updates when changed from the toolbar language selector (27 languages).
- Document share links: generate a public read-only URL from the share dialog,
  copy it with one click, list active links and revoke them. A public page at
  /shared/:token renders the document without authentication.
- CLI rich content: `--append-h1/h2/h3`, `--append-text`, `--append-list`,
  `--append-task`, `--append-table ROWSxCOLS`, `--append-image URL`,
  `--append-code LANG --append-code-content CODE` on both `mdocs create` and
  `mdocs update`. `mdocs update --markdown FILE` replaces content from
  Markdown via the new `POST /markdown/convert` endpoint.
- Code language selector appears in the toolbar whenever the cursor is inside a
  code block.

### Fixed

- Rules-of-Hooks violation in the app router: shared-document routing moved to
  an `AppRoot` wrapper so hooks are never called conditionally.

## [0.1.22] - 2026-11-08

### Fixed

- 移到回收站 no longer fails with 删除失败. The API client sent
  `Content-Type: application/json` on every request, including bodyless
  DELETE/POST calls; Fastify rejects an empty JSON body with 400 INVALID_INPUT.
  The header is now only set when a body exists. This also fixes permanent
  delete, restore, favorite toggles and other bodyless mutations.
- Code blocks were rendered in muted grey. `pre`/`pre code` now use a readable
  #1f2937 on #f7f8fa surface with a monospace stack, while inline code keeps a
  subtle tint instead of inheriting muted text.
- The “所有文档” row looked like a boxed, double-highlighted button. It is now a
  neutral full-width row with a hover state, and only the nav item carries the
  active indicator.
- Empty favorite counts no longer render a stray dot in the sidebar.

## [0.1.21] - 2026-11-08

### Added

- Dedicated 收藏 view: the sidebar entry now opens a real favorites page with
  its own heading, empty state and card grid, instead of only resetting the
  query.
- Quick favorite toggle in the document topbar (star button), mirrored with the
  sidebar count and the favorites page.

### Fixed

- Mobile/tablet floating sidebar covered the editor toolbar and blocked clicks;
  the sidebar is now a proper modal layer (scrim closes it), nav actions close
  it, and toolbar popovers sit above it.
- Unified the z-index scale (sidebar 30, scrim 29, popover 60, modal 70,
  toast 80) so menus can never be hidden behind panels.
- Dropdown widths are constrained per menu type instead of stretching to the
  viewport; every menu was verified at 1440/1024/768/390 with no clipping or
  horizontal page overflow.

### Changed

- Refined sidebar labels, counts and active states, plus a tighter toolbar with
  consistent hover/active tokens and a neutral keyboard focus ring.

## [0.1.20] - 2026-11-08

### Fixed

- Popovers no longer get clipped by scrollable sidebars. Menus were absolutely
  positioned inside `.doc-tree`, so a long document tree cut off items such as
  移到回收站. Every popover now renders in a portal on `document.body` with fixed
  positioning, flips above the trigger when there is no room below, clamps to
  the viewport, and repositions on scroll/resize. Affected: tree actions, new
  document menu, workspace switcher, export menu, paragraph/size/color/align
  menus.

## [0.1.19] - 2026-11-08

### Fixed

- Declare `@tiptap/core` as a direct web dependency. The font-size extension
  imports it, but it was only reachable through the local hoisted store, so a
  clean checkout failed typecheck with "Cannot find module '@tiptap/core'".

## [0.1.18] - 2026-11-08

### Added

- Feishu-style grouped editing toolbar: undo/redo, paragraph style picker
  (正文/标题 1–3), font size, bold/italic/underline/strike/inline code,
  text color and highlight palettes, alignment, lists, task list, quote,
  code block, link, image, table, insert menu, comment, indentation and export.
- Selection bubble toolbar (加粗/斜体/下划线/删除线/行内代码/链接/评论)
  that follows the selection and hides for node selections.
- Slash command menu: type `/` to insert headings, lists, tasks, quotes,
  code blocks, tables, dividers and images with keyboard navigation.
- Image insertion from URL or upload (20 MB), rendered in the editor and
  included in Markdown/HTML/JSON exports.
- Find & replace panel (match count, previous/next, case sensitivity,
  replace, replace all) and a document outline panel with click-to-jump.
- Table contextual menu: insert/delete rows and columns, merge/split cells,
  toggle header row, delete table.
- Font family, font size, text alignment and image nodes in the shared
  Tiptap schema, mirrored in the server and in REST validation.

### Changed

- Document canvas typography follows Feishu density: 15px body at 1.75 line
  height, 32px title, styled headings, quotes, code, tables and task lists.
- Selecting text no longer force-opens the comments panel; the bubble toolbar
  and the explicit 评论 action do that.
- Toolbar supports arrow-key navigation and horizontal scrolling on narrow
  screens without page-level overflow.

### Fixed

- Dialog and popover focus effects depended on inline callbacks, causing a
  render loop ("Maximum update depth exceeded") in some editor interactions.
  Callbacks are now held in refs so effects depend only on open state.

## [0.1.17] - 2026-11-08

### Fixed

- The web image's nginx config proxies `/healthz` to the API again. Earlier
  the container patch was applied live only, so rebuilt images reverted to the
  catch-all `try_files` and returned `index.html` with HTTP 200 for health
  probes — misleading for external monitors.

## [0.1.16] - 2026-11-08

### Fixed

- Clicking a menu no longer blocks the rest of the UI: the full-screen
  `menu-scrim` is gone. Menus close on outside pointerdown or Escape, so topbar
  actions such as 导出、版本历史、评论 respond immediately.
- Every native `window.prompt`/`window.confirm` flow was replaced with in-app
  dialogs: rename, move-to-trash, permanent delete, version restore, link
  insertion, and the admin update confirmation. Dialogs trap focus, restore it
  on close, and support Escape and backdrop dismissal.
- The sidebar workspace button was a dead control; it now opens a workspace menu
  with 管理中心、快捷键与帮助 and 退出登录. 帮助与快捷键 opens a real dialog with
  the shortcut table.
- The comment "定位到引用" action dispatched an event nobody listened to; the
  editor now selects and scrolls to the quoted range.
- Tree rows no longer nest an interactive control inside the row button, so
  folder expand/collapse works with mouse, touch, and keyboard.
- The version list's 恢复 action now opens the preview dialog (with its explicit
  confirmation) instead of a blocking confirm.

### Changed

- New Popover and Dialog primitives in `apps/web/src/components` replace the
  ad-hoc menus; menus, tree actions, export, and workspace switcher all share
  the same behaviour and layering.
- Design tokens (28 CSS variables) for surfaces, borders, text, accent, status,
  focus ring, radii, shadows, and a z-index scale. Muted text moved to #5f6673
  and the accent to #c0533f for WCAG AA contrast (13 failing nodes → 0).
- Focus-visible rings across buttons, links, inputs, menu items, and tabs; a
  skip link and tabpanel roles; touch targets enlarge to 44px at ≤560px and
  tree menus are no longer hover-only on touch devices.
- Reduced-motion support and a before-unload warning while a save is in flight.

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