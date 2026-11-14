import test from 'node:test'
import assert from 'node:assert/strict'
import { automaticDocumentTitle, savedDocumentTitle, UNTITLED_DOCUMENT } from '../src/lib/document-title.js'

const text = (value: string) => ({ type: 'text', text: value })
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content })
const heading = (value: string, level = 1) => ({ type: 'heading', attrs: { level }, content: [text(value)] })
const document = (...content: unknown[]) => ({ schemaVersion: 1, doc: { type: 'doc', content } })

test('the first nonempty H1 takes priority over earlier paragraphs and lower headings', () => {
  const content = document(paragraph(text('Earlier prose')), heading('Other heading', 2), heading('  '), heading('Chosen title'), heading('Later title'))
  assert.equal(automaticDocumentTitle(content), 'Chosen title')
})

test('ordinary prose uses its first nonempty line, including hard breaks and marked text', () => {
  const content = document(paragraph(text('  ')), paragraph({ type: 'hardBreak' }, text('  First   line '), { type: 'hardBreak' }, text('Second line')))
  assert.equal(automaticDocumentTitle(content), 'First line')
  assert.equal(automaticDocumentTitle(document(paragraph({ type: 'text', text: 'Marked text', marks: [{ type: 'bold' }] }))), 'Marked text')
  assert.equal(automaticDocumentTitle(document({ type: 'blockquote', content: [paragraph(text('Nested prose'))] })), 'Nested prose')
  assert.equal(automaticDocumentTitle(document(heading('A note with only a lower heading', 2))), 'A note with only a lower heading')
})

test('code, tables and images cannot provide a title even when their descendants contain H1 or prose', () => {
  const ignored = [
    { type: 'codeBlock', content: [text('code only')] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [heading('Table heading'), paragraph(text('Cell text'))] }] }] },
    { type: 'image', attrs: { alt: 'image alt text' } },
  ]
  assert.equal(automaticDocumentTitle(document(...ignored)), UNTITLED_DOCUMENT)
  assert.equal(automaticDocumentTitle(document(...ignored, paragraph(text('Usable prose')))), 'Usable prose')
})

test('blank content falls back and long Unicode text is truncated without splitting surrogate pairs', () => {
  for (const content of [null, {}, document(), document(paragraph(text('\n  \t')))]) {
    assert.equal(automaticDocumentTitle(content), UNTITLED_DOCUMENT)
  }
  const title = automaticDocumentTitle(document(heading('😀'.repeat(41))))
  assert.equal(title, '😀'.repeat(40))
  assert.equal(Array.from(title).length, 40)
})

test('manual naming is permanent, including the exact untitled placeholder', () => {
  const content = document(heading('New automatic title'))
  assert.deepEqual(savedDocumentTitle('Existing name', 'manual', content), { title: 'Existing name', titleMode: 'manual' })
  assert.deepEqual(savedDocumentTitle('Existing name', 'auto', content, UNTITLED_DOCUMENT), { title: UNTITLED_DOCUMENT, titleMode: 'manual' })
  assert.deepEqual(savedDocumentTitle(UNTITLED_DOCUMENT, 'auto', content), { title: 'New automatic title', titleMode: 'auto' })
})
