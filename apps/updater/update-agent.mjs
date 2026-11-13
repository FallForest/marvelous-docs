import http from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'

const port = Number(process.env.UPDATE_AGENT_PORT || 8080)
const token = process.env.UPDATE_AGENT_TOKEN || ''
const projectDir = process.env.UPDATE_PROJECT_DIR || '/workspace'
let state = { status: 'idle', startedAt: null, finishedAt: null, output: '', error: null }

/**
 * Fetches the release manifest and writes the tags it names to a side file.
 *
 * It deliberately does NOT edit .env or the compose files. Two bugs came from
 * doing that here:
 *
 *   1. the working tree was rewritten on every update, so a checkout drifted
 *      away from its template (image: ${API_IMAGE:-...} became a hard-coded
 *      ghcr.io/...:0.1.66) and the next "git pull" collided with local changes;
 *   2. it ran *before* update.sh took its snapshot, so the rollback restored the
 *      new tags - a rollback that rolls nothing back, exactly what update.sh's
 *      own header warns about.
 *
 * update.sh now reads this file *after* it has backed up, which puts the write
 * on the right side of the snapshot and keeps the repository untouched.
 */
async function writeTarget() {
  const manifestUrl = process.env.UPDATE_MANIFEST_URL
  if (!manifestUrl) return
  const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error('release manifest returned ' + response.status)
  const manifest = await response.json()
  if (!manifest.version) throw new Error('release manifest has no version')

  const lines = ['APP_VERSION=' + manifest.version]
  if (manifest.apiImage) lines.push('API_IMAGE=' + manifest.apiImage)
  if (manifest.webImage) lines.push('WEB_IMAGE=' + manifest.webImage)
  await writeFile(projectDir + '/.update-target.env', lines.join('\n') + '\n')
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
    writeTarget().then(() => {
      // Two layouts exist in the wild: the repository keeps the script under
      // scripts/deploy/, while an older deployment copied it to scripts/. Spawn
      // whichever is present instead of exiting 127 with "No such file".
      const script = ['scripts/deploy/update.sh', 'scripts/update.sh']
        .find((candidate) => existsSync(projectDir + '/' + candidate))
      if (!script) {
        state = { ...state, status: 'failed', finishedAt: new Date().toISOString(), error: 'no update.sh in ' + projectDir }
        return
      }
      const child = spawn('bash', [script], { cwd: projectDir, env: process.env })
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
