import type { FastifyInstance } from 'fastify'
import { registerAuthRoutes } from './auth.js'
import { registerCommentRoutes } from './comments.js'
import { registerDocumentReadRoutes } from './document-reads.js'
import { registerDocumentWriteRoutes } from './document-writes.js'
import { registerExportRoutes } from './export.js'
import { registerMarkdownRoutes } from './markdown.js'
import { registerSharingRoutes } from './sharing.js'
import { registerSystemRoutes } from './system.js'
import { registerTrashRoutes } from './trash.js'
import { registerUploadRoutes } from './uploads.js'
import { registerVersionRoutes } from './versions.js'
import { registerWorkspaceRoutes } from './workspace.js'
import type { RouteDeps } from './deps.js'

/**
 * Route table.
 *
 * Order matters only in that Fastify matches literal segments before
 * parameters, so `/documents/trash` and `/documents/search` are registered
 * before `/documents/:id`.
 */
export function registerRoutes(app: FastifyInstance, deps: RouteDeps) {
  registerSystemRoutes(app, deps)
  registerAuthRoutes(app, deps)
  registerWorkspaceRoutes(app, deps)
  registerMarkdownRoutes(app)

  // Literal document paths first, then the parameterised ones.
  registerDocumentReadRoutes(app, deps)
  registerDocumentWriteRoutes(app, deps)
  registerTrashRoutes(app, deps)
  registerExportRoutes(app, deps)
  registerSharingRoutes(app, deps)
  registerCommentRoutes(app, deps)
  registerVersionRoutes(app, deps)

  registerUploadRoutes(app, deps)
}
