# Editing conventions

Interaction contracts that are not obvious from the code, and the reasoning
behind them. Each entry exists because a library's default behaviour was
wrong for a writer, not for a programmer.

## Code blocks

Code blocks retain the standard ProseMirror schema: raw text, the existing
language attribute, and the same HTML/Markdown serialization. The editing view
is a React NodeView (`components/editor/CodeBlockView.tsx`), so its toolbar is
inside the code card and clips with the paper's scroll area. It is never a
fixed overlay in `document.body`.

The header exposes language, display-only wrapping, exact-text Copy, and a
more-actions button. Wrap adds no newlines to saved or copied code. Moving,
duplicating, inserting prose below, and deleting use the **same block menu** as
the gutter and context menu. The first/last block disables unavailable moves.
Nested code belongs to its top-level list/quote for these structural actions;
it is never extracted accidentally. Structural changes isolate undo capture in
both ProseMirror history and Yjs, preserving the moved block's cursor/range.

`lib/editor/code-block.ts` owns the keyboard contract:

| Press | Where | Result |
| --- | --- | --- |
| `Enter` | anywhere in code | insert a literal newline, replacing selected text normally |
| `Shift+Enter` | anywhere in code | insert a literal newline, never exit |
| three `Enter` presses | at the end | remove the two escape newlines and continue in prose |
| `Ctrl/⌘+Enter` | anywhere in code | continue in the next empty paragraph, or insert one below |
| `Tab` | collapsed caret | insert two spaces |
| `Tab` / `Shift+Tab` | selected lines | indent / remove one indent, preserving code and selection |
| `Shift+Tab` | collapsed caret | remove one indent from the current line |
| `Backspace` | start of nonempty code | preserve the code and block type |
| `Backspace` | empty code | remove the block, retaining a valid paragraph if it was the only block |

Enter must support writing multiline snippets at the end as well as in the
middle. Backspace must never clear an entire nonempty snippet or demote it to
prose. The explicit exit shortcut is shown in the desktop code header and Help;
the triple-Enter shortcut remains available. Non-code selections and ordinary
character deletion keep their existing keyboard handlers.

