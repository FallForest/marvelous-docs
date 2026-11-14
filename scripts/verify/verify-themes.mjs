/**
 * Verifies the theme switcher, and — more importantly — that *nothing* escapes
 * the palette.
 *
 * The static checks in test/theme.test.ts fail on a colour literal in a stylesheet;
 * this one proves it at runtime, where CSS says the last word: it mounts the real
 * topbar, sidebar and editor, opens the real picker, picks the theme, then
 * simulates a second palette by overriding the tokens and reads the *computed*
 * colours back. A widget that stayed white under a dark token set has a literal
 * somewhere, and no screenshot of the light theme would ever show it.
 *
 *   node scripts/verify/verify-themes.mjs
 */
import { createServer } from 'node:http'
import { servePublicArt } from './public-art.mjs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const WEB = resolve(import.meta.dirname, '../../apps/web')
const requireFromWeb = createRequire(join(WEB, 'package.json'))
const { build } = requireFromWeb('esbuild')

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const WORK = await mkdtemp(join(tmpdir(), 'mdocs-themes-'))

const HARNESS = `
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Sidebar from './src/components/layout/Sidebar'
import TopBar from './src/components/layout/TopBar'
import DocumentPanel from './src/components/panels/DocumentPanel'
import { useTheme } from './src/hooks/useTheme'
import './src/styles/index.css'

const noop = () => {}
const now = new Date().toISOString()
const row = (id, title) => ({
  doc: { id, title, kind: 'document', content: null, parentId: null, version: 1, createdAt: now, updatedAt: now, deletedAt: null },
  children: [],
})

function Doc() {
  const editor = useEditor({
    extensions: [StarterKit],
    content: '<h1>设计协作计划</h1><p>用文档连接想法、讨论与行动。</p><blockquote>让每一个好想法，都有落笔的地方。</blockquote>',
    editorProps: { attributes: { class: 'tiptap-content' } },
  })
  return <div className="paper"><EditorContent editor={editor} /></div>
}

function Harness() {
  const { themeId, setTheme } = useTheme()
  const [themeOpen, setThemeOpen] = useState(false)
  return <div className="app-shell">
    <Sidebar
      user={{ id: 'u1', email: 'admin@example.com', name: 'Admin', role: 'admin' }}
      tree={[row('d1', '设计协作计划')]}
      favoriteSet={new Set(['d1'])}
      activeId="d1"
      selectedFolderId={null}
      expandedFolders={new Set()}
      homeView="home"
      emptyMessage="还没有文档"
      templates={[]}
      query=""
      narrow={false}
      floating={false}
      workspaceOpen={false}
      newMenuOpen={false}
      treeExpanded
      onClose={noop}
      onWorkspaceMenu={noop}
      onSearch={noop}
      onHome={noop}
      onAdmin={noop}
      onFavorites={noop}
      onTrash={noop}
      checkedIds={null}
      onToggleChecked={noop}
      onEnterSelection={noop}
      onExitSelection={noop}
      onBatchDelete={noop}
      onBatchFavorite={noop}
      batchBusy={false}
      onMoveInto={noop}
      allDocs={[]}
      onToggleTree={noop}
      onNewMenu={noop}
      onCreateDocument={noop}
      onCreateFolder={noop}
      onImport={noop}
      onToggleFolder={noop}
      onSelectFolder={noop}
      onSelectDocument={noop}
      onDocumentAction={noop}
      onHelp={noop}
      onLogout={noop}
    />
    <div className="main-area">
      <TopBar
        userInitial="A" title="设计协作计划" showRoot saveStatus="saved" collabStatus="connected"
        collaborators={[]} sidebarOpen hasDocument favorite exportOpen={false}
        themeId={themeId} themeOpen={themeOpen} onThemeMenu={setThemeOpen} onTheme={setTheme}
        onOpenSidebar={noop} onFavorite={noop} onExport={noop} onExportMenu={noop}
        onHistory={noop} onComments={noop} onShare={noop}
      />
      <div className="workspace-content">
        <div className="editor-column"><Doc /></div>
        <DocumentPanel
          doc={{ id: 'd1', title: '设计协作计划', version: 1 }} token="" open tab="comments"
          comments={[{ id: 'c1', body: '这里可以补充一下本周的目标。', userId: 'u2', userName: '小林', status: 'open', anchor: { from: 1, to: 3, text: '用文' } }]}
          versions={[]} commentText="" commentAnchor={null} activeCommentId={null}
          onActiveComment={noop} onTab={noop} onClose={noop} onCommentText={noop}
          onClearAnchor={noop} onSubmitComment={noop} onReply={noop} onCommentStatus={noop}
          onPreviewVersion={noop}
        />
      </div>
    </div>
  </div>
}

createRoot(document.getElementById('root')).render(<Harness />)
`

