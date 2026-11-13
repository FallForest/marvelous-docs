/**
 * Verifies the trash view in a real browser.
 *
 * The interesting things about the bin are layout and wording, not data: the
 * countdown has to sit inside the card without pushing the two action buttons
 * out of it, the icon must not overlap the title, and the "empty the bin"
 * affordance must only exist while there is something to empty. None of that can
 * be asserted from Node, so this mounts the real `HomeDashboard` with the real
 * stylesheet and reads the geometry back over the DevTools protocol.
 *
 *   node scripts/verify/verify-trash.mjs
 */
import { createServer } from 'node:http'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const WEB = resolve(import.meta.dirname, '../../apps/web')
const requireFromWeb = createRequire(join(WEB, 'package.json'))
const { build } = requireFromWeb('esbuild')

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const WORK = await mkdtemp(join(tmpdir(), 'mdocs-trash-'))

/*
 * Fixed fixtures rather than live data: the countdown has to be checkable at
 * each band, so the deadlines are pinned relative to the moment the page loads.
 * `expiresIn` is in days; a negative value is a row the sweep has not reached.
 */
const HARNESS = `
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import HomeDashboard from './src/pages/HomePage'
import ShellDialogs from './src/components/dialogs/ShellDialogs'
import './src/styles/index.css'

const DAY = 86400000
const expires = (days) => new Date(Date.now() + days * DAY).toISOString()
const row = (id, title, expiresIn) => ({
  id, title, kind: 'document', version: 1,
  updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
  deletedAt: new Date().toISOString(), expiresAt: expires(expiresIn),
})

const DOCS = [
  row('a', '搭建代理服务器', 29.4),
  row('b', '未命名文档', 12.2),
  row('c', '季度复盘（草稿）', 2.6),
  row('d', '很久以前删除的文档', 0.04),
  row('e', '已经过期的文档', -0.5),
]

const params = new URLSearchParams(location.search)
const view = params.get('view') || 'list'
const noop = () => {}
const props = {
  documents: view === 'empty' ? [] : DOCS,
  favorites: new Set(),
  query: '',
  trash: true,
  favoritesView: false,
  stats: null,
  trashRetentionDays: 30,
  onOpen: noop,
  onCreate: noop,
  onImport: noop,
  onCreateFolder: noop,
  onRestore: async () => {},
  onPermanentDelete: async () => {},
  onEmptyTrash: noop,
}

/* The confirmation is its own surface; mounting it directly is the only way to
   assert the count reaches the copy without driving the whole shell. */
function DialogHarness() {
  const [open, setOpen] = useState(true)
  return <>
    <ShellDialogs
      renameDoc={null} deleteDoc={null} purgeDoc={null}
      emptyTrashCount={open ? DOCS.length : 0} emptyTrashBusy={false}
      updatePrompt={null} helpOpen={false} linkPrompt={null}
      onRename={noop} onCancelRename={noop}
      onConfirmDelete={noop} onCancelDelete={noop}
      onConfirmPurge={noop} onCancelPurge={noop}
      onConfirmEmptyTrash={() => setOpen(false)} onCancelEmptyTrash={() => setOpen(false)}
      onConfirmUpdate={noop} onCancelUpdate={noop} onCloseHelp={noop}
      onInsertLink={noop} onCancelLink={noop}
    />
  </>
}

createRoot(document.getElementById('root')).render(
  view === 'dialog' ? <DialogHarness /> : <HomeDashboard {...props} />
)
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

const bundleSource = await readFile(join(WORK, 'harness.js'), 'utf8')
const cssSource = await readFile(join(WORK, 'harness.css'), 'utf8').catch(() => '')

const page = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>trash harness</title>
<style>${cssSource}
html,body{margin:0;background:#fff}
#root{height:100vh;display:flex}
</style></head><body><div id="root"></div><script>${bundleSource}</script></body></html>`

const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(page)
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const port = server.address().port

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9336', `--user-data-dir=${join(WORK, 'profile')}`,
  '--window-size=1440,960', 'about:blank',
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
await new Promise((done) => setTimeout(done, 2200))

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails))
  return result.result.value
}

const failures = []
const log = (message) => console.log('  ' + message)

/* ---- 1. the window is stated on the page, not hidden in settings ---- */
const subtitle = await evaluate(`document.querySelector('.home-hero p').textContent`)
log('subtitle: ' + subtitle)
if (!subtitle.includes('30 天')) failures.push('the retention window is not stated in the hero: ' + subtitle)
if (!subtitle.includes('自动永久删除')) failures.push('the hero does not say the bin empties itself')

