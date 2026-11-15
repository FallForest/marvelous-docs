# Roadmap

Where this project goes next, and what is already broken — and what has been fixed.

This file began as the findings of a read-only audit (2026-11-14) that compared
the product against Notion and looked for defects that were already producing
wrong data. Most of what it found has since been fixed, so it is now two things
at once: the register of why each rule exists, and the list of what is left.
Every entry names the file that proves it, and the code wins if the two ever
disagree.

## How to read this

- **P0** was triage: something already wrong, not merely missing. Closed; kept as
  the record of what the rule is for.
- **P1** is structural debt. Every feature added on top pays interest on it. Partly
  done; the status table says which entries.
- **P2** needs its own project. The cost or the coupling is beyond one change.
- **What not to do** is collected at the end. Those are judgements with reasons,
  not preferences; overturning one takes new evidence.

Identifiers (`P0-1`, `P1-6`) are stable and belong in commit messages and issue
titles.

## Where the project stands

The editor core is already close to Notion: the code-block keyboard contract
([EDITING.md](EDITING.md)), comment anchors as decorations rather than marks,
block arithmetic with isolated Yjs undo, four layers of concurrency control on
version restore, and CJK search built from per-ideograph phrases.

**The gap is one layer above the document** — URLs, navigation, notifications,
import, visibility, loading and empty states — plus the collaboration write path,
which used to rewrite everything every 500 ms and rebuild the search index with
it. Both halves have moved: see the status tables below for what is closed and
what still costs interest.

## Repository state when this was written

`main` carried 25 modified and 11 untracked files: an in-flight "unified history
timeline" refactor (`migrations/005_history_checkpoints.sql`,
`domain/history.ts`, `panels/HistoryPanel.tsx`, `lib/document-saves.ts`).

**Plan against the code as it lands after that refactor**, especially P1-1, which
touches the very write path the refactor is changing.

### Status

The audit grew into a correctness pass, so most of what follows has landed. The
entries are kept as written: they are the evidence for *why* each rule exists, and
the identifiers stay stable. Read the state column before scheduling anything.

Line numbers in the tables below are where the fix landed, i.e. working tree.
Every other `file:line` in this document is a `main` (HEAD) anchor, per the
convention at the end.

Where a line number would be brittle — a file under active edit, or a construct
that may move — the reference names the unit instead (`DocumentEditor`'s
`useEditor` call, the shell key handler). A pointer that survives the next
refactor is worth more than one that was exact for a day. Anchors are re-checked
whenever this document is edited; a reader who finds one that missed should
trust the code and fix the pointer.

| Item | State | Where |
| --- | --- | --- |
| P0-1 | done: both recursions filter on `deleted_at`, and a live child survives its deleted folder | `lib/trash.ts:88`, `routes/trash.ts:51`, `test/trash.test.ts` |
| P0-2 | done: one `visibleDocumentsCte('live'|'any')` feeds tree, trash, recent, favorites, search and the bulk empty; the inherited grant is reachable, so sharing a folder works | `domain/access.ts:90`, `lib/search.ts:89` |
| P0-3 | done: an ACL change revokes that document's writers, a soft delete evicts the room, and a socket re-reads its role after 60 s of staleness (time-boxed at 2 s so a busy database cannot stall edits) | `collaboration/socket.ts:59`, `collaboration/rooms.ts`, `routes/sharing.ts` |
| P0-4 | done: `TRUST_PROXY` (default on) is passed to Fastify and documented in both `.env.example` files, compose and SECURITY.md | `core/config.ts:47`, `index.ts:29` |
| P0-5 | done: `PUT /documents/:id` is throttled at 120/min, share tokens are stored as SHA-256, `/shared/:token` is throttled; a link still outlives a later ACL change by design, which SECURITY.md now states | `routes/document-writes.ts`, `routes/sharing.ts` |
| P0-6 | done: favourites parse defensively, only 401/403 signs a session out, a boot screen replaces the login flash, and a batch delete refreshes the tree | `hooks/useWorkspaceData.ts:37,131`, `App.tsx`, `pages/BootScreen.tsx` |
| P0-7 | done: `007_version_retention.sql` adds the `documents(parent_id)` index and a retention policy (keep 7 days, 4 per older day, never below 50 per document), swept daily | `migrations/007_version_retention.sql`, `index.ts` |
| P0-8 | done: a reusable `ci-checks.yml` runs the six browser verifiers as their own job, and the release workflow now `needs:` it | `.github/workflows/ci.yml`, `ci-checks.yml`, `release.yml` |

