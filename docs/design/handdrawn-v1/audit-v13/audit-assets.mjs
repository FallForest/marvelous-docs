import { readFile, readdir, writeFile, access, mkdir } from 'node:fs/promises'
import { resolve, join, relative } from 'node:path'
import { log } from 'node:console'
import process from 'node:process'

const root = resolve(import.meta.dirname, '../../../..')
const outIndex = process.argv.indexOf('--out-dir')
const outArgument = outIndex < 0 ? undefined : process.argv[outIndex + 1]
if (outIndex >= 0 && (!outArgument || outArgument.startsWith('--'))) throw new Error('--out-dir requires a directory path')
const outDirectory = outArgument ? resolve(outArgument) : import.meta.dirname
const src = join(root, 'apps/web/src')
const publicDir = join(root, 'apps/web/public')
const files = []
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, item.name)
    if (item.isDirectory()) await walk(file)
    else if (/\.(tsx?|css)$/.test(file)) files.push(file)
  }
}
await walk(src)
const refs = []
const lineAt = (source, index) => source.slice(0, index).split('\n').length
for (const file of files) {
  const source = await readFile(file, 'utf8')
  const path = relative(root, file).replaceAll('\\', '/')
  for (const match of source.matchAll(/<ArtIcon\b[^>]*?\bname=['"]([^'"]+)['"]/g)) {
    refs.push({ kind: 'literal ArtIcon', path, line: lineAt(source, match.index), url: '/art/handdrawn-v1/icons/' + match[1] + '.webp' })
  }
  for (const match of source.matchAll(/url\(['"]?(\/art\/[^)'"\s]+)['"]?\)/g)) {
    refs.push({ kind: 'CSS material', path, line: lineAt(source, match.index), url: match[1] })
  }
}
const iconFile = 'apps/web/src/components/ui/ArtIcon.tsx'
const iconSource = await readFile(join(root, iconFile), 'utf8')
const union = iconSource.slice(iconSource.indexOf('type ArtIconName'), iconSource.indexOf('type ArtIconProps'))
for (const match of union.matchAll(/'([^']+)'/g)) refs.push({ kind: 'ArtIcon type registry', path: iconFile, line: 4, url: '/art/handdrawn-v1/icons/' + match[1] + '.webp' })
for (const ref of refs) {
  try { await access(join(publicDir, ref.url.slice(1))); ref.exists = true }
  catch { ref.exists = false }
}
const manifest = JSON.parse(await readFile(join(publicDir, 'art/handdrawn-v1/manifest.json'), 'utf8'))
const result = {
  baseline: 'Current working tree, including uncommitted handdrawn/title refinements',
  method: 'Resolve literal ArtIcon names, the ArtIcon type registry, and CSS /art URLs against apps/web/public; dynamic names need manual review.',
  filesScanned: files.length,
  referencesChecked: refs.length,
  registeredAssets: manifest.assets.length,
  missing: refs.filter(ref => !ref.exists),
  missingUniqueUrls: [...new Set(refs.filter(ref => !ref.exists).map(ref => ref.url))],
}
await mkdir(outDirectory, { recursive: true })
await writeFile(join(outDirectory, 'asset-inventory.json'), JSON.stringify(result, null, 2) + '\n')
log(JSON.stringify(result, null, 2))
