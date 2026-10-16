import http from 'node:http'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'

const port = Number(process.env.UPDATE_AGENT_PORT || 8080)
const token = process.env.UPDATE_AGENT_TOKEN || ''
const projectDir = process.env.UPDATE_PROJECT_DIR || '/workspace'
let state = { status: 'idle', startedAt: null, finishedAt: null, output: '', error: null }

async function syncReleaseEnv() {
  const manifestUrl = process.env.UPDATE_MANIFEST_URL
  if (!manifestUrl) return
  const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`release manifest returned ${response.status}`)
  const manifest = await response.json()
  if (!manifest.version) throw new Error('release manifest has no version')
  const envPath = `${projectDir}/.env`
  let content = await readFile(envPath, 'utf8')
  const values = { APP_VERSION: manifest.version, API_IMAGE: manifest.apiImage, WEB_IMAGE: manifest.webImage }
  for (const [key, value] of Object.entries(values)) {
    if (!value) continue
    const line = `${key}=${value}`
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    content = pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`
  }
  await writeFile(envPath, content)
}

function authorized(request) {
  return token && request.headers.authorization === `Bearer ${token}`
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
      const child = spawn('bash', ['scripts/update.sh'], { cwd: projectDir, env: process.env })
      child.stdout.on('data', (chunk) => { state.output = (state.output + chunk.toString()).slice(-12000) })
      child.stderr.on('data', (chunk) => { state.output = (state.output + chunk.toString()).slice(-12000) })
      child.on('error', (error) => { state = { ...state, status: 'failed', finishedAt: new Date().toISOString(), error: error.message } })
      child.on('exit', (code) => { state = { ...state, status: code === 0 ? 'completed' : 'failed', finishedAt: new Date().toISOString(), error: code === 0 ? null : `update exited with code ${code}` } })
    }).catch((error) => { state = { ...state, status: 'failed', finishedAt: new Date().toISOString(), error: error.message } })
    return send(response, 202, state)
  }
  return send(response, 404, { error: 'not found' })
})

server.listen(port, '0.0.0.0')
