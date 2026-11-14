# Directory map

How source files are organised, and where a new file belongs. The goal is that
a file's location answers "what does this do and what may it depend on?".

## Repository

```
apps/
  server/        Fastify API + y-websocket collaboration service
  web/           React 18 single-page client
  updater/       Update agent: Dockerfile + update-agent.mjs (Docker socket + compose project)
packages/
  cli/           Dependency-free Node client for the REST API (mdocs)
docs/            API contract, architecture, development, security
scripts/
  deploy/        Host-side operations: backup, restore, update
  release/       Image build/publish for a release
  verify/        Browser verifiers driven over the DevTools protocol
release/         Committed release manifest (latest.json) for the updater
```

Rule of thumb: an `app` is something deployed; a `package` is something
consumed. Only `apps/*` ship containers; only `packages/*` are imported. Root
files are entry points only — configuration, manifests, and the README. Anything
that is *work* lives in one of the directories above.

A script belongs to the phase it serves: `scripts/deploy/` runs against a live
stack, `scripts/release/` builds artefacts, and `scripts/verify/` opens a browser
and checks a rendered result. A new script that fits none of them is the signal
that the category is missing, not that it should go in the root of `scripts/`.

## `apps/web/src`

Layered by responsibility. A module may import from a lower layer, never from a
higher one.

```
main.tsx                  React root: mounts AppRoot inside ErrorBoundary
App.tsx                   Workspace shell: wires hooks to layout and pages

hooks/                    State, data ownership, and lifecycle that outlives one render
  useWorkspaceData.ts     Session, documents, comments, versions, search, stats
  useReducedMotion.ts     Live prefers-reduced-motion, for JS-driven animation
  useBlockGeometry.ts     Rect of every block that hosts its own toolbar
  useBlockAnchor.ts       The top-level block under the pointer, for the gutter handle
  usePresence.ts          Holds a modal mounted for one exit frame (shared by every dialog)
  useSharing.ts           Share dialog data: members, ACL, public links, scope toggle
  useInvite.ts            Invite form: address, role, one-time link, copy feedback
  useDocumentExport.ts    Export menu: markdown/html/json download, print, PDF progress
  useTheme.ts             Active theme: stored id, apply, switch

pages/                    One file per route-level screen
  LoginPage.tsx           Sign-in and invite redemption
  HomePage.tsx            Home dashboard, favorites, trash, folder overview
  SearchPage.tsx          Search results
  CommandPalette.tsx      Cmd/Ctrl+K palette
  AdminPage.tsx           Workspace admin: members, invites, updates
  SharedDocumentPage.tsx  Public, unauthenticated share view

components/
  layout/                 Chrome pieces owned by the shell
    Sidebar.tsx           Workspace switcher, search, nav, document tree
    TopBar.tsx            Breadcrumb, save state, presence, document actions
    ExportMenu.tsx        Export format menu
    ThemeMenu.tsx         Theme picker (radiogroup over the registry)
    TemplateMenu.tsx      New-document menu + template labels
  tree/                   Document tree row
    TreeItem.tsx
  editor/                 Everything that touches the Tiptap instance
    DocumentEditor.tsx    Editor surface, collaboration provider, code overlays
    EditorToolbar.tsx     Grouped formatting toolbar
    BubbleToolbar.tsx     Selection bubble menu
    SlashMenu.tsx         "/" insertion menu
    BlockHandle.tsx       Gutter drag handle, drop indicator, block context menu
    TableMenu.tsx         Table context menu
    FindReplace.tsx       Find/replace and outline panels
  panels/                 Right-hand document panels
    DocumentPanel.tsx     Tabbed comments / history / activity panel
    ActivityPanel.tsx     Per-document activity log
    VersionPreview.tsx    Version snapshot preview
  dialogs/                Modal surfaces
    MoveDialog.tsx        Move a document into a folder
    ShareDialog.tsx       ACL editor + share links
    InviteDialog.tsx      Create an invite link
    ShellDialogs.tsx      Rename / delete / purge / help / link prompts
  ui/                     Generic, domain-agnostic primitives
    Dialog.tsx            Confirm/prompt dialog shells
    Popover.tsx           Portalled, collision-aware popover
    StatsCards.tsx        Metric cards
    ErrorBoundary.tsx     Top-level error boundary

lib/                      Pure logic and browser helpers (no JSX, no React state)
  api.ts                  fetch wrapper and the API base URL
  endpoints.ts            Typed API client: one declaration per endpoint
  app-types.ts            Shell-level unions shared across pages
  format.ts               Dates, word count, excerpting
  motion.ts               Motion contract: durations, spring presets, stagger
  theme.ts                Theme registry, storage, and the data-theme write
  tree.ts                 Tree building, filtering, depth helpers
  trash.ts                Trash countdown and expiry labels
  types.ts                API payload types
  collab.ts               Collaboration URL resolution
  clipboard.ts            Copy with a plain-HTTP fallback and a real boolean result
  editor/                 Everything that only exists inside the Tiptap instance
    index.ts              The extension list DocumentEditor and VersionPreview mount
    blocks.ts             Block spans and move planning for the drag handle
    code-block.ts         Code block boundaries: Enter to leave, Backspace to remove
    comment-marks.ts      Comment markers: anchors → view decorations, mapped through edits
    font-size.ts          Custom FontSize extension
    highlight.ts          lowlight instance + the grammars the editor ships
    image.ts              DocumentImage extension
    languages.ts          Code-block language list and labels
  export/                 Everything on the way out of the editor
    download.ts           File download and print helpers
    export-css.ts         Scopes a standalone export stylesheet for in-app render
    pdf-pages.ts          A4 geometry and canvas→page slicing
    pdf.ts                HTML export → PDF (jsPDF + html2canvas), loaded on demand
    render-html.ts        Tiptap JSON → static HTML for share pages

styles/                   CSS layers, imported in cascade order by index.css
  index.css               Entry point: font import + ordered layer imports
  tokens.css              Design values only: colour palette, type, radii,
                          shadows, z-index, every duration / easing / spring curve
  themes.css              Palette overrides per [data-theme] (see docs/THEMES.md)
  base.css                Reset + shell geometry; styles no specific screen
  motion.css              Keyframes and motion utilities (.motion-rise,
                          .motion-sheet, .stagger, ...) + reduced-motion rules
  surfaces.css            Shared primitives: buttons, backdrop, toast, stacking
  dialogs.css             Modal surfaces (confirm, share, move, version, invite)
  navigation.css          Sidebar/topbar rows, breadcrumbs, presence stack
  panels.css              Right-hand panel, code overlay, block toolbars
  editor.css              Editor chrome, toolbars, menus
  content.css             Code blocks, share links, public share page
  shell.css               Sidebar + topbar consolidation (single source)
  pages.css               Home, folder, search, palette, login, admin screens
  updates.css             Updater banner and links
  layout.css              Shared component geometry and typography for both themes
  handdrawn.css            Shared material skin, font, art-icon fallback
  handdrawn-navigation.css Theme-scoped sidebar, tree and topbar treatments
  handdrawn-content.css    Theme-scoped editor, comments, home and login
  handdrawn-controls.css   Theme-scoped toolbars, tabs and editor popup controls
  handdrawn-materials.css  Graphite frame, search/admin and dialog internals
  handdrawn-writing.css    Paper, tables, tasks, comment composition and code blocks
  handdrawn-editor-chrome.css Toolbar, breadcrumbs, presence and editor status strip
```

