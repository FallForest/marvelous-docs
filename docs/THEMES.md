# Themes

A theme is a **palette**, not a stylesheet. Every colour the client paints
resolves through a custom property declared in `styles/tokens.css`; a theme
re-declares the ones it changes under `[data-theme='<id>']` in
`styles/themes.css`. Switching is one attribute write on `<html>`, so there is
no re-render, no stylesheet reload, and no flash of the previous palette.

## Add a theme

Three edits, no component changes:

1. **`apps/web/src/lib/theme.ts`** — append an entry to `THEMES`:

   ```ts
   { id: 'midnight', name: '午夜', hint: '深色：夜间写作，低亮度', scheme: 'dark',
     swatch: ['#16181d', '#121419', '#e0715c'] },
   ```

   `id` must match `/^[a-z][a-z0-9-]*$/`; it becomes the attribute value and the
   stored preference. `swatch` is the three-stop preview in the picker (page,
   chrome, accent).

2. **`apps/web/src/styles/themes.css`** — add the palette block. Start from the
   commented template at the bottom of the file. Only list the tokens you want to
   change: an omitted token falls back to the shipped palette, which is what lets
   a theme recolour the accent alone.

3. **`apps/web/index.html`** — add the id to the pre-paint map:

   ```js
   var themes = { paper: ['light', '#ffffff'], midnight: ['dark', '#16181d'] };
   ```

   This one duplication is the price of not flashing: the script runs before the
   bundle parses, so it cannot import the registry. `test/theme.test.ts` fails if
   the two lists disagree, or if `themes.css` lacks a block for a registered id.

Nothing else. The picker reads `THEMES`; the shell reads the same hook; the
pre-paint script paints the stored id on the first frame.

## The token contract

| Group | Examples | Notes |
| --- | --- | --- |
| Surfaces | `--surface`, `--surface-soft`, `--surface-muted`, `--surface-sunken`, `--surface-hover`, `--surface-active`, `--surface-selected` | The three "elevations" of chrome (page → panel → sunken well) plus the interaction states |
| Lines | `--border`, `--border-strong`, `--border-subtle` | A hairline, a visible edge, and a separator inside a surface |
| Text | `--text` → `--text-secondary` → `--text-soft` → `--text-muted` → `--text-faint` → `--text-disabled` | Six steps, all AA-checked against `--surface` |
| Accent | `--accent`, `--accent-strong`, `--accent-soft`, `--accent-rgb` | `--text-on-accent` must stay ≥4.5:1 on `--accent` |
| Status | `--danger`, `--success`, `--warning`, `--info` (+ `-soft`, `-line`, `-strong`) | Never reused for brand decoration |
| Code | `--code-comment` … `--code-type` | Contrast against `--surface-sunken` ≥4.5:1 |
| Tints | `--tint-amber-*`, `--tint-rose-*`, `--tint-blue-*`, `--tint-sage-*` | The per-meaning hue ramps that make the tree scannable |

### Alpha channels

CSS cannot take the alpha out of a hex, so anything that needs transparency uses
a channel token: `rgba(var(--shadow-rgb), .14)`, `rgba(var(--accent-rgb), .08)`.
One hex in the theme changes every derived shadow, scrim, halo and ring.

`--shadow-rgb`, `--accent-rgb`, `--surface-rgb`, `--danger-rgb`, `--sage-rgb`,
`--on-accent-rgb`.

### What a theme may not do

- Change layout, radii, spacing, motion or layering. Those live in `tokens.css`
  outside the palette block for a reason: a theme that could move the page is a
  second stylesheet.
- Introduce a literal colour in a component layer. `test/theme.test.ts` fails on
  one — that check is the reason this refactor exists: 180 distinct literals used
  to sit in the layers, and every one of them was a pixel no theme could reach.

## Switching at runtime

`lib/theme.ts` owns the storage key (`mdocs-theme`), validation, and
`applyTheme()`, which writes `data-theme` and `color-scheme` together and keeps
`<meta name="theme-color">` in step with the page colour, so a phone's address
bar is not framed in the wrong palette.

`hooks/useTheme.ts` is the React surface: it reads the stored id (the same key
the pre-paint script uses, so the switcher never disagrees with the painted
page), applies it, and exposes `setTheme`.

The picker is `components/layout/ThemeMenu.tsx`, opened from the topbar. It is a
radiogroup: exactly one theme is active, the tick and the tinted row both say
which.

## Checks

| Check | What it catches |
| --- | --- |
| `test/theme.test.ts` | Registry shape, storage fallbacks, the three lists drifting apart, a colour literal in a layer, a raw `rgba(17,24,39,…)`, an unknown token in an override |
| `scripts/verify/verify-themes.mjs` | In Chrome: opens the picker, picks a theme, then applies a probe palette keyed on `data-theme` and asserts every sampled surface, field and quoted snippet recomputes, that untouched tokens are inherited, that geometry is unchanged, and that removing the probe restores the shipped values exactly |

Run the browser check with `node scripts/verify/verify-themes.mjs` (it is part of
`pnpm verify:browser`).