/* ---- 2. every row shows a countdown, in the right band ---- */
const rows = await evaluate(`Array.from(document.querySelectorAll('.home-card')).map((card) => ({
  title: card.querySelector('b').textContent,
  meta: card.querySelector('small').textContent,
  expired: card.querySelector('small').classList.contains('is-expired'),
}))`)
for (const row of rows) log(row.title + ' → ' + row.meta)

const byTitle = Object.fromEntries(rows.map((row) => [row.title, row]))
const expect = [
  ['搭建代理服务器', '29 天后自动删除', false],
  ['未命名文档', '12 天后自动删除', false],
  ['季度复盘（草稿）', '2 天后自动删除', false],
  ['很久以前删除的文档', '分钟后自动删除', false],
  ['已经过期的文档', '已过期，等待清理', true],
]
for (const [title, fragment, expired] of expect) {
  const row = byTitle[title]
  if (!row) { failures.push('missing row: ' + title); continue }
  if (!row.meta.includes(fragment)) failures.push(title + ' shows "' + row.meta + '", expected "' + fragment + '"')
  if (row.expired !== expired) failures.push(title + ' expired styling is ' + row.expired + ', expected ' + expired)
}
// Every row must still say it is in the bin; the countdown is an addition.
for (const row of rows) if (!row.meta.includes('已移入回收站')) failures.push(row.title + ' lost the "in the bin" line')

/* ---- 3. the card is still one line: text, then both buttons, no overlap ---- */
const boxes = await evaluate(`Array.from(document.querySelectorAll('.home-card')).map((card) => {
  const icon = card.querySelector('.home-card-icon').getBoundingClientRect()
  const main = card.querySelector('.home-card-main').getBoundingClientRect()
  const title = card.querySelector('b').getBoundingClientRect()
  const meta = card.querySelector('small').getBoundingClientRect()
  const actions = card.querySelector('.home-card-actions').getBoundingClientRect()
  const cardBox = card.getBoundingClientRect()
  return {
    title: card.querySelector('b').textContent,
    icon: { left: icon.left, right: icon.right, top: icon.top, bottom: icon.bottom },
    titleBox: { left: title.left, right: title.right, top: title.top, bottom: title.bottom },
    metaBox: { left: meta.left, right: meta.right, top: meta.top, bottom: meta.bottom },
    actions: { left: actions.left, right: actions.right, top: actions.top, bottom: actions.bottom },
    card: { left: cardBox.left, right: cardBox.right, top: cardBox.top, bottom: cardBox.bottom },
    main: { left: main.left, right: main.right },
  }
})`)

for (const box of boxes) {
  const name = box.title
  if (box.icon.right > box.titleBox.left + 1) failures.push(name + ': the icon overlaps the title')
  if (box.metaBox.left < box.titleBox.left - 1) failures.push(name + ': the meta line starts left of the title')
  if (box.main.right > box.actions.left + 1) failures.push(name + ': the text overlaps the buttons')
  if (box.actions.right > box.card.right + 1) failures.push(name + ': the buttons overflow the card')
  // The two action buttons must share a row with the text, not wrap under it.
  if (box.actions.bottom > box.card.bottom || box.actions.top < box.card.top) failures.push(name + ': the action row left the card')
}

/* ---- 4. nothing is clipped: the meta line is fully visible ---- */
const clipped = await evaluate(`Array.from(document.querySelectorAll('.home-card small')).filter((node) => {
  const card = node.closest('.home-card').getBoundingClientRect()
  const rect = node.getBoundingClientRect()
  return rect.right > card.right - 8 || rect.bottom > card.bottom
}).map((node) => node.textContent)`)
if (clipped.length) failures.push('meta lines clipped by the card: ' + clipped.join(' | '))

/* ---- 5. the bulk action exists, and reads as the bin's action ---- */
const emptyBtn = await evaluate(`(() => {
  const buttons = Array.from(document.querySelectorAll('.home-hero .secondary-btn'))
  const node = buttons.find((button) => button.textContent.includes('清空回收站'))
  if (!node) return null
  const rect = node.getBoundingClientRect()
  const hero = node.closest('.home-hero').getBoundingClientRect()
  return { text: node.textContent, right: rect.right, heroRight: hero.right, top: rect.top, heroTop: hero.top, bottom: rect.bottom, heroBottom: hero.bottom }
})()`)
if (!emptyBtn) failures.push('no "empty the bin" button in the hero')
else {
  log('empty button: "' + emptyBtn.text.trim() + '"')
  if (emptyBtn.right > emptyBtn.heroRight + 1) failures.push('the empty button overflows the hero')
  if (emptyBtn.top < emptyBtn.heroTop - 1 || emptyBtn.bottom > emptyBtn.heroBottom + 1) failures.push('the empty button leaves the hero')
}

