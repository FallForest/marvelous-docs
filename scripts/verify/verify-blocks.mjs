/**
 * Verifies the block drag handle and context menu in a real browser.
 *
 * Everything in `BlockHandle` is geometry and event ordering — which block the
 * pointer resolves to, whether the gutter survives the trip from the text, what
 * a drag actually reorders. None of that can be checked from Node, so this
 * bundles the real components with esbuild, mounts them with the real editor
 * extensions and the real stylesheet, and drives them over the DevTools
 * protocol.
 *
 *   node scripts/verify/verify-blocks.mjs
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
const WORK = await mkdtemp(join(tmpdir(), 'mdocs-blocks-'))

const HARNESS = `
import { createRoot } from 'react-dom/client'
import { useEditor, EditorContent } from '@tiptap/react'
import { buildEditorExtensions } from './src/lib/editor'
import BlockHandle from './src/components/editor/BlockHandle'
import { useBlockAnchor } from './src/hooks/useBlockAnchor'
import './src/styles/index.css'

const CONTENT = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '第一段 alpha' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '第二段 beta' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '第三段 gamma' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '第四段 delta' }] },
  ],
}

function Harness() {
  const editor = useEditor({
    extensions: buildEditorExtensions({ placeholder: '' }),
    content: CONTENT,
    editorProps: { attributes: { class: 'tiptap-content' } },
  })
  const blockAnchor = useBlockAnchor(editor)
  // The shell geometry the gutter depends on: a centred column with margins,
  // which is what gives it a left gutter to sit in.
  return (
    <div className="paper" style={{ margin: '0 auto', padding: '56px 72px 120px', maxWidth: 780 }}>
      <EditorContent editor={editor} />
      {editor && <BlockHandle
        editor={editor}
        anchor={blockAnchor.anchor}
        pin={blockAnchor.pin}
        refresh={blockAnchor.refresh}
        editable={true}
      />}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Harness />)
// Expose the live editor so the driver can read the document back.
window.__editor = null
const poll = setInterval(() => {
  const content = document.querySelector('.ProseMirror')
  if (content && content.editor) { window.__editor = content.editor; clearInterval(poll) }
}, 20)
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
const cssSource = await readFile(join(WORK, 'harness.css'), 'utf8').catch(() => '')

const page = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>block harness</title>
<style>${cssSource}
html,body{margin:0;background:#f7f8fa}
#root{min-height:100vh}
</style></head><body><div id="root"></div><script>${bundleSource}</script></body></html>`

const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(page)
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const port = server.address().port

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9334', `--user-data-dir=${join(WORK, 'profile')}`,
  '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' })

async function endpoint() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:9334/json/version')
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

const paragraphRects = () => evaluate(`Array.from(document.querySelectorAll('.tiptap-content > p')).map((node) => {
  const rect = node.getBoundingClientRect()
  return { text: node.textContent, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
})`)
const order = () => evaluate(`Array.from(document.querySelectorAll('.tiptap-content > p')).map((node) => node.textContent)`)
const gutterBox = () => evaluate(`(() => {
  const node = document.querySelector('.block-gutter')
  if (!node) return null
  const rect = node.getBoundingClientRect()
  return { top: rect.top, left: rect.left, right: rect.right, width: rect.width }
})()`)

log('editor: ' + await evaluate(`window.__editor ? 'ready' : 'missing'`))

/* ---- 1. hovering a block reveals the gutter in the margin ---- */
const rects = await paragraphRects()
if (rects.length < 4) failures.push('editor did not render four paragraphs: ' + rects.length)

const second = rects[1]
await mouse('mouseMoved', second.left + 40, (second.top + second.bottom) / 2)
await sleep(320)

const gutter = await gutterBox()
if (!gutter) failures.push('no gutter appeared over the second paragraph')
else {
  log('gutter at x=' + Math.round(gutter.left) + ' y=' + Math.round(gutter.top))
  if (gutter.right > second.left) failures.push('gutter overlaps the text (right ' + Math.round(gutter.right) + ' > text left ' + Math.round(second.left) + ')')
  if (Math.abs(gutter.top - second.top) > 8) failures.push('gutter is not aligned with the hovered block: ' + Math.round(gutter.top) + ' vs ' + Math.round(second.top))
}

/* ---- 2. the anchor follows the pointer to another block ---- */
const third = rects[2]
await mouse('mouseMoved', third.left + 40, (third.top + third.bottom) / 2)
await sleep(280)
const moved = await gutterBox()
if (!moved) failures.push('gutter disappeared when moving between blocks')
else if (Math.abs(moved.top - third.top) > 8) failures.push('gutter stayed on the previous block: ' + Math.round(moved.top) + ' vs ' + Math.round(third.top))

/* ---- 3. right-click suppresses the browser menu and opens ours ---- */
// The synthetic probe runs first: dispatching `contextmenu` on a paragraph also
// *opens* the menu, so doing it after the real right-click would leave the menu
// anchored to a different block than the one the next step is about.
const defaultPrevented = await evaluate(`(() => {
  const node = document.querySelector('.tiptap-content > p')
  const rect = node.getBoundingClientRect()
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 20, clientY: rect.top + 8, button: 2 })
  node.dispatchEvent(event)
  return event.defaultPrevented
})()`)
if (!defaultPrevented) failures.push('contextmenu was not prevented on the editor body')
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
await sleep(220)

