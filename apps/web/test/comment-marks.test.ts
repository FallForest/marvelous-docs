import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { buildEditorExtensions } from '../src/lib/editor/index.ts'
import {
  anchorStillMatches, commentAnchorMarks, commentMarksKey, commentMarksPlugin,
} from '../src/lib/editor/comment-marks.ts'
import type { Comment } from '../src/lib/types.ts'

/**
 * Comment markers, driven headlessly.
 *
 * The whole feature is a view decoration, so the interesting behaviour — where a
 * marker lands, what it does when the text moves, and what happens when the text
 * is deleted — is exactly what a ProseMirror state can answer without a DOM.
 * These cases are the contract the editor and the side panel rely on.
 */

const schema = getSchema(buildEditorExtensions({}))

/** A one-paragraph document; `text` starts at position 1. */
function stateFor(text = 'ABCDEFGHIJ', comments: Comment[] = []) {
  const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  let state = EditorState.create({ schema, doc, plugins: [commentMarksPlugin()] })
  state = push(state, comments, { activeId: null, draft: null })
  return state
}

function push(state: EditorState, comments: Comment[], options: { activeId?: string | null; draft?: { from: number; to: number } | null } = {}) {
  const tr = state.tr.setMeta(commentMarksKey, {
    comments,
    activeId: options.activeId ?? null,
    draft: options.draft ?? null,
  })
  return state.apply(tr)
}

function thread(id: string, from: number, to: number, text: string, status: 'open' | 'resolved' = 'open'): Comment {
  return { id, body: '关于 ' + text, userId: 'u1', userName: '小林', status, anchor: { from, to, text } }
}

function markers(state: EditorState) {
  return commentMarksKey.getState(state)!.deco.find().map((decoration) => ({
    from: decoration.from,
    to: decoration.to,
    ids: decoration.spec.ids as string[],
    attrs: decoration.type.attrs as Record<string, string | undefined>,
  }))
}

/* ------------------------------------------------------------------ */
/* Ranges                                                              */
/* ------------------------------------------------------------------ */

test('a quoted range becomes one marker with a class and a tooltip', () => {
  const state = stateFor('ABCDEFGHIJ', [thread('c1', 3, 6, 'CDE')])
  const [marker] = markers(state)
  assert.equal(marker!.from, 3)
  assert.equal(marker!.to, 6)
  assert.equal(marker!.attrs.class, 'is-commented')
  assert.equal(marker!.attrs['data-comment-id'], 'c1')
  assert.equal(marker!.attrs.title, 'CDE')
})

test('overlapping threads share one marker that answers to both', () => {
  const marks = commentAnchorMarks(
    [thread('a', 1, 5, 'ABCD'), thread('b', 3, 8, 'CDEFG')],
    { content: { size: 12 }, textBetween: (from, to) => 'ABCDEFGHIJ'.slice(from - 1, to - 1) },
  )
  assert.equal(marks.length, 1)
  assert.deepEqual(marks[0]!.ids, ['a', 'b'])
  assert.equal(marks[0]!.from, 1)
  assert.equal(marks[0]!.to, 8)
})

test('ranges that merely touch stay separate comments', () => {
  const marks = commentAnchorMarks(
    [thread('a', 1, 4, 'ABC'), thread('b', 4, 7, 'DEF')],
    { content: { size: 12 }, textBetween: () => '' },
  )
  assert.equal(marks.length, 2)
})

test('reversed, collapsed and out-of-document anchors are repaired or dropped', () => {
  const doc = { content: { size: 12 }, textBetween: () => '' }
  const reversed = commentAnchorMarks([thread('a', 6, 3, 'CDE')], doc)
  assert.deepEqual([reversed[0]!.from, reversed[0]!.to], [3, 6], 'a reversed anchor is read as its own range')

  assert.equal(commentAnchorMarks([thread('b', 5, 5, '')], doc).length, 0, 'a collapsed range marks nothing')

  const far = commentAnchorMarks([thread('c', 200, 400, 'gone')], doc)
  assert.equal(far.length, 0, 'a range past the document is clamped away, not placed outside it')
})

test('a range clamped to the document edge still marks real text', () => {
  const doc = { content: { size: 6 }, textBetween: () => '' }
  const marks = commentAnchorMarks([thread('a', 2, 90, 'long')], doc)
  assert.equal(marks[0]!.to, 5, 'the end clamps to the last valid position')
})

/* ------------------------------------------------------------------ */
/* Placement                                                           */
/* ------------------------------------------------------------------ */

test('an anchor is placed only while the text still says what it quoted', () => {
  const state = stateFor('ABCDEFGHIJ', [])
  const placed = push(state, [thread('c1', 3, 6, 'CDE')])
  assert.equal(markers(placed).length, 1)

  // Same range, different words: a comment written against an older revision
  // must not underline whatever now occupies those positions.
  const staleHere = push(state, [thread('c2', 3, 6, 'XYZ')])
  assert.equal(markers(staleHere).length, 0)
})

test('an anchor without quoted text is placed on its range alone', () => {
  const state = stateFor('ABCDEFGHIJ', [])
  const placed = push(state, [{ id: 'c1', body: '这里', userId: 'u1', userName: '小林', anchor: { from: 2, to: 5 } }])
  assert.equal(markers(placed).length, 1)
})

