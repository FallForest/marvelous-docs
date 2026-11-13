/**
 * Verifies the PDF export in a real browser over the DevTools protocol.
 *
 * There is no test runner here that can drive a page, and the PDF path is the
 * one piece of this batch whose failure mode (a blank page, a cut line, a
 * stylesheet that restyles the app) only shows up once Chrome has laid the
 * document out. So this bundles `lib/export/pdf.ts` with esbuild, loads it into
 * headless Chrome, runs one export, and inspects the resulting PDF.
 *
 *   node scripts/verify/verify-pdf.mjs
 */
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// esbuild is a dependency of apps/web (through Vite), not of the repository
// root, so it is resolved from that package instead of from this script.
const requireFromWeb = createRequire(resolve(import.meta.dirname, '../../apps/web/package.json'))
const { build } = requireFromWeb('esbuild')

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const WORK = await mkdtemp(join(tmpdir(), 'mdocs-pdf-'))

/** A document long enough to need several pages, with the tricky blocks. */
const LONG_TEXT = Array.from({ length: 26 }, (_, index) =>
  `<h2>第 ${index + 1} 节</h2><p>这是第 ${index + 1} 段正文，用来检查分页、中文排版以及长文档的切片是否正确。` +
  `The export must not clip a line at the page boundary, and every page needs a folio.</p>` +
  (index === 3 ? '<table><thead><tr><th>指标</th><th>数值</th></tr></thead><tbody><tr><td>营收</td><td>1,204</td></tr><tr><td>增长</td><td>18%</td></tr></tbody></table>' : '') +
  (index === 7 ? '<pre><code class="language-js">const total = items.reduce((sum, item) =&gt; sum + item.price, 0)\nconsole.log(total)</code></pre>' : '') +
  (index === 11 ? '<blockquote><p>引用块应当保留左侧的强调线。</p></blockquote>' : ''),
).join('')

const EXPORT_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Quarterly plan</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#1f2329;margin:0;padding:2.5rem 1.5rem;}article{max-width:46rem;margin:0 auto;}h1,h2,h3,h4,h5,h6{line-height:1.25;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #dee0e3;padding:.4rem .6rem;text-align:left;}code{background:#f2f3f5;border-radius:4px;padding:.1rem .3rem;font-size:.9em;}pre{background:#f5f6f7;border-radius:6px;padding:1rem;overflow:auto;}pre code{background:none;padding:0;}blockquote{margin:1rem 0;padding-left:1rem;border-left:3px solid #dee0e3;color:#646a73;}ul.task-list{list-style:none;padding-left:1.2rem;}hr{border:none;border-top:1px solid #dee0e3;margin:2rem 0;}</style>
</head><body><article><h1>季度计划 / Quarterly plan</h1>${LONG_TEXT}</article></body></html>`

// Bundle the real modules, so what runs in the browser is what ships.
const bundle = await build({
  stdin: {
    contents: `
      export { htmlToPdf, renderExportCanvas } from './apps/web/src/lib/export/pdf.ts'
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  globalName: '__mdocsPdf',
  platform: 'browser',
  target: 'chrome110',
  outfile: join(WORK, 'pdf-bundle.js'),
  logLevel: 'error',
})
void bundle

const bundleSource = await readFile(join(WORK, 'pdf-bundle.js'), 'utf8')
const page = `<!doctype html><html><head><meta charset="utf-8"><title>harness</title>
<style>html,body{margin:0;font-family:sans-serif;background:#f7f8fa}</style></head>
<body><h1 id="app-title">Application shell</h1><p id="app-body" style="font-size:13px">The app's own styles must survive the export.</p>
<script>${bundleSource}</script></body></html>`

const server = createServer((request, response) => {
  if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(page); return }
  response.writeHead(404); response.end()
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=9333',
  `--user-data-dir=${join(WORK, 'profile')}`,
  '--window-size=1280,900',
  'about:blank',
], { stdio: 'ignore' })

async function endpoint() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:9333/json/version')
      if (response.ok) return response.json()
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Chrome did not expose the DevTools endpoint')
}

const version = await endpoint()
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })

let messageId = 0
const pending = new Map()
ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(JSON.stringify(message.error)))
    else resolve(message.result)
  }
}
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++messageId
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params, sessionId }))
})

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Runtime.enable', {}, sessionId)
await send('Page.enable', {}, sessionId)
await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }, sessionId)
await new Promise((resolve) => setTimeout(resolve, 1200))

const evaluate = async (expression, awaitPromise = true) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails))
  return result.result.value
}

