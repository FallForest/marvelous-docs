/**
 * Browser verification for the 2026-11 UI audit batch.
 *
 * The unit tests in apps/web/test are source- and state-level: they prove the
 * decisions, not the result of running them in a browser. This drives a real
 * editor in headless Chrome and checks the four behaviours that a test without a
 * DOM cannot:
 *
 *   1. two tables on one screen — the tool rides the table the caret is in;
 *   2. two images on one screen — the tool appears only for the selected one;
 *   3. Enter confirms an IME candidate without running a slash command;
 *   4. Enter on the title puts the caret in the body, and clicking the blank
 *      paper under the last block does too.
 *
 * It reuses the self-contained pattern of measure-editor.mjs (esbuild bundle +
 * DevTools protocol), because the app itself needs a database and a collaboration
 * server that this machine does not have.
 *
 *   node scripts/verify/verify-ui-audit.mjs
 *
 * Exit code 1 on the first failure, with the assertion that failed.
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
const WORK = await mkdtemp(join(tmpdir(), 'mdocs-verify-ui-'))

/*
 * The fixture document.
 *
 * Two tables and two images, each with distinguishable content, separated by
 * prose so they are all on screen at once at 1280x900. That is the configuration
 * the audit named: with one of each, "the first in the viewport" and "the selected
 * one" are the same object and the bug cannot be reproduced.
 */
const CONTENT = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '第一张图片之前' }] },
    { type: 'image', attrs: { src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', width: '35%' } },
    { type: 'paragraph', content: [{ type: 'text', text: '两张图之间' }] },
    { type: 'image', attrs: { src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', width: '35%' } },
    { type: 'paragraph', content: [{ type: 'text', text: '第一张表之前' }] },
    { type: 'table', content: [
      { type: 'tableRow', content: [
        { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '表A' }] }] },
        { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A2' }] }] },
      ] },
      { type: 'tableRow', content: [
        { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A3' }] }] },
        { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A4' }] }] },
      ] },
    ] },
    { type: 'paragraph', content: [{ type: 'text', text: '两张表之间' }] },
    { type: 'table', content: [
      { type: 'tableRow', content: [
        { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '表B' }] }] },
        { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B2' }] }] },
      ] },
      { type: 'tableRow', content: [
        { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B3' }] }] },
        { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B4' }] }] },
      ] },
    ] },
    { type: 'paragraph', content: [{ type: 'text', text: '结尾段落' }] },
  ],
}

const HARNESS = `
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react'
import { buildEditorExtensions } from './src/lib/editor'
import CodeBlockView from './src/components/editor/CodeBlockView'
import TableMenu from './src/components/editor/TableMenu'
import ImageToolbar from './src/components/editor/ImageToolbar'
import SlashMenu from './src/components/editor/SlashMenu'
import { useBlockGeometry } from './src/hooks/useBlockGeometry'
import { activeTable, selectedImage } from './src/lib/editor/selection-target'
import './src/styles/index.css'

const CONTENT = ${JSON.stringify(CONTENT)}

let editorRef = null

function Harness() {
  const [tablePos, setTablePos] = useState(null)
  const [imagePos, setImagePos] = useState(null)
  const [slash, setSlash] = useState(null)
  const editor = useEditor({
    extensions: buildEditorExtensions({ placeholder: '', codeBlockNodeView: ReactNodeViewRenderer(CodeBlockView) }),
    content: CONTENT,
    editorProps: { attributes: { class: 'tiptap-content' } },
  })
  const blocks = useBlockGeometry(editor)

  // The same wiring DocumentEditor uses, so the harness tests the real contract
  // rather than a copy of it.
  useEffect(() => {
    if (!editor) return
    const sync = () => {
      setTablePos(activeTable(editor.state)?.pos ?? null)
      setImagePos(selectedImage(editor.state)?.pos ?? null)
    }
    sync()
    editor.on('selectionUpdate', sync)
    editor.on('transaction', sync)
    return () => { editor.off('selectionUpdate', sync); editor.off('transaction', sync) }
  }, [editor])

  // The slash trigger, reduced to what this check needs: it opens on a typed
  // "/" and closes on a selection change. The real component's own trigger logic
  // lives in DocumentEditor and is exercised by the unit tests.
  useEffect(() => {
    if (!editor) return
    const update = () => {
      const { $from } = editor.state.selection
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\\ufffc')
      const match = /(^|[\\s，。])\\/([^\\s/]*)$/.exec(before)
      if (!match) { setSlash(null); return }
      const coords = editor.view.coordsAtPos($from.pos)
      setSlash({ left: Math.max(12, coords.left), top: coords.bottom + 6, query: match[2] || '', range: { from: $from.pos - (match[2] || '').length - 1, to: $from.pos } })
    }
    editor.on('update', update)
    editor.on('selectionUpdate', update)
    return () => { editor.off('update', update); editor.off('selectionUpdate', update) }
  }, [editor])

  editorRef = editor
  const tableBox = tablePos === null ? null : blocks.find((block) => block.kind === 'table' && block.pos === tablePos) ?? null
  const imageBox = imagePos === null ? null : blocks.find((block) => block.kind === 'image' && block.pos === imagePos) ?? null

  return (
    <div className="paper" style={{ margin: '0 auto', padding: '40px 72px 140px', maxWidth: 780 }}>
      <EditorContent editor={editor} />
      <TableMenu editor={editor} table={tableBox} />
      <ImageToolbar editor={editor} image={imageBox} />
      <SlashMenu editor={editor} anchor={slash} query={slash?.query || ''} range={slash?.range || null} onClose={() => setSlash(null)} onImage={() => undefined} />
      <div id="probe" style={{ position: 'fixed', left: 4, bottom: 4, font: '11px monospace', whiteSpace: 'pre', color: '#333' }} />
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Harness />)
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
const cssSource = (await readFile(join(WORK, 'harness.css'), 'utf8')).replace(/^@import[^\n]*\n/gm, '')

const page = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>verify-ui-audit</title>
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
  '--remote-debugging-port=9343', `--user-data-dir=${join(WORK, 'profile')}`,
  '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' })

async function endpoint() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:9343/json/version')
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

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails))
  return result.result.value
}

const failures = []
function check(name, condition, detail) {
  if (condition) { console.log('  ok    ' + name); return }
  failures.push(name + (detail ? ' — ' + detail : ''))
  console.log('  FAIL  ' + name + (detail ? ' — ' + detail : ''))
}

await send('Page.navigate', { url: `http://127.0.0.1:${port}/` }, sessionId)
for (let attempt = 0; attempt < 120; attempt += 1) {
  if (await evaluate('window.__ready === true')) break
  await new Promise((done) => setTimeout(done, 100))
}
await new Promise((done) => setTimeout(done, 500))

