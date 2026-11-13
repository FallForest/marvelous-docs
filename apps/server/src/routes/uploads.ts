import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { fail } from '../core/http.js'
import { config } from '../core/config.js'
import type { AuthRequest } from '../core/types.js'
import type { RouteDeps } from './deps.js'

/** One uploaded file may be 20 MiB. Keep in step with `client_max_body_size`
 * in apps/web/nginx.conf: the proxy runs first, so lowering only one of them is
 * lowering nothing. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/**
 * Everything the endpoint stores, and the one list both gates read.
 *
 * `index.ts` registers a body parser for each of these, and the PUT below
 * rejects anything else; keeping a single exported list is what stops the two
 * from drifting. A type in only one of them fails in a way that reads like a
 * client bug: present in the parser list but not here, the body arrives and the
 * route answers 415; present here but not in the parser list, Fastify answers
 * 415 before the route ever runs.
 *
 * Deliberately image-only plus PDF. This endpoint exists for content that a
 * document embeds, not for general file storage — a driver's licence scan or a
 * 300-page report belongs in a drive, and letting 1 GiB through here once made
 * the editor the obvious place to put one.
 */
export const UPLOAD_MIME_TYPES = [
  'application/octet-stream',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
] as const

const ALLOWED_MIME: ReadonlySet<string> = new Set(UPLOAD_MIME_TYPES)
const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * Uploads.
 *
 * Files live on disk with a random 32-hex prefix and a sanitised name; reads
 * are anonymous because the URL itself is the capability, which matches how
 * embedded images are expected to behave.
 */
export function registerUploadRoutes(app: FastifyInstance, deps: RouteDeps) {
  // Each upload may be 20 MB, so the budget is deliberately small per caller.
  app.put('/api/v1/uploads', { preHandler: [deps.authenticate.preHandler, deps.rateLimit(30, 10 * 60 * 1000)] }, async (request, reply) => {
    const auth = request as AuthRequest
    const mime = String(request.headers['content-type'] || 'application/octet-stream').split(';')[0]!.toLowerCase()
    // Checked before the body: a type this endpoint does not store is a 415
    // whatever the body looks like, and answering "body is required" to a caller
    // who sent 300 KB of text/plain hides the real reason.
    if (!ALLOWED_MIME.has(mime)) {
      return fail(reply, 415, 'UNSUPPORTED_MEDIA_TYPE', 'This file type is not supported. Send it as application/octet-stream if the bytes matter more than the label.')
    }

    const body = request.body as Buffer
    // A non-Buffer here means a parser this endpoint did not register claimed the
    // type — text/plain and JSON have built-ins — so the bytes never arrived as
    // bytes. Naming that is more useful than "body is required".
    if (!Buffer.isBuffer(body)) return fail(reply, 400, 'INVALID_INPUT', 'Send the file as raw bytes, not as text or JSON.')
    if (body.length === 0) return fail(reply, 400, 'INVALID_INPUT', 'Upload body is required.')
    if (body.length > MAX_UPLOAD_BYTES) return fail(reply, 413, 'FILE_TOO_LARGE', 'Files are limited to 20 MB.')

    const rawName = String(request.headers['x-file-name'] || 'upload.bin').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'upload.bin'
    const id = randomBytes(16).toString('hex')
    await mkdir(config.uploadDir, { recursive: true })
    const filename = `${id}-${rawName}`
    await writeFile(join(config.uploadDir, filename), body)

    return reply.code(201).send({
      file: {
        id,
        name: rawName,
        mimeType: mime,
        size: body.length,
        url: `/api/v1/uploads/${filename}`,
        uploadedBy: auth.user.sub,
      },
    })
  })

  app.get('/api/v1/uploads/:filename', async (request, reply) => {
    const filename = String((request.params as { filename?: string }).filename || '')
    if (!/^[a-f0-9]{32}-[a-zA-Z0-9._-]+$/.test(filename)) return fail(reply, 404, 'NOT_FOUND', 'File was not found.')
    try {
      const data = await readFile(join(config.uploadDir, filename))
      /*
       * Serve with the type the file actually is. Everything used to go out as
       * application/octet-stream, so an <img src> pointing here downloaded the
       * file instead of rendering it — the image simply never appeared.
       *
       * The type comes from the extension, not from the upload header: the
       * header is client-supplied, and echoing it back would let a caller label
       * an HTML document as text/html (the filename is sanitised, so this is
       * belt and braces rather than the only guard).
       */
      const type = MIME_BY_EXTENSION[filename.slice(filename.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream'
      // Content is immutable per filename (random prefix), so it can be cached.
      reply.header('Cache-Control', 'public, max-age=31536000, immutable')
      reply.header('X-Content-Type-Options', 'nosniff')
      return reply.type(type).send(data)
    } catch {
      return fail(reply, 404, 'NOT_FOUND', 'File was not found.')
    }
  })
}
