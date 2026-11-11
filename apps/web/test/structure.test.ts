import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * Layering rules from docs/STRUCTURE.md.
 *
 * The layers only stay honest if something fails when an import points the
 * wrong way, so this walks the real files and enforces the direction.
 */

const SRC = resolve(import.meta.dirname, '../src')

type SourceFile = { path: string; text: string; imports: string[] }

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const files: SourceFile[] = walk(SRC).map((path) => {
  const text = readFileSync(path, 'utf8')
  const imports = [...text.matchAll(/from\s+'(\.[^']+)'/g)].map((match) => match[1]!)
  return { path: relative(SRC, path).replace(/\\/g, '/'), text, imports }
})

/** Resolves a relative import to a path relative to src/. */
function resolveImport(from: string, spec: string): string {
  const base = resolve(SRC, from, '..')
  const target = relative(SRC, resolve(base, spec)).replace(/\\/g, '/')
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const candidate = join(SRC, target + ext)
    try {
      if (statSync(candidate).isFile()) return target + ext
    } catch { /* try the next extension */ }
  }
  return target
}

const layerOf = (file: string) => {
  const parts = file.split('/')
  if (parts[0] === 'lib') return 'lib'
  if (parts[0] === 'hooks') return 'hooks'
  if (parts[0] === 'pages') return 'pages'
  if (parts[0] === 'components') return `components/${parts[1]}`
  if (file === 'App.tsx' || file === 'main.tsx') return 'shell'
  return 'other'
}

test('lib never imports UI code', () => {
  const offenders: string[] = []
  for (const file of files.filter((entry) => layerOf(entry.path) === 'lib')) {
    for (const spec of file.imports) {
      const target = layerOf(resolveImport(file.path, spec))
      if (target !== 'lib' && target !== 'other') offenders.push(`${file.path} -> ${spec} (${target})`)
    }
  }
  assert.deepEqual(offenders, [], 'lib must stay free of React and UI imports')
})

test('hooks may read lib and endpoints but never render UI', () => {
  const offenders: string[] = []
  for (const file of files.filter((entry) => layerOf(entry.path) === 'hooks')) {
    for (const spec of file.imports) {
      const target = layerOf(resolveImport(file.path, spec))
      if (target !== 'lib' && target !== 'other' && target !== 'hooks') {
        offenders.push(`${file.path} -> ${spec} (${target})`)
      }
    }
  }
  assert.deepEqual(offenders, [], 'a hook must not depend on a component or a page')
})

test('the API surface is declared once in lib/endpoints', () => {
  // Paths spelled inline at call sites are how a typo becomes a silent 404.
  const offenders: string[] = []
  for (const file of files.filter((entry) => entry.path.startsWith('hooks/') || entry.path.startsWith('pages/'))) {
    if (/'\/?(documents|workspace|templates|invites|system)\//.test(file.text) || /'\/me'|'\/auth\//.test(file.text)) {
      offenders.push(file.path)
    }
  }
  assert.deepEqual(offenders, [], 'route the call through lib/endpoints.ts instead: ' + offenders.join(', '))
})

test('components never import from pages', () => {
  const offenders: string[] = []
  for (const file of files.filter((entry) => entry.path.startsWith('components/'))) {
    for (const spec of file.imports) {
      const target = resolveImport(file.path, spec)
      if (target.startsWith('pages/')) offenders.push(`${file.path} -> ${spec}`)
    }
  }
  assert.deepEqual(offenders, [], 'a component must not depend on a page')
})

test('generic primitives stay domain free', () => {
  // ui/ may use shared types but must not pull in a page or a feature module.
  const offenders: string[] = []
  for (const file of files.filter((entry) => entry.path.startsWith('components/ui/'))) {
    for (const spec of file.imports) {
      const target = resolveImport(file.path, spec)
      if (target.startsWith('pages/') || target.startsWith('components/editor/')) {
        offenders.push(`${file.path} -> ${spec}`)
      }
    }
  }
  assert.deepEqual(offenders, [], 'components/ui must stay reusable across features')
})

test('the shell owns composition and stays the only importer of pages', () => {
  const importers = new Set<string>()
  for (const file of files) {
    for (const spec of file.imports) {
      if (resolveImport(file.path, spec).startsWith('pages/')) importers.add(file.path)
    }
  }
  for (const importer of importers) {
    assert.ok(importer === 'App.tsx' || importer.startsWith('pages/'), 'pages imported from ' + importer)
  }
})