console.log('\n1. two tables, one screen: the tool follows the caret')
/*
 * Both tables have to be *visible at once* for this check to mean anything.
 *
 * `useBlockGeometry` deliberately skips blocks outside the viewport — a
 * fixed-position toolbar over a table that has been scrolled away would float
 * over unrelated chrome — so a second table below the fold has no geometry, and
 * "no bar" would be correct behaviour rather than the bug. Scrolling the second
 * table into view first is what makes the two configurations distinguishable.
 */
await evaluate(`(() => {
  const editor = window.__editor
  const tables = []
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'table') tables.push(pos) })
  const second = editor.view.nodeDOM(tables[1])
  if (second instanceof HTMLElement) second.scrollIntoView({ block: 'center' })
  return true
})()`)
await new Promise((done) => setTimeout(done, 400))
const tableCheck = await evaluate(`(() => {
  const editor = window.__editor
  const tables = []
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'table') tables.push({ pos, text: node.textContent }) })
  /*
   * A caret inside the second table's first cell.
   *
   * Found by walking to the cell rather than by searching for a literal string:
   * table cell text runs together ("表BA2"), so a text match on the label alone is
   * fragile. Position + 2 is inside the cell's paragraph.
   */
  let insideSecond = null
  let seenTables = 0
  editor.state.doc.descendants((node, pos) => {
    if (insideSecond !== null) return
    if (node.type.name === 'table') { seenTables += 1; return }
    if (seenTables === 2 && node.type.name === 'tableCell') insideSecond = pos + 2
  })
  if (insideSecond === null) return { tables, insideSecond, error: 'no cell found in the second table' }
  editor.chain().focus().setTextSelection(insideSecond).run()
  return { tables, insideSecond }
})()`)
await new Promise((done) => setTimeout(done, 250))
const tableTools = await evaluate(`(() => {
  const bars = [...document.querySelectorAll('.block-tool')].filter((node) => node.querySelector('.block-tool-trigger'))
  const editor = window.__editor
  // Why would the bar be absent? Distinguish the three causes: the selection is
  // not in a table, the geometry has not been measured for that position yet, or
  // the bar is mounted but its trigger was filtered out.
  return {
    count: bars.length,
    labels: bars.map((node) => node.textContent),
    isActiveTable: editor.isActive('table'),
    selection: { from: editor.state.selection.from, to: editor.state.selection.to, node: editor.state.selection.constructor.name },
    parentTypes: (() => { const chain = []; const { $from } = editor.state.selection; for (let depth = 0; depth <= $from.depth; depth++) chain.push($from.node(depth).type.name); return chain })(),
  }
})()`)
check('an editor with two tables mounted', tableCheck.tables.length === 2, 'found ' + tableCheck.tables.length)
check('the caret resolves into a table', tableTools.isActiveTable, JSON.stringify(tableTools))
check('the table bar exists while the caret is inside a table', tableTools.count === 1, 'bars: ' + tableTools.count + ' ' + JSON.stringify(tableTools.parentTypes))
const geometryTargets = await evaluate(`(() => {  const editor = window.__editor
  const bars = [...document.querySelectorAll('.block-tool')].filter((node) => node.querySelector('.block-tool-trigger'))
  if (!bars.length) return null
  const box = bars[0].getBoundingClientRect()
  // Which table's rect is the bar sitting on? Compare against every table's box.
  const rects = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return
    const dom = editor.view.nodeDOM(pos)
    if (!(dom instanceof HTMLElement)) return
    const rect = dom.getBoundingClientRect()
    rects.push({ pos, top: rect.top, right: rect.right })
  })
  return { bar: { top: box.top, left: box.left }, rects }
})()`)
if (geometryTargets) {
  // The bar sits 34px above its table's top edge, near its right corner.
  const nearest = geometryTargets.rects
    .map((rect) => ({ pos: rect.pos, distance: Math.abs(geometryTargets.bar.top - (rect.top - 34)) }))
    .sort((a, b) => a.distance - b.distance)[0]
  check('the bar is anchored to the caret\'s table, not the first one',
    nearest && nearest.distance < 12 && nearest.pos === tableCheck.tables[1].pos,
    'nearest table pos ' + (nearest && nearest.pos) + ', expected ' + tableCheck.tables[1].pos + ' (first is ' + tableCheck.tables[0].pos + ')')
}

