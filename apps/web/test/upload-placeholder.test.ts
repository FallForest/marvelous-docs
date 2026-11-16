import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { buildEditorExtensions } from '../src/lib/editor/index.ts'
import { addUpload, failUpload, uploadPlaceholderKey, uploadPlaceholderPlugin, uploadPosition } from '../src/lib/editor/upload-placeholder.ts'

/**
 * The upload reservation.
 *
 * The bug this pins: the image used to be inserted wherever the caret was when
 * the upload *finished*, so typing during the upload moved the picture. A
 * decoration is used instead of a node because the reservation must not reach the
 * saved body, the collaboration update, the export, or the undo history — so the
 * tests check both "the position follows the text" and "the document is
 * unchanged".
 */

const schema = getSchema(buildEditorExtensions())
const p = (text = '') => schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined)

/**
 * `getSchema` builds the schema only, so the plugin has to be supplied to the
 * state explicitly. Using the same factory the editor build uses means the tests
 * exercise the real state machine rather than a copy of it.
 */
const stateWith = (doc: ReturnType<typeof schema.nodes.doc.create>, pos: number) => EditorState.create({
  doc,
  selection: TextSelection.create(doc, pos),
  plugins: [uploadPlaceholderPlugin(() => undefined)],
})

test('the reservation is not part of the document', () => {
  const doc = schema.nodes.doc.create(null, [p('alpha'), p('beta')])
  const state = stateWith(doc, 3)
  const before = state.doc.toJSON()
  const tr = addUpload(state, { id: 'a', pos: 3, status: 'uploading', name: 'shot.png' })
  const next = state.apply(tr)
  assert.deepEqual(next.doc.toJSON(), before, 'the body must be byte-identical; the placeholder is a decoration')
  assert.equal(uploadPlaceholderKey.getState(next)?.entries.length, 1)
})

test('typing above the reservation pushes it down with the text', () => {
  const doc = schema.nodes.doc.create(null, [p('alpha'), p('beta')])
  const start = stateWith(doc, 3)
  // Reserve at the start of the second paragraph.
  const reserved = start.apply(addUpload(start, { id: 'a', pos: doc.child(0).nodeSize + 1, status: 'uploading', name: '' }))
  const anchor = uploadPosition(reserved, 'a')
  assert.ok(anchor !== null)

  // Someone types "XY" in the first paragraph.
  const tr = reserved.tr.insertText('XY', 2)
  const typed = reserved.apply(tr)
  const moved = uploadPosition(typed, 'a')
  // Two characters entered before the reservation, so it must have moved by
  // exactly two — this is the whole point of remapping instead of storing a
  // number.
  assert.equal(moved, anchor! + 2)
  assert.equal(typed.doc.textBetween(1, typed.doc.child(0).content.size + 1, ' '), 'aXYlpha')
})

test('a reservation can fail in place and then be retried or removed', () => {
  const doc = schema.nodes.doc.create(null, [p('alpha')])
  const start = stateWith(doc, 2)
  const reserved = start.apply(addUpload(start, { id: 'a', pos: 2, status: 'uploading', name: 'x.png' }))
  const failed = reserved.apply(failUpload(reserved, 'a', '上传失败：网络中断'))
  const entry = uploadPlaceholderKey.getState(failed)?.entries[0]
  assert.equal(entry?.status, 'error')
  assert.match(entry?.message || '', /网络中断/)

  // Retrying resets the status without losing the position.
  const retried = failed.apply(addUpload(failed, { id: 'a', pos: uploadPosition(failed, 'a')!, status: 'uploading', name: 'x.png' }))
  assert.equal(uploadPlaceholderKey.getState(retried)?.entries.find((item) => item.id === 'a')?.status, 'uploading')
  // A retry re-arms the same reservation: reusing the id must never create a
  // second placeholder on the line.
  assert.equal(uploadPlaceholderKey.getState(retried)?.entries.length, 1)
})

test('a settled reservation disappears and the document is still untouched', () => {
  const doc = schema.nodes.doc.create(null, [p('alpha')])
  const start = stateWith(doc, 2)
  const reserved = start.apply(addUpload(start, { id: 'a', pos: 2, status: 'uploading', name: '' }))
  const cleared = reserved.apply(reserved.tr.setMeta(uploadPlaceholderKey, { type: 'remove', id: 'a' }))
  assert.equal(uploadPlaceholderKey.getState(cleared)?.entries.length, 0)
  assert.equal(uploadPosition(cleared, 'a'), null)
  assert.deepEqual(cleared.doc.toJSON(), doc.toJSON())
})

test('the plugin is registered and its stylesheet defines both states', () => {
  const names = buildEditorExtensions().map((extension) => extension.name)
  assert.ok(names.includes('uploadPlaceholder'), 'the extension must be part of the editor build, not only of a test')

  const style = readFileSync(join(fileURLToPath(new URL('../src/styles/', import.meta.url)), 'content.css'), 'utf8')
  assert.match(style, /\.upload-placeholder\{/, 'the placeholder needs a visible box')
  assert.match(style, /\.upload-placeholder\.is-error\{/, 'a failed upload needs its own state, not just a toast')
  assert.match(style, /\.upload-placeholder-retry:active\{transform:var\(--press-transform\)\}/, 'the retry is a pressable control, using the shared press token')
  // Reduced motion must remove the arrival fade rather than leaving it as the
  // only feedback.
  assert.match(style, /@media \(prefers-reduced-motion:reduce\)\{\s*\.upload-placeholder\{animation:none\}/)
})
