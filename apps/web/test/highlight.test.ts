import test from 'node:test'
import assert from 'node:assert/strict'
import { LANGUAGES } from '../src/lib/languages.js'
import { grammarFor, lowlight, safeGrammar, supportsLanguage } from '../src/lib/highlight.js'

/**
 * The language picker and the highlighter have to agree.
 *
 * A grammar missing from the registry is not a crash — the block simply renders
 * unhighlighted — which is exactly the kind of silent regression this pins down.
 */

test('every language the picker offers has a grammar', () => {
  const missing = LANGUAGES.filter((language) => !supportsLanguage(language.id)).map((language) => language.id)
  assert.deepEqual(missing, [], 'languages without a grammar: ' + missing.join(', '))
})

test('aliases resolve to the grammar highlight.js names', () => {
  assert.equal(grammarFor('html'), 'xml', 'html is highlighted by the xml grammar')
  assert.equal(grammarFor('toml'), 'ini')
  assert.equal(grammarFor('cpp'), 'cpp')
  assert.equal(grammarFor('csharp'), 'csharp')
  assert.equal(grammarFor('javascript'), 'javascript')
})

test('an empty or plain language highlights as plaintext', () => {
  assert.equal(grammarFor(''), 'plaintext')
  assert.equal(grammarFor('   '), 'plaintext')
  assert.equal(grammarFor('plaintext'), 'plaintext')
})

test('an unknown language falls back to plaintext instead of throwing', () => {
  assert.equal(supportsLanguage('objective-c'), false)
  assert.equal(grammarFor('Objective-C'), 'objective-c', 'lowercased for lookup')
  // lowlight throws on an unregistered language, so the editor resolves through
  // safeGrammar first; a document with any fence still renders.
  assert.equal(safeGrammar('objective-c'), 'plaintext')
  assert.doesNotThrow(() => lowlight.highlight(safeGrammar('objective-c'), 'let x = 1'))
  assert.equal(safeGrammar('javascript'), 'javascript', 'known languages pass through')
})

test('highlighting emits token classes the stylesheet targets', () => {
  const tree = lowlight.highlight('javascript', 'const x = 1')
  const classes = JSON.stringify(tree).match(/hljs-[a-z-]+/g) ?? []
  assert.ok(classes.length > 0, 'expected at least one hljs-* class')
  for (const cls of ['hljs-keyword', 'hljs-number']) {
    assert.ok(classes.includes(cls), 'missing ' + cls + ' in ' + classes.join(','))
  }
})

test('the registry stays proportional to the picker, not to highlight.js', () => {
  // lowlight's `all` bundle registers 192 grammars; shipping that cost 1.1 MB.
  const registered = (lowlight as unknown as { listLanguages: () => string[] }).listLanguages()
  assert.ok(registered.length <= 40, 'registered ' + registered.length + ' grammars, expected the picker\'s ~27')
})
