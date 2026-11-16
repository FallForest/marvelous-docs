import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const read = (path: string) => readFileSync(join(SRC, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Two documented ways to keep writing, which both used to end in nowhere.
 *
 *   - Enter on the title blurred the field and left focus on `<body>`.
 *   - The blank band under the last paragraph of the paper was not part of the
 *     editor, so clicking it produced no caret at all.
 *
 * These are source-level assertions because both decisions live inside event
 * handlers that need a live ProseMirror view. What a browser would add: that the
 * caret is actually placed and that the first typed character lands in the body.
 */

test('Enter on the title moves the caret into the body instead of blurring to nowhere', () => {
  const editor = read('components/editor/DocumentEditor.tsx')
  const title = editor.slice(editor.indexOf('aria-label="文档标题"'))
  const field = title.slice(0, title.indexOf('/></div>'))
  assert.ok(!/event\.currentTarget\.blur\(\)[\s\S]{0,80}event\.key === 'Enter'/.test(field), 'a bare blur on Enter is the bug')
  assert.match(field, /titleIme\.current\.blocked/, 'the title field needs the same composition guard as the slash menu')
  assert.match(field, /editor\?\.chain\(\)\.focus\('start'\)\.run\(\)/, 'Enter must place the caret at the start of the body')
  // Escape still reverts the name but must not need a second interaction to get
  // back to the text, so it blurs deliberately (that is the cancel path).
  assert.match(field, /event\.key === 'Escape'[\s\S]{0,160}blur\(\)/)
})

test('clicking the blank paper under the last block starts writing there', () => {
  const editor = read('components/editor/DocumentEditor.tsx')
  const paper = editor.slice(editor.indexOf('className="paper"'))
  const handler = paper.slice(0, paper.indexOf('<div className="document-heading"'))
  assert.match(handler, /onMouseDown=/, 'the paper needs an explicit handler; the padding is not editable surface')
  assert.match(handler, /editor\.chain\(\)\.focus\('end'\)\.run\(\)/)
  // It must not steal clicks that belong to the text, the title, or a control.
  assert.match(handler, /closest\('\.tiptap-content, \.document-heading, input, textarea, button, a, label'\)/)
  // And it must not hijack the context menu.
  assert.match(handler, /event\.button !== 0/)
  // A locked (read-only) document keeps doing nothing.
  assert.match(handler, /!editor\.isEditable/)
})

test('the canvas keeps a real minimum height so the blank band exists', () => {
  const style = read('styles/editor.css')
  assert.match(style, /\.tiptap-content\{[^}]*min-height:45vh/, 'without a minimum the paper would end at the last character and there would be no band to click')
})
