# Themes

Every appearance has a **semantic palette**. Every colour the client paints
resolves through a custom property declared in `styles/tokens.css`; its palette
re-declares the changed tokens under `[data-theme='<id>']` in `styles/themes.css`.
A visual appearance may also have a separate, explicitly theme-scoped layer for
artwork, borders and spacing. Switching writes the attribute on `<html>` without
replacing the mounted editor, its document, selection or undo history.

The shipped appearances are **纸本** (`paper`, the unchanged default) and
**手绘纸本** (`handdrawn`, ivory paper, graphite lines and AI-generated stationery
art). The latter uses pale sage and yellow for decoration, with a darker sage
control accent so action labels remain readable.

## Add a palette

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

The picker reads `THEMES`; the shell reads the same hook; the pre-paint script
paints the stored id on the first frame. Keep `paper` as the default unless a
separate product decision explicitly changes it; adding an appearance does not
migrate an existing preference.

## Add an art direction

The hand-drawn appearance also loads component styling after the normal layers.
Every visual override must begin with `[data-theme='handdrawn']`, including rules
inside media queries, so changing back to `paper` restores the original design.
Use semantic colour tokens in these layers just as in the base components.

The transparent PNG/WebP artwork lives at `/art/handdrawn-v1/`. Images are
decorative alongside real text and controls. They must not replace editable text,
encode document state, cover pointer targets, or force an editor remount. Read
the asset guide in `docs/design/handdrawn-v1/` for sizes and material usage.

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

### What a palette may not do

- Change layout, radii, spacing, motion or layering in `themes.css`. Keep that
  file limited to colour token overrides and `color-scheme`; optional visual
  layers are separate and explicitly scoped to their appearance.
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
page), applies it, and exposes `setTheme`. A `storage` event updates other tabs;
clearing the preference restores the default. Blocked storage safely falls back
to `paper`, and stale or unknown ids never reach the DOM.

The picker is `components/layout/ThemeMenu.tsx`, opened from the topbar. Its
group contains radio menu items: exactly one appearance is active, and both the
tick and tinted row indicate it. Arrow keys, Home and End move focus; Enter or
Space selects the focused appearance.

## Checks

| Check | What it catches |
| --- | --- |
| `test/theme.test.ts` | Registry shape, storage fallbacks, pre-paint restoration and hostile-id rejection, AA contrast for hand-drawn surfaces/actions, the three lists drifting apart, colour literals outside the palette, unknown tokens |
| `scripts/verify/verify-themes.mjs` | In Chrome: opens the picker, picks a theme, then applies a probe palette keyed on `data-theme` and asserts every sampled surface, field and quoted snippet recomputes, that untouched tokens are inherited, that geometry is unchanged, and that removing the probe restores the shipped values exactly |

Run the browser check with `node scripts/verify/verify-themes.mjs` (it is part of
`pnpm verify:browser`).