The UI separation follows the code-specific controls documented by
[Notion](https://www.notion.com/help/code-blocks), while the editing boundary
behavior builds on [Tiptap's code-block extension](https://tiptap.dev/docs/editor/extensions/nodes/code-block).
This repository uses Tiptap 2; its installed keymap and code-block implementation
were checked rather than copying newer Tiptap 3 options.

Tests in `test/code-block.test.ts` use real ProseMirror states, keymap fallthrough,
and history. `test/block-commands.test.ts` verifies structural transactions.
`scripts/verify/verify-blocks.mjs` mounts the real React code view, gutter, shared
menus and styles in Chrome, including Yjs undo isolation, wrap and Copy.

## Comment markers

A thread stores an `anchor: {from, to, text, relative?}` range. The text in the document is
marked from that anchor by `lib/editor/comment-marks.ts`, which is a ProseMirror
**plugin with decorations**, not a mark:

| Concern | Why a decoration |
| --- | --- |
| Export, versions, Markdown round-trip | A mark would be part of the document body and would leak into all of them. A decoration is view state only. |
| Placement | New collaborative anchors include Yjs relative positions, so edits and reloads preserve item identity. Legacy absolute offsets are accepted only while the complete quoted text still matches (500-character snapshots are explicitly capped). |
| Editing | Typing before a marker carries it along; deleting or replacing its entire quote leaves a deleted-range tombstone. Undo restores the quote and its marker. Replacements never acquire the discussion accidentally. |
| Overlap | Two threads on the same words share one span, whose tooltip names both. |

The open thread is tinted through `is-commented-active`, resolved threads fall
back to a dashed rule, and the range the composer is quoting is drawn as
`is-comment-draft` so the writer can see what the comment will point at before
sending it.

Two interactions cross the boundary and are worth knowing about:

- pressing marked text dispatches `mdoc-focus-comment`; the shell opens the
  comments tab, tints the card and scrolls it into view, then sends
  `mdoc-focus-anchor` with the thread ID to select its live range. Raw saved
  offsets are never navigation targets. The click is not swallowed, so the
  caret still lands in the text.
- pressing a card calls `onActiveComment`, which reaches the same plugin through
  `setCommentMarks` and lights the sentence. The card's own quoted-snippet
  button also re-selects the range in the document.

Both directions are covered by `test/comment-marks.test.ts` (placement, mapping,
deletion, tinting) and `scripts/verify/verify-comment-marks.mjs` (CSS, caret,
click direction), which mounts the real editor and the real panel in Chrome.

To change any of this, edit `lib/editor/comment-marks.ts`; the extension is
registered in `lib/editor/index.ts` next to `CodeBlockBoundary`.

### Discussion lifecycle

Deleting source text keeps the discussion, its original quoted snapshot, replies,
and resolution state. The card labels a mapped deletion as "原文已删除" and disables
navigation. An older snapshot that no longer matches, or a relative anchor from a
replaced Yjs document, says "原文已删除或已更改" instead of claiming to know which
operation occurred. It never searches for another identical sentence to reattach.
Remote Yjs edits replace the ProseMirror document in one transaction: relative
anchors resolve item identities; legacy anchors map the minimal changed slice.

Replies are grouped under one root, including legacy nested replies. Open,
resolved, detached-source and author filters preserve the whole matching thread.
A resolved discussion must be reopened before replying. Sending captures the
composer's currently mapped quote, rejects a deleted quote, and prevents duplicate
submissions. Replies show an explicit cancellable target, without pretending an
`@name` string is a real mention or notification.

Authors may edit or delete their own comment or reply. Administrators cannot
rewrite another author's words; document editors may resolve and reopen root
discussions. Deletion is confirmed and clears the stored body with `deleted_at`
(migration 008), leaving a non-editable placeholder and preserving other people's
replies and the thread's quoted context. Whole-document permanent deletion still
removes its comments. Workspace open-comment counts represent unresolved root
discussions, excluding empty deleted threads.

These are this product's retention and deletion choices. Notion's
[official comments guide](https://www.notion.com/help/comments-mentions-and-reminders)
documents thread replies, editing/deleting, status filters and reopening; it does
not specify every deleted-source edge case. The persistent anchor mechanism follows
[Yjs relative positions](https://docs.yjs.dev/api/relative-positions), verified
against the installed y-prosemirror version. API integration tests cover content
deletion without discussion loss, reply normalization, validation, author/admin
boundaries and deletion placeholders. The Chrome verifier also exercises moved
quote navigation, deleted-source labels, undo, author filters, edit and confirmed
delete interactions.

## Find, replace, and links

Find works in ProseMirror document positions, including nested list items,
quotes, tables, and words split by formatting. It does not match across inline
atoms or block boundaries. Results subscribe to edits and undo; navigation keeps
focus in the search input. Replace inserts literal text, including `<b>` and
other HTML-looking strings. Replace All has no hidden 500-result cutoff and is
one undo step, isolated from adjacent typing in ProseMirror and Yjs history.

Link editing captures a request scoped to its document and maps the target
through transactions while the dialog is open. Deleted or replaced targets are
rejected; applying an old absolute range is never allowed. A caret inside a link
expands to the whole link and pre-fills its URL. Removing a link retains its
words; a bare caret inserts a visible linked URL. Saving and opening accept only
complete HTTP(S) URLs, and outgoing tabs use `noopener noreferrer`.

`test/find-replace.test.ts`, `test/link-editing.test.ts`, and
`scripts/verify/verify-editor-tools.mjs` cover those contracts. The browser
verifier mounts the real `DocumentEditor` and link dialog to exercise concurrent
prefix insertion and target deletion, not only the pure mapping helper.

## Indentation and tables

`changeBlockIndent` is shared by toolbar buttons and prose Tab. It adjusts
selected paragraphs/headings independently, clamps their persisted `indent`
attribute to 0-6, and uses structural list commands for ordinary and task lists.
Unavailable operations disable their buttons. Code owns literal indentation;
table Tab/Shift-Tab fall through to cell navigation. The mobile overflow menu
includes task lists and indentation too.

The table menu preserves the cell selection, disables merge/split when they
cannot run, exposes row/column/cell header toggles, and uses the shared popover
for dismissal and viewport clamping. These are the installed Tiptap 2 table
commands documented in [Tiptap's table reference](https://tiptap.dev/docs/editor/extensions/nodes/table),
without introducing database-table behavior. Read-only editors hide floating
image/bubble/table editing tools and prevent toolbar mutations.
