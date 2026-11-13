import http from 'node:http'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'

const port = Number(process.env.UPDATE_AGENT_PORT || 8080)
const token = process.env.UPDATE_AGENT_TOKEN || ''
const projectDir = process.env.UPDATE_PROJECT_DIR || '/workspace'
let state = { status: 'idle', startedAt: null, finishedAt: null, output: '', error: null }

/**
 * The compose files this deployment uses, in order.
 *
 * COMPOSE_FILE is a space-separated list; production passes three files. Treating
 * it as one path produced
 *   ENOENT: open '/workspace/docker-compose.deploy.yml docker-compose.yml ...'
 * which failed the update before it touched anything.
 */
function composeFiles() {
  return String(process.env.COMPOSE_FILE || 'docker-compose.yml')
    .split(/\s+/)
    .map((file) => file.trim())
    .filter(Boolean)
}

/** Escapes a string for use inside a RegExp. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Applies a release manifest: pins the image tags and the version everywhere they
 * appear, so the next compose build runs the new images.
 */
async function syncReleaseEnv() {
  const manifestUrl = process.env.UPDATE_MANIFEST_URL
  if (!manifestUrl) return
  const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error('release manifest returned ' + response.status)
  const manifest = await response.json()
  if (!manifest.version) throw new Error('release manifest has no version')

  const envPath = projectDir + '/.env'
  let content = await readFile(envPath, 'utf8')
  const values = { APP_VERSION: manifest.version, API_IMAGE: manifest.apiImage, WEB_IMAGE: manifest.webImage }
  for (const [key, value] of Object.entries(values)) {
    if (!value) continue
    const line = key + '=' + value
    const pattern = new RegExp('^' + key + '=.*$', 'm')
    content = pattern.test(content) ? content.replace(pattern, line) : content.trimEnd() + '\n' + line + '\n'
  }
  await writeFile(envPath, content)

  for (const file of composeFiles()) {
    const composePath = projectDir + '/' + file
    let compose
    try { compose = await readFile(composePath, 'utf8') } catch { continue }
    let changed = false
    for (const image of [manifest.apiImage, manifest.webImage]) {
      if (!image) continue
      // Match any tag on the same repository, so a re-run replaces rather than
      // appends.
      const repository = image.replace(/:[^:/]+$/, '')
      const pattern = new RegExp('(^\\s*image:\\s*' + escapeRegExp(repository) + ':)[^\\s]*$', 'm')
      if (pattern.test(compose)) {
        compose = compose.replace(pattern, '$1' + image.split(':').pop())
        changed = true
      }
    }
    const versionPattern = /^(\s*APP_VERSION:\s*).*$/m
    if (versionPattern.test(compose)) {
      compose = compose.replace(versionPattern, '$1' + manifest.version)
      changed = true
    }
    if (changed) await writeFile(composePath, compose)
  }
}

function authorized(request) {
  return token && request.headers.authorization === 'Bearer ' + token
}

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

const server = http.createServer((request, response) => {
  if (!authorized(request)) return send(response, 401, { error: 'unauthorized' })
  if (request.method === 'GET' && request.url === '/status') return send(response, 200, state)
  if (request.method === 'POST' && request.url === '/update') {
    if (state.status === 'running') return send(response, 409, { error: 'update already running', state })
    state = { status: 'running', startedAt: new Date().toISOString(), finishedAt: null, output: '', error: null }
    syncReleaseEnv().then(() => {
      const child = spawn('bash', ['scripts/deploy/update.sh'], { cwd: projectDir, env: process.env })
      child.stdout.on('data', (chunk) => { state.output = (state.output + chunk.toString()).slice(-12000) })
      child.stderr.on('data', (chunk) => { state.output = (state.output + chunk.toString()).slice(-12000) })
      child.on('error', (error) => { state = { ...state, status: 'failed', finishedAt: new Date().toISOString(), error: error.message } })
      child.on('exit', (code) => { state = { ...state, status: code === 0 ? 'completed' : 'failed', finishedAt: new Date().toISOString(), error: code === 0 ? null : 'update exited with code ' + code } })
    }).catch((error) => { state = { ...state, status: 'failed', finishedAt: new Date().toISOString(), error: error.message } })
    return send(response, 202, state)
  }
  return send(response, 404, { error: 'not found' })
})

server.listen(port, '0.0.0.0')