P1 has since moved too, in the same order the entries below propose:

| Item | State | Where |
| --- | --- | --- |
| P1-1 | done: the projection runs on its own clock (10 s) while the durable state stays at 500 ms, `flushRoom` forces a projection so no read sees a stale body, and a `sync-step-1` no longer queues behind a write. Incremental `yjs_state` was assessed and **declined with a reason** — the note below says why | `collaboration/rooms.ts`, `collaboration/socket.ts` |
| P1-2 | **measured, and the answer was not the one this entry predicted**: the hooks cost 0.2 ms of a 2.5 ms keystroke at 2000 blocks, while layout cost 113 ms. `content-visibility: auto` on top-level blocks took that to 20 ms (82%); `shouldRerenderOnTransaction` stays off the list until something shows it matters. Numbers and method: [PERFORMANCE.md](PERFORMANCE.md) | `lib/../styles/base.css`, `scripts/verify/measure-editor.mjs` |
| P1-3 | done: `BlockShortcuts` wires the commands the gutter already had, `TabInProse` indents lists and paragraphs (the `indent` attribute, mirrored in the server schema and the HTML export), Escape layers, `/` fires after CJK punctuation and inside list items, aliases make `/h1` and `/biaoti` work, and `Ctrl+K` links the selection instead of opening the palette | `lib/editor/block-shortcuts.ts`, `tab-in-prose.ts`, `App.tsx` |
| P1-4 | done: the gutter opens on a long press and is sized for a finger under `pointer:coarse`, both overlays clamp to `visualViewport`, the shell uses `dvh`, and the viewport meta covers the safe area | `useBlockAnchor.ts`, `lib/viewport.ts`, `base.css` |
| P1-5 | done: `?doc=` gives a document an address, the breadcrumb renders the ancestor trail, `ancestorsOf` walks it, "最近" is a real view backed by `GET /documents/recent`, and the sidebar is grouped | `lib/url.ts`, `lib/tree.ts`, `Sidebar.tsx`, `pages/HomePage.tsx` |
| P1-6 | done: `versions`, `updatePrompt`, `updates.css`, the `'__favorites__'` literal, `api.activity` and the unlistened `mdoc-reload` are all gone; the outline subscribes to the editor. Sharing now exposes expiry, manual copying, loading failures and retry. The public page shows the title, cancels superseded requests and truthfully renders all links read-only; `commenter` remains compatibility metadata pending an authenticated guest-comment flow | `hooks/useSharing.ts`, `components/dialogs/ShareDialog.tsx`, `pages/SharedDocumentPage.tsx`, `docs/SECURITY.md` |
| P1-7 | done: (a) version copies are generated by `scripts/release/bump-version.mjs` and checked in CI; (b) `RELEASING.md` names the compose file that exists; (c) `preconnect` for the web fonts; (d) art PNGs excluded from the build; (e) `GET /system/metrics`; (f) `schema_migrations` + advisory lock + one transaction per file. **(g) is closed as by-design**: `release.yml` builds arm64 on a native runner because QEMU emulation hung for ten minutes per tag, and its header already documents the three-part multi-arch change as its own project | `scripts/release/bump-version.mjs`, `lib/migrations.ts`, `routes/system.ts` |
| P1-8 | **partly addressed in the 2026-11-15 product pass**: comment lifecycle, editor tool correctness, share expiry/public-page loading and local draft recovery are implemented. Notifications, @mentions, backlinks, i18n, full offline/PWA, API tokens, webhooks and workspace export remain explicit product gaps | [PRODUCT-CONTRACTS.md](PRODUCT-CONTRACTS.md) records component acceptance and remaining work |

### Why incremental `yjs_state` was left alone

P1-1 proposed appending Yjs deltas to a `document_updates` table and compacting
periodically, instead of writing full state on every save. It is the textbook
answer and it was not taken, for a reason worth writing down rather than
rediscovering:

the projection was the expensive half. A full `yjs_state` write is one bytea column
that nothing indexes; the GIN rebuild came from `content`. With the projection on
its own clock, a save is now a single-column update plus a version bump, and the
remaining cost is proportional to document size rather than to index maintenance.

An append log would add a table, a compaction job, and a failure mode where the log
and the snapshot disagree — and it would be paid for by documents that are, in
practice, tens of kilobytes. The measurement that would justify it (state size
times save frequency) has not been made, and adding it without one is the kind of
optimisation that costs correctness to buy an unmeasured win.

