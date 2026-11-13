#!/usr/bin/env node
/*
 * Finds uploads no document refers to, and optionally deletes them.
 *
 * An upload is stored under a content URL — /api/v1/uploads/<32-hex>-<name> — and
 * that URL is the only record that it exists. Nothing deletes one: removing the
 * document that embedded an image leaves the bytes behind, and there is no route
 * to remove them by hand. On a deployment that has been pasting screenshots for a
 * year the volume is mostly orphans, and there is no way to tell which is which
 * from the filesystem alone.
 *
 *   node scripts/maintenance/prune-uploads.mjs            # report only
 *   node scripts/maintenance/prune-uploads.mjs --delete   # remove them
 *   node scripts/maintenance/prune-uploads.mjs --min-age 30 --delete
 *
 * --min-age (days, default 1) protects an upload that was just made and has not
 * been embedded yet: the editor uploads first and inserts the URL a moment later,
 * so a sweep that ran in between would delete a file the user is watching.
 *
 * Two protections worth knowing about:
 *
 * - The scan reads `documents.content` and every row of `document_versions`, so a
 *   URL that survives only in an old version still counts as referenced. Without
 *   that, restoring a version would bring back a broken image.
 * - It never touches a file whose name is not in the upload shape. Those are
 *   something else's business — a mounted volume, a stray directory, an admin's
 *   scratch file.
 *
 * Needs DATABASE_URL and UPLOAD_DIR, which the server already reads.
 */

import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import pg from 'pg'

const args = process.argv.slice(2)
const shouldDelete = args.includes('--delete')
const minAgeIndex = args.indexOf('--min-age')
const minAgeDays = minAgeIndex >= 0 ? Number(args[minAgeIndex + 1]) : 1

if (!Number.isFinite(minAgeDays) || minAgeDays < 0) {
  console.error('--min-age needs a number of days, 0 or more')
  process.exit(2)
}

const uploadDir = process.env.UPLOAD_DIR || '/data/uploads'
const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set')
  process.exit(2)
}

/** /api/v1/uploads/<32 hex>-<name> */
const UPLOAD_NAME = /^[a-f0-9]{32}-[a-zA-Z0-9._-]+$/

const pool = new pg.Pool({ connectionString })

async function referencedNames() {
  // Both tables: a URL in an old version is still in use the moment someone
  // restores it, and a restore is not the moment to discover the file is gone.
  const live = await pool.query(
    "SELECT content::text AS body FROM documents WHERE content::text LIKE '%/api/v1/uploads/%'",
  )
  const versions = await pool.query(
    "SELECT content::text AS body FROM document_versions WHERE content::text LIKE '%/api/v1/uploads/%'",
  )
  const names = new Set()
  for (const row of [...live.rows, ...versions.rows]) {
    for (const match of String(row.body).matchAll(/\/api\/v1\/uploads\/([^"\\\s]+)/g)) {
      names.add(match[1])
    }
  }
  return names
}

async function main() {
  const referenced = await referencedNames()

  let entries
  try {
    entries = await readdir(uploadDir, { withFileTypes: true })
  } catch (error) {
    console.error('cannot read ' + uploadDir + ': ' + error.message)
    process.exit(1)
  }

  const cutoff = Date.now() - minAgeDays * 24 * 60 * 60 * 1000
  const orphans = []
  let skipped = 0
  let orphanBytes = 0
  let keptBytes = 0

  for (const entry of entries) {
    if (!entry.isFile()) { skipped++; continue }
    if (!UPLOAD_NAME.test(entry.name)) { skipped++; continue }
    const path = join(uploadDir, entry.name)
    const info = await stat(path)
    if (referenced.has(entry.name)) {
      keptBytes += info.size
      continue
    }
    // Too new to judge: the upload may be seconds away from being inserted.
    if (info.mtimeMs > cutoff) { skipped++; continue }
    orphans.push({ name: entry.name, size: info.size })
    orphanBytes += info.size
  }

  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1) + ' MB'
  console.log('uploads directory: ' + uploadDir)
  console.log('referenced by documents: ' + referenced.size)
  console.log('orphaned: ' + orphans.length + ' (' + mb(orphanBytes) + ')')
  console.log('kept: ' + mb(keptBytes))
  if (skipped) console.log('skipped (too new, or not an upload): ' + skipped)

  for (const orphan of orphans.slice(0, 20)) {
    console.log('  ' + orphan.name + '  ' + mb(orphan.size))
  }
  if (orphans.length > 20) console.log('  ... and ' + (orphans.length - 20) + ' more')

  if (!shouldDelete) {
    if (orphans.length) console.log('\nnothing deleted. Re-run with --delete to remove these.')
    await pool.end()
    return
  }

  let removed = 0
  let failed = 0
  for (const orphan of orphans) {
    try {
      await unlink(join(uploadDir, orphan.name))
      removed++
    } catch (error) {
      failed++
      console.error('  could not delete ' + orphan.name + ': ' + error.message)
    }
  }
  console.log('\ndeleted ' + removed + ' file(s), ' + mb(orphanBytes) + ' reclaimed' + (failed ? ', ' + failed + ' failed' : ''))
  await pool.end()
}

await main()
