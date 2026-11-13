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