await mouse('mousePressed', third.left + 40, (third.top + third.bottom) / 2, 'right', 2, 1)
await mouse('mouseReleased', third.left + 40, (third.top + third.bottom) / 2, 'right', 0, 1)
await sleep(320)

const menu = await evaluate(`(() => {
  const node = document.querySelector('.block-menu')
  if (!node) return null
  const rect = node.getBoundingClientRect()
  return {
    heading: node.querySelector('.block-menu-head span')?.textContent,
    items: Array.from(node.querySelectorAll('.block-menu-item span')).map((item) => item.textContent),
    left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
    width: window.innerWidth, height: window.innerHeight,
  }
})()`)
if (!menu) failures.push('right-click did not open the block menu')
else {
  log('menu "' + menu.heading + '": ' + menu.items.join(', '))
  for (const needed of ['正文', '标题 1', '上移', '下移', '创建副本', '删除块']) {
    if (!menu.items.includes(needed)) failures.push('block menu is missing "' + needed + '"')
  }
  if (menu.left < 0 || menu.top < 0 || menu.right > menu.width + 1 || menu.bottom > menu.height + 1) {
    failures.push('block menu escapes the viewport')
  }
}

/* ---- 4. a menu command reorders blocks ---- */
const beforeMove = await order()
await evaluate(`(() => {
  const row = Array.from(document.querySelectorAll('.block-menu-item')).find((item) => item.textContent.includes('下移'))
  row?.click()
})()`)
await sleep(320)
const afterMove = await order()
log('下移: ' + beforeMove.join(' | ') + '  →  ' + afterMove.join(' | '))
const expectedMove = ['第一段 alpha', '第二段 beta', '第四段 delta', '第三段 gamma']
if (afterMove.join('|') !== expectedMove.join('|')) {
  failures.push('"下移" produced ' + JSON.stringify(afterMove) + ', expected ' + JSON.stringify(expectedMove))
}
if (await evaluate('Boolean(document.querySelector(".block-menu"))')) failures.push('block menu stayed open after a command')

/* ---- 5. dragging the grip reorders, with a drop indicator ---- */
const fresh = await paragraphRects()
const firstBlock = fresh[0]
const lastBlock = fresh[fresh.length - 1]

await mouse('mouseMoved', firstBlock.left + 40, firstBlock.top + 6)
await sleep(300)
const grip = await evaluate(`(() => {
  const node = document.querySelector('.block-grip')
  if (!node) return null
  const rect = node.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
})()`)

if (!grip) failures.push('no grip over the first block')
else {
  const beforeDrag = await order()
  await mouse('mousePressed', grip.x, grip.y, 'left', 1, 1)
  await sleep(140)
  await mouse('mouseMoved', lastBlock.left + 30, lastBlock.top + 2, 'left', 1)
  await sleep(180)

  const indicator = await evaluate(`(() => {
    const line = document.querySelector('.block-drop-line')
    if (!line) return null
    const rect = line.getBoundingClientRect()
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
  })()`)
  if (!indicator) failures.push('no drop indicator during a block drag')
  else {
    log('drop line at y=' + Math.round(indicator.top) + ', width ' + Math.round(indicator.width))
    if (Math.abs(indicator.top - lastBlock.top) > 10) failures.push('drop indicator is not at the target block edge: ' + Math.round(indicator.top) + ' vs ' + Math.round(lastBlock.top))
    if (indicator.width < 80) failures.push('drop indicator is too narrow: ' + indicator.width)
  }

  await mouse('mouseReleased', lastBlock.left + 30, lastBlock.top + 2, 'left', 0, 1)
  await sleep(280)
  const afterDrag = await order()
  log('drag: ' + beforeDrag.join(' | ') + '  →  ' + afterDrag.join(' | '))
  if (beforeDrag.join('|') === afterDrag.join('|')) failures.push('dragging the grip did not reorder the document')
  if (await evaluate(`document.body.classList.contains('is-dragging-block')`)) failures.push('body kept the drag class after the drop')
  if (await evaluate(`Boolean(document.querySelector('.block-drop-line'))`)) failures.push('drop indicator was left behind after the drop')
}

/* ---- 6. Escape closes the menu ---- */
const again = await paragraphRects()
await mouse('mouseMoved', again[0].left + 40, again[0].top + 6)
await sleep(280)
await mouse('mousePressed', again[0].left + 40, again[0].top + 6, 'right', 2, 1)
await mouse('mouseReleased', again[0].left + 40, again[0].top + 6, 'right', 0, 1)
await sleep(280)
if (await evaluate(`Boolean(document.querySelector('.block-menu'))`)) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
  await sleep(280)
  if (await evaluate(`Boolean(document.querySelector('.block-menu'))`)) failures.push('Escape did not close the block menu')
} else {
  failures.push('right-click on the first block did not open the menu')
}

/* ---- 7. the editor still accepts input afterwards ---- */
const textBefore = await evaluate(`window.__editor.getText()`)
await evaluate(`window.__editor.commands.focus('start')`)
await send('Input.insertText', { text: 'Z' }, sessionId)
await sleep(250)
const textAfter = await evaluate(`window.__editor.getText()`)
if (textBefore === textAfter) failures.push('the editor stopped accepting input after the gestures')
log('document after the gestures: ' + JSON.stringify(textAfter.slice(0, 40)))

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
console.log('block handle verified in Chrome')
process.exit(0)
