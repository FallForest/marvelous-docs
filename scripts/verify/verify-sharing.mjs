/** Sharing controls, clipboard fallback and public-page request races in Chrome. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { servePublicArt } from './public-art.mjs'

const WEB = resolve(import.meta.dirname, '../../apps/web')
const { build } = createRequire(join(WEB, 'package.json'))('esbuild')
const work = await mkdtemp(join(tmpdir(), 'mdocs-sharing-'))
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
let chrome, socket, server, createdBody
let expiredReads = 0
try {
  await build({
    stdin: { resolveDir: WEB, loader: 'tsx', contents: `
      import { useEffect, useState } from 'react'
      import { createRoot } from 'react-dom/client'
      import ShareDialog from './src/components/dialogs/ShareDialog'
      import SharedDocumentPage from './src/pages/SharedDocumentPage'
      import { useSharing } from './src/hooks/useSharing'
      import './src/styles/index.css'
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied') } } })
      document.execCommand = () => false
      function Harness() {
        const [doc, setDoc] = useState({ id: 'doc-a', title: 'Document A', version: 1 })
        const [publicToken, setPublicToken] = useState(null)
        const [notice, setNotice] = useState('')
        const sharing = useSharing({ token: 'fixture', userId: 'owner', notify: setNotice })
        useEffect(() => { void sharing.load(doc) }, [doc])
        useEffect(() => {
          window.__showShare = (id) => { setPublicToken(null); setDoc({ id, title: id, version: 1 }) }
          window.__showPublic = setPublicToken
          window.__sharing = sharing
        })
        if (publicToken) return <SharedDocumentPage token={publicToken}/>
        return <><p id="notice">{notice}</p><ShareDialog title={doc.title} {...sharing} shareLinkCopied={sharing.linkCopied}
          onCreateShareLink={(permission, days) => sharing.createLink(doc, permission, days)}
          onCopyShareLink={sharing.copyLink} onRetry={() => sharing.load(doc)} onRevokeShareLink={(id) => sharing.revokeLink(doc, id)}
          onRestrictedChange={(value) => sharing.setRestriction(doc, value)} onPermissionChange={(member, role) => sharing.setPermission(doc, member, role)} onClose={() => {}}/></>
      }
      createRoot(document.getElementById('root')).render(<Harness/>)
    ` },
    bundle: true, format: 'iife', platform: 'browser', target: 'chrome110', jsx: 'automatic',
    outfile: join(work, 'app.js'), external: ['/art/*'], logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  })
  const js = await readFile(join(work, 'app.js'))
  const css = (await readFile(join(work, 'app.css'), 'utf8')).replace(/^@import[^\n]*\n/gm, '')
  server = createServer(async (request, response) => {
    if (servePublicArt(request, response)) return
    if (request.url === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(js); return }
    if (request.url === '/app.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return }
    if (request.url?.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json')
      if (request.url.includes('doc-a')) await sleep(250)
      if (request.url === '/api/v1/workspace/members') { response.end(JSON.stringify({ members: [{ id: 'owner', name: 'Owner', email: 'owner@example.test', role: 'admin' }] })); return }
      if (request.url.endsWith('/acl')) { response.end(JSON.stringify({ permissions: [], restricted: request.url.includes('doc-b') })); return }
      if (request.url.endsWith('/share-link')) {
        if (request.method === 'POST') {
          let raw = ''
          for await (const part of request) raw += part
          createdBody = JSON.parse(raw)
          response.end(JSON.stringify({ shareLink: { id: 'new-link', token: 'plaintext-minted-token', permission: 'viewer', expiresAt: new Date(Date.now() + createdBody.expiresInDays * 86400000).toISOString() } }))
        } else response.end(JSON.stringify({ shareLinks: [{ id: 'old-link', permission: 'commenter', expiresAt: null }] }))
        return
      }
      if (request.url.startsWith('/api/v1/shared/')) {
        const token = request.url.split('/').pop()
        if (token === 'slow-token') await sleep(600)
        if (token === 'expired-token' && expiredReads++ === 0) { response.statusCode = 404; response.end(JSON.stringify({ error: { message: 'expired' } })); return }
        response.end(JSON.stringify({ document: { id: token, title: token === 'slow-token' ? 'OLD DOCUMENT' : 'CURRENT DOCUMENT', content: { schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'PUBLIC BODY ' + token }] }] } }, updatedAt: new Date().toISOString(), permission: 'commenter' } }))
        return
      }
      response.statusCode = 404; response.end('{}'); return
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>')
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const url = 'http://127.0.0.1:' + server.address().port
  chrome = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + join(work, 'profile'), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' })
  let port
  for (let i = 0; i < 60; i++) { try { port = (await readFile(join(work, 'profile/DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await sleep(250) } }
  assert.ok(port, 'Chrome must expose DevTools')
  const version = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json()
  socket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject })
  let sequence = 0
  const pending = new Map()
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id); clearTimeout(entry.timer)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.done(message.result)
  }
  const send = (method, params = {}, sessionId) => new Promise((done, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')) }, 10000)
    pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Browser exception')
    return result.result.value
  }
  const until = async (expression) => {
    for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await sleep(100) }
    throw new Error('Browser condition not reached: ' + expression)
  }
  await send('Page.enable', {}, sessionId)
  await until('Boolean(window.__sharing && !window.__sharing.busy && document.querySelector("[role=dialog]"))')
  /*
   * Wait for the link list itself, not just the dialog. The dialog and a settled
   * hook are true before the list requests resolve, so a direct assertion here
   * raced the fixture: locally the ACL/share-link responses landed in time and CI
   * read the DOM a beat earlier and found no row. The rows are what the next two
   * assertions are about, so wait for a row.
   */
  await until('Boolean(document.querySelector(".share-link-item"))')
  assert.equal(await evaluate('Boolean(document.querySelector("option[value=commenter]"))'), false)
  assert.ok(await evaluate('document.body.textContent.includes("旧评论链接")'))
  await evaluate('window.__showShare("doc-b")')
  await sleep(400)
  assert.equal(await evaluate('document.querySelector(".share-restriction input").checked'), true)
  await evaluate('(() => { const select = document.querySelector("[aria-label=分享链接有效期]"); select.value="30"; select.dispatchEvent(new Event("change", {bubbles:true})); })()')
  await evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("生成并复制链接")).click()')
  await until('Boolean(document.querySelector("[aria-label=公开链接地址]"))')
  assert.deepEqual(createdBody, { permission: 'viewer', expiresInDays: 30 })
  assert.ok(await evaluate('document.querySelector("[aria-label=公开链接地址]").value.endsWith("/shared/plaintext-minted-token")'))
  assert.ok(await evaluate('document.getElementById("notice").textContent.includes("手动复制")'))
  assert.equal(await evaluate('document.body.textContent.includes("已复制链接")'), false)
  await evaluate('document.querySelector(".share-modal footer button").focus()')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' }, sessionId)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab' }, sessionId)
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), '关闭共享设置', 'Tab must remain inside the dialog')
  const shots = resolve(import.meta.dirname, '../../.tmp/shots')
  await mkdir(shots, { recursive: true })
  const desktop = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  await writeFile(join(shots, 'verify-sharing.png'), Buffer.from(desktop.data, 'base64'))
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 760, deviceScaleFactor: 1, mobile: false }, sessionId)
  await sleep(150)
  assert.ok(await evaluate('(() => { const panel=document.querySelector(".share-modal"); const r=panel.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && panel.scrollWidth<=panel.clientWidth+1; })()'), 'sharing controls must fit a phone viewport')
  const mobile = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  await writeFile(join(shots, 'verify-sharing-phone.png'), Buffer.from(mobile.data, 'base64'))
  await send('Emulation.clearDeviceMetricsOverride', {}, sessionId)
  await evaluate('window.__showShare("doc-a")')
  await sleep(20)
  await evaluate('window.__showShare("doc-b")')
  await sleep(400)
  assert.equal(await evaluate('document.querySelector(".share-restriction input").checked'), true, 'old sharing responses must not replace the new ACL')
  assert.equal(await evaluate('Boolean(document.querySelector("[aria-label=公开链接地址]"))'), false, 'plaintext must not leak across documents')
  await evaluate('window.__showPublic("slow-token")')
  await sleep(30)
  await evaluate('window.__showPublic("fast-token")')
  await sleep(750)
  assert.equal(await evaluate('document.querySelector(".shared-document-title").textContent'), 'CURRENT DOCUMENT')
  assert.equal(await evaluate('document.body.textContent.includes("OLD DOCUMENT")'), false)
  assert.ok(await evaluate('document.title.startsWith("CURRENT DOCUMENT")'))
  assert.equal(await evaluate('document.querySelector(".shared-badge").textContent'), '仅查看')
  await evaluate('window.__showPublic("expired-token")')
  await until('Boolean(document.querySelector("[role=alert]"))')
  assert.equal(await evaluate('document.body.textContent.includes("CURRENT DOCUMENT")'), false, 'a failed token cannot retain the previous document')
  await evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent === "重新加载").click()')
  await until('Boolean(document.querySelector(".shared-document-title"))')
  console.log('share expiry, manual clipboard fallback, legacy capability labels, ACL/public request races and retry verified in Chrome')
} finally {
  socket?.close()
  if (chrome) { const stopped = new Promise((done) => chrome.once('exit', done)); chrome.kill(); await Promise.race([stopped, sleep(3000)]) }
  server?.closeAllConnections()
  if (server) await new Promise((done) => server.close(done))
  assert.equal(dirname(resolve(work)), resolve(tmpdir()))
  assert.ok(basename(work).startsWith('mdocs-sharing-'))
  await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