### What `shouldRerenderOnTransaction` still needs

Turning it off is one line and it breaks the toolbar's active states: the buttons
read `editor.isActive(...)` during render, and without a re-render per transaction
they keep whatever was true when they last painted. The fix is a subscription that
repaints on `selectionUpdate` and on transactions that change marks — a different
component contract, not a flag. It wants a profiled thousand-block document to show
that the change is worth that contract, which is what this entry has been waiting
for.

Everything on the P0 and P1 lists is closed, and the last entry closed by
measurement rather than by argument: [PERFORMANCE.md](PERFORMANCE.md) shows the
hooks this list called expensive were 0.2 ms of a 2.5 ms keystroke, and that the
layout `content-visibility` removes was 113 ms. `shouldRerenderOnTransaction` is
left alone with that number in hand, not for lack of trying.

---

## P0 — Data correctness and trust

### P0-1 The trash sweep hard-deletes live documents

**S · low risk · do this first** — *already fixed in the working tree; see the
status table above.*

Deletion is recursive, restore is recursive, and permanent delete filters on
`deleted_at IS NOT NULL`. The two sweep recursions do not:

| Where | Problem |
| --- | --- |
| `lib/trash.ts:80` | `JOIN expired e ON d.parent_id = e.id` has no `deleted_at` filter |
| `routes/trash.ts:56` | the `subtree` recursion has none either |
| `routes/trash.ts:119` | **the correct form**: `AND deleted_at IS NOT NULL` |

**Reproduce**: delete a folder, restore one child on its own (making it live), and
the next sweep — fifteen minutes later, or the moment an administrator empties
the bin — removes that live document and closes its collaboration room.

The automatic sweep is more dangerous than the manual permanent delete. That
direction is wrong on its own terms.

**Done when** `test/trash.test.ts` covers it: delete the parent, restore the
child, sweep, and assert the child survives.

### P0-2 List and search queries bypass folder inheritance

**M · medium risk (it changes who can see what)** — *already fixed in the working
tree; see the status table above.*

The single access decision is sound: `domain/access.ts:72-108` walks the whole
ancestor chain in one recursive CTE and returns both the strongest inherited role
and `chain_restricted`.

But **every list-shaped query reads only the document's own `acl_restricted`**:

- `routes/document-reads.ts:28` (tree)
- `routes/document-reads.ts:37` (trash)
- `routes/document-reads.ts:58` (recent)
- `routes/document-reads.ts:69` (favorites)
- `lib/search.ts:90` (search)
- `routes/trash.ts:44-51` (the `visible` CTE when emptying the bin)

The consequence is not theoretical. Restrict a **folder**, and a child document
that was never restricted individually still appears in search — where
`lib/search.ts:84` returns `marvelous_doc_text(d.content) AS body_text` as a
snippet — while opening it directly is a 404, because `requireDoc` goes through
`getDocumentAccess`.

**Approach**: extract the `chain` CTE into a reusable fragment (a view, or an
exported SQL fragment) and replace all six call sites in one change. `body_text`
must not be returned until visibility is corrected.

**Also**: `domain/documents.ts:10-18` `assertFolderParent` checks that the
parent exists, is a folder, and is not deleted — but never checks the caller's
role on it. Any member can file a document into a restricted folder they cannot
see.

### P0-3 Collaboration permission is checked once, at handshake

**S (kick) / M (periodic recheck) · medium risk** — *already fixed in the working
tree; see the status table above.*

- `collaboration/socket.ts:36-37` snapshots `canWrite` into `clientState`
- `collaboration/socket.ts:113-118` calls `getDocumentAccess` only during upgrade
- `routes/sharing.ts:26-76` changes an ACL without notifying any socket
- `routes/trash.ts:66-77` soft-deletes without `evictRoom` (only permanent
  delete, empty, and sweep evict)

So demoting someone from editor to viewer leaves their connection writing, and a
document in the bin can still be edited from an open tab.

**Approach**: after the ACL transaction commits, walk that document's room and
close any connection whose new role is `viewer` but whose `canWrite` is true;
add `evictRoom` to the soft delete. The cheaper variant is a 60-second
`lastAccessCheck` inside the message handler that re-runs the decision when
stale.

The client already surfaces `collabStatus`, so an interruption can be explained
in place.

### P0-4 `trustProxy` is unset, so login throttling is one shared bucket

**S · low risk, but it changes rate-limit behaviour** — *already fixed in the
working tree; see the status table above.*

