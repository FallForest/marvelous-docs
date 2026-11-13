/**
 * Verifies that the shell behaves like an interface and the document like a
 * document, in a real browser.
 *
 * The bug this exists for is invisible in a screenshot: clicking a label that
 * has no focusable target ("导航", "文档", a breadcrumb) left the browser a
 * collapsed caret to draw, blinking between two words of a heading, and
 * dragging across the topbar painted a text highlight over the chrome.
 *
 * Both come from one root: the whole shell was document text. The fix is
 * html,body{user-select:none;caret-color:transparent} plus an opt-in list of
 * content, so this asserts both halves - no caret in the chrome, and a real
 * selection (and a real caret) in the editor and its inputs.
 *
 *   node scripts/verify/verify-selectability.mjs
 */
import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const WEB = resolve(import.meta.dirname, '../../apps/web')
const requireFromWeb = createRequire(join(WEB, 'package.json'))
const { build } = requireFromWeb('esbuild')

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const WORK = await mkdtemp(join(tmpdir(), 'mdocs-select-'))


/*
 * The real components, with fixed props. The chrome is what is under test, so
 * the tree carries a document that looks like a real workspace. The editor is a
 * real Tiptap instance: a textarea would prove nothing about ProseMirror, which
 * is the one place the opt-in has to survive.
 */
