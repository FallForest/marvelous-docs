import test from 'node:test'
import assert from 'node:assert/strict'
import { renderDocHTML } from '../src/lib/export/render-html.js'

/**
 * The public share page injects this HTML with dangerouslySetInnerHTML while
 * rendering anonymously, so any URL that reaches an href or src is untrusted.
 * These cases pin the scheme allowlist: a document must not be able to smuggle
 * a javascript: URL into someone else's browser.
 */

function linkDocument(href: string) {
  return {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href } }] }],
    }],
  }
}

test('javascript: links are stripped, not rendered', () => {
  const html = renderDocHTML(linkDocument('javascript:alert(1)'))
  assert.ok(!html.includes('javascript:'), 'scheme must not survive')
  assert.ok(!html.includes('<a '), 'no anchor is emitted without a safe href')
  assert.ok(html.includes('click'), 'the text still renders')
})

test('data: and vbscript: links are stripped', () => {
  for (const href of ['data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'JavaScript:alert(1)']) {
    const html = renderDocHTML(linkDocument(href))
    assert.ok(!/<a [^>]*href/i.test(html), 'no href for ' + href)
  }
})

test('http, https, mailto, tel and relative links survive', () => {
  for (const href of ['https://example.com/a', 'http://example.com', 'mailto:a@b.c', 'tel:+123', '/docs/x', '#anchor']) {
    const html = renderDocHTML(linkDocument(href))
    assert.ok(html.includes('href="' + href + '"'), 'kept ' + href)
    assert.ok(html.includes('rel="noopener noreferrer nofollow"'), 'external links are nofollow')
  }
})

test('image sources use the same allowlist', () => {
  const bad = renderDocHTML({ type: 'image', attrs: { src: 'javascript:alert(1)', alt: 'x' } })
  assert.equal(bad, '', 'an unsafe image is dropped entirely')
  const good = renderDocHTML({ type: 'image', attrs: { src: 'https://example.com/a.png', alt: 'x' } })
  assert.ok(good.includes('src="https://example.com/a.png"'))
  assert.ok(good.includes('loading="lazy"'))
})

test('text content is escaped', () => {
  const html = renderDocHTML({
    type: 'paragraph',
    content: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }],
  })
  assert.ok(!html.includes('<img'), 'no markup from text')
  assert.ok(html.includes('&lt;img'))
})