`apps/server/src/index.ts:23` passes only `{ logger, bodyLimit }`; `trustProxy`
appears nowhere in the server source.

`request.ip` is therefore the nginx container address, and the `ip:` bucket in
`routes/auth.ts` **degenerates into one bucket for everyone**: ten failed logins
lock the entire workspace out.

**Do not apply P0-4 blindly**: the in-flight refactor already adds a
`config.trustProxy` (working tree: `core/config.ts`) and passes it to Fastify at
`index.ts`. Check which side landed before touching it, and keep the
`TRUST_PROXY=false` escape hatch for a deployment that publishes the API
directly — trusting `X-Forwarded-For` is only safe behind a proxy that overwrites
it.

**Note**: fixing this flips throttling from "one shared bucket" to "per real
address". That behaviour change belongs in [SECURITY.md](SECURITY.md) in the same
commit.

### P0-5 Four security items outside the ACL

*Partly fixed in the working tree: the rate limit and the plaintext token are
done, the ACL-blind share read is not.*

| Item | Evidence | Size |
| --- | --- | --- |
| `PUT /documents/:id` has no rate limit at all | `routes/document-writes.ts` registers no `rateLimit` preHandler | S |
| Share-link tokens are stored in plaintext, while invite tokens are SHA-256 | `routes/sharing.ts:77` vs `routes/auth.ts:52` | S |
| Share links ignore the ACL entirely, so a link minted before a document was locked still reads it | `routes/sharing.ts:110` checks only `deleted_at` | S |
| `/shared/:token` has no rate limit and no access count | `routes/sharing.ts:105` | S |

### P0-6 Four client bugs that cost users their work

*Partly fixed in the working tree: (a) and (b) are done, (c) and (d) are not.*

| # | Problem | Evidence | Size |
| --- | --- | --- | --- |
| a | `favorites` parses raw `JSON.parse` with no try/catch; one bad key blanks the app | `hooks/useWorkspaceData.ts:54` | S |
| b | bootstrap treats *any* error as an expired session, so a network blip clears the token and returns to login | `hooks/useWorkspaceData.ts:113` | S |
| c | with a token but no user yet, it renders `LoginPage`; the shell flashes a login form on every load | `App.tsx:657` | S |
| d | batch delete dispatches `mdoc-reload`, which **nothing listens for**; deleted rows stay in the sidebar | `App.tsx:573` | S |

(d) deserves its own line. The event name suggests a mechanism exists, but there
is not one `addEventListener` for it anywhere in the repository. A fake wire is
more expensive than no wire, because it stops the next reader from looking.

### P0-7 No retention policy on versions, and one missing index

**S (index) / M (retention) · low risk**

- `migrations/001_initial.sql:59-68`: `document_versions` stores a full content
  JSONB per row, and **nothing deletes from it anywhere in the repository**.
- An eight-hour session at the ten-minute interval produces roughly 48 full
  copies of the document.
- `routes/workspace.ts:27`: `GET /workspace/stats` runs `count(*)` over that
  table on every request.
- `migrations/001_initial.sql:35`: `documents(parent_id)` has a foreign key but
  **no index**, while access resolution, deletion, and moves all recurse on it.

The throttling itself is right (fingerprint dedupe, idle 2 min / interval 10 min,
`document_history_pending` resuming after a restart). Only retention is missing.

**Approach**: a `007_*.sql` adding the `documents(parent_id)` index; retention as
"newest N per document, plus one per day, plus everything from the last seven
days", hung off the existing timer, **starting as a dry run that only logs**.

### P0-8 Put the browser verifiers in CI

**S · low risk · highest leverage in this document**

`scripts/verify/*.mjs` are six dependency-free verifiers (the seventh file there,
`public-art.mjs`, is a shared asset helper rather than a verifier): esbuild bundles
the real source, a headless Chrome is spawned, and a bare WebSocket drives it over
the DevTools protocol. They exercise real components, real styles, and a real
ProseMirror instance, and they fail with geometry rather than
"selector not found".

None of them runs in CI: `.github/workflows/ci.yml` stops at
lint/typecheck/test/build, and `verify:browser` is only a local npm script.
`.github/workflows/release.yml` builds and pushes images on a tag **without
running the tests first**.

**Approach**: add `pnpm verify:browser` to CI (it needs `CHROME_PATH`), and make
the release workflow depend on CI through `needs:` or `workflow_run`.

This is the only mechanism that stops P0-1 and P0-2 from coming back.

---