await build({
  stdin: { contents: HARNESS, resolveDir: WEB, loader: 'tsx' },
  bundle: true,
  external: ['/art/*'],
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
/*
 * Offline: an unreachable @import keeps the document in "loading" for as long as
 * the browser is willing to wait, and nothing paints. The fallback stack is what
 * these assertions measure anyway, so the font import is dropped — and it has to
 * be dropped line-wise, because the URL itself contains semicolons.
 */
const cssSource = (await readFile(join(WORK, 'harness.css'), 'utf8').catch(() => '')).replace(/^@import[^\n]*\n/gm, '')

const page = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>theme harness</title>
<link rel="stylesheet" href="/harness.css">
</head><body><div id="root"></div><script src="/harness.js"></script></body></html>`

const server = createServer((request, response) => {
  if (servePublicArt(request, response)) return
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
  '--remote-debugging-port=9338', `--user-data-dir=${join(WORK, 'profile')}`,
  '--window-size=1280,860', 'about:blank',
], { stdio: 'ignore' })

async function endpoint() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:9338/json/version')
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
const style = (selector, property) => evaluate(`(() => {
  const node = document.querySelector(${JSON.stringify(selector)})
  return node ? getComputedStyle(node)[${JSON.stringify(property)}] : null
})()`)

/* ---- 0. the shell mounted ---- */
const mounted = await evaluate(`(() => ({
  shell: !!document.querySelector('.app-shell'),
  theme: document.documentElement.getAttribute('data-theme'),
  scheme: getComputedStyle(document.documentElement).colorScheme,
  trigger: !!document.querySelector('.theme-btn'),
}))()`)
log('mounted: ' + JSON.stringify(mounted))
if (!mounted.shell) failures.push('the harness did not render')
if (mounted.theme !== 'handdrawn') failures.push('the root is not on the hand-drawn default theme: ' + mounted.theme)
if (!mounted.trigger) failures.push('the topbar has no theme control')

/* ---- 1. the picker lists every registered theme ---- */
const button = await evaluate(`(() => {
  const node = document.querySelector('.theme-btn')
  if (!node) return null
  const rect = node.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
})()`)
if (!button) failures.push('no theme button to press')
else {
  await mouse('mousePressed', button.x, button.y, 'left', 1, 1)
  await mouse('mouseReleased', button.x, button.y, 'left', 0, 1)
  await sleep(320)
  const menu = await evaluate(`(() => {
    const panel = document.querySelector('.theme-menu')
    if (!panel) return null
    const rows = Array.from(panel.querySelectorAll('.theme-item')).map((row) => ({
      name: row.querySelector('b')?.textContent,
      hint: row.querySelector('small')?.textContent,
      checked: row.getAttribute('aria-checked'),
      dots: row.querySelectorAll('.theme-dot').length,
      active: row.className.includes('is-active'),
    }))
    const rect = panel.getBoundingClientRect()
    return { rows, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, vw: innerWidth, vh: innerHeight }
  })()`)
  if (!menu) failures.push('pressing the theme button did not open the picker')
  else {
    log('picker: ' + menu.rows.map((row) => row.name + '(' + row.checked + ')').join(', '))
    if (menu.rows.length < 1) failures.push('the picker lists no themes')
    for (const row of menu.rows) {
      if (!row.name || !row.hint) failures.push('a theme row is missing its name or hint')
      if (row.dots !== 3) failures.push(row.name + ' has ' + row.dots + ' swatch dots')
    }
    const active = menu.rows.filter((row) => row.checked === 'true')
    if (active.length !== 1) failures.push('the picker does not mark exactly one theme as checked')
    if (!active[0]?.active) failures.push('the checked row is not styled as active')
    if (menu.left < 0 || menu.top < 0 || menu.right > menu.vw + 1 || menu.bottom > menu.vh + 1) {
      failures.push('the picker escapes the viewport')
    }
    const shotMenu = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    const shotDir = resolve(import.meta.dirname, '../../.tmp/shots')
    await mkdir(shotDir, { recursive: true })
    await writeFile(join(shotDir, 'verify-theme-menu.png'), Buffer.from(shotMenu.data, 'base64'))
  }

  /* ---- 2. choosing paper overrides the new default and survives a reload ---- */
  await evaluate(`document.querySelector('.theme-item[aria-checked="false"]')?.click()`)
  await sleep(260)
  const picked = await evaluate(`(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    stored: localStorage.getItem('mdocs-theme'),
    schemed: document.documentElement.style.colorScheme,
    open: !!document.querySelector('.theme-menu'),
  }))()`)
  log('picked: ' + JSON.stringify(picked))
  if (picked.theme !== 'paper') failures.push('picking a theme did not write data-theme')
  if (picked.stored !== 'paper') failures.push('picking a theme did not store the preference')
  if (picked.open) failures.push('the picker stayed open after a choice')

  await send('Page.reload', {}, sessionId)
  await sleep(1200)
  const restoredPreference = await evaluate(`(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    stored: localStorage.getItem('mdocs-theme'),
  }))()`)
  log('restored preference: ' + JSON.stringify(restoredPreference))
  if (restoredPreference.theme !== 'paper' || restoredPreference.stored !== 'paper') {
    failures.push('the hand-drawn default replaced an explicitly chosen paper preference')
  }
}

/* ---- 3. a theme block keyed by data-theme reaches every surface ---- */
const SAMPLE = {
  '.topbar': 'backgroundColor',
  '.sidebar': 'backgroundColor',
  '.workspace-content': 'backgroundColor',
  '.right-panel': 'backgroundColor',
  '.tiptap-content': 'color',
  '.share-btn': 'backgroundColor',
  '.breadcrumbs strong': 'color',
  '.comment-anchor': 'backgroundColor',
  '.comment-compose textarea': 'backgroundColor',
}
const before = {}
for (const [selector, property] of Object.entries(SAMPLE)) before[selector] = await style(selector, property)
log('paper: ' + JSON.stringify(before))
for (const [selector, value] of Object.entries(before)) {
  if (!value) failures.push('nothing matched ' + selector)
  else if (/^rgba\(0, 0, 0, 0\)$/.test(value)) failures.push(selector + ' paints nothing, so it cannot prove the palette reaches it')
}

/*
 * The probe theme is written exactly the way the next real theme will be: a
 * [data-theme='<id>'] block of token overrides, nothing else. It is deliberately
 * *partial* — it never touches --accent-strong, --success or the code palette —
 * because "an omitted token falls back to the shipped value" is a promise
 * themes.css makes, and a theme that had to restate all 120 tokens would be a
 * second stylesheet.
 *
 * The id is not in the registry, so it is applied by writing the attribute the
 * way applyTheme does rather than through the picker: this step is about the
 * cascade, and the picker's own path is covered above.
 */
await evaluate(`(() => {
  const probe = document.createElement('style')
  probe.id = 'probe-theme'
  probe.textContent = \`
    [data-theme='probe']{
      --surface:#101215; --surface-rgb:16,18,21; --surface-soft:#14171b;
      --surface-muted:#0c0e11; --surface-sunken:#080a0c; --surface-hover:#1b1f24;
      --surface-active:#23282e; --surface-selected:#252b32;
      --border:#2a2f36; --border-strong:#3c424b; --border-subtle:#1e2329;
      --text:#f2f4f7; --text-secondary:#d3d8e0; --text-soft:#adb4bf;
      --text-muted:#98a0ac; --text-faint:#7c8491; --text-disabled:#5c636e;
      --accent:#3bd47f; --accent-soft:#12281c; --accent-rgb:59,212,127;
      --shadow-rgb:0,0,0; --sage-rgb:0,0,0; --on-accent-rgb:16,18,21;
      --surface-glass:rgba(16,18,21,.72); --scrim:rgba(0,0,0,.6);
      --quote-bg:#1d2430; --quote-bg-hover:#26303e; --quote-ink:#9ec1e8; --quote-line:#3f5871;
    }
  \`
  document.head.append(probe)
  const root = document.documentElement
  root.setAttribute('data-theme', 'probe')
  root.style.colorScheme = 'dark'
})()`)
await sleep(280)

const probe = {}
for (const [selector, property] of Object.entries(SAMPLE)) probe[selector] = await style(selector, property)
log('probe: ' + JSON.stringify(probe))

for (const selector of Object.keys(SAMPLE)) {
  if (probe[selector] === before[selector]) {
    failures.push(selector + ' did not follow the theme (' + SAMPLE[selector] + ' stayed ' + probe[selector] + ') — a colour literal is hiding there')
  }
}

/* ---- 4. a partial theme falls back instead of painting nothing ---- */
/*
 * --accent-strong is not in the probe block. If the cascade is right the element
 * wearing it computes the shipped value; if a theme had to restate every token,
 * this would resolve to an empty string and the control would lose its colour.
 */
const inherited = await evaluate(`(() => ({
  accentStrong: getComputedStyle(document.documentElement).getPropertyValue('--accent-strong').trim(),
  codeKeyword: getComputedStyle(document.documentElement).getPropertyValue('--code-keyword').trim(),
  scheme: getComputedStyle(document.documentElement).colorScheme,
}))()`)
log('inherited from paper: ' + JSON.stringify(inherited))
if (!inherited.accentStrong) failures.push('an overridden theme lost --accent-strong instead of inheriting it')
if (!inherited.codeKeyword) failures.push('an overridden theme lost the code palette instead of inheriting it')
if (!String(inherited.scheme).includes('dark')) failures.push('color-scheme did not follow the theme: ' + inherited.scheme)

/* ---- 5. the palette changed, the layout did not ---- */
const geometry = await evaluate(`(() => {
  const read = (selector) => {
    const node = document.querySelector(selector)
    if (!node) return null
    const rect = node.getBoundingClientRect()
    return [Math.round(rect.width), Math.round(rect.height)]
  }
  return { topbar: read('.topbar'), sidebar: read('.sidebar'), panel: read('.right-panel') }
})()`)
log('geometry: ' + JSON.stringify(geometry))
for (const [name, size] of Object.entries(geometry)) {
  if (!size) failures.push(name + ' disappeared while switching themes')
}
const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
const shotDir = resolve(import.meta.dirname, '../../.tmp/shots')
await mkdir(shotDir, { recursive: true })
await writeFile(join(shotDir, 'verify-theme-probe.png'), Buffer.from(shot.data, 'base64'))

/* ---- 6. going back restores every value exactly ---- */
await evaluate(`(() => {
  document.getElementById('probe-theme')?.remove()
  const root = document.documentElement
  root.setAttribute('data-theme', 'paper')
  root.style.colorScheme = 'light'
})()`)
await sleep(280)
for (const [selector, property] of Object.entries(SAMPLE)) {
  const restored = await style(selector, property)
  if (restored !== before[selector]) failures.push(selector + ' did not return to the shipped palette: ' + restored + ' vs ' + before[selector])
}

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
console.log('theme switcher verified in Chrome (screenshots: .tmp/shots/verify-theme-*.png)')
process.exit(0)
