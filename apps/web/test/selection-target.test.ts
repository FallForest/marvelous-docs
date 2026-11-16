import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { buildEditorExtensions } from '../src/lib/editor/index.ts'
import { activeTable, geometryFor, selectedImage } from '../src/lib/editor/selection-target.ts'
import { compositionGuard, isComposingEvent, COMPOSITION_GRACE } from '../src/lib/editor/ime.ts'

/**
 * The two contracts that made wrong content change under the writer.
 *
 * 1. Floating tools used to attach to `blocks.find(kind === 'table' | 'image')` —
 *    layout order — while their commands ran on the selection. With two tables
 *    on screen the bar sat beside A and edited B. These tests assert the target
 *    now comes from the document state, so "same screen, two objects, correct
 *    one" is checked rather than eyeballed.
 * 2. Command keys were handled with no composition guard, so an Enter that
 *    confirmed an IME candidate also ran a slash command.
 */

const schema = getSchema(buildEditorExtensions())
const p = (text = '') => schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined)
const cell = (text = '') => schema.nodes.tableCell.create(null, p(text))
const row = (...cells: ReturnType<typeof cell>[]) => schema.nodes.tableRow.create(null, cells)
const table = (...rows: ReturnType<typeof row>[]) => schema.nodes.table.create(null, rows)
const image = (src: string) => schema.nodes.image.create({ src })

test('the table tool resolves the table the caret is in, not the first table', () => {
  const first = table(row(cell('A1'), cell('A2')))
  const second = table(row(cell('B1'), cell('B2')))
  const doc = schema.nodes.doc.create(null, [p('lead'), first, p('between'), second, p('tail')])
  const distances = [0, 1, 2, 3]
  const positions = { first: 0, second: 0 }
  doc.forEach((node, offset) => { if (node.type.name === 'table') { if (node === first) positions.first = offset; else positions.second = offset } })

  // A caret inside the second table's first cell.
  let insideSecond = 0
  doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell' && node.textContent === 'B1') insideSecond = pos + 2
  })
  assert.ok(insideSecond > 0 && distances.length > 0)

  const state = EditorState.create({ doc, selection: TextSelection.create(doc, insideSecond) })
  const target = activeTable(state)
  assert.ok(target, 'a caret inside a table must resolve to that table')
  assert.equal(target!.pos, positions.second, 'the resolved table is the second one, not the first in layout order')
  assert.notEqual(target!.pos, positions.first)

  // And the geometry lookup uses that position, so the bar cannot be placed on
  // the neighbour either.
  const blocks = [
    { pos: positions.first, kind: 'table' as const },
    { pos: positions.second, kind: 'table' as const },
  ]
  assert.equal(geometryFor(blocks, target, 'table')?.pos, positions.second)
  assert.notEqual(geometryFor(blocks, target, 'table')?.pos, positions.first)
})

test('a whole-table node selection also resolves to that table', () => {
  const doc = schema.nodes.doc.create(null, [table(row(cell('x'))), p('after')])
  const state = EditorState.create({ doc, selection: NodeSelection.create(doc, 0) })
  const target = activeTable(state)
  assert.ok(target)
  assert.equal(target!.pos, 0)
})

test('outside a table there is no table target at all', () => {
  const doc = schema.nodes.doc.create(null, [p('one'), table(row(cell('inside'))), p('two')])
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 2) })
  assert.equal(activeTable(state), null, 'a caret in ordinary prose must not claim the nearest table')
})

test('the image tool only appears for a selected image, never for a caret beside one', () => {
  const doc = schema.nodes.doc.create(null, [image('https://example.com/a.png'), image('https://example.com/b.png'), p('text')])
  const second = doc.child(0).nodeSize
  const blocks = [
    { pos: 0, kind: 'image' as const },
    { pos: second, kind: 'image' as const },
  ]

  const selected = EditorState.create({ doc, selection: NodeSelection.create(doc, second) })
  const target = selectedImage(selected)
  assert.ok(target)
  assert.equal(target!.pos, second, 'the second image is the one selected and the one returned')
  assert.equal(geometryFor(blocks, target, 'image')?.pos, second)
  assert.notEqual(geometryFor(blocks, target, 'image')?.pos, 0)

  // A caret in the paragraph after both images: nothing is selected, so the
  // toolbar must be absent rather than acting on the nearest image.
  const caret = EditorState.create({ doc, selection: TextSelection.create(doc, doc.content.size - 1) })
  assert.equal(selectedImage(caret), null)
  assert.equal(geometryFor(blocks, selectedImage(caret), 'image'), null)

  // A text selection is not an image selection either.
  const textRange = EditorState.create({ doc, selection: TextSelection.create(doc, doc.content.size - 3, doc.content.size - 1) })
  assert.equal(selectedImage(textRange), null)
})

test('an IME candidate confirmation does not run a command', () => {
  const guard = compositionGuard()
  // Enter that confirms a candidate: Safari/older WebKit report keyCode 229.
  assert.equal(isComposingEvent({ key: 'Enter', keyCode: 229 }), true)
  assert.equal(isComposingEvent({ key: 'Enter', isComposing: true }), true)
  assert.equal(isComposingEvent({ key: 'Enter' }), false)

  guard.start()
  assert.equal(guard.blocked({ key: 'Enter' }), true, 'Enter while composing belongs to the IME')
  assert.equal(guard.blocked({ key: 'Escape' }), true)
  assert.equal(guard.blocked({ key: 'ArrowDown' }), true)
  // A letter is part of the composition and must still reach the editor.
  assert.equal(guard.blocked({ key: 'b' }), true, 'while composing every key is the IME\'s')

  guard.end()
  // Some IMEs emit the final keydown after compositionend; the grace window
  // holds only the keys that could commit or cancel.
  assert.equal(guard.blocked({ key: 'Enter' }), true, 'a confirm key just after compositionend is still the IME')
  assert.equal(guard.blocked({ key: 'Escape' }), true)
  assert.equal(guard.blocked({ key: 'b' }), false, 'typing resumes immediately after the composition ends')

  // Outside the window a deliberate Enter is the writer's.
  const later = { key: 'Enter' }
  const original = performance.now()
  const stub = () => original + COMPOSITION_GRACE + 1
  const realNow = performance.now
  try {
    performance.now = stub
    assert.equal(guard.blocked(later), false, 'a deliberate Enter must not be swallowed')
  } finally {
    performance.now = realNow
  }
})

test('a guard starts clean, so a key before any composition is never blocked', () => {
  const guard = compositionGuard()
  assert.equal(guard.blocked({ key: 'Enter' }), false)
  assert.equal(guard.blocked({ key: 'Escape' }), false)
  assert.equal(guard.blocked({ key: 'ArrowUp' }), false)
})