## P1 — Structural debt

### P1-1 Collaboration persists everything, every 500 ms, and rebuilds the index

**L · high risk (data-safety critical path)** — *the projection clock is split out;
see the status table. The queue split and incremental state are still open.*

`collaboration/rooms.ts:118-138` `persistRoom` does five things per trigger:

1. serialises the whole `content` JSON
2. writes the whole `yjs_state` bytea
3. `version + 1`
4. derives the title
5. appends a full `document_versions` row

Changing `content` rebuilds both GENERATED tsvector columns and both GIN indexes
from `migrations/003_full_text_search.sql:48-56`. So each typing pause is a full
write plus an index rebuild.

Two things amplify it:

- `collaboration/socket.ts:41` funnels **every** WebSocket message into the same
  per-document queue, so one slow commit blocks all inbound messages for that
  document
- `routes/document-reads.ts:136` `GET /documents/:id` `flushRoom` first, which
  means **a read waits behind the write queue**

**Direction**:

1. append Yjs deltas and compact periodically, instead of writing full state
2. move the `content` projection onto its own slow path — it is what triggers
   the index rebuild
3. split sync messages from persistence

**Before starting**: a test that proves `yjs_state` still reconstructs the
document after `kill -9`.

### P1-2 The editor measures the whole document

**M · medium risk** — *measured: see [PERFORMANCE.md](PERFORMANCE.md). The claim in
this entry was right about the code and wrong about where the time goes.*

| Hot spot | Evidence | What happens |
| --- | --- | --- |
| `useBlockGeometry` | `hooks/useBlockGeometry.ts:47-92` | walks `doc.descendants` on every transaction, selection, scroll, and `ResizeObserver` tick; each hit does `nodeDOM` + `getBoundingClientRect()` (forced layout) and walks the ancestor chain with `getComputedStyle` |
| Whole-tree re-render | `components/editor/DocumentEditor.tsx` (`useEditor`) | no `shouldRerenderOnTransaction` (zero hits repo-wide), so every keystroke re-renders the editor React tree, while `EditorToolbar` alone asks `isActive` 19 times (27 across the toolbars) |
| Word count | `DocumentEditor.tsx` (`onUpdate`) | `getText()` over the whole document per keystroke, while `@tiptap/extension-character-count` is installed and unused |
| Save confirmation | `DocumentEditor.tsx` (`confirmPersisted`) | polls `GET` of the whole document every 1.2 s, and that GET flushes the room |
| Degraded anchor lookup | `hooks/useBlockAnchor.ts:94-111` | when `posAtCoords` returns null it measures every top-level DOM child, unthrottled |

At 3000 blocks with 200 tables, images, or code blocks, that is 200 layout reads
plus a full re-render per keystroke.

### P1-3 Keyboard gaps

**S · low risk · high perceived value** — *done; see the status table.*

`addKeyboardShortcuts` appears **exactly once** in the client
(`lib/editor/code-block.ts:185-193`).

| Problem | Evidence | Effect |
| --- | --- | --- |
| Tab does nothing in prose | repo-wide, `'Tab'` appears only in the code block and dialog focus traps | Tab in a paragraph drops focus out of the editor |
| Indent exists only on a toolbar button | `components/editor/EditorToolbar.tsx:186-187` | `sinkListItem` only affects list items; a paragraph cannot indent |
| No block-level shortcuts | `BlockHandle.tsx:41-116` — 14 commands, all pointer-only | `blocks.ts` already exports `moveBlock`/`duplicateBlock`/`deleteBlock`; they are simply not wired |
| `Ctrl+K` is taken by the command palette | `App.tsx` shell key handler | with text selected, `Ctrl+K` opens search instead of linking it |
| Esc does not layer | the shell key handler vs `SlashMenu.tsx` (`preventDefault` but no `stopPropagation`) | one Esc closes the slash menu *and* the right panel |
| `/` triggers too narrowly | `DocumentEditor.tsx` slash trigger `/(^|\s)\//` | impossible to type after Chinese punctuation or a full-width space; no trigger inside list items |
| Slash menu matches Chinese labels only | `SlashMenu.tsx` filter | `h1`, `todo`, and pinyin initials return nothing |

### P1-4 Touch is not usable

**M · medium risk (needs a real device)** — *done; see the status table.*

- `BlockHandle` shows the gutter only when its anchor is non-null, and the anchor
  is produced solely by `pointermove` (`useBlockAnchor`). On a device with no
  hover, **block menus, dragging, and move up/down are all unreachable**.
