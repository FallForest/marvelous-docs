# Directory map

How source files are organised, and where a new file belongs. The goal is that
a file's location answers "what does this do and what may it depend on?".

## Repository

```
apps/
  server/        Fastify API + y-websocket collaboration service
  web/           React 18 single-page client
  updater/       Update agent container (Docker socket + compose project)
packages/
  cli/           Dependency-free Node client for the REST API (mdocs)
docs/            API contract, architecture, development, security
scripts/         Release, publish, and update automation
release-check/   Smoke checks run against a built release
```

Rule of thumb: an `app` is something deployed; a `package` is something
consumed. Only `apps/*` ship containers; only `packages/*` are imported.

## `apps/web/src`

Layered by responsibility. A module may import from a lower layer, never from a
higher one.

```
main.tsx                  React root: mounts AppRoot inside ErrorBoundary
App.tsx                   Workspace shell: wires hooks to layout and pages

hooks/                    State and data ownership that outlives one screen
  useWorkspaceData.ts     Session, documents, comments, versions, search, stats


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
    TemplateMenu.tsx      New-document menu + template labels
  tree/                   Document tree row
    TreeItem.tsx
  editor/                 Everything that touches the Tiptap instance
    DocumentEditor.tsx    Editor surface, collaboration provider, code overlays
    EditorToolbar.tsx     Grouped formatting toolbar
    BubbleToolbar.tsx     Selection bubble menu
    SlashMenu.tsx         "/" insertion menu
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

lib/                      Pure logic and browser helpers (no JSX)
  api.ts                  fetch wrapper and the API base URL
  endpoints.ts            Typed API client: one declaration per endpoint
  app-types.ts            Shell-level unions shared across pages
  collab.ts               Collaboration URL resolution
  download.ts             Export download and print helpers
  editor.ts               Tiptap extension list
  font-size.ts            Custom FontSize extension
  format.ts               Dates, word count, excerpting
  languages.ts            Code-block language list and labels
  render-html.ts          Tiptap JSON → static HTML for share pages
  tree.ts                 Tree building, filtering, depth helpers
  types.ts                API payload types

styles/                   CSS layers, imported in cascade order by index.css
  index.css               Entry point: font import + layer imports
  base.css                Tokens, reset, shell geometry, login, admin
  surfaces.css            Focus rings, popovers, dialogs, toasts
  editor.css              Editor chrome, toolbars, menus
  navigation.css          Sidebar/topbar rows, dropdown language
  content.css             Code blocks, share links, public share page
  shell.css               Sidebar + topbar consolidation (single source)
  updates.css             Updater banner and links
```

### Where a new file goes

| You are adding | Put it in |
| --- | --- |
| A new screen reachable from navigation | `pages/` |
| A piece only the editor needs (Tiptap-aware) | `components/editor/` |
| A modal that edits a resource | `components/dialogs/` |
| A reusable primitive with no domain knowledge | `components/ui/` |
| A pure function with no React | `lib/` |
| State or data loading shared by screens | `hooks/` |
| A new API call | Add it to `lib/endpoints.ts` |
| A type shared by more than one page | `lib/types.ts` or `lib/app-types.ts` |
| Styling for an existing component | The matching layer in `styles/` |

Rules that keep the layers honest:

- `lib/` never imports from `components/`, `pages/`, or `App.tsx`.
- `components/ui/` never imports domain types from `pages/`.
- A page may import components; a component never imports a page.
- Only `App.tsx` wires state into pages; pages receive props and emit callbacks.
- Cross-cutting UI events use the existing `mdoc-*` window events
  (`mdoc-notice`, `mdoc-updated`, `mdoc-force-save`, ...), not prop drilling
  through four levels.

## `apps/server/src`

```
index.ts                  Process assembly: plugins, route table, sockets,
                          shutdown. Contains no business rules.
config.ts                 Every environment variable, resolved once
db.ts                     Pool + migrations + bootstrap administrator
http.ts                   Error envelope and zod parsing helpers
security.ts               scrypt password hash/verify, safeUser
access.ts                 Document JSON shape, effective role, activity log
documents.ts              Folder-parent check and document insert
guards.ts                 requireNode / requireDoc route guards
types.ts                  Claims, DocumentRow, Room, update manifest

routes/                   One module per REST resource
  index.ts                Route table (registration order matters)
  deps.ts                 Shared auth dependency
  schemas.ts              Id and content schemas
  system.ts               Health, version, self-update
  auth.ts                 Login, invite redeem, me, invite create
  workspace.ts            Members, stats, templates
  document-reads.ts       Tree, trash, recent, favorites, search, get
  document-writes.ts      Create, import, update, duplicate, favorite
  trash.ts                Soft delete, restore, permanent delete
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
  markdown.ts             Markdown import/export, search snippets
  schema.ts               Server-side Tiptap schema
  templates.ts            Built-in document templates
  version.ts              Semver comparison
  rate-limit.ts           Login throttling
  migrations.ts           Migration runner
  font-size.ts            FontSize Markdown round-trip
migrations/               Idempotent SQL, applied in filename order
test/                     node --test suites
```

Rules for the server:

- `routes/` may import from the parent directory, never the reverse.
- Route modules receive the Fastify instance and `RouteDeps`; they do not
  import `index.ts`, which keeps the graph acyclic.
- Anything that touches SQL in more than one statement belongs in a route
  handler transaction, not in `lib/`.
- `lib/` stays pure so `test/*.test.ts` can run without a database.

## `packages/cli/src`

```
index.ts        Entry point
cli.ts          Dispatch loop
args.ts         Flag/positional parsing
command.ts      CommandDefinition and CommandContext contracts
commands/       One module per command group (auth, documents, comments, ...)
http.ts         API client
config.ts       Profile storage
output.ts       Table/JSON rendering
errors.ts       Exit codes and messages
help.ts         Usage text
completion.ts   Shell completion scripts
```
