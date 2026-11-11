# Motion

How movement works in this client, what to reuse, and what not to add.

The reference is iOS. That does not mean "animate everything" — UIKit is
restrained: springs for anything that moves through space, cross-fades for
anything that only changes state, and nothing that makes the user wait.

## The three files

| File | Owns | Never contains |
| --- | --- | --- |
| `styles/tokens.css` | Every duration, easing, spring curve, shadow, radius | Selectors with descendants, layout, state |
| `styles/motion.css` | Keyframes, motion utilities, reduced-motion rules | Component-specific rules |
| `lib/motion.ts` | The same numbers for JS, plus `prefersReducedMotion()` | CSS, React |

Every other layer — `base.css`, `surfaces.css`, `dialogs.css`,
`navigation.css`, `panels.css`, `editor.css`, `content.css`, `shell.css`,
`pages.css`, `updates.css` — only *uses* these names. A rule that hard-codes
`220ms` or `ease-in-out` is a bug: it will not be retuned when the rest of the
app is, and `structure.test.ts` fails on it.

## Choosing a motion

| The user… | Use | Duration |
| --- | --- | --- |
| pressed a control | `:active{transform:scale(.97)}` | `--duration-instant` |
| hovered a row | background/colour cross-fade | `--duration-fast` |
| opened a menu | `.motion-rise` / `.motion-sink` (below / above the trigger) | `--duration-base` |
| opened a dialog | `.motion-sheet` from 0.97 scale | `--duration-base` |
| switched screen | `.motion-enter` on the new screen's root | `--duration-base` |
| saw a list appear | `.stagger` + `staggerStyle(i)` | `--duration-base`, 28ms steps |
| expanded a folder | `.motion-disclose` on the children | `--duration-fast` |
| got a toast | `.motion-rise` | `--duration-base` |
| waits on the network | `.motion-breathe` (status dot) / `.motion-sheen` | loop |

Exit is always at least as fast as entry — 140ms for a dismissal against 220ms
for a presentation. A dialog that takes as long to leave as to arrive feels
stuck.

## The spring curves

`--ease-spring-snappy` and `--ease-spring-bouncy` are sampled from a damped
harmonic oscillator (`lib/motion.ts`, `springValue`), not hand-tuned
`cubic-bezier` values. That is why they overshoot the way UIKit does instead of
easing politely into place.

- `snappy` — response 0.28s, damping 0.86. Default for surfaces and rows.
- `bouncy` — response 0.52s, damping 0.66. Only for things that should feel
  playful: a newly added collaborator avatar, a new list item.
- `--ease-standard` / `--ease-decelerate` — plain curves for colour, opacity and
  anything where overshoot would read as a glitch.

## Rules

1. **Animate `transform` and `opacity` only.** Anything else triggers layout on
   every frame. The single blocked exception is a measured height reveal, and it
   must be marked with a comment explaining why.
2. **Never animate on mount just because a component mounted.** Local state
   (typing, list re-render) must not restart an entry animation. Key the element
   on the identity that changed (document id, message text), as `App.tsx` does
   for the toast.
3. **Respect `prefers-reduced-motion`.** CSS handles it globally in
   `motion.css` by collapsing travel to a cross-fade. JavaScript must call
   `useReducedMotion()` before animating; `scroll-behavior:smooth` is a
   JS-driven animation and counts.
4. **No motion on the critical path.** If a save, a navigation or an input
   waits for an animation, the animation is wrong.
5. **One surface, one definition.** Dialogs share `dialogSurface`; menus share
   `Popover`. A second copy of the same entrance is how the app started feeling
   inconsistent in the first place.
6. **Stagger is capped.** Ten items, 28ms apart, 280ms maximum. Beyond that the
   user is waiting for the UI, which is the opposite of the point.

## Adding something new

1. Does the value already exist as a token? Use it.
2. Does the motion already exist as a utility in `motion.css`? Use it.
3. If not: add the token to `tokens.css` first, then the keyframe + utility to
   `motion.css`, then reference both from the component's layer.
4. If JavaScript needs to know the timing, read it from `lib/motion.ts` rather
   than repeating the literal.

`structure.test.ts` enforces that `motion.css` loads before the layers that use
it, that every named layer file exists, and that no stylesheet invents a
duration that is not a token.
