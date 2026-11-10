import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { fail } from '../http.js'
import { config } from '../config.js'
import type { AuthRequest } from '../types.js'
import type { RouteDeps } from './deps.js'

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const ALLOWED_MIME = new Set(['application/octet-stream', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'])

/**
 * Uploads.
 *
 * Files live on disk with a random 32-hex prefix and a sanitised name; reads
 * are anonymous because the URL itself is the capability, which matches how
 * embedded images are expected to behave.
 */
export function registerUploadRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.put('/api/v1/uploads', deps.authenticate, async (request, reply) => {
    const auth = request as AuthRequest
    const body = request.body as Buffer
    if (!Buffer.isBuffer(body) || body.length === 0) return fail(reply, 400, 'INVALID_INPUT', 'Upload body is required.')
    if (body.length > MAX_UPLOAD_BYTES) return fail(reply, 413, 'FILE_TOO_LARGE', 'Files are limited to 20 MB.')

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
      return reply.type('application/octet-stream').send(data)
    } catch {
      return fail(reply, 404, 'NOT_FOUND', 'File was not found.')
    }
  })
}