const report = await evaluate(`(async () => {
  const before = {
    titleFont: getComputedStyle(document.getElementById('app-title')).fontSize,
    bodyFont: getComputedStyle(document.getElementById('app-body')).fontSize,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
  }
  const t0 = performance.now()
  const blob = await window.__mdocsPdf.htmlToPdf(${JSON.stringify(EXPORT_HTML)}, { onProgress: () => {} })
  const elapsed = Math.round(performance.now() - t0)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  // A PDF keeps its page tree in a plain-text trailer; counting the /Type /Page
  // entries is enough to tell a blank export from a paginated one.
  const text = new TextDecoder('latin1').decode(bytes)
  const pages = (text.match(/\\/Type\\s*\\/Page[^s]/g) || []).length
  // Inline the artefact so it can be written out and inspected page by page.
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunk))
  }
  const after = {
    titleFont: getComputedStyle(document.getElementById('app-title')).fontSize,
    bodyFont: getComputedStyle(document.getElementById('app-body')).fontSize,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    leftoverNodes: document.querySelectorAll('.mdoc-export-root').length,
    leftoverStyles: Array.from(document.querySelectorAll('style')).filter((node) => node.textContent.includes('mdoc-export-root')).length,
  }
  return {
    size: bytes.length,
    pages,
    elapsed,
    before,
    after,
    header: String.fromCharCode(...bytes.slice(0, 5)),
    trailer: text.includes('%%EOF'),
    base64: btoa(binary),
  }
})()`)

console.log(JSON.stringify({ ...report, base64: '[omitted]' }, null, 2))

// Keep the artefact for inspection, and print where it went.
const { base64, ...rest } = report
const pdfPath = join(process.cwd(), '.tmp-export.pdf')
await writeFile(pdfPath, Buffer.from(base64, 'base64'))
await writeFile(join(WORK, 'report.json'), JSON.stringify(rest, null, 2))
console.log('artefact: ' + pdfPath)

const failures = []
if (!report.header.startsWith('%PDF-')) failures.push('output is not a PDF')
if (!report.trailer) failures.push('PDF is truncated')
if (report.pages < 3) failures.push('expected at least 3 pages for a 26-section document, got ' + report.pages)
if (report.size < 20000) failures.push('PDF is suspiciously small: ' + report.size)
if (report.after.titleFont !== report.before.titleFont) failures.push('export restyled the app heading: ' + report.after.titleFont)
if (report.after.bodyBackground !== report.before.bodyBackground) failures.push('export restyled the app body')
if (report.after.leftoverNodes !== 0) failures.push('export left its render node in the page')
if (report.after.leftoverStyles !== 0) failures.push('export left its stylesheet in the page')

/* ------------------------------------------------------------------ */
/* The raster itself: what actually gets sliced                        */
/* ------------------------------------------------------------------ */

// Rendering the PDF cannot answer "is the text legible and unclipped"; the
// canvas can, and it is the same pixels that go into every page.
const shot = await evaluate(`(async () => {
  const { canvas, title } = await window.__mdocsPdf.renderExportCanvas(${JSON.stringify(EXPORT_HTML)})
  const context = canvas.getContext('2d')
  const width = canvas.width
  const height = canvas.height
  // Ink density per horizontal band tells a clipped or blank page from a
  // populated one: count non-white pixels in each sixteenth of the height.
  const bands = 16
  const counts = []
  for (let band = 0; band < bands; band += 1) {
    const y = Math.floor((height / bands) * band)
    const h = Math.max(1, Math.floor(height / bands))
    const data = context.getImageData(0, y, width, h).data
    let ink = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) ink += 1
    }
    counts.push(ink)
  }
  // The very first and last rows must be margin, not ink: content that starts
  // at y=0 means the top margin was eaten.
  const topRow = context.getImageData(0, 0, width, 4).data
  const bottomRow = context.getImageData(0, height - 4, width, 4).data
  const safe = (data) => Array.from(data).every((value, index) => index % 4 === 3 || value > 240)
  return {
    width, height, title, bands: counts,
    topMarginClean: safe(topRow),
    bottomMarginClean: safe(bottomRow),
    preview: canvas.toDataURL('image/png'),
  }
})()`)

const previewPath = join(process.cwd(), '.tmp-export-canvas.png')
await writeFile(previewPath, Buffer.from(shot.preview.split(',')[1], 'base64'))
console.log('canvas preview: ' + previewPath)

if (shot.bands.some((ink) => ink === 0)) failures.push('a horizontal band of the export is blank')
if (!shot.topMarginClean) failures.push('content starts at the very top edge')
if (shot.title !== 'Quarterly plan') failures.push('title was not carried over: ' + shot.title)

ws.close()
chrome.kill()
server.close()
// Chrome holds its profile lock for a moment after the kill; a leftover temp
// directory is not a failure of the verification.
const closed = new Promise((resolve) => chrome.once('exit', resolve))
await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 3000))])
await rm(WORK, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined)

if (failures.length) {
  console.error('FAILED:\n- ' + failures.join('\n- '))
  process.exit(1)
}
console.log('PDF export verified in Chrome: ' + report.pages + ' pages, ' + report.size + ' bytes, ' + report.elapsed + 'ms')
process.exit(0)
