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
