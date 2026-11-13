import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scopeCss } from '../src/lib/export/export-css'

/**
 * The export stylesheet is a standalone document's rules; injecting it into the
 * running app unscoped would restyle the application itself. These cases pin the
 * rewriting that prevents it.
 */

const EXPORT_CSS = [
  'body{font-family:serif;margin:0;padding:2.5rem 1.5rem;}',
  'article{max-width:46rem;margin:0 auto;}',
  'h1,h2,h3{line-height:1.25;}',
  'table{border-collapse:collapse;width:100%;}',
  'th,td{border:1px solid #dee0e3;padding:.4rem .6rem;}',
  'pre code{background:none;padding:0;}',
  'ul.task-list{list-style:none;}',
  'hr{border:none;border-top:1px solid #dee0e3;}',
  '@media print{article{max-width:none;}body{padding:0;}}',
  '@keyframes fade{from{opacity:0}to{opacity:1}}',
  '@font-face{font-family:"Export Sans";src:url(/x.woff2);}',
].join('\n')

test('document-level selectors map onto the export root', () => {
  const scoped = scopeCss(EXPORT_CSS, '.root')
  assert.ok(scoped.includes('.root{font-family:serif'))
  assert.ok(scoped.includes('.root{max-width:46rem'))
  // `body` must not survive as a bare selector, or the app is restyled.
  assert.ok(!/(^|\n)body\{/.test(scoped))
  assert.ok(!/(^|\n)article\{/.test(scoped))
});

test('every element selector is prefixed', () => {
  const scoped = scopeCss(EXPORT_CSS, '.root')
  for (const element of ['h1', 'table', 'th', 'pre code', 'ul.task-list', 'hr']) {
    assert.ok(!new RegExp('(^|\\n)' + element.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{').test(scoped), element + ' leaked unscoped')
  }
  assert.ok(scoped.includes('.root h1,.root h2,.root h3{line-height:1.25;}'))
  assert.ok(scoped.includes('.root pre code{background:none'))
});

test('at-rules keep their bodies intact and scope their inner rules', () => {
  const scoped = scopeCss(EXPORT_CSS, '.root')
  // @keyframes selectors are not CSS selectors: prefixing them would break it.
  assert.ok(scoped.includes('@keyframes fade{from{opacity:0}to{opacity:1}}'))
  assert.ok(scoped.includes('@font-face{font-family:"Export Sans";src:url(/x.woff2);}'))
  // @media is a container, so the rules inside it are scoped recursively.
  assert.ok(scoped.includes('@media print{'))
  assert.ok(scoped.includes('.root{max-width:none;}'))
});

test('selector lists are split on top-level commas only', () => {
  const scoped = scopeCss('a:not(.x,.y),p{margin:0}', '.root')
  assert.equal(scoped, '.root a:not(.x,.y),.root p{margin:0}')
});

test('an empty or comment-only stylesheet yields nothing', () => {
  assert.equal(scopeCss('', '.root'), '')
  assert.equal(scopeCss('/* nothing */', '.root'), '')
});

test(':root declarations stay on the document', () => {
  const scoped = scopeCss(':root{--ink:#111}', '.root')
  assert.equal(scoped, ':root{--ink:#111}')
});

test('comments are stripped rather than copied into the page', () => {
  const scoped = scopeCss('/* body{color:red} */ p{margin:0}', '.root')
  assert.ok(!scoped.includes('red'))
  assert.equal(scoped, '.root p{margin:0}')
});
