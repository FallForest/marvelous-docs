/**
 * Theme registry.
 *
 * Every colour in a theme resolves through a custom property declared in
 * styles/tokens.css. A visual theme can also opt into a separately scoped style
 * layer, such as the hand-drawn paper textures and artwork. Switching writes an
 * attribute on <html>; the mounted editor and its document state stay intact.
 *
 * Adding a theme is therefore one entry here plus one block in styles/themes.css:
 *
 *   1. append { id, name, hint, scheme } below;
 *   2. add `[data-theme='<id>']{ ... }` overrides in styles/themes.css, using the
 *      same token names as tokens.css;
 *   3. add the id and its scheme/page colour to index.html's pre-paint map;
 *   4. if needed, add an isolated [data-theme='<id>'] visual layer.
 *
 * `scheme` sets
 * `color-scheme` on the root, so form controls, scrollbars and the caret follow
 * the palette instead of staying light on a dark page.
 */

export type ThemeScheme = 'light' | 'dark'

export type Theme = {
  /** Value written to <html data-theme>; also the stored preference. */
  id: string
  /** Shown in the switcher. */
  name: string
  /** One line of what it is for, so the list is not four words in a row. */
  hint: string
  scheme: ThemeScheme
  /**
   * Three colours for the picker's swatch: page, chrome, accent.
   *
   * Declared here rather than read from CSS because the picker has to show a
   * theme that is *not* active, and a custom property only resolves inside the
   * element that declares it. Keeping the preview next to the theme definition
   * means the two are edited in one place.
   */
  swatch: [page: string, chrome: string, accent: string]
}

/**
 * The built-in list.
 *
 * `paper` is the shipped look and the default; the others are declared here
 * because the switcher, the storage key and the pre-paint script need a closed
 * set to validate against, and an id that is not in this list must never reach
 * the DOM.
 */
export const THEMES: Theme[] = [
  { id: 'paper', name: '纸本', hint: '默认：暖白纸面、炭灰墨线', scheme: 'light', swatch: ['#ffffff', '#f7f8fa', '#c0533f'] },
  { id: 'handdrawn', name: '手绘纸本', hint: '铅笔线条、纸张纹理与手绘图标', scheme: 'light', swatch: ['#fffef9', '#eeeadd', '#526442'] },
]

export const DEFAULT_THEME_ID = 'paper'

/** localStorage key. Kept short because it is read before first paint. */
export const THEME_STORAGE_KEY = 'mdocs-theme'

export const isThemeId = (value: unknown): value is string =>
  typeof value === 'string' && THEMES.some((theme) => theme.id === value)

export const themeById = (id: string): Theme =>
  THEMES.find((theme) => theme.id === id) ?? THEMES.find((theme) => theme.id === DEFAULT_THEME_ID)!

/** The id to paint with: the stored one if this build still ships it. */
export function readStoredTheme(storage?: Pick<Storage, 'getItem'>): string {
  try {
    const stored = (storage ?? window.localStorage).getItem(THEME_STORAGE_KEY)
    return isThemeId(stored) ? stored : DEFAULT_THEME_ID
  } catch {
    // Private mode and blocked storage both throw on access; a document that
    // cannot remember a preference still has to render in a known theme.
    return DEFAULT_THEME_ID
  }
}

export function storeTheme(id: string): void {
  try { window.localStorage.setItem(THEME_STORAGE_KEY, id) } catch { /* private mode */ }
}

/**
 * Applies a theme to the document element.
 *
 * `data-theme` is what styles/themes.css keys on, and `color-scheme` is what
 * tells the engine to paint scrollbars, form controls and the caret for that
 * scheme. Both are written together so they can never disagree.
 */
export function applyTheme(id: string, root: HTMLElement = document.documentElement): void {
  const theme = themeById(id)
  root.dataset.theme = theme.id
  root.style.colorScheme = theme.scheme
  /*
   * The browser paints its own chrome — the mobile address bar, the desktop
   * title bar in some shells — from <meta name="theme-color">. Leaving it on the
   * shipped value would frame a dark page with a white bar, so it follows the
   * theme's page colour. Absent in a test environment, hence the guard.
   */
  const meta = typeof document === 'undefined' ? null : document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme.swatch[0])
}

/** The theme the document is currently painted with. */
export function currentThemeId(root: HTMLElement = document.documentElement): string {
  const id = root.dataset.theme
  return isThemeId(id) ? id : DEFAULT_THEME_ID
}
