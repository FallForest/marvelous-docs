import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Layering rules from docs/STRUCTURE.md.
 *
 * The server is assembled from `index.ts` -> `routes/` -> `domain/` -> `core/`
 * -> `lib/`. tsc enforces types, not direction: an import pointing the wrong way
 * still compiles and still passes every route test, while quietly turning a leaf
 * module into something that needs a database. This walks the real files and
 * fails on the reverse edge.
 */

const SRC = resolve(import.meta.dirname, '../src');

type SourceFile = { path: string; imports: string[] };

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const files: SourceFile[] = walk(SRC).map((path) => ({
  path: relative(SRC, path).replace(/\\/g, '/'),
  imports: [...readFileSync(path, 'utf8').matchAll(/from\s+'(\.[^']+)'/g)].map((match) => match[1]!),
}));

/** Resolves a relative import to a path relative to src/. */
function resolveImport(from: string, spec: string): string {
  const base = resolve(SRC, from, '..');
  return relative(SRC, resolve(base, spec.replace(/\.js$/, ''))).replace(/\\/g, '/');
}

/** The layer a resolved path belongs to. */
type Layer = 'routes' | 'domain' | 'core' | 'lib' | 'collaboration' | 'root';

function layerOf(file: string): Layer {
  const [head] = file.split('/');
  if (head === 'routes') return 'routes';
  if (head === 'domain') return 'domain';
  if (head === 'core') return 'core';
  if (head === 'lib') return 'lib';
  if (head === 'collaboration') return 'collaboration';
  return 'root';
}

/**
 * Which layers each layer may import, per docs/STRUCTURE.md.
 *
 * `collaboration/` is a peer service, not a layer below `domain/`: a write has to
 * invalidate a live room, and a room has to persist Yjs state through the same
 * access rules. Both directions are therefore allowed between them, while
 * `core/` and `lib/` stay free of both.
 */
const ALLOWED: Record<Layer, Layer[]> = {
  // index.ts assembles everything, and the collaboration service sits beside it.
  root: ['routes', 'domain', 'core', 'lib', 'collaboration', 'root'],
  routes: ['domain', 'core', 'lib', 'routes', 'collaboration'],
  domain: ['core', 'lib', 'domain', 'collaboration'],
  // Infrastructure knows nothing about documents; it may only reach into lib/.
  core: ['lib', 'core'],
  collaboration: ['domain', 'core', 'lib', 'collaboration'],
  // lib/ has to stay runnable without a pool, so it imports nothing above it.
  lib: ['lib'],
};

test('every layer only imports downwards', () => {
  const offenders: string[] = [];
  for (const file of files) {
    const from = layerOf(file.path);
    for (const spec of file.imports) {
      const to = layerOf(resolveImport(file.path, spec));
      if (!ALLOWED[from].includes(to)) offenders.push(file.path + ' -> ' + spec + ' (' + to + ')');
    }
  }
  assert.deepEqual(offenders, [], 'imports point back up the stack: ' + offenders.join(' | '));
});

test('lib/ never imports Fastify or the pool', () => {
  // lib/ is the layer the database-free unit tests import. A single `fastify`
  // type import there is how the suite stops being runnable without Postgres.
  const offenders = files
    .filter((file) => layerOf(file.path) === 'lib')
    // A type-only import is erased before the module runs, so `import type { Pool }`
    // cannot pull the driver into the database-free suite.
    .filter((file) => /^\s*import (?!type )[^;]*from '(fastify|pg|@fastify\/)/m.test(readFileSync(join(SRC, file.path), 'utf8')))
    .map((file) => file.path);
  assert.deepEqual(offenders, [], 'lib/ must stay framework free: ' + offenders.join(', '));
});

test('route modules never import the process entry point', () => {
  // index.ts registers the routes; importing it back would close the cycle at
  // runtime and re-run the whole boot sequence on the first request.
  const offenders = files
    .filter((file) => file.path.startsWith('routes/') || file.path.startsWith('domain/'))
    // Resolve first: lib/markdown/index.js is a barrel, not the entry point.
    .filter((file) => file.imports.some((spec) => resolveImport(file.path, spec) === 'index'))
    .map((file) => file.path);
  assert.deepEqual(offenders, [], 'a route or domain module imported the entry point: ' + offenders.join(', '));
});

test('a lib folder exposes a barrel and is imported through it', () => {
  // lib/markdown/ is seven files that only make sense together. Callers import
  // the folder; reaching into a leaf makes the internal split unchangeable.
  const offenders: string[] = [];
  for (const file of files) {
    for (const spec of file.imports) {
      const target = resolveImport(file.path, spec);
      const parts = target.split('/');
      if (parts[0] !== 'lib' || parts.length < 3) continue;
      if (parts[1] !== 'markdown') continue;
      if (parts[2] === 'index') continue;
      if (file.path.startsWith('lib/markdown/')) continue;
      offenders.push(file.path + ' -> ' + spec);
    }
  }
  assert.deepEqual(offenders, [], 'import lib/markdown/index.js instead of a leaf: ' + offenders.join(', '));
});
