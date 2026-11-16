import test from 'node:test'
import assert from 'node:assert/strict'
import { isTrashedRow, openTarget, viewForTarget } from '../src/lib/open-target.ts'
import type { Doc } from '../src/lib/types.ts'

/**
 * The opening rule, checked without a DOM.
 *
 * Every list in the shell — sidebar tree, breadcrumb, home cards, favourites,
 * recent, trash, search results, command palette, folder page — now asks this
 * module what a row opens. The point of the module is that the answer depends on
 * the row and not on the caller, so the tests are about rows, not about screens.
 *
 * The three bugs this pins, all of which were live:
 *   1. `setActive(doc)` followed by `setSelectedFolderId(doc.parentId)`: for a
 *      folder, `parentId` is the folder *above* it, so pressing a folder selected
 *      its parent.
 *   2. At the root, `parentId` is null, so that same expression cleared the
 *      selection entirely and the reader landed on the dashboard.
 *   3. `active` was set to the folder row itself, which is the state the editor
 *      branch renders on.
 */

const folder = (id: string, title: string, parentId: string | null = null): Doc => ({
  id, title, kind: 'folder', parentId, version: 1,
})
const document = (id: string, title: string, parentId: string | null = null): Doc => ({
  id, title, parentId, version: 1,
})

const ROOT_FOLDER = folder('f-root', '资料')
const NESTED_FOLDER = folder('f-nested', '旧稿', 'f-root')
const DOC_IN_FOLDER = document('d-in-folder', '第一章', 'f-root')
const ROOT_DOC = document('d-root', '随手记')

test('a folder opens its own page, never its parent', () => {
  const target = openTarget(ROOT_FOLDER)
  assert.deepEqual(target, { kind: 'folder', folderId: 'f-root' })
  // With a parent the regression is invisible, because the parent id happens to
  // name a real folder: the reader simply lands one level up.
  assert.deepEqual(openTarget(NESTED_FOLDER), { kind: 'folder', folderId: 'f-nested' })
})

test('a folder never becomes the active document', () => {
  // `active` drives the editor branch. Setting it to a folder is what let a
  // folder row mount an editor over a folder that has no body.
  const view = viewForTarget(openTarget(NESTED_FOLDER))
  assert.equal(view.active, null, 'the editor must close')
  assert.equal(view.selectedFolderId, 'f-nested')
  assert.equal(view.homeView, 'home', 'the folder page belongs to the workspace, not to a dashboard view')
})

test('a document opens the editor and records its folder', () => {
  const target = openTarget(DOC_IN_FOLDER)
  assert.equal(target.kind, 'document')
  assert.equal(target.kind === 'document' ? target.doc.id : null, 'd-in-folder')
  assert.equal(target.kind === 'document' ? target.parentFolderId : null, 'f-root', 'the parent folder stays highlighted')

  const view = viewForTarget(target)
  assert.equal(view.active?.id, 'd-in-folder')
  assert.equal(view.selectedFolderId, 'f-root', 'the tree keeps the branch open')
  assert.equal(view.homeView, 'home', 'a folder page behind the editor must not stay mounted')
})

test('a root-level document opens with no folder selected', () => {
  const target = openTarget(ROOT_DOC)
  assert.equal(target.kind === 'document' ? target.parentFolderId : 'x', null)
  const view = viewForTarget(target)
  assert.equal(view.active?.id, 'd-root')
  assert.equal(view.selectedFolderId, null)
  assert.equal(view.homeView, 'home')
})

test('a trash row resolves as a document and is marked unopenable', () => {
  // The bin reuses the same card markup, so its rows reach the same resolver. The
  // server keeps deleted rows out of the live tree, so opening one is a 404 after
  // a flash of an empty editor — the flag lets the shell say so instead.
  const trashed: Doc = { ...document('d-trashed', '删掉的稿子', 'f-root'), expiresAt: '2026-12-01T00:00:00.000Z' }
  assert.equal(isTrashedRow(trashed), true)
  const target = openTarget(trashed)
  assert.equal(target.kind, 'document')
  assert.equal(target.kind === 'document' ? target.trashed : null, true)
  // It still resolves to a document: the refusal is the shell's job, once, rather
  // than every list deciding for itself whether a row is safe to open.
  assert.equal(viewForTarget(target).active?.id, 'd-trashed')
})

test('a live document is not mistaken for a trash row', () => {
  assert.equal(isTrashedRow(DOC_IN_FOLDER), false)
  assert.equal(isTrashedRow(ROOT_DOC), false)
  const target = openTarget(DOC_IN_FOLDER)
  assert.equal(target.kind === 'document' ? target.trashed : null, false)
})

test('a folder is never a trash row, even carrying a deadline', () => {
  // `expiresAt` is derived from `deletedAt` and a trashed folder is listed too, so
  // the test is on the row kind: a folder card opens the folder page, which is
  // still readable from the bin's own list.
  const trashedFolder: Doc = { ...folder('f-gone', '旧目录'), expiresAt: '2026-12-01T00:00:00.000Z' }
  assert.equal(isTrashedRow(trashedFolder), false)
  assert.deepEqual(openTarget(trashedFolder), { kind: 'folder', folderId: 'f-gone' })
})

test('the resolver is total: a row with no kind is a document', () => {
  // List responses omit `kind` for plain documents (it defaults to a document on
  // the server), so treating a missing kind as "not a folder" is what keeps an
  // older row from being rendered as a folder page with no children.
  const bare: Doc = { id: 'd-bare', title: '没有 kind', version: 1 }
  assert.deepEqual(openTarget(bare), { kind: 'document', doc: bare, parentFolderId: null, trashed: false })
})
