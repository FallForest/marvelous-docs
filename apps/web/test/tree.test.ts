import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDocTree, descendantIds, filterDocTree, flatten, treeDepth } from '../src/lib/tree.ts'
import type { Doc } from '../src/lib/types.ts'

function makeDoc(id: string, title: string, kind: 'document' | 'folder' = 'document', parentId: string | null = null): Doc {
  return { id, title, kind, parentId, content: { schemaVersion: 1, doc: { type: 'doc', content: [] } }, version: 1 }
}

const documents: Doc[] = [
  makeDoc('root-doc', 'Doc C'),
  makeDoc('f1', 'Alpha', 'folder'),
  makeDoc('d1', 'Beta', 'document', 'f1'),
  makeDoc('d2', 'Amber', 'document', 'f1'),
  makeDoc('f2', 'Zeta', 'folder'),
  makeDoc('grandchild', 'Nested', 'document', 'd1'),
]

test('buildDocTree nests children, keeps roots flat and sorts folders first', () => {
  const tree = buildDocTree(documents)
  assert.deepEqual(tree.map((node) => node.doc.id), ['f1', 'f2', 'root-doc'])
  assert.deepEqual(tree[0].children.map((node) => node.doc.id), ['d2', 'd1'])
  assert.equal(tree[1].children.length, 0)
})

test('buildDocTree promotes documents whose parent is missing', () => {
  const tree = buildDocTree([makeDoc('orphan', 'Orphan', 'document', 'missing-parent')])
  assert.deepEqual(tree.map((node) => node.doc.id), ['orphan'])
})

test('buildDocTree tolerates an empty workspace', () => {
  assert.deepEqual(buildDocTree([]), [])
})

test('filterDocTree keeps matched nodes and their ancestors', () => {
  const tree = buildDocTree(documents)
  const filtered = filterDocTree(tree, 'amber')
  assert.deepEqual(filtered.map((node) => node.doc.id), ['f1'])
  assert.deepEqual(filtered[0].children.map((node) => node.doc.id), ['d2'])
})

test('filterDocTree keeps a folder when a deep descendant matches', () => {
  const filtered = filterDocTree(buildDocTree(documents), 'nested')
  assert.deepEqual(filtered.map((node) => node.doc.id), ['f1'])
  assert.deepEqual(filtered[0].children.map((node) => node.doc.id), ['d1'])
  assert.deepEqual(filtered[0].children[0].children.map((node) => node.doc.id), ['grandchild'])
})

test('filterDocTree with an empty query returns the original tree', () => {
  const tree = buildDocTree(documents)
  assert.equal(filterDocTree(tree, ''), tree)
})

test('flatten walks the tree depth first', () => {
  assert.deepEqual(flatten(buildDocTree(documents)).map((doc) => doc.id), ['f1', 'd2', 'd1', 'grandchild', 'f2', 'root-doc'])
})

test('descendantIds collects nested children without the root', () => {
  const ids = descendantIds('f1', documents)
  assert.deepEqual([...ids].sort(), ['d1', 'd2', 'grandchild'])
  assert.equal(descendantIds('d2', documents).size, 0)
})

test('treeDepth counts folder ancestors', () => {
  const byId = new Map(documents.map((doc) => [doc.id, doc]))
  assert.equal(treeDepth(documents[0], byId), 0)
  assert.equal(treeDepth(documents[2], byId), 1)
  assert.equal(treeDepth(documents[5], byId), 2)
})
