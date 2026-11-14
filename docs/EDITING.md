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

A thread stores an `anchor: {from, to, text}` range. The text in the document is
marked from that anchor by `lib/editor/comment-marks.ts`, which is a ProseMirror
**plugin with decorations**, not a mark:

| Concern | Why a decoration |
| --- | --- |
| Export, versions, Markdown round-trip | A mark would be part of the document body and would leak into all of them. A decoration is view state only. |
| Placement | The anchor is a snapshot. A range is placed from it only while the text at that range still says what the anchor says, then it is mapped through every transaction. |
| Editing | Typing before a marker carries it along; deleting its text removes it for good rather than underlining whatever moved in. |
| Overlap | Two threads on the same words share one span, whose tooltip names both. |

The open thread is tinted through `is-commented-active`, resolved threads fall
back to a dashed rule, and the range the composer is quoting is drawn as
`is-comment-draft` so the writer can see what the comment will point at before
sending it.

Two interactions cross the boundary and are worth knowing about:

- pressing marked text dispatches `mdoc-focus-comment`; the shell opens the
  comments tab, tints the card and scrolls it into view, then sends
  `mdoc-focus-anchor` to select the range. The click is not swallowed, so the
  caret still lands in the text.
- pressing a card calls `onActiveComment`, which reaches the same plugin through
  `setCommentMarks` and lights the sentence. The card's own quoted-snippet
  button also re-selects the range in the document.

Both directions are covered by `test/comment-marks.test.ts` (placement, mapping,
deletion, tinting) and `scripts/verify/verify-comment-marks.mjs` (CSS, caret,
click direction), which mounts the real editor and the real panel in Chrome.

To change any of this, edit `lib/editor/comment-marks.ts`; the extension is
registered in `lib/editor/index.ts` next to `CodeBlockBoundary`.
