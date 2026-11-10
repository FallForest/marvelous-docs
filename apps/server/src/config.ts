/**
 * Process configuration, resolved once at startup.
 *
 * Every environment variable the API reads is listed here so a deployment can
 * be audited from one file instead of by grepping process.env.
 */

const environment = process.env.NODE_ENV || 'development'
const configuredSecret = process.env.JWT_SECRET?.trim()

if (environment === 'production' && (!configuredSecret || configuredSecret.length < 32)) {
  console.error('JWT_SECRET must be configured with at least 32 characters when NODE_ENV=production.')
  process.exit(1)
}

export const config = {
  environment,
  jwtSecret: configuredSecret || 'development-only-change-this-secret',
  port: Number(process.env.PORT || 3000),
  collabPort: Number(process.env.COLLAB_PORT || 1234),
  host: process.env.HOST || '0.0.0.0',
  uploadDir: process.env.UPLOAD_DIR || '/data/uploads',
  appVersion: process.env.APP_VERSION || '0.1.0',
  updateManifestUrl: process.env.UPDATE_MANIFEST_URL?.trim() || '',
  updateAgentUrl: process.env.UPDATE_AGENT_URL?.trim() || '',
  updateAgentToken: process.env.UPDATE_AGENT_TOKEN?.trim() || '',
  corsOrigins: (process.env.CORS_ORIGIN || '').split(',').map((value) => value.trim()).filter(Boolean),
  bootstrap: {
    email: process.env.BOOTSTRAP_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '',
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '',
    name: process.env.BOOTSTRAP_ADMIN_NAME || process.env.ADMIN_NAME || 'Administrator',
  },
}
