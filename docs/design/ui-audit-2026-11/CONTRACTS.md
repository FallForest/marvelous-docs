# Batch A/B shared contracts

Written before implementation, because three work streams touch the same
components. Each stream reads this file and must not contradict it. Line numbers
refer to the workspace at the start of the batch.

## 1. What is already landed (Batch A, first half)

These are done in the working tree; a stream must build on them, not redo them.

| Change | File |
| --- | --- |
| Object target comes from the selection, never from viewport order | `lib/editor/selection-target.ts` (`activeTable`, `selectedImage`) |
| Image tool only for a `NodeSelection` on an image | `ImageToolbar` + `DocumentEditor` object-target effect |
| Table tool anchored to the table under the caret; the bar disappears if the node at that position is no longer a table | `TableMenu`, `DocumentEditor` |
| Floating bars clamp to the visual viewport, not `innerWidth/innerHeight` | `ImageToolbar`, `TableMenu` |
| IME guard for the slash menu (Enter/Escape/arrows held during composition and for 60 ms after) | `lib/editor/ime.ts`, `SlashMenu` |
| Title field: Enter after composition commits, saves, and moves the caret into the body | `DocumentEditor` |

## 2. Object selection contract

One source of truth: `activeTable(state)` and `selectedImage(state)` in
`lib/editor/selection-target.ts`.

- A tool appears only when its object is the current selection target.
- A tool never acts on a position it did not receive from that resolver.
- If the resolved node is gone (deleted locally or by a collaborator), the tool
  unmounts on the next transaction. It never retargets a neighbour.
- Placement may read measured geometry for that position only; it must not
  search the geometry list for "the first table/image".

## 3. IME contract

`lib/editor/ime.ts` is the only place composition state is tracked.

- Every keyboard handler that can run a command on Enter/Escape/arrows/Tab calls
  `guard.blocked(event.nativeEvent)` first and returns when true.
- Composition boundaries are observed with `compositionstart`/`compositionend` on
  the surface the handler listens to (capture phase for `document`).
- Nothing may call `preventDefault()` on a key it has decided to ignore.
- Ordinary character keys are never blocked; only command keys.

## 4. Focus-return contract

Opening an overlay records the element that had focus. Closing it — by Escape,
by choosing a row, by clicking away, or by the command that opened it — returns
focus to that element, or to the editor when the recorded element is gone
(e.g. the row that opened a menu was itself removed).

The editor surface is the fallback because it is where the writer was working.
`document.body` is never an acceptable resting place for focus.

## 5. Capability matrix (phone)

Every formatting command must remain reachable at `max-width: 560px`. A command
may move into a menu; it may not disappear. Current gaps, from `editor.css`
lines 388-456: colour, highlight, alignment, redo, `inline code`, image upload,
link, find, outline.

The rule for the phone row: undo, block style, bold, insert, more. Everything
else with a visible entry inside "more", grouped and scrolling inside the panel
rather than behind a horizontal swipe.

## 6. Navigation contract

- A folder opens the folder page from **every** entry: sidebar tree, home card,
  favourites, search results, command palette, breadcrumb.
- A document opens the editor from every entry.
- Search does not unload the document. While a query is being typed the editor
  stays mounted; only an accepted result navigates. Cancelling restores the
  caret, the scroll position and the previously open document.
- A page shows only the chrome that can act on it. `hasDocument` is false for
  home/folder/search/trash/all, so document-only actions must not render there.

## 7. Motion contract (already established in the repo)

Do not add a second animation system. `styles/tokens.css` owns durations and
curves; `styles/motion.css` owns keyframes and utilities; `lib/motion.ts` mirrors
the values JS needs.

- A menu/bar entrance is one animation, `backwards` fill, never replayed by a
  re-measure or a position write.
- Exits are at least as fast as entrances (140 out / 220 in).
- Text, the caret and line height never animate. No per-character motion.
- A press is `:active` only: `scale(.97)` at `--duration-instant`, released on
  the spring curve. No hover scale on text-bearing chrome.
- `prefers-reduced-motion` removes travel and overshoot, keeps the state change.
- Every motion change in this batch must state which of the above it uses.

## 8. Verification

- `pnpm --filter @marvelous-docs/web test` for unit tests.
- `pnpm --filter @marvelous-docs/web typecheck` must stay clean;
  `noUnusedLocals`/`noUnusedParameters` are on.
- `scripts/verify/*.mjs` need `CHROME_PATH`; Chrome is installed here at the
  default Windows location, so browser verification is possible.
- A claim about input feel that was not measured is written as unmeasured.
