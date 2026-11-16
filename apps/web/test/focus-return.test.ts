import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chooseFocusReturn } from '../src/lib/focus.ts'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const read = (path: string) => readFileSync(join(SRC, path), 'utf8')
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/**
 * Where focus goes when an overlay closes.
 *
 * CONTRACTS §4. The decision is a pure function, so the four cases it has to get
 * right are tested here directly. The wiring in each surface is asserted at the
 * source level; what a browser would add is listed at the bottom.
 */

/** Stand-ins for DOM elements: the decision function only identity-compares them. */
const element = (id: string) => ({ id } as unknown as Element)

test('focus returns to the trigger that opened the surface', () => {
  const trigger = element('trigger')
  assert.equal(chooseFocusReturn({
    recorded: { node: trigger, usable: true },
    current: { node: null, usable: false },
    fallback: { node: null, usable: false },
    currentInsideOverlay: false,
  }), 'recorded')
})

test('a caret the writer moved deliberately is not stolen', () => {
  const trigger = element('trigger')
  const editor = element('editor')
  // Focus is on a real element outside the closing surface, and it is not the
  // recorded one: the writer clicked into the text while the menu was open.
  assert.equal(chooseFocusReturn({
    recorded: { node: trigger, usable: true },
    current: { node: editor, usable: true },
    fallback: { node: editor, usable: true },
    currentInsideOverlay: false,
  }), null, 'restoring here would collapse the writer\'s selection')
})

test('a vanished trigger falls back to the editor, never to body', () => {
  const trigger = element('trigger')
  const editor = element('editor')
  assert.equal(chooseFocusReturn({
    recorded: { node: trigger, usable: false },
    current: { node: null, usable: false },
    fallback: { node: editor, usable: true },
    currentInsideOverlay: false,
  }), 'fallback')
})

test('focus left inside the closing surface counts as destroyed', () => {
  const trigger = element('trigger')
  const row = element('row')
  assert.equal(chooseFocusReturn({
    recorded: { node: trigger, usable: true },
    current: { node: row, usable: true },
    fallback: { node: null, usable: false },
    currentInsideOverlay: true,
  }), 'recorded', 'a row that is about to be removed is not a destination')
})

test('nothing usable means nothing is focused, not body', () => {
  assert.equal(chooseFocusReturn({
    recorded: { node: null, usable: false },
    current: { node: null, usable: false },
    fallback: { node: null, usable: false },
    currentInsideOverlay: false,
  }), null)
  // Nothing to assert beyond the choice: focusing nothing is the point.
})

test('Popover records the trigger before it moves focus, and restores on close', () => {
  const popover = code('components/ui/Popover.tsx')
  assert.match(popover, /focusReturn\.current\.record\(\)/, 'without a record there is nothing to restore to')
  assert.match(popover, /controller\.restore\(\{ overlay \}\)/, 'the cleanup hands focus back')
  // The record must precede the first-row focus in the file, because effects run
  // in declaration order and `autoFocus` children focus during the commit.
  const record = popover.indexOf('focusReturn.current.record()')
  const firstRow = popover.indexOf("querySelector<HTMLElement>('[role=\"menuitem\"], button, [tabindex=\"0\"]')")
  assert.ok(record >= 0 && firstRow >= 0)
  assert.ok(record < firstRow, 'recording after the panel takes focus would record the panel itself')
  // And restore must be in a cleanup, so it runs while the panel is still mounted.
  // Both refs are captured first: reading `panel.current` inside the cleanup would
  // see the next panel, or null.
  assert.match(popover, /if \(!open\) return\n\s*const controller = focusReturn\.current\n\s*const overlay = panel\.current\n\s*return \(\) => \{ controller\.restore\(\{ overlay \}\) \}/)
})

test('the controller is inert until a surface has actually opened', () => {
  // Surfaced through the source: `restore` is a no-op when `armed` is false, which
  // is what stops every never-opened popover from dragging focus into the editor
  // on mount.
  const focus = code('lib/focus.ts')
  assert.match(focus, /if \(!armed\) return null/)
})

test('a restored focus does not scroll the page', () => {
  const focus = code('lib/focus.ts')
  assert.match(focus, /focus\(\{ preventScroll: true \}\)/, 'returning focus must not jump the document')
})
