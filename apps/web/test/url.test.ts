import test from 'node:test'
import assert from 'node:assert/strict'
import { DOC_PARAM, hrefWithDocument, readDocumentId } from '../src/lib/url.ts'

/**
 * Document addresses.
 *
 * The parsing rules are pure, so they are checked without a DOM. `syncDocumentUrl`
 * is the only part that touches `window` and is exercised by the browser
 * verifiers instead.
 */

test('reads the document id from a query string', () => {
  assert.equal(readDocumentId('?doc=abc-123'), 'abc-123')
  assert.equal(readDocumentId('?doc=abc-123&x=1'), 'abc-123')
  assert.equal(readDocumentId('?other=1'), null)
  assert.equal(readDocumentId(''), null)
  assert.equal(readDocumentId('?doc='), null, 'an empty id is not an address')
  assert.equal(readDocumentId('?doc=%20'), null, 'nor is whitespace')
})

test('writes the id without disturbing other parameters', () => {
  assert.equal(hrefWithDocument('/', 'd1'), '/?doc=d1')
  // `URLSearchParams.set` appends when the key is absent and replaces in place when
  // it is present, so the *order* differs between the two cases. The contract is
  // about which parameters exist, so compare that instead of the spelling.
  const params = (href: string) => [...new URLSearchParams(href.slice(href.indexOf('?'))).entries()].sort()
  assert.deepEqual(params(hrefWithDocument('/?q=notes', 'd1')), [['doc', 'd1'], ['q', 'notes']])
  assert.deepEqual(params(hrefWithDocument('/?doc=old&q=notes', 'd1')), [['doc', 'd1'], ['q', 'notes']], 'the old id is replaced, not appended')
  assert.equal(hrefWithDocument('/?doc=d1', null), '/', 'clearing removes the parameter entirely')
})

test('the fragment and path survive a rewrite', () => {
  assert.equal(hrefWithDocument('/x/y#frag', 'd1'), '/x/y?doc=d1#frag')
  assert.equal(hrefWithDocument('https://host.example/x?doc=d1', null), '/x')
})

test('an id is round-tripped exactly', () => {
  const id = '0b7f4c1e-9a3d-4f52-8c11-2e5a6d7b8c90'
  const href = hrefWithDocument('/', id)
  // hrefWithDocument returns path + query, so the parse is fed the query half -
  // which is exactly what readDocumentId receives from window.location.search.
  assert.equal(readDocumentId(href.slice(href.indexOf('?'))), id)
})

test('the parameter name is stable', () => {
  // Links in the wild carry it; renaming it silently breaks every one of them.
  assert.equal(DOC_PARAM, 'doc')
})