Each layer answers one question. `tokens.css` owns *what a value is*,
`motion.css` owns *how a surface arrives*, and every other layer owns *one
region of the app*. A rule that needs a new hex, duration, or curve adds a token
first; a rule that needs a new animation adds a keyframe to `motion.css` first.
That is what keeps "make it feel snappier" a one-file change — see
[`docs/MOTION.md`](./MOTION.md).

### Where a new file goes

| You are adding | Put it in |
| --- | --- |
| A new screen reachable from navigation | `pages/` |
| A piece only the editor needs (Tiptap-aware) | `components/editor/` |
| A modal that edits a resource | `components/dialogs/` |
| A reusable primitive with no domain knowledge | `components/ui/` |
| A pure function with no React | `lib/` |
| State or data loading shared by screens | `hooks/` |
| The data and actions behind one overlay | A `hooks/use*.ts` hook (`useSharing`, `useInvite`, `useDocumentExport`): the shell keeps only the open/closed boolean |
| A new API call | Add it to `lib/endpoints.ts` |
| A browser-only flow that must be seen to be believed | A `scripts/verify/verify-*.mjs` script: bundle the real module with esbuild and drive Chrome over the DevTools protocol (`pnpm verify:browser`) |
| A type shared by more than one page | `lib/types.ts` or `lib/app-types.ts` |
| Styling for an existing component | The matching layer in `styles/` |
| A new screen's styles | `styles/pages.css`, scoped to that screen's root class |
| A new design value (colour, duration, curve) | A token in `styles/tokens.css` |
| A new theme | An entry in `lib/theme.ts`, a block in `styles/themes.css`, and an id in the `index.html` pre-paint map — see [THEMES.md](./THEMES.md) |
| A new animation | A keyframe + utility in `styles/motion.css` |
| A new modal | `components/dialogs/`, styled by `styles/dialogs.css` |

Rules that keep the layers honest:

