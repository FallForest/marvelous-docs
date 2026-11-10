import { z } from 'zod'

/**
 * Request schemas shared by several route modules.
 *
 * They live here so the shape of a document id, or of stored content, is
 * declared once instead of being re-typed per route file.
 */

export const uuidSchema = z.string().uuid()

export const idParams = z.object({ id: uuidSchema })

export const versionParams = z.object({ id: uuidSchema, versionId: uuidSchema })

/** Stored document body: `{ schemaVersion: 1, doc: <Tiptap JSON> }`. */
export const contentSchema = z.object({
  schemaVersion: z.literal(1),
  doc: z.object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() }).passthrough(),
}).passthrough()
