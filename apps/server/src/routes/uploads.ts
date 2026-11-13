import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { fail } from '../core/http.js'
import { config } from '../core/config.js'
import type { AuthRequest } from '../core/types.js'
import type { RouteDeps } from './deps.js'

/*
 * One uploaded file may be 1 GiB.
 *
 * This was 20 MiB, which is fine for a screenshot pasted into a note and useless
 * for the other thing people do here: attach a long PDF. A 300-page scan is
 * routinely 200–600 MiB, so the old ceiling rejected exactly the files worth
 * uploading.
 *
 * The body is buffered (parseAs: 'buffer' below), so one upload costs its size in
 * RSS while it is in flight. Fastify's bodyLimit is set just above this number;
 * the two must move together or the request is rejected before this check runs.
 */
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
const ALLOWED_MIME = new Set(['application/octet-stream', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'])

/**
 * Type served for a stored file, chosen by extension.
 *
 * Deliberately excludes anything HTML-ish: a stored file is content, never a
 * document, so it must not be able to run script in the app's origin.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
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
  // An upload may be 1 GiB, so the per-caller budget stays low on purpose:
  // thirty of these in ten minutes would be thirty gigabytes of body.
  app.put('/api/v1/uploads', { preHandler: [deps.authenticate.preHandler, deps.rateLimit(30, 10 * 60 * 1000)] }, async (request, reply) => {
    const auth = request as AuthRequest
    const body = request.body as Buffer
    if (!Buffer.isBuffer(body) || body.length === 0) return fail(reply, 400, 'INVALID_INPUT', 'Upload body is required.')
    if (body.length > MAX_UPLOAD_BYTES) return fail(reply, 413, 'FILE_TOO_LARGE', 'Files are limited to 1 GB.')

    const mime = String(request.headers['content-type'] || 'application/octet-stream').split(';')[0]!.toLowerCase()
    if (!ALLOWED_MIME.has(mime)) return fail(reply, 415, 'UNSUPPORTED_MEDIA_TYPE', 'This file type is not supported.')

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