- `lib/` never imports from `components/`, `pages/`, or `App.tsx`.
- `components/ui/` never imports domain types from `pages/`.
- A page may import components; a component never imports a page.
- Only `App.tsx` wires state into pages; pages receive props and emit callbacks.
- A hook owns the data an overlay needs; the shell owns whether that overlay is
  open. Moving the fetch into `App.tsx` again is how it grew to 1055 lines.
- Cross-cutting UI events use the existing `mdoc-*` window events
  (`mdoc-notice`, `mdoc-updated`, `mdoc-force-save`, ...), not prop drilling
  through four levels.

## `apps/server/src`

```
index.ts                  Process assembly: plugins, route table, sockets,
                          shutdown. Contains no business rules.

core/                     Infrastructure with no document knowledge
  config.ts               Every environment variable, resolved once
  db.ts                   Pool + migrations + bootstrap administrator
  http.ts                 Error envelope and zod parsing helpers
  security.ts             scrypt password hash/verify, safeUser
  types.ts                Claims, DocumentRow, Room, update manifest

domain/                   Document and workspace rules, still HTTP-free
  access.ts               Document JSON shape, effective role, activity log
  documents.ts            Folder-parent check and document insert
  guards.ts               requireNode / requireDoc route guards

routes/                   One module per REST resource
  index.ts                Route table (registration order matters)
  deps.ts                 Shared auth dependency
  schemas.ts              Id and content schemas
  system.ts               Health, version, self-update
  auth.ts                 Login, invite redeem, me, invite create
  workspace.ts            Members, stats, templates
  document-reads.ts       Tree, trash, recent, favorites, search, get
  document-writes.ts      Create, import, update, duplicate, favorite
  trash.ts                Soft delete, restore, permanent delete, empty, sweep
  export.ts               Export and activity log
  sharing.ts              ACL and public share links
  comments.ts             Comment threads
  versions.ts             History list, snapshot, restore
  uploads.ts              File upload and read
  markdown.ts             Markdown → Tiptap conversion

collaboration/
  ydoc.ts                 Tiptap JSON ↔ Y.Doc, state encoding
  protocol.ts             y-websocket v2 framing helpers
  rooms.ts                Room lifecycle, debounce, persistence
  socket.ts               Upgrade auth and per-socket protocol handling

lib/                      Pure helpers, unit-tested without PostgreSQL
  markdown/               Markdown, HTML and search text — one concern per file
    index.ts              Barrel: the only import path routes and tests use
    nodes.ts              Tiptap node types, envelope unwrapping, nodeText
    parse.ts              Markdown → Tiptap (inline marks, blocks, tables, fences)
    serialize.ts          Tiptap → Markdown
    html.ts               Tiptap → standalone escaped HTML document
    export.ts             exportResponse: documentId/format/filename/content
    snippet.ts            Plain text extraction + search windowing
  schema.ts               Server-side Tiptap schema
  search.ts               tsquery building + the full-text search statement
  templates.ts            Built-in document templates
  version.ts              Semver comparison
  rate-limit.ts           Login throttling
  migrations.ts           Migration runner
  font-size.ts            FontSize Markdown round-trip
  trash.ts                Trash retention window, deadline, and sweep
migrations/               Idempotent SQL, applied in filename order
test/                     node --test suites
```

The dependency direction is `index.ts` → `routes/` → `domain/` → `core/` → `lib/`.

Rules for the server:

- `core/` holds what every deployment needs (configuration, the pool, the error
  envelope, password hashing, shared types) and knows nothing about documents.
- `domain/` holds document rules shared by several routes: effective-role
  resolution, the JSON shapes, the route guards. It may import `core/` and
  `lib/`, never `routes/`.
- `routes/` may import from `domain/`, `core/`, and `lib/`, never the reverse.
- Route modules receive the Fastify instance and `RouteDeps`; they do not
  import `index.ts`, which keeps the graph acyclic.
- Anything that touches SQL in more than one statement belongs in a route
  handler transaction, not in `lib/`.
- `lib/` stays pure so `test/*.test.ts` can run without a database.
- A folder under `lib/` is a single concern that outgrew one file; it exposes a
  barrel `index.ts` and callers import the barrel, not a leaf module.

## `packages/cli/src`

```
index.ts        Entry point
cli.ts          Dispatch loop
args.ts         Flag/positional parsing
command.ts      CommandDefinition and CommandContext contracts
commands/       One module per command group (auth, documents, comments, ...)
  index.ts      The command table; resolution order and subcommand hints
  support.ts    Helpers shared by groups: positional parsing, JSON in, tables out
  completion.ts The `completion` command (the script itself lives in ../completion.ts)
http.ts         API client
config.ts       Profile storage
output.ts       Table/JSON rendering
errors.ts       Exit codes and messages
help.ts         Usage text
completion.ts   Shell completion script generators (bash/zsh/fish/powershell)
update-check.ts Newer-release notice after a command
```
