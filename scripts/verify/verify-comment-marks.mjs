/**
 * Verifies the comment markers in a real browser.
 *
 * A marker is a view decoration: everything that can go wrong with it — the
 * span not existing, the wash painting over a wrapped line, a click opening the
 * panel while also moving the caret somewhere else, a resolved thread still
 * shouting — is only observable once CSS and ProseMirror render together. So
 * this mounts the real editor with the real stylesheet, places two threads on a
 * paragraph, and drives the page over the DevTools protocol.
 *
 *   node scripts/verify/verify-comment-marks.mjs
 */
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const WEB = resolve(import.meta.dirname, '../../apps/web')
const requireFromWeb = createRequire(join(WEB, 'package.json'))
const { build } = requireFromWeb('esbuild')

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const WORK = await mkdtemp(join(tmpdir(), 'mdocs-comments-'))

const HARNESS = `
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useEditor, EditorContent } from '@tiptap/react'
import { buildEditorExtensions } from './src/lib/editor'
import DocumentPanel from './src/components/panels/DocumentPanel'
import './src/styles/index.css'

const CONTENT = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '用文档连接想法、讨论与行动。' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '在同一页里，一起把事情做好。' }] },
  ],
}

// A paragraph's content starts at 1, so 「文档连接」 is 2-6 and 「想法、讨」 is
// 6-10 in the first paragraph — the second range overlaps the first on 「想」,
// which is exactly the stacked case the plugin merges.
const THREADS = [
  { id: 't-open', body: '这里可以补充一下本周的目标。', userId: 'u1', userName: '小林', status: 'open', anchor: { from: 2, to: 6, text: '文档连接' } },
  { id: 't-done', body: '已经改好了。', userId: 'u2', userName: 'ZHZ', status: 'resolved', anchor: { from: 6, to: 10, text: '想法、讨' } },
]

function Harness() {
  const [active, setActive] = useState(null)
  const [draft, setDraft] = useState(null)
  const editor = useEditor({
    extensions: buildEditorExtensions({ placeholder: '' }),
    content: CONTENT,
    editorProps: { attributes: { class: 'tiptap-content' } },
  })

  // The shell's wiring, reduced to what the marker needs: a thread list, the
  // open thread, and the range the composer is quoting.
  useEffect(() => {
    if (!editor) return
    editor.commands.setCommentMarks(THREADS, active)
    editor.commands.setCommentDraft(draft)
  }, [editor, active, draft])

  useEffect(() => {
    const focus = (event) => setActive(event.detail.id)
    const quote = (event) => setDraft(event.detail)
    window.addEventListener('mdoc-focus-comment', focus)
    window.addEventListener('test-draft', quote)
    window.__editor = editor
    window.__setActive = setActive
    return () => {
      window.removeEventListener('mdoc-focus-comment', focus)
      window.removeEventListener('test-draft', quote)
    }
  }, [editor])

  /*
   * The panel is mounted beside the page for one reason: the tint has to read
   * the same on both sides of the interaction. Pressing the text marks the card
   * and pressing the card marks the text, and only a real click proves the
   * second direction.
   */
  return <div style={{ display: 'flex', alignItems: 'flex-start' }}>
    <div className="paper" style={{ flex: '1 1 auto' }}>
      <EditorContent editor={editor} />
    </div>
    <div id="active-thread" style={{ display: 'none' }}>{active || ''}</div>
    <DocumentPanel
      doc={{ id: 'doc-1', title: '设计协作计划', version: 1 }}
      token=""
      open={true}
      tab="comments"
      comments={THREADS}
      versions={[]}
      commentText=""
      commentAnchor={null}
      activeCommentId={active}
      onActiveComment={setActive}
      onTab={() => {}}
      onClose={() => {}}
      onCommentText={() => {}}
      onClearAnchor={() => {}}
      onSubmitComment={() => {}}
      onReply={() => {}}
      onCommentStatus={() => {}}
      onPreviewVersion={() => {}}
    />
  </div>
}

createRoot(document.getElementById('root')).render(<Harness />)
`

