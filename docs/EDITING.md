# Editing conventions

Interaction contracts that are not obvious from the code, and the reasoning
behind them. Each entry exists because a library's default behaviour was
wrong for a writer, not for a programmer.

## Code blocks

A code block is a ProseMirror `code: true` node: its content is raw text and
every keystroke is literal. That is right for writing code and wrong for
getting out again, so `lib/editor/code-block.ts` owns the boundaries:

| Press | Where | Result |
| --- | --- | --- |
| `Enter` | middle of the block | newline, as expected |
| `Enter` | at the end of the last line | a paragraph is created below and the caret moves to it |
| `Shift+Enter` | anywhere in the block | newline (never leaves the block) |
| `Backspace` | at the start, block has text | the text is cleared, the block stays |
| `Backspace` | at the start, block is empty | the block node is removed, caret goes before it |

Why these and not the stock behaviour:

- **Enter leaving at the end.** The stock escapes are triple Enter and
  ArrowDown on the last line. Neither is discoverable, and "press Enter where
  you want to start writing" needs no documentation. Everywhere else stays a
  newline, so the block remains usable for code.
- **Shift+Enter inserting a newline.** The stock handler maps it to
  `exitCode()`, so the one shortcut that means "line break" everywhere else
  was the only way out.
- **Two-step Backspace.** The stock handler calls `clearNodes()`, which
  *demotes* the node to a paragraph and keeps the code as body text, so
  deleting a code block looked like deleting the wrong thing. Clearing first
  makes every intermediate state ordinary undoable editing.

The node schema is untouched: no attribute, no mark, no new node type. That
keeps `apps/server/src/lib/schema.ts`, the Markdown round-trip and existing
documents all valid.

To change any of this, edit `lib/editor/code-block.ts`. The handlers are covered by
`test/code-block.test.ts`, which runs them against a real ProseMirror state
with no DOM.

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
