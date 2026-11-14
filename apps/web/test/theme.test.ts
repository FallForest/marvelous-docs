import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import {
  DEFAULT_THEME_ID, THEMES, THEME_STORAGE_KEY, applyTheme, isThemeId, readStoredTheme,
  storeTheme, themeById,
} from '../src/lib/theme.ts'

/**
 * The theme contract.
 *
 * Every appearance shares a semantic palette contract. The failures include a colour
 * that bypasses the token layer cannot be rethemed, a theme missing from one of
 * the three lists (registry, CSS block, pre-paint script) paints the wrong
 * palette for one frame, and a missing derived channel token makes every shadow
 * resolve to nothing. Each of those is invisible in a screenshot of the theme
 * that happens to be active, which is why they are asserted rather than left to
 * review.
 */

const SRC = resolve(import.meta.dirname, '../src')
const STYLES = join(SRC, 'styles')
const WEB = resolve(import.meta.dirname, '..')

const css = (name: string) => readFileSync(join(STYLES, name), 'utf8')
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '')

/** A clean whitespace-tolerant set of custom-property names a file declares. */
const declared = (text: string) => new Set([...strip(text).matchAll(/(?:^|[;{]\s*)--([a-z0-9-]+)\s*:/g)].map((m) => m[1]!))

/* ------------------------------------------------------------------ */
/* The registry                                                        */
/* ------------------------------------------------------------------ */

test('every theme id is unique and the default exists', () => {
  const ids = THEMES.map((theme) => theme.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate theme id: ' + ids.join(', '))
  assert.ok(ids.includes(DEFAULT_THEME_ID), 'the default theme must be in the list')
  assert.ok(THEMES.length >= 1)
})

test('hand-drawn is the default and only its picker hint labels it as such', () => {
  assert.equal(DEFAULT_THEME_ID, 'handdrawn')
  assert.deepEqual(THEMES.filter((theme) => theme.hint.startsWith('默认：')).map((theme) => theme.id), ['handdrawn'])
})

test('a theme entry carries everything the picker and the root need', () => {
  for (const theme of THEMES) {
    assert.match(theme.id, /^[a-z][a-z0-9-]*$/, 'id must be a plain attribute value: ' + theme.id)
    assert.ok(theme.name.trim().length > 0, theme.id + ' has no name')
    assert.ok(theme.hint.trim().length > 0, theme.id + ' has no hint')
    assert.ok(theme.scheme === 'light' || theme.scheme === 'dark', theme.id + ' has no usable scheme')
    assert.equal(theme.swatch.length, 3, theme.id + ' needs three swatch colours')
    for (const colour of theme.swatch) assert.match(colour, /^#[0-9a-f]{6}$/i, theme.id + ' swatch: ' + colour)
  }
})

test('an unknown id never reaches the DOM', () => {
  assert.equal(isThemeId('paper'), THEMES.some((theme) => theme.id === 'paper'))
  assert.equal(isThemeId('nope'), false)
  assert.equal(isThemeId(null), false)
  assert.equal(isThemeId(''), false)
  // themeById falls back rather than returning undefined, so a stale stored id
  // cannot leave the root without a palette.
  assert.equal(themeById('deleted-theme').id, DEFAULT_THEME_ID)
})

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

test('a stored theme is read back, and anything else falls back', () => {
  const storage = (value: string | null) => ({ getItem: () => value })
  for (const theme of THEMES) assert.equal(readStoredTheme(storage(theme.id)), theme.id)
  for (const value of [null, '', 'from-a-build-that-is-gone', '__proto__', 'constructor']) {
    assert.equal(readStoredTheme(storage(value)), 'handdrawn')
  }
})

test('an existing explicit paper preference takes priority over the hand-drawn default', () => {
  assert.equal(readStoredTheme({ getItem: () => 'paper' }), 'paper')
})

test('blocked storage never throws on read or write', () => {
  // Private mode throws on the property access itself, which is why the read is
  // inside the try rather than around the caller.
  const blocked = { getItem: () => { throw new Error('blocked') } }
  assert.equal(readStoredTheme(blocked), DEFAULT_THEME_ID)

  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    get localStorage() { throw new Error('blocked') },
  } })
  try {
    assert.equal(readStoredTheme(), DEFAULT_THEME_ID)
    assert.doesNotThrow(() => storeTheme('paper'))
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

test('the storage key is short and namespaced', () => {
  assert.equal(THEME_STORAGE_KEY, 'mdocs-theme')
})

/* ------------------------------------------------------------------ */
/* The attribute write                                                 */
/* ------------------------------------------------------------------ */

test('applying a theme writes the id and the scheme together', () => {
  const root = { dataset: {} as Record<string, string>, style: { colorScheme: '' } } as unknown as HTMLElement
  for (const theme of THEMES) {
    applyTheme(theme.id, root)
    assert.equal(root.dataset.theme, theme.id)
    assert.equal(root.style.colorScheme, theme.scheme)
  }
})

test('applying an unknown id applies the default instead', () => {
  const root = { dataset: {} as Record<string, string>, style: { colorScheme: '' } } as unknown as HTMLElement
  applyTheme('gone', root)
  assert.equal(root.dataset.theme, DEFAULT_THEME_ID)
})

/* ------------------------------------------------------------------ */
/* The three lists stay in step                                        */
/* ------------------------------------------------------------------ */

test('every theme has a palette block in themes.css', () => {
  const themes = css('themes.css')
  for (const theme of THEMES) {
    assert.ok(
      new RegExp("\\[data-theme=['\"]" + theme.id + "['\"]\\]").test(themes),
      'styles/themes.css has no block for ' + theme.id,
    )
  }
})

test('the pre-paint script knows every theme and its scheme', () => {
  // index.html paints before the bundle loads, so it cannot import the registry.
  // That duplication is the price of not flashing; this test is what keeps it
  // from drifting silently.
  const html = readFileSync(join(WEB, 'index.html'), 'utf8')
  const map = /var themes = \{([^}]*)\}/.exec(html)
  assert.ok(map, 'index.html must declare the id → [scheme, page colour] map')
  const entries = new Map([...map[1]!.matchAll(/([a-z0-9-]+)\s*:\s*\['([a-z]+)'\s*,\s*'(#[0-9a-f]{6})'\]/gi)].map((m) => [m[1]!, { scheme: m[2]!, page: m[3]! }]))
  for (const theme of THEMES) {
    const entry = entries.get(theme.id)
    assert.ok(entry, 'index.html does not know ' + theme.id)
    assert.equal(entry.scheme, theme.scheme, 'index.html disagrees about the scheme of ' + theme.id)
    // The bar around the page has to match the page, or the first frame is
    // framed in the wrong colour on a phone.
    assert.equal(entry.page.toLowerCase(), theme.swatch[0].toLowerCase(), 'index.html disagrees about the page colour of ' + theme.id)
  }
  assert.equal(entries.size, THEMES.length, 'index.html lists a theme the registry dropped')
  assert.ok(html.includes(THEME_STORAGE_KEY), 'the pre-paint script must read the same key')
})

test('first paint restores every appearance and safely rejects stale or hostile ids', () => {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8')
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1]
  assert.ok(script, 'the preference must be applied before the bundle loads')
  const paint = (value: string | null, blocked = false) => {
    const attributes: Record<string, string> = {}
    const root = { style: { colorScheme: '' }, setAttribute: (key: string, next: string) => { attributes[key] = next } }
    let metaColour = ''
    runInNewContext(script, {
      localStorage: { getItem: () => { if (blocked) throw new Error('blocked'); return value } },
      document: { documentElement: root, querySelector: () => ({ setAttribute: (_key: string, next: string) => { metaColour = next } }) },
    })
    return { id: attributes['data-theme'], scheme: root.style.colorScheme, colour: metaColour }
  }
  for (const theme of THEMES) {
    assert.deepEqual(paint(theme.id), { id: theme.id, scheme: theme.scheme, colour: theme.swatch[0] })
  }
  const fallback = themeById(DEFAULT_THEME_ID)
  for (const value of [null, '', 'deleted-appearance', '__proto__', 'constructor']) {
    assert.deepEqual(paint(value), { id: fallback.id, scheme: fallback.scheme, colour: fallback.swatch[0] })
  }
  assert.deepEqual(paint('paper', true), { id: fallback.id, scheme: fallback.scheme, colour: fallback.swatch[0] })
})

/** sRGB relative luminance used by the WCAG contrast formula. */
const luminance = (hex: string) => {
  const linear = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return linear[0]! * .2126 + linear[1]! * .7152 + linear[2]! * .0722
}
const contrast = (a: string, b: string) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0]! + .05) / (values[1]! + .05)
}

