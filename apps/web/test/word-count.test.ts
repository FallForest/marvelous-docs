import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSchema } from '@tiptap/core'
import { buildEditorExtensions } from '../src/lib/editor/index.ts'
import { wordCount } from '../src/lib/format.ts'

/**
 * The footer's 字数 must count what it says it counts.
 *
 * `@tiptap/extension-character-count` keeps the number in `editor.storage` and
 * updates it incrementally, which is why the footer reads it instead of walking
 * the document on every keystroke (`DocumentEditor.countWords`). But its default
 * `wordCounter` splits on spaces: a paragraph of Chinese returned 1, so the label
 * and the number described different things. The extension accepts a counter, so
 * the fix is to give it the app's own `wordCount` rather than to stop using the
 * incremental storage.
 */

const schema = getSchema(buildEditorExtensions())

test('the editor is configured with the app-wide counter, not the space splitter', () => {
  const counter = buildEditorExtensions().find((extension) => extension.name === 'characterCount')
  assert.ok(counter, 'CharacterCount must stay in the build; the footer depends on its storage')
  const configured = (counter!.options as { wordCounter?: (text: string) => number }).wordCounter
  assert.equal(typeof configured, 'function', 'a wordCounter must be supplied explicitly')
  assert.equal(configured, wordCount, 'the footer and lib/format.wordCount must be the same function, not two implementations that agree today')
})

test('the configured counter treats CJK as characters and Latin as words', () => {
  const counter = (buildEditorExtensions().find((extension) => extension.name === 'characterCount')!.options as { wordCounter: (text: string) => number }).wordCounter
  // The default would return 1 for the first case and 2 for the second.
  assert.equal(counter('这是一段中文'), 6)
  assert.equal(counter('这是一段中文 hello world'), 8)
  assert.equal(counter('hello world'), 2)
  assert.equal(counter(''), 0)
})

test('the document text the extension counts is the visible text', () => {
  // `textBetween` with a space block separator is what the extension passes to
  // the counter; a paragraph break must not glue two Chinese paragraphs into one
  // word.
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.text('第一段')),
    schema.nodes.paragraph.create(null, schema.text('第二段')),
  ])
  const text = doc.textBetween(0, doc.content.size, ' ', ' ')
  assert.equal(text, '第一段 第二段')
  assert.equal(wordCount(text), 6)
})