/* ---- 6. an empty bin hides the bulk action and says so ---- */
await send('Page.navigate', { url: `http://127.0.0.1:${port}/?view=empty` }, sessionId)
await new Promise((done) => setTimeout(done, 900))
const empty = await evaluate(`(() => ({
  cards: document.querySelectorAll('.home-card').length,
  hasButton: Array.from(document.querySelectorAll('.home-hero .secondary-btn')).some((button) => button.textContent.includes('清空回收站')),
  message: document.querySelector('.home-empty')?.textContent || '',
}))()`)
log('empty view: ' + JSON.stringify(empty))
if (empty.cards !== 0) failures.push('the empty view still rendered cards')
if (empty.hasButton) failures.push('the empty action is offered while the bin is empty')
if (!empty.message.includes('回收站为空')) failures.push('the empty bin does not say it is empty')

/* ---- 7. the confirmation names how many rows go ---- */
await send('Page.navigate', { url: `http://127.0.0.1:${port}/?view=dialog` }, sessionId)
await new Promise((done) => setTimeout(done, 900))
const dialog = await evaluate(`(() => {
  const panel = document.querySelector('.confirm-modal')
  if (!panel) return null
  const buttons = Array.from(panel.querySelectorAll('.modal-actions button')).map((button) => button.textContent.trim())
  const rect = panel.getBoundingClientRect()
  return { title: panel.querySelector('h2')?.textContent, description: panel.querySelector('#dialog-description')?.textContent, buttons, width: rect.width, height: rect.height }
})()`)
if (!dialog) failures.push('the empty-trash confirmation did not open')
else {
  log('dialog: ' + dialog.title + ' / ' + dialog.description)
  if (!dialog.description.includes('5 项')) failures.push('the confirmation does not name the count: ' + dialog.description)
  if (!dialog.description.includes('无法恢复')) failures.push('the confirmation does not warn that it is irreversible')
  if (!dialog.buttons.some((label) => label.includes('清空回收站'))) failures.push('the confirm button is not labelled with the action')
}

/* ---- 8. the list again, for the layout checks ---- */
await send('Page.navigate', { url: `http://127.0.0.1:${port}/?view=list` }, sessionId)
await new Promise((done) => setTimeout(done, 900))

/* ---- 9. no page-level horizontal scroll ---- */
const scroll = await evaluate(`(() => {
  const dash = document.querySelector('.home-dashboard')
  return { width: dash.scrollWidth, client: dash.clientWidth, docWidth: document.documentElement.scrollWidth, inner: window.innerWidth }
})()`)
if (scroll.width > scroll.client + 1) failures.push('the trash page scrolls horizontally: ' + scroll.width + ' > ' + scroll.client)
if (scroll.docWidth > scroll.inner + 1) failures.push('the document scrolls horizontally')

/* ---- 10. the countdown survives a narrow viewport ---- */
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: true }, sessionId)
await new Promise((done) => setTimeout(done, 600))
const narrow = await evaluate(`(() => {
  const cards = Array.from(document.querySelectorAll('.home-card'))
  let overflow = 0
  for (const card of cards) {
    const cardBox = card.getBoundingClientRect()
    const actions = card.querySelector('.home-card-actions').getBoundingClientRect()
    const main = card.querySelector('.home-card-main').getBoundingClientRect()
    if (actions.right > cardBox.right + 1) overflow += 1
    if (main.right > actions.left + 1) overflow += 1
  }
  const dash = document.querySelector('.home-dashboard')
  return { overflow, cards: cards.length, scrollWidth: dash.scrollWidth, clientWidth: dash.clientWidth }
})()`)
if (narrow.overflow) failures.push('cards overflow at 430px wide: ' + narrow.overflow + ' problems')
if (narrow.scrollWidth > narrow.clientWidth + 1) failures.push('the trash page scrolls horizontally at 430px')

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
console.log('trash view verified in Chrome')
process.exit(0)