test('hand-drawn reading surfaces, actions and quoted text retain AA contrast', () => {
  const base = new Map([...strip(css('tokens.css')).matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1]!, m[2]!]))
  const handdrawn = /\[data-theme='handdrawn'\]\s*\{([^}]+)\}/.exec(strip(css('themes.css')))?.[1]
  assert.ok(handdrawn, 'handdrawn requires its own semantic palette')
  for (const match of handdrawn.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)) base.set(match[1]!, match[2]!)
  const pairs: Array<[string, string]> = []
  for (const ink of ['text', 'text-secondary', 'text-soft', 'text-muted']) {
    for (const surface of ['surface', 'surface-soft', 'surface-muted', 'surface-sunken']) pairs.push([ink, surface])
  }
  pairs.push(['text-on-accent', 'accent'], ['text-on-accent', 'accent-strong'], ['text-on-code', 'surface-code'], ['quote-ink', 'quote-bg'], ['quote-ink', 'quote-bg-hover'], ['text', 'comment-mark-active'])
  for (const [ink, surface] of pairs) {
    const foreground = base.get(ink), background = base.get(surface)
    assert.ok(foreground && background, `missing contrast token: ${ink} / ${surface}`)
    const ratio = contrast(foreground, background)
    assert.ok(ratio >= 4.5, `${ink} on ${surface}: ${ratio.toFixed(2)}:1, expected 4.5:1`)
  }
})

