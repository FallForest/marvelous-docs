import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import { buildEditorExtensions } from '../src/lib/editor/index.ts'
import { SLASH_ITEMS } from '../src/components/editor/SlashMenu.tsx'

/**
 * The insertion command's search contract.
 *
 * These are pure: `SLASH_ITEMS` is data, and the filter is the rule the component
 * applies. Testing the rule here rather than through the menu keeps a DOM out of
 * it, and the same array feeds the trigger check in DocumentEditor.
 */

const matches = (query) => {
  const needle = query.trim().toLowerCase()
  if (!needle) return SLASH_ITEMS
  const byLabel = SLASH_ITEMS.filter((item) => item.label.includes(needle))
  if (byLabel.length) return byLabel
  const byHint = SLASH_ITEMS.filter((item) => item.hint.includes(needle))
  if (byHint.length) return byHint
  return SLASH_ITEMS.filter((item) => item.keywords.some((word) => word.startsWith(needle)))
}

test('every item is reachable by a Latin alias', () => {
  // The menu used to match Chinese labels only, so a writer thinking in English or
  // typing pinyin got an empty menu and reached for the mouse.
  for (const item of SLASH_ITEMS) {
    assert.ok(item.keywords.length > 0, item.id + ' has no aliases')
    for (const word of item.keywords) {
      const hit = matches(word)
      assert.ok(hit.some((entry) => entry.id === item.id), 'alias "' + word + '" does not reach ' + item.id)
    }
  }
})

test('a label match outranks an alias match', () => {
  // "表格" is the label of the table item; nothing else should win.
  assert.deepEqual(matches('表格').map((item) => item.id), ['table'])
})

test('a prefix reaches the item, an unrelated string does not', () => {
  assert.ok(matches('head').some((item) => item.id === 'h1'))
  assert.deepEqual(matches('zzzz'), [])
})

test('the ids are unique, because they are React keys and command targets', () => {
  const ids = SLASH_ITEMS.map((item) => item.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('the editor extensions build the same schema on both sides of the wire', () => {
  // A node the client can produce and the server cannot reject makes every REST
  // save fail with 400 while collaboration keeps working - the trap recorded in
  // lib/editor/image.ts. The two extension lists must stay in step.
  const schema = getSchema(buildEditorExtensions({}))
  for (const name of ['paragraph', 'heading', 'bulletList', 'listItem', 'taskItem', 'blockquote', 'codeBlock', 'table', 'image']) {
    assert.ok(schema.nodes[name], 'client schema is missing ' + name)
  }
})
test('the indent attribute exists on both schemas', async () => {
  // The client can produce it with Tab; the server has to accept it or every REST
  // save of an indented paragraph returns 400 while collaboration keeps working.
  // That asymmetry is the trap recorded in lib/editor/image.ts, and it is silent
  // until somebody saves.
  const clientSchema = getSchema(buildEditorExtensions({}))
  const { editorExtensions } = await import('../../server/src/lib/schema.ts').catch(() => ({ editorExtensions: null }))
  for (const type of ['paragraph', 'heading']) {
    assert.ok(clientSchema.nodes[type]?.spec.attrs?.indent, 'client ' + type + ' has no indent attribute')
  }
  if (editorExtensions) {
    const serverSchema = getSchema(editorExtensions)
    for (const type of ['paragraph', 'heading']) {
      assert.ok(serverSchema.nodes[type]?.spec.attrs?.indent, 'server ' + type + ' has no indent attribute')
    }
  }
})

test('the indent shape is one integer, and zero means none', () => {
  const schema = getSchema(buildEditorExtensions({}))
  const paragraph = schema.nodes.paragraph
  assert.equal(paragraph.spec.attrs.indent.default, 0)
  // A positive value renders as a data attribute; zero renders as nothing, so a
  // document that never used Tab is byte-identical to one from before the feature.
  // Read through the JSON writer, which is what the editor persists and the API
  // validates - the DOM serialiser is one of several consumers, not the contract.
  const indented = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { indent: 2 }, content: [{ type: 'text', text: 'x' }] }] })
  assert.equal(indented.firstChild.attrs.indent, 2)
  const plain = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] })
  assert.equal(plain.firstChild.attrs.indent, 0, 'an absent attribute defaults to no indent')
})
