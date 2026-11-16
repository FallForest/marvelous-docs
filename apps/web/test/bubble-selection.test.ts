import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const read = (path: string) => readFileSync(join(SRC, path), 'utf8')

/**
 * The selection bubble's reach.
 *
 * A source-level test, because the decision is one predicate inside a closure
 * that needs a live ProseMirror view and `coordsAtPos` to run. What is being
 * pinned is exactly the predicate: the bar used to require
 * `$from.parent === $to.parent`, so a range that crossed a paragraph boundary —
 * the ordinary way to quote a sentence in prose — got no bubble at all, and
 * therefore no pointer route to bold, link or comment on it.
 *
 * A browser test would additionally prove that the bar lands above the first
 * line of a multi-line range and stays inside the visual viewport. That is
 * untested here and is listed as such in the batch report.
 */
test('a selection that spans paragraphs still gets the bubble', () => {
  const editor = read('components/editor/DocumentEditor.tsx')
  const selection = editor.slice(editor.indexOf('onSelectionUpdate'))
  const block = selection.slice(0, selection.indexOf('editorProps'))
  // The restriction is described in the source comment in prose; what must be
  // absent is the *code*. Slicing the comment away is what makes this a real
  // assertion rather than a test of documentation.
  const code = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.ok(!/\$from\.parent\s*===\s*\$to\.parent/.test(code), 'the single-block restriction must be gone; it hid the bar for cross-paragraph ranges')
  assert.match(code, /if \(to > from && !isNodeSelection\)/, 'a non-empty text range is the condition')
  // The anchor is still computed from the two ends of the range, and still
  // clamped to the visual viewport so a phone keyboard cannot cover it.
  assert.match(code, /coordsAtPos\(from\)/)
  assert.match(code, /coordsAtPos\(to\)/)
  assert.match(code, /visualViewportRect\(\)/)
})

test('the bubble keeps its exit animation when the selection collapses', () => {
  // The bar outlives a collapsed selection by one exit beat; without that there
  // is nothing to animate and it reads as a hard cut.
  const bubble = read('components/editor/BubbleToolbar.tsx')
  assert.match(bubble, /DURATION\.fast/)
  assert.match(bubble, /is-leaving/)
  // Reduced motion still gets the exit, just without travel.
  const style = read('styles/editor.css')
  assert.match(style, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]*?\.bubble-toolbar\.is-leaving\{animation:motion-fade-out/)
})
