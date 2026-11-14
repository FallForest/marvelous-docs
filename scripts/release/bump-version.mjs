#!/usr/bin/env node
/*
 * Synchronises the release version from the root package.json into every file
 * that has to state it.
 *
 * A version bump used to be eight hand edits, and the one that gets missed is
 * always the one nobody reads: a server image reporting 0.1.70 while the web
 * bundle says 0.1.71 makes the update banner lie and the compose default stale.
 * The root manifest is the source of truth because it is the file a release tag
 * is named after; everything else is a copy.
 *
 *   node scripts/release/bump-version.mjs            # write the copies
 *   node scripts/release/bump-version.mjs --dry-run  # report what would change
 *   node scripts/release/bump-version.mjs --check    # exit 1 when a copy drifts
 *
 * The root package.json is never written: edit it first (and add the
 * CHANGELOG section in the same change), then run this to carry the number
 * everywhere. --check is the CI-shaped form: it changes nothing and fails the
 * job, so a bumped manifest with stale copies cannot be tagged.
 *
 * Only the version is rewritten. Each file is matched by the shape it actually
 * uses - a JSON field, an APP_VERSION assignment, a compose default, a manifest
 * URL, a doc example - because a blind search-and-replace over the old number
 * would also rewrite the CHANGELOG and the third-party pins in pnpm-lock.yaml.
 *
 * The previous version's release URLs in release/latest.json are rebuilt, not
 * pattern-substituted: the manifest is what the in-app updater compares against,
 * so it has to name the images this version publishes.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')

/**
 * One entry per place that states the version. `pattern` must capture the
 * number in group 1 so the rest of the match survives untouched; `label` is what
 * the report names. A file may appear more than once (release/latest.json has a
 * plain "version" field, a release URL and two image tags); the rules are applied
 * in order against the same buffer.
 */
const TARGETS = [
  { file: 'apps/server/package.json', label: 'server manifest', pattern: /"version":\s*"([^"]+)"/ },
  { file: 'apps/web/package.json', label: 'web manifest', pattern: /"version":\s*"([^"]+)"/ },
  { file: 'packages/cli/package.json', label: 'cli manifest', pattern: /"version":\s*"([^"]+)"/ },
  { file: '.env.example', label: 'compose env template', pattern: /^APP_VERSION=(\S+)$/m },
  { file: 'apps/server/.env.example', label: 'server env template', pattern: /^APP_VERSION=(\S+)$/m },
  // The comment above the assignment quotes "(default 0.1.71)"; it is part of
  // the same statement and would otherwise contradict the value below it.
  { file: 'apps/server/.env.example', label: 'server env comment', pattern: /default (\d+\.\d+\.\d+)\)/ },
  { file: 'docker-compose.yml', label: 'compose app version', pattern: /\$\{APP_VERSION:-([^}]+)\}/ },
  { file: 'release/latest.json', label: 'release manifest', pattern: /"version":\s*"([^"]+)"/ },
  // The release URLs carry the tag, so they have their own rule rather than
  // reusing the manifest's "version" field.
  { file: 'release/latest.json', label: 'release tag url', pattern: /\/releases\/tag\/v(\d+\.\d+\.\d+)/ },
  // The image tags are the version without the leading v, in both the manifest
  // and the compose file people copy from.
  { file: 'release/latest.json', label: 'api image tag', pattern: /marvelous-docs-api:([^"]+)/ },
  { file: 'release/latest.json', label: 'web image tag', pattern: /marvelous-docs-web:([^"]+)/ },
  { file: 'docs/API.md', label: 'API doc example', pattern: /"version":\s*"(\d+\.\d+\.\d+)"/ },
]

const args = process.argv.slice(2)
const known = new Set(['--dry-run', '--check'])
const unknown = args.filter((arg) => !known.has(arg))
if (unknown.length) {
  console.error('unknown option(s): ' + unknown.join(', '))
  console.error('usage: node scripts/release/bump-version.mjs [--dry-run | --check]')
  process.exit(2)
}
const dryRun = args.includes('--dry-run')
const check = args.includes('--check')

const rootPackage = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const version = rootPackage.version
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error('root package.json has no usable version: ' + JSON.stringify(version))
  process.exit(2)
}

/** Group the per-file rules so each file is read and written once. */
const byFile = new Map()
for (const target of TARGETS) {
  if (!byFile.has(target.file)) byFile.set(target.file, [])
  byFile.get(target.file).push(target)
}

const stale = []
const changed = []
for (const [file, rules] of byFile) {
  const path = join(ROOT, file)
  const before = await readFile(path, 'utf8')
  let after = before
  for (const rule of rules) {
    const match = rule.pattern.exec(after)
    if (!match) {
      console.error('cannot find ' + rule.label + ' in ' + file + '; the file changed shape, fix the pattern first')
      process.exit(2)
    }
    if (match[1] === version) continue
    stale.push(file + ' (' + rule.label + '): ' + match[1] + ' -> ' + version)
    after = after.slice(0, match.index) + match[0].replace(match[1], version) + after.slice(match.index + match[0].length)
  }
  if (after === before) continue
  changed.push(file)
  if (!dryRun && !check) await writeFile(path, after)
}

if (!changed.length) {
  console.log('all ' + TARGETS.length + ' version statements already agree on ' + version)
  process.exit(0)
}

for (const line of stale) console.log((dryRun || check ? 'stale: ' : 'updated: ') + line)
if (check) {
  console.error('\nrun: node scripts/release/bump-version.mjs   (after bumping the root package.json)')
  process.exit(1)
}
if (dryRun) {
  console.log('\n--dry-run: nothing was written')
  process.exit(0)
}
console.log('\nwrote ' + changed.length + ' file(s); add the CHANGELOG.md section for ' + version + ' next')