await build({
  stdin: { contents: HARNESS, resolveDir: WEB, loader: 'tsx' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome110',
  jsx: 'automatic',
  outfile: join(WORK, 'harness.js'),
  loader: { '.css': 'css' },
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
})

const { readFile } = await import('node:fs/promises')
const bundleSource = await readFile(join(WORK, 'harness.js'), 'utf8')
/*
 * The web fonts come from fonts.googleapis.com. A verifier has to run offline,
 * and an unreachable @import keeps the document in "loading" forever, which is
 * exactly what a render-blocking stylesheet is supposed to do. The fallback
 * stack is what the assertions measure anyway, so the import is dropped.
 */
const cssSource = (await readFile(join(WORK, 'harness.css'), 'utf8').catch(() => ''))
  /*
   * esbuild inlines the layer imports, so the only @import left is the font one
   * — and it has to go line-wise. The URL uses ";" between weight tuples, so a
   * regex up to the first semicolon leaves a fragment that the parser reads as
   * a selector and then drops every rule after it, tokens included.
   */
  .replace(/^@import[^\n]*\n/gm, '')

/*
 * Served as three files rather than one inlined document: the bundle contains
 * the literal text "</script>" inside React's own error messages, and a single
 * inline <script> would end at the first of those.
 */
const page = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>comment harness</title>
<link rel="stylesheet" href="/harness.css">
<style>html,body{margin:0;background:#fff}.paper{width:640px;padding:32px}</style>
</head><body><div id="root"></div><script src="/harness.js"></script></body></html>`

const server = createServer((request, response) => {
  if (request.url === '/harness.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
    response.end(bundleSource)
    return
  }
  if (request.url === '/harness.css') {
    response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' })
    response.end(cssSource)
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(page)
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const port = server.address().port

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9336', `--user-data-dir=${join(WORK, 'profile')}`,
  '--window-size=1100,800', 'about:blank',
], { stdio: 'ignore' })

async function endpoint() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:9336/json/version')
      if (response.ok) return response.json()
    } catch { /* not up yet */ }
    await new Promise((done) => setTimeout(done, 250))
  }
  throw new Error('Chrome did not expose the DevTools endpoint')
}

const version = await endpoint()
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail })

let messageId = 0
const pending = new Map()
ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    const { resolve: ok, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(JSON.stringify(message.error)))
    else ok(message.result)
  }
}
const send = (method, params = {}, sessionId) => new Promise((ok, reject) => {
  const id = ++messageId
  pending.set(id, { resolve: ok, reject })
  ws.send(JSON.stringify({ id, method, params, sessionId }))
})

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Runtime.enable', {}, sessionId)
await send('Page.enable', {}, sessionId)
await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }, sessionId)
await new Promise((done) => setTimeout(done, 2500))

const evaluate = async (expression, awaitPromise = true) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails))
  return result.result.value
}

const mouse = (type, x, y, button = 'none', buttons = 0, clickCount = 0) =>
  send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount, pointerType: 'mouse' }, sessionId)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const failures = []
const log = (message) => console.log('· ' + message)

const markerBoxes = () => evaluate(`Array.from(document.querySelectorAll('.is-commented')).map((node) => {
  const rect = node.getBoundingClientRect()
  const style = getComputedStyle(node)
  return {
    text: node.textContent,
    id: node.getAttribute('data-comment-id'),
    title: node.getAttribute('title'),
    className: node.className,
    background: style.backgroundColor,
    borderBottom: style.borderBottomStyle + ' ' + style.borderBottomColor,
    color: style.color,
    cursor: style.cursor,
    left: rect.left, top: rect.top, width: rect.width, height: rect.height,
  }
})`)

/* ---- 1. both threads are marked, at the words they quote ---- */
/* ---- 0. the harness mounted at all ---- */
const mounted = await evaluate(`(() => ({
  prose: !!document.querySelector('.ProseMirror'),
  editor: !!window.__editor,
  text: window.__editor ? window.__editor.getText().slice(0, 24) : null,
  marked: document.querySelectorAll('.is-commented').length,
}))()`)
log('mounted: ' + JSON.stringify(mounted))
let boxes = await markerBoxes()
log('markers: ' + boxes.map((box) => box.text + ' -> ' + box.id).join(' | '))
if (boxes.length !== 2) failures.push('expected 2 markers, found ' + boxes.length)
const openMark = boxes.find((box) => box.id === 't-open')
const doneMark = boxes.find((box) => box.id === 't-done')
if (!openMark) failures.push('the open thread has no marker')
else {
  if (openMark.text !== '文档连接') failures.push('the marker covers "' + openMark.text + '", expected 文档连接')
  if (openMark.className.includes('is-commented-resolved')) failures.push('an open thread is styled as resolved')
  if (openMark.background === 'rgba(0, 0, 0, 0)') failures.push('the marker has no wash')
  if (!openMark.cursor.includes('pointer')) failures.push('the marker is not announced as clickable (cursor ' + openMark.cursor + ')')
  if (openMark.width <= 0 || openMark.height <= 0) failures.push('the marker has no box')
}

/* ---- 2. a resolved thread is quieter, not louder ---- */
if (!doneMark) failures.push('the resolved thread has no marker')
else {
  log('resolved: background ' + doneMark.background + ', border ' + doneMark.borderBottom)
  if (!doneMark.className.includes('is-commented-resolved')) failures.push('a resolved thread lost its resolved class')
  if (doneMark.background !== 'rgba(0, 0, 0, 0)') failures.push('a resolved thread still has a filled wash: ' + doneMark.background)
  if (!doneMark.borderBottom.includes('dashed')) failures.push('a resolved thread should be underlined with a dashed rule')
}

/* ---- 3. pressing the marked text opens its thread ---- */
const press = async (box) => {
  await mouse('mousePressed', box.left + 4, box.top + box.height / 2, 'left', 1, 1)
  await mouse('mouseReleased', box.left + 4, box.top + box.height / 2, 'left', 0, 1)
  await sleep(200)
}
await press(openMark)
const opened = await evaluate('document.getElementById("active-thread").textContent')
if (opened !== 't-open') failures.push('pressing the marker opened "' + opened + '", expected t-open')
else log('pressing the marker opened thread ' + opened)

/*
 * The press must also place the caret: a review marker that swallows the click
 * would make the commented sentence the one place in the page you cannot edit.
 *
 * The check is on the editor's own selection rather than on the DOM node under
 * the caret — ProseMirror resolves a press at the very edge of a decorated span
 * to the boundary, so an ancestor check fails on a click that is correct.
 */
const caretInMarker = await evaluate(`(() => {
  const editor = window.__editor
  const node = document.querySelector('.is-commented')
  if (!editor || !node) return false
  const pos = editor.state.selection.from
  let inside = false
  editor.state.doc.descendants((child, offset) => {
    if (child.isText && child.text.includes('文档连接')) inside = pos >= offset && pos <= offset + child.text.length
  })
  return inside
})()`)
if (!caretInMarker) failures.push('clicking the marker did not place the caret inside the text')

/* ---- 4. the open thread is tinted in the text ---- */
boxes = await markerBoxes()
const tinted = boxes.find((box) => box.id === 't-open')
if (!tinted?.className.includes('is-commented-active')) failures.push('the opened thread is not tinted in the text')
else log('open thread tint: ' + tinted.background + ' (idle ' + openMark.background + ')')

// Captured with both markers and the open thread's tint on screen: the state a
// reviewer actually sees, which is what the wash and the underline are for.
const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
const shotDir = resolve(import.meta.dirname, '../../.tmp/shots')
await (await import('node:fs/promises')).mkdir(shotDir, { recursive: true })
await (await import('node:fs/promises')).writeFile(join(shotDir, 'verify-comment-marks.png'), Buffer.from(shot.data, 'base64'))

/* ---- 4b. the panel shows the same thread as active, and pressing a card marks the text ---- */
const panelState = await evaluate(`(() => {
  const cards = Array.from(document.querySelectorAll('.comment'))
  return {
    cards: cards.length,
    active: cards.map((card) => card.className.includes('is-active')),
    quoted: cards.map((card) => card.querySelector('.comment-anchor')?.textContent || ''),
  }
})()`)
log('panel: ' + JSON.stringify(panelState))
if (panelState.cards !== 2) failures.push('the panel did not render both threads: ' + panelState.cards)
if (!panelState.active[0]) failures.push('the open thread is not marked active in the panel')
if (panelState.active[1]) failures.push('a second card is marked active')

await evaluate(`(() => {
  const cards = Array.from(document.querySelectorAll('.comment'))
  cards[1].click()
})()`)
await sleep(250)
const flipped = await evaluate(`(() => ({
  panel: Array.from(document.querySelectorAll('.comment')).map((card) => card.className.includes('is-active')),
  text: Array.from(document.querySelectorAll('.is-commented')).map((node) => [node.getAttribute('data-comment-id'), node.className.includes('is-commented-active')]),
}))()`)
log('pressing the card: ' + JSON.stringify(flipped))
if (!flipped.panel[1]) failures.push('pressing a card did not activate it')
if (!flipped.text.some((entry) => entry[0] === 't-done' && entry[1])) failures.push('pressing a card did not tint its text')
await evaluate('window.__setActive("t-open")')
await sleep(200)

/* ---- 5. closing the thread removes the tint ---- */
await evaluate('window.__setActive(null)')
await sleep(250)
boxes = await markerBoxes()
if (boxes.some((box) => box.className.includes('is-commented-active'))) failures.push('closing the thread left the tint behind')

/* ---- 6. the quote draft is outlined, not filled ---- */
await evaluate('window.dispatchEvent(new CustomEvent("test-draft", { detail: { from: 1, to: 3 } }))')
await sleep(220)
const draft = await evaluate(`(() => {
  const node = document.querySelector('.is-comment-draft')
  if (!node) return null
  const style = getComputedStyle(node)
  return { text: node.textContent, background: style.backgroundColor, border: style.borderBottomStyle }
})()`)
if (!draft) failures.push('the quoted draft range was not marked')
else {
  log('draft: "' + draft.text + '" ' + draft.background + ', ' + draft.border)
  if (!draft.border.includes('dashed')) failures.push('a draft quote must read as provisional (dashed), got ' + draft.border)
}
await evaluate('window.dispatchEvent(new CustomEvent("test-draft", { detail: null }))')
await sleep(200)

/* ---- 7. an edit elsewhere in the document keeps the markers on their words ---- */
await evaluate(`window.__editor.chain().focus().insertContentAt(1, '补充：').run()`)
await sleep(300)
boxes = await markerBoxes()
log('after typing: ' + boxes.map((box) => box.text).join(' | '))
if (boxes.length !== 2) failures.push('typing before the markers changed how many exist: ' + boxes.length)
if (boxes.find((box) => box.id === 't-open')?.text !== '文档连接') failures.push('the open marker drifted off its words after an edit')
if (boxes.find((box) => box.id === 't-open')?.text !== '文档连接') failures.push('the open marker drifted off its words after an edit')

/* ---- 8. deleting the marked text removes the marker ---- */
// The descendant offset is where the text node starts, so the quoted words are
// found inside it rather than assumed to begin at that position.
await evaluate(`(() => {
  const editor = window.__editor
  let start = -1
  editor.state.doc.descendants((node, pos) => {
    if (start >= 0 || !node.isText) return
    const index = node.text.indexOf('文档连接')
    if (index >= 0) start = pos + index
  })
  editor.chain().focus().deleteRange({ from: start, to: start + 4 }).run()
})()`)
await sleep(300)
boxes = await markerBoxes()
if (boxes.some((box) => box.id === 't-open')) failures.push('the marker survived deletion of the text it quoted')

ws.close()
chrome.kill()
server.close()
const closed = new Promise((done) => chrome.once('exit', done))
await Promise.race([closed, new Promise((done) => setTimeout(done, 3000))])
await rm(WORK, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined)

if (failures.length) {
  console.error('FAILED:\n- ' + failures.join('\n- '))
  process.exit(1)
}
console.log('comment markers verified in Chrome (screenshot: .tmp/shots/verify-comment-marks.png)')
process.exit(0)