# Editor cost, measured

`scripts/verify/measure-editor.mjs` drives the real editor in headless Chrome and
reports, per configuration: how long the synchronous unit of work took (what a
writer feels as input lag), the 95th percentile, and the style/layout milliseconds
the browser spent afterwards.

It can also leave either hook out (`?geometry=0`, `?anchor=0`), because "this hook
is expensive" is only answerable by measuring the editor with and without it.
Measuring one tree says what the cost *is*, not whether the code in question
causes it.

```
node scripts/verify/measure-editor.mjs            # 200 / 1000 / 2000 blocks
node scripts/verify/measure-editor.mjs 2000       # one size
```

## What it measures

- **script median / p95** — one `insertContent` through the full plugin chain, so
  every extension that subscribes to a transaction pays its cost. This is the number
  a user feels.
- **style / layout** — read from the Performance timeline, not guessed. A forced
  `getBoundingClientRect` inside a transaction lands here rather than in script
  time, so a measurement that only timed JavaScript would miss the most expensive
  thing the editor does.

The document is a realistic mix: prose, plus tables, code blocks and dividers in two
of every five positions — the block types that carry their own toolbar. A document
of pure paragraphs would measure the cheap case.

## The measurement that changed a plan

The roadmap argued for turning off `shouldRerenderOnTransaction` and for scoping
the geometry walk, on the grounds that both run per keystroke. Both statements are
true about the code. This is what they are worth:

| blocks | hooks | script median | p95 | layout ms |
| --- | --- | --- | --- | --- |
| 1000 | geometry + anchor | 1.10 | 2.80 | 68.5 |
| 1000 | anchor only | 1.00 | 1.60 | 53.0 |
| 1000 | none | 1.00 | 1.60 | 50.3 |
| 2000 | geometry + anchor | 2.50 | 3.80 | 113.6 |
| 2000 | anchor only | 2.50 | 3.40 | 103.3 |
| 2000 | none | 2.30 | 3.30 | 96.0 |

At 2000 blocks, removing **both** hooks saves 0.2 ms of a 2.5 ms unit — and 17 ms
of the 113 ms of layout, which is where a per-keystroke `getBoundingClientRect`
shows up. So:

- the hooks are not what makes a long document feel slow;
- **layout is**, by a factor of forty over script time;
- the remaining script cost is the editor itself — ProseMirror's own transaction,
  the plugin chain, the decorations — not our subscriber.

That is why `shouldRerenderOnTransaction` is still on: a React re-render per
keystroke is a real cost, but this measurement says it is not the one to attack
first, and turning it off breaks the toolbar's active states until the components
subscribe differently. The change is worth making when there is a number showing it
helps, and there is not.

## Where the cost actually is

Layout, and it scales with document size because the whole document is in the DOM.
The answer to that is not a cheaper per-keystroke handler; it is not laying out
2000 blocks to type a character.

`content-visibility: auto` with `contain-intrinsic-size`, scoped to top-level blocks
inside `.tiptap-content`, is now in `base.css`. Same harness, same two sizes:

| blocks | before: layout ms | after: layout ms | before: script med | after |
| --- | --- | --- | --- | --- |
| 1000 | 68.5 | 27.6 | 1.10 | 0.70 |
| 2000 | 113.6 | 20.5 | 2.50 | 1.50 |

Layout at 2000 blocks fell by 82%, and script time by 40% with it — the script was
waiting on the layout its own reads forced. Six browser verifiers still pass, which
is what says the block handle, the drop targets, the comment decorations and the
theme probe are unaffected.

Two things keep this honest:

- `contain-intrinsic-size` is an estimate, so the scrollbar is approximate while a
  block has never been laid out. It settles once the block is on screen, and the
  alternative — measuring the block — is the work being avoided.
- The rule is scoped to `.tiptap-content` and a test fails if it ever reaches the
  export stylesheet. Skipping layout is a lie in a document about to be
  rasterised.

The roadmap's "do not virtualise the editor" entry still stands: ProseMirror's
geometry, the block handle and the comment decorations all assume the DOM is the
document. This takes the layout win without touching that assumption.

## 2026-11-16 — UI audit batch, re-measured

A separate run, deliberately not merged into the tables above: that data was taken
against a previous tree, and the batch that produced this entry changed the
extension list (`CharacterCount` now takes `lib/format.wordCount` as its
`wordCounter`; a `uploadPlaceholder` decoration plugin was added). Comparing across
those two states would attribute a difference in the harness to a change in the
product.

Command, unchanged:

```
CHROME_PATH=<chrome> node scripts/verify/measure-editor.mjs      # 200 / 1000 / 2000
```

Environment: Windows 10 (10.0.19045), Google Chrome 157.0.8103.51, headless as the
script launches it. Fixture: the script's own mixed document — prose plus tables,
code blocks and dividers in two of every five positions — so `tracked` blocks carry
their own toolbars. `script` is one `insertContent` through the whole plugin chain;
`style`/`layout` come from the Performance timeline.

| blocks | hooks | tracked | script med | p95 | style ms | layout ms |
| --- | --- | --- | --- | --- | --- | --- |
| 200 | geometry + anchor | 5 | 0.30 | 1.20 | 8.6 | 25.5 |
| 200 | anchor only | 0 | 0.30 | 1.10 | 9.1 | 7.2 |
| 200 | none | 0 | 0.20 | 1.20 | 8.1 | 7.1 |
| 1000 | geometry + anchor | 5 | 0.70 | 1.20 | 15.6 | 14.2 |
| 1000 | anchor only | 0 | 0.60 | 1.20 | 15.6 | 14.1 |
| 1000 | none | 0 | 0.60 | 1.40 | 14.5 | 13.7 |
| 2000 | geometry + anchor | 5 | 1.60 | 2.50 | 24.4 | 22.1 |
| 2000 | anchor only | 0 | 1.80 | 3.10 | 22.5 | 22.0 |
| 2000 | none | 0 | 1.60 | 3.00 | 24.3 | 24.9 |

### What this says

- The earlier conclusion still holds on this tree: script time is 1–2.5 ms, and the
  hooks are not what makes a long document feel slow. At 2000 blocks the three
  configurations are within the run-to-run noise of each other (the
  `geometry + anchor` median is *lower* than `none`, which cannot be a real
  difference at this sample size).
- `content-visibility: auto` is still doing the work it was added for: layout at
  2000 blocks is 22 ms here, in the same range as the 20.5 ms recorded after it
  landed and far below the 113 ms before.
- The 200-block `layout` figure for `geometry + anchor` (25.5 ms) is a single run
  and the largest number in the table; treat it as noise until it reproduces. It
  is called out rather than smoothed because a table with one rule for
  inconvenient rows is a table nobody should trust.

### What it does not say

- It does not measure the input-to-visible-feedback latency a writer feels, only
  the synchronous unit of work and the browser's own layout afterwards. The audit
  proposed "p95 < 50 ms for input to visible feedback" as a **target to
  calibrate**; this harness cannot confirm or refute it, and no such target is
  claimed here.
- It does not cover a real Chinese IME, a soft keyboard, or a collaborative
  session with remote transactions arriving mid-keystroke.
- The raw run is scratch and is not committed (`.gitignore` now ignores
  `/measure-run*.txt`); the numbers above are the record.