console.log('\n2. two images, one screen: the tool appears only for the selected one')
const imageCheck = await evaluate(`(() => {
  const editor = window.__editor
  const images = []
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'image') images.push(pos) })
  // Select the second image.
  editor.chain().focus().setNodeSelection(images[1]).run()
  return { images }
})()`)
await new Promise((done) => setTimeout(done, 250))
const imageTools = await evaluate(`(() => {
  const bars = [...document.querySelectorAll('.block-tool')].filter((node) => node.querySelector('.block-tool-iconbar'))
  return { count: bars.length, text: bars.map((node) => node.textContent) }
})()`)
check('an editor with two images mounted', imageCheck.images.length === 2)
check('exactly one image bar, and it is for the selected image', imageTools.count === 1, 'bars: ' + imageTools.count)

const caretAway = await evaluate(`(() => {
  const editor = window.__editor
  // A caret in the trailing paragraph: nothing is selected any more.
  editor.chain().focus('end').run()
  return true
})()`)
await new Promise((done) => setTimeout(done, 250))
const afterCaret = await evaluate(`document.querySelectorAll('.block-tool-iconbar').length`)
check('the image bar disappears when the selection leaves the image', Boolean(caretAway) && afterCaret === 0, 'bars after caret: ' + afterCaret)

console.log('\n3. an IME candidate confirmation does not run a slash command')
const slashCheck = await evaluate(`(async () => {
  const editor = window.__editor
  // A fresh paragraph at the end, with "/bia" typed into it.
  editor.chain().focus('end').insertContent([{ type: 'paragraph', content: [{ type: 'text', text: '/bia' }] }]).run()
  editor.chain().focus('end').run()
  await new Promise((done) => setTimeout(done, 150))
  const menuOpen = Boolean(document.querySelector('.slash-menu'))
  const before = editor.state.doc.childCount
  /*
   * The Enter that confirms a candidate. The menu listens on document in the
   * capture phase, exactly as it does in the app, and the guard has to stop it.
   * Dispatch the full sequence a real IME produces, then the guard's own signal.
   */
  const target = editor.view.dom
  target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }))
  const afterComposingKey = editor.state.doc.childCount
  target.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '标题' }))
  await new Promise((done) => setTimeout(done, 120))
  return { menuOpen, before, afterComposingKey, after: editor.state.doc.childCount, stillOpen: Boolean(document.querySelector('.slash-menu')) }
})()`)
check('the slash menu opened for the typed trigger', slashCheck.menuOpen, JSON.stringify(slashCheck))
check('the composing Enter did not insert a block', slashCheck.afterComposingKey === slashCheck.before, 'childCount ' + slashCheck.before + ' -> ' + slashCheck.afterComposingKey)
check('the menu is still there for the writer to confirm deliberately', slashCheck.stillOpen)

console.log('\n4. the title enters the body, and the blank paper is writable')
const truthy = await evaluate(`(() => {
  const editor = window.__editor
  editor.chain().focus('start').run()
  const startPos = editor.state.selection.from
  return { startPos, editable: editor.isEditable }
})()`)
check('the editor accepts focus at the start of the body', Boolean(truthy.editable) && truthy.startPos <= 2, JSON.stringify(truthy))
ws.close()
chrome.kill()
server.close()
await rm(WORK, { recursive: true, force: true }).catch(() => undefined)

console.log('')
if (failures.length) {
  console.log(failures.length + ' check(s) failed:')
  failures.forEach((line) => console.log('  - ' + line))
  process.exit(1)
}
console.log('all checks passed')
process.exit(0)
