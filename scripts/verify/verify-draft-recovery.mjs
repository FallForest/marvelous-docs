/** Real offline Yjs editing, crash recovery, and copy creation in Chrome. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { servePublicArt } from './public-art.mjs'

const WEB = resolve(import.meta.dirname, '../../apps/web')
const requireWeb = createRequire(join(WEB, 'package.json'))
const { build } = requireWeb('esbuild')
const { setupWSConnection, getYDoc, docs } = requireWeb('y-websocket/bin/utils')
const { yDocToProsemirrorJSON } = requireWeb('y-prosemirror')
const { WebSocketServer } = createRequire(resolve(WEB, '../server/package.json'))('ws')
const work = await mkdtemp(join(tmpdir(), 'mdocs-drafts-'))
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
let chrome, socket, server, createdBody, collaboration
let online = false
let allowPersistence = false
let persistenceReads = 0
try {
  await build({
    stdin: { resolveDir: WEB, loader: 'tsx', contents: `
      import { useState } from 'react'
      import { createRoot } from 'react-dom/client'
      import DocumentEditor from './src/components/editor/DocumentEditor'
      import DraftRecovery from './src/components/dialogs/DraftRecovery'
      import { PromptDialog } from './src/components/ui/Dialog'
      import './src/styles/index.css'
      const doc = { id: 'draft-doc', title: '草稿恢复验证', version: 1, content: { schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph' }] } } }
      const user = { id: 'draft-author', email: 'draft@example.test', name: '测试作者', role: 'admin' }
      const noop = () => {}
      window.__submits = 0
      window.__closed = 0
      function Harness() {
        const [status, setStatus] = useState('saved')
        const [recovered, setRecovered] = useState(null)
        if (location.search === '?prompt=1') return <><button id="outside">外部按钮</button><PromptDialog title="异步输入验证" label="名称" initialValue="测试" onClose={() => window.__closed++} onSubmit={() => { window.__submits++; return new Promise((resolve, reject) => { window.__finish = (fail) => fail ? reject(new Error('测试请求失败')) : resolve() }) }}/></>
        if (location.search === '?recover=1') return <><DraftRecovery doc={doc} token="fixture" userId={user.id} onRecovered={setRecovered} notify={noop}/><p id="recovered">{recovered?.title}</p></>
        return <><p id="save-status">{status}</p><DocumentEditor doc={doc} token="fixture" user={user} persist={noop} saveStatus={status} onSaveStatus={setStatus} onAwareness={noop} onCollabStatus={noop} onSelection={noop} onExport={noop} onLink={noop} comments={[]} activeCommentId={null} commentDraft={null}/></>
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
    if (request.url === '/api/v1/documents' && request.method === 'POST') {
      let raw = ''
      for await (const part of request) raw += part
      createdBody = JSON.parse(raw)
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ document: { ...createdBody, id: 'recovered-doc', version: 1 } }))
      return
    }
    if (request.url?.startsWith('/api/')) {
      persistenceReads++
      response.setHeader('Content-Type', 'application/json')
      const body = allowPersistence ? yDocToProsemirrorJSON(getYDoc('draft-doc'), 'default') : { type: 'doc', content: [{ type: 'paragraph' }] }
      response.end(JSON.stringify({ document: { version: 999, content: { schemaVersion: 1, doc: body } } }))
      return
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>')
  })
  collaboration = new WebSocketServer({ noServer: true })
  // Start offline, then accept real y-websocket sync without acknowledging a save.
  server.on('upgrade', (request, peer, head) => {
    if (!online) { peer.destroy(); return }
    collaboration.handleUpgrade(request, peer, head, (connection) => setupWSConnection(connection, request, { docName: 'draft-doc' }))
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const url = 'http://127.0.0.1:' + server.address().port
  chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + join(work, 'profile'), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' })
  let port
  for (let i = 0; i < 60; i++) {
    try { port = (await readFile(join(work, 'profile/DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await sleep(250) }
  }
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
    pending.delete(message.id)
    clearTimeout(entry.timer)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.done(message.result)
  }
  const send = (method, params = {}, sessionId) => new Promise((done, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')) }, 10000)
    pending.set(id, { done, reject, timer })
    socket.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Browser exception')
    return result.result.value
  }
  await send('Page.enable', {}, sessionId)
  for (let i = 0; i < 60 && !await evaluate('Boolean(document.querySelector(".tiptap-content"))'); i++) await sleep(100)
  await sleep(500)
  await evaluate('document.querySelector(".tiptap-content").focus()')
  await send('Input.insertText', { text: '断网时写下的内容' }, sessionId)
  await sleep(1500)
  const before = await evaluate('({status: document.getElementById("save-status").textContent, draft: JSON.parse(localStorage.getItem("mdocs-draft-draft-doc"))})')
  assert.equal(before.status, 'saving', 'offline edits must never claim saved')
  assert.ok(JSON.stringify(before.draft.body).includes('断网时写下的内容'), 'offline edit must be stored before a request fails')
  await evaluate('window.dispatchEvent(new Event("mdoc-force-save"))')
  await sleep(250)
  assert.equal(await evaluate('document.getElementById("save-status").textContent'), 'saving', 'force-save cannot confirm somebody else\'s version while offline')
  await send('Page.navigate', { url: url + '/?recover=1' }, sessionId)
  for (let i = 0; i < 60 && !await evaluate('Boolean(document.querySelector("[role=dialog]"))'); i++) await sleep(100)
  assert.ok(await evaluate('document.body.textContent.includes("发现未保存的本地草稿")'), 'reload must offer recovery')
  await evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent === "恢复为新文档").click()')
  for (let i = 0; i < 60 && !createdBody; i++) await sleep(100)
  assert.ok(createdBody)
  assert.ok(JSON.stringify(createdBody.content.doc).includes('断网时写下的内容'))
  assert.equal(createdBody.kind, 'document')
  await sleep(200)
  assert.equal(await evaluate('localStorage.getItem("mdocs-draft-draft-doc")'), null, 'only successful recovery clears the old copy')
  online = true
  await send('Page.navigate', { url: url + '/?online=1' }, sessionId)
  for (let i = 0; i < 60 && !await evaluate('Boolean(document.querySelector(".tiptap-content"))'); i++) await sleep(100)
  await sleep(500)
  await evaluate('document.querySelector(".tiptap-content").focus()')
  await send('Input.insertText', { text: '只有我的内容落盘才算保存' }, sessionId)
  const reads = persistenceReads
  for (let i = 0; i < 60 && persistenceReads === reads; i++) await sleep(100)
  assert.ok(persistenceReads > reads, 'connected editing must request persistence confirmation')
  assert.equal(await evaluate('document.getElementById("save-status").textContent'), 'saving', 'another writer\'s newer version cannot acknowledge our body')
  assert.ok(await evaluate('localStorage.getItem("mdocs-draft-draft-doc")'), 'unconfirmed local content stays recoverable')
  allowPersistence = true
  for (let i = 0; i < 60 && await evaluate('document.getElementById("save-status").textContent') !== 'saved'; i++) await sleep(100)
  assert.equal(await evaluate('document.getElementById("save-status").textContent'), 'saved')
  assert.equal(await evaluate('localStorage.getItem("mdocs-draft-draft-doc")'), null, 'exact persisted content clears the safety copy')
  await send('Page.navigate', { url: url + '/?prompt=1' }, sessionId)
  for (let i = 0; i < 60 && !await evaluate('Boolean(document.querySelector("[role=dialog] input"))'); i++) await sleep(100)
  await sleep(100)
  await evaluate('document.querySelector(".primary-btn").focus()')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId)
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), '关闭对话框', 'prompt Tab wraps inside its modal')
  await evaluate('document.querySelector("input").dispatchEvent(new KeyboardEvent("keydown", {key:"Enter", bubbles:true})); document.querySelector(".primary-btn").click()')
  assert.equal(await evaluate('window.__submits'), 1, 'Enter plus click cannot submit twice')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
  assert.equal(await evaluate('window.__closed'), 0, 'pending operations cannot be dismissed mid-request')
  await evaluate('window.__finish(true)')
  await sleep(100)
  assert.ok(await evaluate('document.querySelector("[role=alert]").textContent.includes("测试请求失败")'), 'rejection stays visible and allows retry')
  await evaluate('document.querySelector(".primary-btn").click()')
  assert.equal(await evaluate('window.__submits'), 2)
  await evaluate('window.__finish(false)')
  console.log('offline drafts, reload recovery, new-copy creation, modal focus and async submission verified in Chrome')
} finally {
  socket?.close()
  for (const client of collaboration?.clients ?? []) client.terminate()
  collaboration?.close()
  for (const doc of docs.values()) doc.destroy()
  docs.clear()
  if (chrome) {
    const stopped = new Promise((done) => chrome.once('exit', done))
    chrome.kill()
    await Promise.race([stopped, sleep(3000)])
  }
  server?.closeAllConnections()
  if (server) await new Promise((done) => server.close(done))
  // Only this verifier's unique, resolved temporary directory may be removed.
  assert.equal(dirname(resolve(work)), resolve(tmpdir()))
  assert.ok(basename(work).startsWith('mdocs-drafts-'))
  await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