- `editor.css`: `.block-gutter` is not covered by any `@media (hover:none)` rule
  (the project has three such blocks elsewhere, so the pattern exists).
- `DocumentEditor`: the bubble menu and slash menu position with
  `window.innerWidth` instead of `visualViewport`, so the menu lands under the
  software keyboard. `ui/Popover.tsx` gets this right; there are two standards in
  one project.
- `styles/base.css`: `.app-shell{height:100vh}` rather than `dvh`.
- `apps/web/index.html`: no `viewport-fit=cover`.

Do not regress what already works: the mobile toolbar reflows instead of
scrolling sideways, hidden groups move into a "more" menu, and rows are 44 px.

### P1-5 Information architecture: documents have no identity

**S~M · medium risk** — *`?doc=`, the breadcrumb trail and `ancestorsOf` are done;
recent and the sidebar grouping are open.*

- No URL routing beyond `/shared/:token` (`App.tsx:48-50`). A document has no
  address, so **a reload always returns to the first document**
  (`hooks/useWorkspaceData.ts:110-111`), back navigation does nothing, and a
  document cannot be sent to a colleague.
- The breadcrumb has two levels, `我的文档 ▸ title`
  (`components/layout/TopBar.tsx:45-48`), with no ancestor chain. `parentId` is
  already in every row; this is pure UI.
- The sidebar is five flat items (`Sidebar.tsx:129-135`) with no grouping, so
  every new view has to be appended to the same list.
- `GET /documents/recent` is implemented and asserted by the route test, but
  **the web client never calls it** (`routes/document-reads.ts:54-61`). The home
  page's "recent" is a client-side slice by `updatedAt`
  (`pages/HomePage.tsx:117`).

Order: **URL → breadcrumb → recent → sidebar groups**. What makes this feel like
Notion is those four, not another theme.

### P1-6 Half-finished work and dead code

**S · very low risk · pays for itself in every later read**

