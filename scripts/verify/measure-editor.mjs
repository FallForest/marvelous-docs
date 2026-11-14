/**
 * Measures what typing costs in a long document, in a real browser.
 *
 * Every optimisation in the roadmap that involves the editor had one thing in
 * common: the claim could not be checked. "This re-renders on every keystroke",
 * "that walks the whole document" — true statements about the code, with no number
 * attached, so a change could only be argued for and not shown.
 *
 * This drives the real editor, the real extensions and the real stylesheet with a
 * configurable number of blocks, dispatches typed characters through ProseMirror's
 * own input pipeline, and reports two numbers per keystroke:
 *
 *   - **script** — how long the synchronous handler took. This is what a writer
 *     feels as input lag.
 *   - **layout** — how long the browser spent recalculating style and layout
 *     afterwards, read from the Performance timeline rather than guessed at. A
 *     forced `getBoundingClientRect` inside a transaction lands here.
 *
 * Run it before and after a change and compare; it prints one line per
 * configuration so the difference is the point.
 *
 *   node scripts/verify/measure-editor.mjs            # 200 / 1000 / 2000 blocks
 *   node scripts/verify/measure-editor.mjs 3000       # one size
 */
import { createServer } from 'node:http'
import { servePublicArt } from './public-art.mjs'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const WEB = resolve(import.meta.dirname, '../../apps/web')
const requireFromWeb = createRequire(join(WEB, 'package.json'))
const { build } = requireFromWeb('esbuild')

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const WORK = await mkdtemp(join(tmpdir(), 'mdocs-measure-'))

/** A document with `blocks` paragraphs, a fifth of them tracked block types. */
const HARNESS = `
import { createRoot } from 'react-dom/client'
import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react'
import { buildEditorExtensions } from './src/lib/editor'
import BlockHandle from './src/components/editor/BlockHandle'
import CodeBlockView from './src/components/editor/CodeBlockView'
import { useBlockGeometry } from './src/hooks/useBlockGeometry'
import { useBlockAnchor } from './src/hooks/useBlockAnchor'
import './src/styles/index.css'

const params = new URLSearchParams(location.search)
const BLOCKS = Number(params.get('blocks') || 1000)
/*
 * The two hooks are the subject of the measurement, so the harness can leave one
 * out. Comparing "editor with the hook" against "editor without it" is what turns
 * a claim about a cost into a number - measuring only the current tree says what
 * the cost is now, not whether it changed.
 */
const WITH_GEOMETRY = params.get('geometry') !== '0'
const WITH_ANCHOR = params.get('anchor') !== '0'

/*
 * A realistic mix: prose, plus the block types that carry their own toolbar. Those
 * are the ones useBlockGeometry measures, so a document of pure paragraphs would
 * measure the cheap case and report a number nobody ships.
 */
function buildContent(count) {
  const content = []
  for (let index = 0; index < count; index += 1) {
    const kind = index % 5
    if (kind === 1) content.push({ type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'const x = ' + index }] })
    else if (kind === 2) content.push({ type: 'table', content: [
      { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'h' }] }] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'c' }] }] }] },
    ] })
    else if (kind === 3) content.push({ type: 'horizontalRule' })
    else content.push({ type: 'paragraph', content: [{ type: 'text', text: '段落 ' + index + ' lorem ipsum dolor sit amet' }] })
  }
  return { type: 'doc', content }
}

let editorRef = null
function Harness() {
  const editor = useEditor({
    extensions: buildEditorExtensions({ placeholder: '', codeBlockNodeView: ReactNodeViewRenderer(CodeBlockView) }),
    content: buildContent(BLOCKS),
    editorProps: { attributes: { class: 'tiptap-content' } },
  })
  // Both hooks run, because both are subscribed to every transaction: measuring
  // one without the other would report a cost the application does not pay.
  const geometry = useBlockGeometry(WITH_GEOMETRY ? editor : null)
  const anchor = useBlockAnchor(WITH_ANCHOR ? editor : null)
  editorRef = editor
  // Read at sampling time: the hook returns [] until its first measurement pass,
  // so a mount-time snapshot would always report zero.
  window.__geometryCount = () => geometry.length
  window.__blocksInDoc = () => editor.state.doc.childCount
  return (
    <div className="paper" style={{ margin: '0 auto', padding: '56px 72px 120px', maxWidth: 780 }}>
      <EditorContent editor={editor} />
      {editor && <BlockHandle editor={editor} anchor={anchor.anchor} pin={anchor.pin} refresh={anchor.refresh} editable />}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Harness />)
window.__ready = false
const poll = setInterval(() => {
  if (editorRef) { window.__editor = editorRef; window.__ready = true; clearInterval(poll) }
}, 20)
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
  logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"' },
})

const bundleSource = await readFile(join(WORK, 'harness.js'), 'utf8')
// Same offline treatment as the other verifiers: the font @import is a network round
// trip that would leave the page "loading" forever on a machine without internet.
const cssSource = (await (await import('node:fs/promises')).readFile(join(WORK, 'harness.css'), 'utf8')).replace(/^@import[^\n]*\n/gm, '')

const page = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>measure</title>
<link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>`