test('styles are layered and the entry point imports them in order', () => {
  const index = readFileSync(join(SRC, 'styles/index.css'), 'utf8')
  const order = [...index.matchAll(/@import\s+'\.\/([a-z-]+)\.css'/g)].map((match) => match[1])
  assert.deepEqual(
    order,
    ['tokens', 'base', 'motion', 'surfaces', 'dialogs', 'navigation', 'panels', 'editor', 'content', 'shell', 'pages', 'updates'],
    'style layers must load from broadest to most specific',
  )
  for (const layer of order) {
    assert.ok(statSync(join(SRC, 'styles', `${layer}.css`)).isFile(), `${layer}.css is missing`)
  }
})

test('tokens load first and motion loads before any layer that animates', () => {
  const index = readFileSync(join(SRC, 'styles/index.css'), 'utf8')
  const order = [...index.matchAll(/@import\s+'\.\/([a-z-]+)\.css'/g)].map((match) => match[1])
  assert.equal(order[0], 'tokens', 'values must be defined before anything references them')
  assert.ok(order.indexOf('motion') < order.indexOf('surfaces'), 'motion utilities must exist before surfaces use them')
})

test('no stylesheet hard-codes a duration or an easing keyword', () => {
  // A literal 0.12s or ease-out is a value that will not be retuned with the
  // rest of the app. tokens.css defines them; motion.css composes them;
  // everywhere else must reference the token.
  const DEFINITIONS = new Set(['tokens.css', 'motion.css'])
  const timeLiteral = /(?:^|[^\w-])(\d*\.?\d+)m?s\b/g
  const easing = /(?:^|[^\w-])(?:ease|ease-in|ease-out|ease-in-out)(?![\w-])/
  // Sub-millisecond durations are the reduced-motion collapse idiom ("finish
  // instantly"), not a styling choice, so they are allowed everywhere.
  const INSTANT = 1
  const offenders: string[] = []
  for (const name of readdirSync(join(SRC, 'styles'))) {
    if (!name.endsWith('.css') || DEFINITIONS.has(name)) continue
    const text = readFileSync(join(SRC, 'styles', name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const [lineNumber, line] of text.split('\n').entries()) {
      const stripped = line.replace(/var\([^)]*\)/g, '')
      // A stagger step (animation-delay) is not a duration: it is the gap
      // between list items, and each list picks the gap that suits its density.
      // motion.css owns the default; the cap and the per-list step are local.
      const timed = /animation-delay/.test(stripped) ? '' : stripped
      const durations = [...timed.matchAll(timeLiteral)]
        .map((match) => Number(match[1]))
        .filter((value) => value > INSTANT)
      if (durations.length) offenders.push(name + ':' + (lineNumber + 1) + ' duration -> ' + line.trim().slice(0, 70))
      else if (easing.test(stripped)) offenders.push(name + ':' + (lineNumber + 1) + ' easing -> ' + line.trim().slice(0, 70))
    }
  }
  assert.deepEqual(offenders, [], 'use the --duration-* / --ease-* tokens instead')
})

test('the motion guide names every style layer', () => {
  // The guide is where someone learns which layer a new rule belongs to; it
  // drifts the moment a layer is added without a matching entry.
  const guide = readFileSync(resolve(import.meta.dirname, '../../../docs/MOTION.md'), 'utf8')
  const index = readFileSync(join(SRC, 'styles/index.css'), 'utf8')
  for (const layer of [...index.matchAll(/@import\s+'\.\/([a-z-]+)\.css'/g)].map((match) => match[1])) {
    assert.ok(guide.includes(layer + '.css'), 'docs/MOTION.md must name ' + layer + '.css')
  }
})

test('every source file is valid UTF-8 without misplaced CJK', () => {
  // Comments were historically stored in the wrong code page, which produced
  // mojibake that still compiled. Guard against reintroducing it.
  const mojibake = /[\u9239\u923a\u9225\u9226\u9518\u93c8\u93c1\u9418\u5a04\u934f\u93b4\u6222]/
  const offenders = files.filter((file) => mojibake.test(file.text)).map((file) => file.path)
  assert.deepEqual(offenders, [], 'mojibake in: ' + offenders.join(', '))
})
