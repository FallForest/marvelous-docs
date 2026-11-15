/** Real editor toolbar, find/replace, table menus and keyboard boundaries. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { servePublicArt } from './public-art.mjs'

const WEB = resolve(import.meta.dirname, '../../apps/web')
const requireWeb = createRequire(join(WEB, 'package.json'))
const { build } = requireWeb('esbuild')
const work = await mkdtemp(join(tmpdir(), 'mdocs-tools-'))
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
let chrome, socket, server
try {
  await build({
    stdin: { resolveDir: WEB, loader: 'tsx', contents: `
      import { useEffect, useState } from 'react'
      import { createRoot } from 'react-dom/client'
      import { useEditor, EditorContent } from '@tiptap/react'
      import { CellSelection } from '@tiptap/pm/tables'
      import { TextSelection } from '@tiptap/pm/state'
      import DocumentEditor from './src/components/editor/DocumentEditor'
      import LinkDialog from './src/components/dialogs/LinkDialog'
      import EditorToolbar from './src/components/editor/EditorToolbar'
      import TableMenu from './src/components/editor/TableMenu'
      import { FindReplace } from './src/components/editor/FindReplace'
      import { buildEditorExtensions } from './src/lib/editor'
      import { useBlockGeometry } from './src/hooks/useBlockGeometry'
      import './src/styles/index.css'
      const p = (text) => ({ type: 'paragraph', content: text ? [{type: 'text', text}] : [] })
      const content = { type: 'doc', content: [p('intro'),
        { type: 'paragraph', content: [{type:'text', text:'nee'}, {type:'text', text:'dle', marks:[{type:'bold'}]}] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [p('needle')] }] },
        { type: 'table', content: [{ type: 'tableRow', content: [
          { type: 'tableCell', content: [p('needle')] }, { type: 'tableCell', content: [p('second')] }
        ] }] }, p('end')] }
      function Harness() {
        const [find, setFind] = useState(true)
        const editor = useEditor({ extensions: buildEditorExtensions(), content, editorProps: { attributes: { class: 'tiptap-content' } } })
        const blocks = useBlockGeometry(editor)
        useEffect(() => {
          window.__editor = editor
          window.__closeFind = () => setFind(false)
          window.__openFind = () => setFind(true)
          window.__selectCells = () => {
            const cells = []
            editor.state.doc.descendants((node,pos) => { if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') cells.push(pos) })
            editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[cells.length-1])))
          }
          window.__reset = () => editor.commands.setContent(content)
        }, [editor])
        const noop = () => {}
        return <><EditorToolbar editor={editor} actions={{onLink:noop,onImage:noop,onFind:()=>setFind(true),onOutline:noop,onExport:noop,onComment:noop}}/>
          {find && <FindReplace editor={editor} initial="needle" onClose={()=>setFind(false)}/>}
          <div className="paper" style={{padding:'60px 30px', minHeight:600}}><EditorContent editor={editor}/></div>
          <TableMenu editor={editor} table={blocks.find(block=>block.kind==='table') || null}/></>
      }
      const linkContent = {type:'doc', content:[{type:'paragraph',content:[{type:'text',text:'before '},{type:'text',text:'linked words',marks:[{type:'link',attrs:{href:'https://example.com/old'}}]},{type:'text',text:' after'}]}]}
      const stableNoop = () => {}
      function LinksHarness() {
        const [prompt, setPrompt] = useState(null)
        const noop = stableNoop
        useEffect(() => {
          window.__linkFixture = () => {
            const view = document.querySelector('.tiptap-content').editor.view
            view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, view.state.schema.nodeFromJSON(linkContent).content))
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,11)))
            window.__linkView = view
          }
        }, [])
        return <><DocumentEditor doc={{id:'link-doc',title:'链接验证',version:1,content:{schemaVersion:1,doc:linkContent}}} token="fixture" user={{id:'link-user',name:'作者',email:'test@example.test',role:'admin'}} persist={noop} saveStatus="saved" onSaveStatus={noop} onAwareness={noop} onCollabStatus={noop} onSelection={noop} onExport={noop} onLink={setPrompt} comments={[]} activeCommentId={null} commentDraft={null}/>
          {prompt && <LinkDialog prompt={prompt} onSave={(nextHref)=>{window.dispatchEvent(new CustomEvent('mdoc-insert-link',{detail:{...prompt,nextHref}}));setPrompt(null)}} onClose={()=>{window.dispatchEvent(new CustomEvent('mdoc-cancel-link',{detail:prompt}));setPrompt(null)}}/>}</>
      }
      createRoot(document.getElementById('root')).render(location.search ? <LinksHarness/> : <Harness/>)
    ` },
    bundle: true, format: 'iife', platform: 'browser', target: 'chrome110', jsx: 'automatic',
    outfile: join(work, 'app.js'), external: ['/art/*'], logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  })
  const js = await readFile(join(work, 'app.js'))
  const css = (await readFile(join(work, 'app.css'), 'utf8')).replace(/^@import[^\n]*\n/gm, '')
  server = createServer((request, response) => {
    if (servePublicArt(request, response)) return
    if (request.url === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(js); return }
    if (request.url === '/app.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>')
  })
  server.on('upgrade', (_request, peer) => peer.destroy())
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
  const clickText = async (text) => {
    assert.ok(await evaluate(`(() => { const button = Array.from(document.querySelectorAll('button')).find(node => node.textContent === ${JSON.stringify(text)}); button?.click(); return Boolean(button && !button.disabled) })()`), 'enabled button: ' + text)
    await sleep(120)
  }
  const selectText = async (text) => {
    await evaluate(`(() => { const editor = window.__editor; let found; editor.state.doc.descendants((node,pos) => { if (node.isText && node.text === ${JSON.stringify(text)}) found = pos }); editor.chain().focus().setTextSelection(found).run() })()`)
    await sleep(120)
  }
  await send('Page.enable', {}, sessionId)
  for (let i = 0; i < 60 && !await evaluate('Boolean(window.__editor)'); i++) await sleep(100)
  await sleep(250)
  assert.equal(await evaluate('document.querySelector(".find-count").textContent'), '1/3')
  assert.equal(await evaluate('window.__editor.state.doc.textBetween(window.__editor.state.selection.from, window.__editor.state.selection.to)'), 'needle')
  await evaluate('document.querySelector("input[placeholder=查找内容]").focus()')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId)
  assert.equal(await evaluate('document.activeElement.getAttribute("placeholder")'), '查找内容', 'Enter must keep focus in search')
  await sleep(120)
  assert.equal(await evaluate('document.querySelector(".find-count").textContent'), '2/3')
  await evaluate('document.querySelector("input[placeholder=替换为]").focus()')
  await send('Input.insertText', { text: '<b>X</b>' }, sessionId)
  await clickText('全部替换')
  assert.equal(await evaluate('window.__editor.getText().split("<b>X</b>").length - 1'), 3, 'replacement must remain literal text')
  await evaluate('document.querySelector("button[aria-label=撤销]").click()')
  await sleep(100)
  assert.equal(await evaluate('document.querySelector(".find-count").textContent'), '1/3', 'undo updates visible results')
  await evaluate('window.__editor.commands.insertContentAt(1, "needle ")')
  await sleep(100)
  assert.equal(await evaluate('document.querySelector(".find-count").textContent'), '1/4', 'editing updates visible results')
  await evaluate('window.__closeFind(); window.__reset()')
  await sleep(150)
  await selectText('intro')
  await evaluate('document.querySelector("button[aria-label=增加缩进]").click()')
  assert.equal(await evaluate('window.__editor.state.doc.firstChild.attrs.indent'), 1)
  await evaluate('document.querySelector("button[aria-label=减少缩进]").click()')
  assert.equal(await evaluate('window.__editor.state.doc.firstChild.attrs.indent'), 0)
  await sleep(100)
  assert.equal(await evaluate('document.querySelector("button[aria-label=减少缩进]").disabled'), true)
  await selectText('second')
  // Tab from the final cell adds a row; Shift+Tab goes to the previous cell.
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 }, sessionId)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 }, sessionId)
  assert.equal(await evaluate('window.__editor.state.selection.$from.parent.textContent'), 'needle', 'Shift+Tab navigates cells')
  assert.equal(await evaluate('window.__editor.state.selection.$from.parent.attrs.indent'), 0)
  await clickText('表格')
  assert.equal(await evaluate('Array.from(document.querySelectorAll("[role=menuitem]")).find(node=>node.textContent === "合并单元格").disabled'), true)
  assert.equal(await evaluate('Array.from(document.querySelectorAll("[role=menuitem]")).find(node=>node.textContent === "拆分单元格").disabled'), true)
  await clickText('切换表头列')
  assert.equal(await evaluate('document.querySelectorAll("th").length'), 1)
  await evaluate('window.__selectCells()')
  await sleep(100)
  await clickText('表格')
  await clickText('合并单元格')
  assert.equal(await evaluate('document.querySelectorAll("td,th").length'), 1)
  await clickText('表格')
  await clickText('拆分单元格')
  assert.equal(await evaluate('document.querySelectorAll("td,th").length'), 2)
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId)
  await evaluate('document.querySelector("button[aria-label=更多格式]").click()')
  await sleep(200)
  const mobile = await evaluate(`(() => { const menu = document.querySelector('[aria-label="更多格式"].popover'); const rect = menu.getBoundingClientRect(); return {text:menu.textContent,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:innerWidth,height:innerHeight} })()`)
  assert.ok(mobile.text.includes('任务列表') && mobile.text.includes('增加缩进'))
  assert.ok(mobile.left >= 0 && mobile.right <= mobile.width + 1 && mobile.top >= 0 && mobile.bottom <= mobile.height + 1, 'phone menu fits viewport')
  const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  const shots = resolve(import.meta.dirname, '../../.tmp/shots')
  await mkdir(shots, { recursive: true })
  await writeFile(join(shots, 'verify-editor-tools.png'), Buffer.from(shot.data, 'base64'))
  await send('Emulation.clearDeviceMetricsOverride', {}, sessionId)
  await send('Page.navigate', { url: url + '/?links=1' }, sessionId)
  for (let i = 0; i < 60 && !await evaluate('Boolean(document.querySelector(".tiptap-content")) && Boolean(window.__linkFixture)'); i++) await sleep(100)
  await sleep(500)
  await evaluate('window.__linkFixture()')
  await sleep(120)
  const openLink = async () => {
    await evaluate('document.querySelector(".editor-toolbar [aria-label=链接]").click()')
    await sleep(100)
    assert.equal(await evaluate('document.querySelector("[role=dialog] h2").textContent'), '编辑链接')
    assert.equal(await evaluate('document.activeElement === document.querySelector("[role=dialog] input")'), true, 'link input receives focus')
  }
  await openLink()
  assert.equal(await evaluate('document.querySelector("[role=dialog] input").value'), 'https://example.com/old')
  const outgoing = await evaluate('({href:document.querySelector("[role=dialog] a").href, rel:document.querySelector("[role=dialog] a").rel})')
  assert.equal(outgoing.href, 'https://example.com/old')
  assert.ok(outgoing.rel.includes('noopener') && outgoing.rel.includes('noreferrer'))
  await evaluate('window.__linkView.dispatch(window.__linkView.state.tr.insertText("prefix ", 1))')
  await evaluate('document.querySelector("[role=dialog] input").focus(); document.querySelector("[role=dialog] input").select()')
  await send('Input.insertText', { text: 'https://example.com/new' }, sessionId)
  await clickText('保存链接')
  assert.equal(await evaluate('document.querySelector(".tiptap-content a").textContent'), 'linked words')
  assert.equal(await evaluate('document.querySelector(".tiptap-content a").getAttribute("href")'), 'https://example.com/new')
  assert.ok(await evaluate('document.querySelector(".tiptap-content").textContent.startsWith("prefix before ")'))
  await openLink()
  await clickText('移除链接')
  assert.equal(await evaluate('document.querySelector(".tiptap-content a")'), null)
  assert.ok(await evaluate('document.querySelector(".tiptap-content").textContent.includes("linked words")'))
  // Deletion while the dialog is open must never link neighbouring words.
  await evaluate('window.__linkFixture()')
  await sleep(100)
  await openLink()
  await evaluate('window.__linkView.dispatch(window.__linkView.state.tr.delete(8,20))')
  await clickText('保存链接')
  assert.equal(await evaluate('document.querySelector(".tiptap-content a")'), null)
  assert.equal(await evaluate('document.querySelector(".tiptap-content").textContent'), 'before  after')
  console.log('find/replace, undo, live matches, indentation, table menus/cell navigation, phone overflow, link edit/remove/open and concurrent edit boundaries verified in Chrome')
} finally {
  socket?.close()
  if (chrome) {
    const stopped = new Promise((done) => chrome.once('exit', done))
    chrome.kill()
    await Promise.race([stopped, sleep(3000)])
  }
  server?.closeAllConnections()
  if (server) await new Promise((done) => server.close(done))
  assert.equal(dirname(resolve(work)), resolve(tmpdir()))
  assert.ok(basename(work).startsWith('mdocs-tools-'))
  await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