| Item | Evidence |
| --- | --- |
| `versions` state is declared and never used | `useWorkspaceData.ts:53` → `App.tsx:226` → `DocumentPanel.tsx:17` |
| `updatePrompt` is always null, so the update dialog is unreachable | `App.tsx:105,275,988`; `ShellDialogs.tsx:95-101` |
| `styles/updates.css` is referenced by nothing, and no component renders its classes any more | repo-wide |
| `'__favorites__'` magic string: repeated reads, zero writes | `App.tsx:650,691,843`, plus `lib/app-types.ts` once the refactor lands |
| `api.activity` has no web consumer (`ActivityEntry` survives only in the CLI's own types) | `lib/endpoints.ts:100` |
| Closed: share-link UI exposes `expiresInDays`, actual expiry, revocation and a manual-copy field for newly minted links. New UI links are `viewer`; `commenter` remains API compatibility metadata, not a public commenting promise | `hooks/useSharing.ts`, `components/dialogs/ShareDialog.tsx`, `routes/sharing.ts` |
| Closed: the public page shows the document title and read-only capability, resets on token changes, cancels superseded reads and offers retry on failure | `pages/SharedDocumentPage.tsx`, `lib/shared-document.ts` |
| The command palette advertises `⌘N`, but `App.tsx:307-317` has no `n` branch | `pages/CommandPalette.tsx:39` |
| The outline `useMemo` depends only on `[editor]`, so it never updates as the document changes | `components/editor/FindReplace.tsx:123-130` |
| Dragging a document from the sidebar into the editor **inserts its UUID as text** | `TreeItem.tsx:110-115` writes `text/plain=id`; the editor's `handleDrop` reads only `files` |

### P1-7 Engineering — *all but the release platform; see the status table.*

| # | Item | Evidence | Size |
| --- | --- | --- | --- |
| a | the version is hand-edited in nine places (four `package.json`, two `.env.example`, `docker-compose.yml`, `latest.json`, `API.md`) — *now that `scripts/release/bump-version.mjs` owns the copies, what is left is to run it from CI with `--check`* | `docs/RELEASING.md` | S |
| b | `RELEASING.md` used to send operators to `docker-compose.deploy.yml`, which **does not exist** in the repository; the file now names `docker-compose.yml` and `COMPOSE_FILE` — *verify the deploy scripts agree before closing this* | `docs/RELEASING.md` | S |
| c | a Google Fonts `@import` blocks first paint, with no `preconnect` | `styles/index.css:33`, `apps/web/index.html` | S |
| d | 37 PNGs (3,687 KB) ship alongside 37 WebPs (797 KB), and `.png` appears in `apps/web/src` only inside two example strings | `apps/web/public/art` | S |
| e | production crashes are silent: `ErrorBoundary` logs to the console only in DEV | `components/ui/ErrorBoundary.tsx:15-17` | S |
| f | no `/metrics`, no trace id across REST → room → socket | `routes/system.ts` | M |
| g | migrations have no `schema_migrations`, no advisory lock, no per-file transaction | `lib/migrations.ts:11-19` | S/M |
| h | ~~`release.yml` hardcodes `linux/arm64`~~ — **resolved as by-design**: the arm runner is native and QEMU hung per tag; an amd64 path exists behind `workflow_dispatch`, and the header states the three-part multi-arch change is its own project | `.github/workflows/release.yml` | — |
| i | no `jsx-a11y`, no type-aware rules | `eslint.config.mjs` (flat config with neither plugin) | M (start as warnings) |

### P1-8 Product gaps, in batches that can ship separately

Notifications/inbox (no table, route, or UI), @mentions, backlinks, i18n (4548
hardcoded Chinese strings), PWA/offline, self-service signup, API tokens,
webhooks, workspace-level audit log, whole-workspace or per-folder ZIP export,
HTML/Word/Notion import, first-run setup and demo data.

**Notifications** are the best value of that group: `document_activity` and
`comments` are already the base, and `Sidebar`'s `nav-count` style exists.

---

## P2 — Needs its own project

| Item | Why it cannot be a side change | Size |
| --- | --- | --- |
| Databases and views (table/board/calendar/gallery) | not an editor extension: a second content model, new screens, new API, and `documents` has no `properties` column at all | XL |
| Multiple workspaces / teamspaces | nearly every query carries `workspace_id` (40+ places), and the JWT bakes `workspaceId` in, so switching means signing in again | XL |
| Synced blocks / block references / backlinks | needs stable block IDs first; today a block is positional arithmetic (`lib/editor/blocks.ts:25-33`) | XL |
| Multi-replica collaboration | see "What not to do" #5 | XL |
| Column layouts | multi-column ProseMirror schemas are a known hard problem, and Markdown has no representation | L |
| Page references and mentions | cross-cutting contract, ACL checks (the target may be invisible), and three export paths | L |
| Block-level version diff | today only an LCS add/remove count | L |
| Formulas / KaTeX | new node, two marks, export support, and about 280 KB loaded on demand | M~L |

---

## What not to do

Each entry has a reason. Overturning one takes new evidence, not a new preference.

1. **Do not redo the editor schema to feel more like Notion.** The server mirrors
   the Tiptap schema and rejects anything it cannot represent, so a schema change
   invalidates every stored version and every export at once. Editor depth is the
   most valuable asset here.

2. **Do not add a client node before the server schema.** `lib/editor/image.ts:11-13`
   records this trap in a comment: with a mismatched schema **collaboration keeps
   working while REST saves return 400**, which is very hard to find. The order is
   server `lib/schema.ts:24-41` → client `lib/editor/index.ts:31` → the three
   export paths (`markdown/serialize.ts`, `markdown/html.ts`,
   `export/render-html.ts`).

3. **Do not rewrite state management on react-query or SWR.** The two genuinely
   hard problems — out-of-order document switches and concurrent writes — are
   already solved by `DocumentSaveQueue` and the 409 draft path. If it ever
   happens, wrap the read path only and leave the save queue alone.

4. **Do not go back to ILIKE, and do not add Meilisearch yet.** What is missing is
   **filters and pagination**, not an engine. An external engine would have to
   redo the CJK problem that `marvelous_cjk_tokens` already solves.

5. **Do not scale out before single-replica correctness is settled.** Redis turns
   "two Y.Docs" into "two Y.Docs plus a Redis" and settles neither who increments
   `version` nor who writes the `content` projection. [ARCHITECTURE.md](ARCHITECTURE.md)
   treating one instance as an explicit choice is correct.

6. **Do not virtualise the editor.** Block handles, block geometry, and comment
   decorations all assume the DOM is the document. Try `content-visibility: auto`
   with `contain-intrinsic-size` first, and **regress it with
   `verify-blocks.mjs`** for handle placement and drop targets.

7. **Do not move the access decision out of SQL.** `visibleDocumentsCte` answers
   for every list query and `getDocumentAccess` for a single document; two
   traversals in one statement are harder to get wrong than three round trips, and
   they must keep agreeing.

8. **Do not materialise inherited ACL rows.** Computing inheritance at read time
   is right. Materialised rows would need a cascade whenever a folder changes, and
   `parent_id` does not even have an index.

9. **Do not "simplify" the four layers of restore concurrency control.**
   `expectedVersion`, `expectedStateVector`, the in-transaction `FOR UPDATE`
   recheck, and the `before_restore` snapshot each stop a real race. This is the
   code most worth keeping exactly as it is.

10. **Do not add a theme without checking the layer budget.** There are two themes
    and seven hand-drawn layers, roughly 730 lines of CSS on top of twenty-one
    shared ones; every new skin has to repaint all of them.

11. **Do not replace `scripts/verify/*.mjs` with Playwright.** They have no
    dependencies, drive real modules, and report geometry. They run in CI now;
    the missing piece was the wiring, not a different tool.

12. **Do not add another `setInterval` without a reason it cannot be a job.**
    `index.ts` now runs two (trash retention, version retention), `routes/auth.ts`
    runs one (throttle sweep), and the history checkpoint adds a per-document
    timer. Each is lost on restart and duplicated per replica, which is fine for
    idempotent sweeps and not fine for anything that must happen exactly once.

13. **Do not move PDF export back to the server.** It is browser rasterisation
    today, lazy-loaded at 173 KB gzipped; a server-side text PDF needs megabytes of
    CJK fonts.

14. **Do not do i18n before there are real users who need it.** 4548 literals,
    twenty-one CSS layers, and two themes mean every later PR doubles in diff size.

---

## If only three things happen next

The P0 list is closed, so the question is what earns the next three changes.

1. **P1-2** — the editor measures every block on every transaction and re-renders
   the whole tree on every keystroke. It is the one remaining item that degrades
   with document size, and the one where the fix is measured rather than argued.
2. **P1-5's last two** — recent in the sidebar, and grouping it. The endpoints
   exist and the data is already fetched; this is the difference between a tree
   that grows and a workspace that is navigable.
3. **P1-1's queue split** — a slow commit currently blocks every inbound message
   for that document, including the reads. The projection clock took the write
   amplification out; this takes out the head-of-line blocking.
---

## The suites could not run together

Five server suites started their in-process PostgreSQL on a fixed port (5599, 5601,
5603, 5611, 5613). Each one passed alone and the set did not: a killed process left
the listening socket open and the next suite died with `EADDRINUSE` before a single
assertion, which reads as a hang rather than a failure. That is why the numbers in
earlier rounds were per-file sums.

Two things fixed it, and one of them was a real bug rather than a test problem:

- every suite now binds port 0 and asks the server what it got (`test/socket-url.ts`);
- `PUT /documents/:id` authorised **inside** `withRoomMutation`, so a caller that
  reacted to the access query queued a second write behind the one waiting on it. One
  request could deadlock the document. Authorisation moved before the queue.

`npx tsx --test test/*.test.ts` now runs all 112 cases in one process, 11 seconds,
exit 0. One fixture defect remains skipped, with its diagnosis written down: it
freezes a `COMMIT` that the server needs in order to answer, so the gate has to be
released from the thing blocked on it. What it was meant to cover - that the durable
state is always complete and a read repairs the projection - is asserted separately.

---

## What the verifiers caught

P0-8 was the claim that the browser verifiers are the mechanism that keeps the
rest honest. Two changes in this pass proved it before the wiring even reached a
pipeline:

- the breadcrumb started taking a `trail` prop, and both harnesses that mount
  `TopBar` kept rendering it without one — `verify-themes` failed with
  "topbar disappeared while switching themes" and `verify-selectability` threw on
  a null `.sidebar-scroll`. Neither is a style regression; both are the harness
  and the component disagreeing about the contract, which is exactly what a
  render-level check is for.
- the theme probe also re-checked that a colour literal had not crept into
  `.comment-compose textarea`.

Keeping the harnesses compiling is part of changing a component's props, and the
verifiers are where that shows up.

---

## Method and evidence conventions

- Read-only: `read`, `grep`, `glob`, and read-only git commands. No build, no
  install, no file was changed by the audit.
- Line numbers refer to `main` **before** the in-flight history refactor landed.
  They will drift; the code wins. The one exception is the "Status of the P0 list"
  table, which is deliberately checked against the working tree because its job is
  to tell you what is already done.
- Every claim carries a `file:line`. Guesses that could not be verified were
  dropped rather than softened.