const server = createServer((request, response) => {
  if (servePublicArt(request, response)) return
  if (request.url?.startsWith('/harness.js')) { response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); response.end(bundleSource); return }
  if (request.url === '/harness.css') { response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' }); response.end(cssSource); return }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(page)
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const port = server.address().port

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9341', `--user-data-dir=${join(WORK, 'profile')}`,
  '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' })

async function endpoint() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:9341/json/version')
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
await send('Performance.enable', {}, sessionId)

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails))
  return result.result.value
}

/** Types `keys` characters through ProseMirror and returns per-keystroke costs. */
async function measureBlocks(blocks, options = {}, keys = 40) {
  const query = new URLSearchParams({ blocks: String(blocks), ...options })
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/?${query}` }, sessionId)
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate('window.__ready === true')) break
    await new Promise((done) => setTimeout(done, 100))
  }
  // Let the first layout settle: the harness is not what is being measured.
  await new Promise((done) => setTimeout(done, 600))

  const samples = await evaluate(`(async () => {
    const editor = window.__editor
    editor.commands.focus('end')
    const script = []
    for (let index = 0; index < ${keys}; index += 1) {
      const started = performance.now()
      // A real transaction through the same path a keystroke uses, so the plugin
      // chain, the decorations and both hooks all run.
      editor.chain().insertContent('a').run()
      // Force the layout the next frame would otherwise batch, so the cost lands
      // in this sample instead of in the next one.
      void document.body.offsetHeight
      script.push(performance.now() - started)
    }
    const tracked = window.__geometryCount()
    const nodes = document.querySelectorAll('.tiptap-content > *').length
    return { script, tracked, nodes }
  })()`)

  // Layout time from the timeline: what the browser spent after the script.
  const metrics = await send('Performance.getMetrics', {}, sessionId)
  const value = (name) => metrics.metrics.find((entry) => entry.name === name)?.value ?? 0
  return {
    blocks,
    nodes: samples.nodes,
    tracked: samples.tracked,
    median: median(samples.script),
    p95: percentile(samples.script, 0.95),
    layoutMs: value('LayoutDuration') * 1000,
    styleMs: value('RecalcStyleDuration') * 1000,
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

const sizes = process.argv.slice(2).map(Number).filter(Boolean)
const configs = sizes.length ? sizes : [200, 1000, 2000]

console.log('blocks   hooks        tracked   script med   p95     style ms   layout ms')
for (const blocks of configs) {
  for (const [label, options] of [['geometry+anchor', {}], ['anchor only', { geometry: '0' }], ['none', { geometry: '0', anchor: '0' }]]) {
    const row = await measureBlocks(blocks, options)
    console.log(
      String(row.blocks).padEnd(8),
      label.padEnd(15),
      String(row.tracked).padEnd(9),
      row.median.toFixed(2).padEnd(12),
      row.p95.toFixed(2).padEnd(7),
      row.styleMs.toFixed(1).padEnd(10),
      row.layoutMs.toFixed(1),
    )
  }
}

ws.close()
chrome.kill()
server.close()
await rm(WORK, { recursive: true, force: true }).catch(() => undefined)
process.exit(0)
