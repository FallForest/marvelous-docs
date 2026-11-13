import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PUBLIC = fileURLToPath(new URL('../../apps/web/public/', import.meta.url))
const TYPES = { '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' }

/** Serve the same public art URLs as Vite inside isolated browser verifiers. */
export function servePublicArt(request, response) {
  if (!request.url?.startsWith('/art/')) return false
  let filename
  try { filename = resolve(PUBLIC, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname)) }
  catch { response.writeHead(400).end(); return true }
  if (!filename.startsWith(resolve(PUBLIC) + sep)) { response.writeHead(403).end(); return true }
  readFile(filename).then((bytes) => {
    response.writeHead(200, { 'Content-Type': TYPES[extname(filename)] || 'application/octet-stream' })
    response.end(bytes)
  }).catch(() => { response.writeHead(404).end() })
  return true
}