const HARNESS = `
import { createRoot } from 'react-dom/client'
import Sidebar from './src/components/layout/Sidebar'
import TopBar from './src/components/layout/TopBar'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import './src/styles/index.css'

const noop = () => {}
const now = new Date().toISOString()
const node = (id, title) => ({
  doc: { id, title, kind: 'document', content: null, parentId: null, version: 1, createdAt: now, updatedAt: now, deletedAt: null },
  children: [],
})

function Doc() {
  // Same wiring as DocumentEditor: the class lands on the editable node through
  // editorProps, not on the EditorContent wrapper, or the opt-in would be
  // tested against the wrong element.
  const editor = useEditor({
    extensions: [StarterKit],
    content: '<p>这是一段正文，用来验证选区。</p><pre><code>const answer = 42</code></pre>',
    editorProps: { attributes: { class: 'tiptap-content' } },
  })
  return <div className="paper"><EditorContent editor={editor} /></div>
}

function Harness() {
  return <div className="app-shell">
    <Sidebar
      user={{ id: 'u1', email: 'admin@example.com', name: 'Admin', role: 'admin' }}
      tree={[node('d1', '产品路线图')]}
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
        userInitial="A" title="产品路线图" showRoot saveStatus="saved" collabStatus="connected"
        collaborators={[]} sidebarOpen hasDocument favorite={false} exportOpen={false}
        onOpenSidebar={noop} onFavorite={noop} onExport={noop} onExportMenu={noop}
        onHistory={noop} onComments={noop} onShare={noop}
      />
      <div className="workspace-content"><div className="editor-column"><Doc /></div></div>
    </div>
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

const bundleSource = await readFile(join(WORK, 'harness.js'), 'utf8')
/*
 * Offline first. The @import for the web fonts is dropped line-wise (its URL
 * contains semicolons, so a regex up to the first one leaves a fragment the
 * parser reads as a selector and then drops every rule after it — including the
 * user-select rules this script exists to check). An unreachable import also
 * keeps the document in "loading" for as long as the browser will wait, which is
 * what made the harness look empty.
 */
const cssSource = (await readFile(join(WORK, 'harness.css'), 'utf8').catch(() => ''))
  .replace(/^@import[^\n]*\n/gm, '')

/*
 * Three files, not one inlined document: the bundle contains the literal text
 * "</script>" inside React's own error strings, and an inline <script> would end
 * at the first of them.
 */
const page = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>selectability</title>
<link rel="stylesheet" href="/harness.css">
<style>html,body{margin:0;background:#fff}</style>
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
  '--remote-debugging-port=9337', '--user-data-dir=' + join(WORK, 'profile'),
  '--window-size=1440,960', 'about:blank',
], { stdio: 'ignore' })

async function endpoint() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:9337/json/version')
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
await send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/' }, sessionId)
await new Promise((done) => setTimeout(done, 2500))

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails))
  return result.result.value
}

const failures = []
const log = (message) => console.log('  ' + message)


/* Reads an element's box; null when it is not rendered (or not present). */
const boxOf = (selector) => evaluate(
  '(() => {' +
  'const element = document.querySelector(' + JSON.stringify(selector) + ');' +
  'if (!element) return null;' +
  'const rect = element.getBoundingClientRect();' +
  'if (!rect.width || !rect.height) return null;' +
  'return { x: Math.round(rect.left + Math.min(18, rect.width / 2)), y: Math.round(rect.top + rect.height / 2), width: Math.round(rect.width) };' +
  '})()'
)

const selectionType = () => evaluate("(() => { const s = window.getSelection(); return s ? s.type : null })()")
const selectionText = () => evaluate("String(window.getSelection() ? window.getSelection().toString() : '')")
const clearSelection = () => evaluate('window.getSelection().removeAllRanges()')

/** A real press: element.click() never produces a caret. */
const press = async (point) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }, sessionId)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId)
  await new Promise((done) => setTimeout(done, 120))
}

/** A real drag: drag-selecting chrome text is the other half of the bug. */
const drag = async (point, distance) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }, sessionId)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 }, sessionId)
  for (let offset = 10; offset <= distance; offset += 10) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + offset, y: point.y, button: 'left' }, sessionId)
    await new Promise((done) => setTimeout(done, 15))
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + distance, y: point.y, button: 'left', clickCount: 1 }, sessionId)
  await new Promise((done) => setTimeout(done, 120))
}

/* ---- 1. chrome: a press must not leave a caret ---- */
const CHROME_TARGETS = ['.nav-label', '.tree-heading', '.breadcrumbs', '.crumb-root', '.brand-row', '.profile-copy', '.save-state', '.help-row']
let checked = 0
for (const selector of CHROME_TARGETS) {
  const point = await boxOf(selector)
  if (!point) { log('skipped (not rendered): ' + selector); continue }
  checked += 1
  await clearSelection()
  await press(point)
  const state = await selectionType()
  log(selector + ' -> ' + state)
  if (state === 'Caret') failures.push(selector + ' leaves a blinking caret in the chrome')
}
if (checked < 6) failures.push('only ' + checked + ' chrome targets were checked; the harness did not mount')

/* ---- 2. chrome: a drag must not paint a text selection ---- */
for (const selector of ['.breadcrumbs', '.tree-heading', '.nav-label']) {
  const point = await boxOf(selector)
  if (!point) continue
  await clearSelection()
  await drag(point, Math.min(point.width - 24, 90))
  const text = await selectionText()
  log('drag ' + selector + ' -> ' + JSON.stringify(text))
  if (text.trim()) failures.push('dragging across ' + selector + ' selects chrome text: ' + JSON.stringify(text))
}


/* ---- 3. the editor is content: selection and caret must still work ---- */
const paragraph = await boxOf('.tiptap-content p')
if (!paragraph) {
  failures.push('the editor did not render; cannot check the content opt-in')
} else {
  await clearSelection()
  await press({ x: paragraph.x, y: paragraph.y })
  const caret = await evaluate("(() => { const s = window.getSelection(); return { type: s ? s.type : null, focused: document.activeElement ? document.activeElement.classList.contains('ProseMirror') : false } })()")
  log('editor press -> ' + JSON.stringify(caret))
  if (caret.type !== 'Caret' && caret.type !== 'Range') failures.push('the editor lost its caret: ' + JSON.stringify(caret))

  await clearSelection()
  await drag({ x: paragraph.x, y: paragraph.y }, 80)
  const selected = await selectionText()
  log('editor drag -> ' + JSON.stringify(selected))
  if (!selected.trim()) failures.push('dragging inside the editor selects nothing')

  // The code block is the case a naive * { user-select:none } breaks silently.
  const code = await evaluate("(() => {" +
    "const block = document.querySelector('.tiptap-content pre code');" +
    "if (!block) return null;" +
    "const range = document.createRange();" +
    "range.selectNodeContents(block);" +
    "const selection = window.getSelection();" +
    "selection.removeAllRanges(); selection.addRange(range);" +
    "return String(selection.toString());" +
  "})()")
  log('code block selection -> ' + JSON.stringify(code))
  if (!code || !String(code).includes('42')) failures.push('a code block inside the editor is not selectable')

  const caretColour = await evaluate("getComputedStyle(document.querySelector('.tiptap-content')).caretColor")
  log('editor caret colour -> ' + caretColour)
  if (/rgba\(0, 0, 0, 0\)/.test(String(caretColour))) failures.push('the editor caret is transparent')
}

/* ---- 4. fields keep a real caret and a real selection ---- */
const field = await evaluate("(() => {" +
  "const input = document.createElement('input');" +
  "input.value = 'selectable text';" +
  "document.querySelector('.sidebar-scroll').appendChild(input);" +
  "const style = getComputedStyle(input);" +
  "return { select: style.userSelect, caret: style.caretColor };" +
"})()")
log('input -> ' + JSON.stringify(field))
if (field.select !== 'text') failures.push('an input is not selectable: ' + field.select)
if (/rgba\(0, 0, 0, 0\)/.test(String(field.caret))) failures.push('an input has a transparent caret')

const summary = await evaluate("(() => {" +
  "const read = (selector) => { const element = document.querySelector(selector); return element ? getComputedStyle(element).userSelect : null };" +
  "return {" +
    "body: getComputedStyle(document.body).userSelect," +
    "navLabel: read('.nav-label')," +
    "breadcrumb: read('.breadcrumbs')," +
    "treeLabel: read('.tree-label')," +
    "editor: read('.tiptap-content')," +
    "title: read('.document-heading input')," +
  "};" +
"})()")
log('computed -> ' + JSON.stringify(summary))
if (summary.body !== 'none') failures.push('the shell is still selectable: body user-select = ' + summary.body)
if (summary.editor !== 'text') failures.push('the editor is not selectable: ' + summary.editor)

ws.close()
chrome.kill()
server.close()

if (failures.length) {
  console.log('')
  console.log(failures.length + ' failure(s):')
  for (const failure of failures) console.log('  - ' + failure)
  process.exit(1)
}
console.log('')
console.log('selectability ok: no caret in the chrome, real selection in the content')