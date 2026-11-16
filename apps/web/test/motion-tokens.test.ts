import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const STYLES = fileURLToPath(new URL('../src/styles/', import.meta.url))
const read = (name: string) => readFileSync(join(STYLES, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const ALL = readdirSync(STYLES).filter((name) => name.endsWith('.css'))
const sources = Object.fromEntries(ALL.map((name) => [name, read(name)]))

/**
 * The motion layer's single source of truth, pinned.
 *
 * The failure this prevents is not a broken animation, it is a *diverging* one:
 * every control carrying its own literal `.97`, so "make presses shallower" or
 * "respect reduced motion" becomes a hunt through six files. These assertions
 * hold the layer to its own contract (CONTRACTS §7):
 *
 *   - values live in tokens.css, keyframes and utilities in motion.css;
 *   - press depth is one token, and it collapses under reduced motion because the
 *     token does, not because of a suppression list;
 *   - entrances fill `backwards` so a retained final frame cannot outrank
 *     `:hover`/`:active`;
 *   - nothing transitions a layout property.
 */

test('press depth is one token, defined once', () => {
  const tokens = sources['tokens.css']!
  assert.match(tokens, /--press-scale:\s*\.03/, 'the press depth is a named value')
  assert.match(tokens, /--press-transform:scale\(calc\(1 - var\(--press-scale\) \* var\(--motion-scale\)\)\)/, 'the transform composes depth with the reduced-motion scale')
  assert.match(tokens, /--motion-scale:1/)
  assert.match(tokens, /@media \(prefers-reduced-motion:reduce\)\{\s*:root\{--motion-scale:0\}/, 'reduced motion neutralises the press from one declaration')

  // Nothing may hard-code the depth again. `.97` is the value this replaces; a
  // second copy is how the two lists drifted apart in the first place.
  const hardcoded: string[] = []
  for (const [name, css] of Object.entries(sources)) {
    if (name === 'tokens.css') continue
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/:active/.test(selector!)) continue
      if (/transform:\s*scale\(\.97\)/.test(body!)) hardcoded.push(`${name}: ${selector!.trim()}`)
    }
  }
  assert.deepEqual(hardcoded, [], 'press feedback must read --press-transform, not repeat the literal')
})

test('every press rule that uses the token is a real control', () => {
  // A token nobody consumes is dead weight: the first version of this fix defined
  // --press-transform and used it nowhere, so reduced motion changed nothing.
  const users = Object.values(sources).filter((css) => css.includes('var(--press-transform)'))
  assert.ok(users.length >= 2, 'the token must be consumed by more than one layer')
})

test('entrances fill backwards, never both', () => {
  // `both` retains the final frame after the animation ends, and a retained
  // transform outranks :hover/:active — the button stops responding.
  //
  // View-transition pseudo-elements are exempt: a cross-fade is not an entrance on
  // an interactive control, it is the browser's own snapshot playing once, and it
  // has no hover state to break.
  const offenders: string[] = []
  for (const [name, css] of Object.entries(sources)) {
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/::view-transition/.test(selector!)) continue
      const animation = /animation:([^;}]*)/.exec(body!)
      if (!animation || !/motion-(?:rise|sink|sheet|enter|disclose|fade)-in|editor-bubble-in|motion-enter/.test(animation[1]!)) continue
      if (/\bboth\b/.test(animation[1]!)) offenders.push(`${name}: ${selector!.trim()} -> ${animation[1]!.trim()}`)
    }
  }
  assert.deepEqual(offenders, [], 'an entrance with fill-mode both silently disables hover and press')
})

test('no transition animates a layout property', () => {
  // width/height/top/left in a transition means layout on every frame. The
  // fixed-position toolbars write top/left directly for placement, which is not a
  // transition and is not what this checks.
  const offenders: string[] = []
  for (const [name, css] of Object.entries(sources)) {
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const transition = /transition:([^;}]*)/.exec(body!)
      if (!transition) continue
      if (/(?:^|[\s,])(?:width|height|top|left)\s+\d|(?:^|[\s,])(?:width|height|top|left)\s+var\(/.test(transition[1]!)) {
        offenders.push(`${name}: ${selector!.trim()}`)
      }
    }
  }
  assert.deepEqual(offenders, [])
})

test('a floating surface keeps one animation name while its placement changes', () => {
  // A popover re-measures on every scroll and can flip below→above while open.
  // Swapping the animation-name on that flip replays the entrance under the
  // pointer; changing a custom property read inside one keyframe does not.
  const tokens = sources['tokens.css']!
  const motion = sources['motion.css']!
  assert.match(tokens, /--motion-rise-shift:/)
  assert.match(tokens, /--motion-rise-direction:/)
  const rise = /@keyframes motion-rise-in\{([^}]*)\}/.exec(motion)
  assert.ok(rise, 'the rise keyframe must exist in motion.css')
  assert.match(rise![1]!, /var\(--motion-rise-direction\)/, 'the direction must be a value, not a second keyframe')
})