test('a thread without an anchor leaves no marker', () => {
  const state = stateFor('ABCDEFGHIJ', [])
  const placed = push(state, [{ id: 'c1', body: '整篇', userId: 'u1', userName: '小林', anchor: null }])
  assert.equal(markers(placed).length, 0)
})

test('anchorStillMatches compares folded prefixes', () => {
  const doc = { content: { size: 20 }, textBetween: () => '用文档连接想法、讨论与行动。' }
  assert.ok(anchorStillMatches(thread('a', 1, 12, '用文档连接\n想法'), doc, 1, 12))
  assert.ok(!anchorStillMatches(thread('b', 1, 12, '完全不同的句子'), doc, 1, 12))
  assert.ok(anchorStillMatches({ id: 'c', body: '', userId: 'u', userName: 'n', anchor: { from: 1, to: 2 } }, doc, 1, 2))
})

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

test('a marker follows its text when content is inserted before it', () => {
  let state = stateFor('ABCDEFGHIJ', [thread('c1', 3, 6, 'CDE')])
  state = state.apply(state.tr.insertText('XX', 1))
  const [marker] = markers(state)
  assert.deepEqual([marker!.from, marker!.to], [5, 8])
  assert.equal(state.doc.textBetween(marker!.from, marker!.to), 'CDE')
})

test('a marker shrinks with a deletion inside it and never leaves the document', () => {
  let state = stateFor('ABCDEFGHIJ', [thread('c1', 3, 6, 'CDE')])
  state = state.apply(state.tr.delete(4, 5))
  const [marker] = markers(state)
  assert.deepEqual([marker!.from, marker!.to], [3, 5])
})

test('deleting the marked text removes the marker and it does not come back', () => {
  let state = stateFor('ABCDEFGHIJ', [thread('c1', 3, 6, 'CDE')])
  state = state.apply(state.tr.delete(3, 6))
  assert.equal(markers(state).length, 0, 'nothing left to underline')

  // The panel still lists the thread; pushing it again must not re-mark the
  // words that moved into the old range.
  state = push(state, [thread('c1', 3, 6, 'CDE')])
  assert.equal(markers(state).length, 0)
  assert.equal(state.doc.textBetween(3, 6), 'FGH')
})

test('a thread removed from the list loses its marker', () => {
  let state = stateFor('ABCDEFGHIJ', [thread('c1', 3, 6, 'CDE')])
  state = push(state, [])
  assert.equal(markers(state).length, 0)
})

/* ------------------------------------------------------------------ */
/* State: open thread, resolution, draft                               */
/* ------------------------------------------------------------------ */

test('the open thread is tinted, and only it', () => {
  const threads = [thread('c1', 1, 3, 'AB'), thread('c2', 4, 6, 'DE')]
  const state = stateFor('ABCDEFGHIJ', threads)
  const tinted = push(state, threads, { activeId: 'c2' })
  const byId = new Map(markers(tinted).map((marker) => [marker.attrs['data-comment-id'], marker.attrs.class]))
  assert.equal(byId.get('c1'), 'is-commented')
  assert.equal(byId.get('c2'), 'is-commented is-commented-active')

  const cleared = push(tinted, threads, { activeId: null })
  assert.ok(markers(cleared).every((marker) => !marker.attrs.class?.includes('is-commented-active')))
})

test('resolving a thread quiets its marker without moving it', () => {
  let state = stateFor('ABCDEFGHIJ', [thread('c1', 3, 6, 'CDE')])
  state = push(state, [thread('c1', 3, 6, 'CDE', 'resolved')])
  const [marker] = markers(state)
  assert.ok(marker!.attrs.class?.includes('is-commented-resolved'))
  assert.deepEqual([marker!.from, marker!.to], [3, 6], 're-tinting must not rewind the range')
})

test('stacked threads report a shared tooltip', () => {
  const state = stateFor('ABCDEFGHIJ', [thread('a', 1, 5, 'ABCD'), thread('b', 3, 8, 'CDEFG')],)
  const [marker] = markers(state)
  assert.deepEqual(marker!.ids, ['a', 'b'])
  assert.ok(marker!.attrs.title?.includes('共 2 条评论'))
})

test('the quoted draft is mapped through typing and cleared on send', () => {
  let state = stateFor('ABCDEFGHIJ', [])
  state = push(state, [], { draft: { from: 3, to: 6 } })
  assert.deepEqual(commentMarksKey.getState(state)!.draft, { from: 3, to: 6 })

  // Inserting before the quote moves it along with its text; the highlight has
  // to cover the same words, not the same offsets.
  state = state.apply(state.tr.insertText('X', 1))
  assert.deepEqual(commentMarksKey.getState(state)!.draft, { from: 4, to: 7 })
  assert.equal(state.doc.textBetween(4, 7), 'CDE')

  // Typing inside the quote belongs to it, so the range grows with the edit.
  state = state.apply(state.tr.insertText('Y', 5))
  assert.deepEqual(commentMarksKey.getState(state)!.draft, { from: 4, to: 8 })
  assert.equal(state.doc.textBetween(4, 8), 'CYDE')

  state = push(state, [], { draft: null })
  assert.equal(commentMarksKey.getState(state)!.draft, null)
})