test('themes.css only re-declares tokens that tokens.css defines', () => {
  // An override of a token nobody declared is dead code that reads as intent:
  // it looks like the theme changes that value, and it changes nothing.
  const base = declared(css('tokens.css'))
  const offenders: string[] = []
  for (const block of strip(css('themes.css')).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = block[1]!.trim()
    if (!selector.includes('[data-theme=')) continue
    for (const name of [...block[2]!.matchAll(/(?:^|[;{]\s*)--([a-z0-9-]+)\s*:/g)].map((m) => m[1]!)) {
      if (!base.has(name)) offenders.push(selector + ' → --' + name)
    }
  }
  assert.deepEqual(offenders, [], 'unknown token in a theme override: ' + offenders.join(', '))
})

/* ------------------------------------------------------------------ */
/* The point of the whole conversion                                   */
/* ------------------------------------------------------------------ */

test('no component layer carries a colour literal', () => {
  // This is the reason the palette was folded out of 180 hex values in the
  // first place: a literal in base.css or pages.css is a pixel that no theme can
  // reach, and it is invisible until someone ships a dark theme.
  const LAYERS = readdirSync(STYLES).filter((name) => name.endsWith('.css')
    && name !== 'tokens.css' && name !== 'themes.css')
  const offenders: string[] = []
  for (const name of LAYERS) {
    for (const [index, line] of strip(css(name)).split('\n').entries()) {
      // A mask gradient's stop is not a palette decision: #000 there is an
      // instruction to the compositor, not a colour on screen.
      const text = line.replace(/mask-image:[^;]*/g, '')
      const hex = text.match(/(?:^|[\s:,(])#[0-9a-fA-F]{3,8}\b/)
      if (hex) offenders.push(name + ':' + (index + 1) + ' ' + line.trim().slice(0, 80))
    }
  }
  assert.deepEqual(offenders, [], 'use a var(--token) instead: ' + offenders.join(' | '))
})

test('every token a layer consumes is declared', () => {
  const base = declared(css('tokens.css'))
  /*
   * Two kinds of custom property are legitimately undeclared in a stylesheet:
   *   --i and --stagger-step are written per element by React (staggerStyle);
   *   --hero-shift is written by HomePage's scroll handler.
   * They are runtime values, not palette entries, so they are named here rather
   * than being silently tolerated by a loose pattern.
   */
  const RUNTIME = new Set(['i', 'stagger-step', 'hero-shift'])
  const used = new Set<string>()
  for (const name of readdirSync(STYLES).filter((entry) => entry.endsWith('.css'))) {
    const body = strip(css(name))
    // Comments are stripped above, but a doc comment in tokens.css still shows
    // up in the *declaration* scan below if it survived; the value scan here is
    // already comment-free.
    for (const match of body.matchAll(/var\(--([a-z0-9-]+)/g)) used.add(match[1]!)
  }
  /*
   * shell.css declares its own chrome geometry (--side-w, --row-h, …) on
   * .app-shell rather than on :root, because they describe that surface, not the
   * palette. They are still declared tokens, so the check reads every file.
   */
  const local = new Set<string>()
  for (const name of readdirSync(STYLES).filter((entry) => entry.endsWith('.css'))) {
    for (const name2 of declared(css(name))) local.add(name2)
  }
  const missing = [...used].filter((token) => !base.has(token) && !local.has(token) && !RUNTIME.has(token)).sort()
  assert.deepEqual(missing, [], 'undeclared token(s): ' + missing.join(', '))
})

test('rgba() literals only ever derive from a channel token', () => {
  // Shadows, scrims and rings are rgba(var(--x-rgb), a) so a theme recolours
  // them by changing one hex. A raw rgba(17,24,39,.14) is a shadow that stays
  // blue-black on a warm theme.
  const offenders: string[] = []
  for (const name of readdirSync(STYLES).filter((entry) => entry.endsWith('.css') && entry !== 'tokens.css' && entry !== 'themes.css')) {
    for (const [index, line] of strip(css(name)).split('\n').entries()) {
      if (/rgba\(\s*\d/.test(line)) offenders.push(name + ':' + (index + 1) + ' ' + line.trim().slice(0, 70))
    }
  }
  assert.deepEqual(offenders, [], 'use rgba(var(--*-rgb),a): ' + offenders.join(' | '))
})
