/** Real DocumentEditor title: soft wrapping, marker fragments and editing.
 * Uses an isolated REST fixture and disables collaboration only in this bundle.
 * Never opens the workspace database or changes production collaboration code. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { servePublicArt } from './public-art.mjs'

const WEB = resolve(import.meta.dirname, '../../apps/web')
const outIndex = process.argv.indexOf('--out-dir')
const outInline = process.argv.find(argument => argument.startsWith('--out-dir='))
const outOverride = outInline?.slice('--out-dir='.length) ?? (outIndex < 0 ? undefined : process.argv[outIndex + 1])
if ((outInline || outIndex >= 0) && (!outOverride || outOverride.startsWith('--'))) throw new Error('--out-dir requires a directory path')
const OUT = outOverride ? resolve(outOverride) : resolve(import.meta.dirname, '../../docs/design/handdrawn-v1/implementation-v11')
const { build } = createRequire(join(WEB, 'package.json'))('esbuild')
const work = await mkdtemp(join(tmpdir(), 'mdocs-title-'))
const sleep = ms => new Promise(done => setTimeout(done, ms))
const evidence = { fixture: 'Real DocumentEditor, in-memory REST; no collaboration transport or workspace database. Composition uses synthetic start/end signals with native browser key events, not an OS IME candidate window.', layouts: [], interactions: [], materials: [], failures: [], browserErrors: [] }
const initial = { id: 'title-doc', kind: 'document', title: '字体加载前后，标题与黄色手绘下划线都应当跟随每一行文字保持相同的换行位置。', titleMode: 'manual', version: 1, createdAt: '2026-11-17T03:00:00Z', updatedAt: '2026-11-17T03:00:00Z', content: { schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文起点：从这里继续写作。' }] }] } } }
let stored = initial, writes = []
let chrome, socket, server, evaluate, screenshot
let releaseFonts
const fontsGate = new Promise(done => { releaseFonts = done })
try {
  await mkdir(OUT, { recursive: true })
  await build({
    stdin: { resolveDir: WEB, loader: 'tsx', contents: `
      import { useEffect, useState } from 'react'
      import { createRoot } from 'react-dom/client'
      import DocumentEditor from './src/components/editor/DocumentEditor'
      import './src/styles/index.css'
      const initial = ${JSON.stringify(initial)}
      const noop = () => {}
      const user = {id:'title-author',name:'作者',email:'title@example.test',role:'admin'}
      function Harness() {
        const [doc,setDoc] = useState(initial), [mount,setMount] = useState(0)
        useEffect(() => {
          window.__fixture = async (title,content) => {
            const response = await fetch('/fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,content})})
            const next = await response.json()
            setDoc(next.document);setMount(value=>value+1)
          }
          const updated = event => setDoc(event.detail)
          const notice = event => {window.__notices = [...(window.__notices||[]),event.detail]}
          window.addEventListener('mdoc-updated',updated);window.addEventListener('mdoc-notice',notice)
          return () => {window.removeEventListener('mdoc-updated',updated);window.removeEventListener('mdoc-notice',notice)}
        },[])
        return <div className="app-shell"><main className="main-area"><div className="workspace-content"><div className="editor-column">
          <DocumentEditor key={mount} doc={doc} token="fixture" user={user} persist={noop} saveStatus="saved" onSaveStatus={noop} onAwareness={noop} onCollabStatus={noop} onSelection={noop} onLink={noop} comments={[]} activeCommentId={null} commentDraft={null}/>
        </div></div></main></div>
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    ` },
    plugins: [{ name: 'fixture-no-collaboration', setup(builder) { builder.onLoad({ filter: /[/\\]lib[/\\]collab\.ts$/ }, () => ({ contents: 'export const COLLAB_URL = ""', loader: 'ts' })) } }],
    bundle: true, format: 'iife', platform: 'browser', target: 'chrome110', jsx: 'automatic',
    outfile: join(work, 'app.js'), external: ['/art/*'], logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  })
  const js = await readFile(join(work, 'app.js'))
  const css = (await readFile(join(work, 'app.css'), 'utf8')).replace(/^@import[^\n]*\n/gm, '')
  server = createServer(async (request, response) => {
    // Hold the actual bundled font until after the first fallback-font layout.
    // This proves the mirror reflows when fonts arrive without another edit.
    if (request.url?.startsWith('/art/') && request.url.includes('/fonts/')) await fontsGate
    if (servePublicArt(request, response)) return
    if (request.url === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(js); return }
    if (request.url === '/app.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return }
    if (request.url === '/fixture' || request.url.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json')
      const chunks = []; for await (const chunk of request) chunks.push(chunk)
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
      if (request.url === '/fixture' && request.method === 'POST') { stored = { ...initial, title: body.title, ...(body.content ? {content:{schemaVersion:1,doc:body.content}} : {}) }; writes = [] }
      else if (request.method === 'PUT') {
        if (body.expectedVersion !== stored.version || !body.title?.trim() || body.title.length > 500) { response.statusCode = 400; response.end(JSON.stringify({ message: 'Invalid fixture title write' })); return }
        writes.push(body); stored = { ...stored, title: body.title.trim(), titleMode: 'manual', version: stored.version + 1 }
      }
      response.end(JSON.stringify({ document: stored, writes })); return
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html lang="zh-CN" data-theme="handdrawn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>')
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  chrome = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + join(work, 'profile'), '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' })
  let port
  for (let i = 0; i < 60; i++) { try { port = (await readFile(join(work, 'profile/DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await sleep(150) } }
  assert.ok(port, 'Chrome exposes DevTools')
  const version = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json()
  socket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject })
  let sequence = 0
  const pending = new Map()
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') evidence.browserErrors.push(message.params.exceptionDetails)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id); clearTimeout(entry.timer)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.done(message.result)
  }
  const send = (method, params = {}, sessionId) => new Promise((done, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timeout')) }, 10000)
    pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'http://127.0.0.1:' + server.address().port })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Browser exception')
    return result.result.value
  }
  const until = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(60) } throw new Error('Condition not reached: ' + expression) }
  const key = async (key, code = key, modifiers = 0) => {
    const vk = { Enter: 13, Escape: 27, Backspace: 8, z: 90, y: 89, v: 86 }[key]
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, windowsVirtualKeyCode: vk }, sessionId)
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: vk }, sessionId)
  }
  const viewport = async (width, height) => { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId); await sleep(100) }
  const reset = async (title,content) => {
    await evaluate('window.__fixture(' + JSON.stringify(title) + ',' + JSON.stringify(content) + ')')
    await until('document.querySelector("textarea[aria-label=文档标题]")?.value === ' + JSON.stringify(title))
    await evaluate('document.fonts.ready'); await sleep(90)
  }
  const field = 'document.querySelector("textarea[aria-label=文档标题]")'
  const input = async text => { await send('Input.insertText', { text }, sessionId); await sleep(50) }
  screenshot = async name => {
    await evaluate('Promise.all([document.fonts.ready,...Array.from(document.images).map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=i.onerror=r}))])')
    await sleep(280) // Finish the shared 220ms theme-colour transition.
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId)
    await writeFile(join(OUT, name + '.png'), Buffer.from(shot.data, 'base64'))
  }
  const inspect = () => evaluate(`(()=>{
    const field=${field}, mirror=document.querySelector('.document-title-measure'), text=document.querySelector('.document-title-text')
    const box=n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}
    const r=document.createRange();r.selectNodeContents(text)
    const rects=Array.from(r.getClientRects()).map(r=>[r.x,r.y,r.width,r.height])
    const fragments=Array.from(text.getClientRects()).map(r=>[r.x,r.y,r.width,r.height])
    const s=getComputedStyle(field),m=getComputedStyle(mirror),p=getComputedStyle(text),f=field.getBoundingClientRect()
    return {value:field.value,field:box(field),mirror:box(mirror),scroll:[field.scrollWidth,field.scrollHeight,field.clientWidth,field.clientHeight],rects,fragments,
      lineCount:new Set(rects.map(r=>Math.round(r[1]*10)/10)).size,outline:s.outlineStyle,outlineWidth:s.outlineWidth,shadow:s.boxShadow,
      marker:p.backgroundImage,focusMarker:p.textDecorationLine,mirrorHidden:mirror.getAttribute('aria-hidden'),pointer:m.pointerEvents,
      font:s.font,mirrorFont:m.font,fontReady:document.fonts.check('36px "Docs Hand"'),whiteSpace:s.whiteSpace,wrap:s.overflowWrap,
      fieldOverflow:s.overflow,scrollTop:field.scrollTop,rectsFit:rects.every(r=>r[0]>=f.left-1&&r[0]+r[2]<=f.right+1&&r[1]>=f.top-1&&r[1]+r[3]<=f.bottom+7),viewport:innerWidth}
  })()`)
  const assertLayout = (name, m) => {
    assert.ok(m.scroll[0] <= m.scroll[2] + 1 && m.scroll[1] <= m.scroll[3] + 1, name + ' textarea must fit every line: ' + JSON.stringify(m))
    /*
     * Glyph bounds are only comparable once the real face is in use.
     *
     * This case intentionally measures the fallback first, and the fallback is
     * whatever the machine has: KaiTi on a desktop Windows box, Noto CJK on the
     * CI image. Their ascent/descent differ by a fraction of a pixel, which is
     * enough to put the last glyph box outside the textarea even though the
     * textarea's own scrollHeight fits. The claim worth asserting before the font
     * arrives is that the mirror and the field share typography and boxes - both
     * checked below - and that the real face then lands inside the field.
     */
    if (m.fontReady) assert.ok(m.rectsFit, name + ' mirror glyph bounds must fit the textarea: ' + JSON.stringify(m))
    else assert.ok(m.rectsFit || m.scroll[1] <= m.scroll[3] + 1, name + ' fallback mirror must not overflow its field: ' + JSON.stringify(m))
    assert.equal(m.font, m.mirrorFont, name + ' textarea and mirror share typography')
    assert.ok(m.field.every((value, index) => Math.abs(value - m.mirror[index]) < 1), name + ' mirror/textarea boxes coincide')
    assert.equal(m.outline, 'none', name + ' title has no rectangular focus outline')
    assert.equal(m.shadow, 'none', name + ' title has no rectangular focus shadow')
    assert.equal(m.mirrorHidden, 'true'); assert.equal(m.pointer, 'none')
    assert.ok(m.fragments.length === m.rects.length, name + ' each line has one marker fragment')
    for (let i = 0; i < m.rects.length; i++) assert.ok(Math.abs(m.fragments[i][2] - m.rects[i][2]) < 1, name + ' marker width follows actual text')
  }
  await until('Boolean(window.__fixture)&&Boolean(document.querySelector("textarea[aria-label=文档标题]"))&&Boolean(document.querySelector(".tiptap-content")?.editor)')
  await send('Runtime.enable', {}, sessionId)
  await viewport(1440, 1100)
  const beforeFonts = await inspect(); evidence.layouts.push({ name: 'font-before-arrival', ...beforeFonts }); assertLayout('fallback font', beforeFonts)
  assert.equal(beforeFonts.fontReady, false, 'font gate exposes the actual fallback-font layout')
  releaseFonts(); await evaluate('document.fonts.ready'); await sleep(80)
  const afterFonts = await inspect(); evidence.layouts.push({ name: 'font-after-arrival', ...afterFonts }); assertLayout('loaded font', afterFonts)
  assert.equal(afterFonts.fontReady, true)
  // Save useful previews before the maximal cases, so a failure still leaves an
  // immediately reviewable desktop and phone example for the implementation.
  for (const [name, width, title] of [
    ['desktop-long-chinese', 1440, '手绘标题应当跟随每一行文字自然换行，而不是在固定宽度的横线上继续延伸。一起把文档的细节补齐，让阅读和编辑都舒服。'],
    ['desktop-long-english', 1440, 'AReallyLongUnbrokenEnglishDocumentTitleThatMustWrapNaturallyWithoutHorizontalScrollingOrAClippedCaret'.repeat(2)],
    ['phone-long-chinese', 390, '让每一个好想法，都有落笔的地方。标题的黄线应该跟着文字换行，留出舒服的呼吸感。'],
  ]) {
    await viewport(width, width === 390 ? 844 : 1100); await reset(title); await evaluate(field + '.focus()'); await screenshot(name)
    const sample = await inspect(); evidence.layouts.push({ name, theme: 'handdrawn', ...sample }); assertLayout(name, sample)
    console.log('preview verified: ' + name)
  }
  const cases = { short: '短标题', empty: '', chinese500: '手绘文档标题测试'.repeat(63).slice(0, 500), english500: 'UnbrokenEnglishTitle'.repeat(27).slice(0, 500), emoji500: '📚'.repeat(250) }
  for (const [width, height, zoom] of [[1440, 1100, 1], [390, 844, 1], [1000, 900, 1.5]]) {
    await viewport(width, height); await evaluate('document.documentElement.style.zoom=' + zoom)
    for (const [name, title] of Object.entries(cases)) {
      await reset(title); await evaluate(field + '.focus()')
      const states = []
      for (const theme of ['paper', 'handdrawn']) {
        await evaluate('document.documentElement.dataset.theme=' + JSON.stringify(theme)); await sleep(60)
        const m = await inspect(); states.push(m); evidence.layouts.push({ name, width, height, zoom, theme, ...m }); assertLayout(name + ' ' + width + '/' + zoom + '/' + theme, m)
        if (name.endsWith('500')) assert.ok(m.lineCount > 1, name + ' must soft wrap')
        if (name === 'short') assert.ok(m.fragments[0][2] < m.field[2] * .75, 'short marker is text-sized')
      }
      assert.deepEqual(states[0].field, states[1].field, name + ' theme switch keeps title geometry')
      assert.deepEqual(states[0].rects, states[1].rects, name + ' theme switch keeps soft wrapping')
    }
  }
  await reset(cases.english500)
  for (const [width, height] of [[1440, 1100], [390, 844], [1440, 1100]]) {
    await viewport(width, height)
    const m = await inspect(); evidence.layouts.push({ name: 'live-resize-english500', width, ...m }); assertLayout('live resize ' + width, m)
  }
  await evaluate('document.documentElement.style.zoom=1'); await viewport(1440, 1100)
  await reset('编辑前的标题'); await evaluate(field + '.focus();' + field + '.select()'); await input('键盘保存的新标题')
  await key('Enter'); await until('document.activeElement?.classList.contains("ProseMirror")')
  await until('(async()=>{const r=await fetch("/fixture");return (await r.json()).writes.length===1})()')
  let state = await evaluate('fetch("/fixture").then(r=>r.json())')
  assert.equal(state.document.title, '键盘保存的新标题'); assert.equal(state.writes.length, 1)
  assert.ok(await evaluate('document.querySelector(".tiptap-content").editor.state.selection.from<=2'), 'title Enter places the real caret at the first body block')
  evidence.interactions.push('Real Enter saved exactly once and focused the mounted body editor')
  await reset('按 Escape 保留的标题'); await evaluate(field + '.focus();' + field + '.select()'); await input('这段修改应该取消'); await key('Escape'); await sleep(120)
  assert.equal(await evaluate(field + '.value'), '按 Escape 保留的标题'); assert.equal((await evaluate('fetch("/fixture").then(r=>r.json())')).writes.length, 0)
  evidence.interactions.push('Real Escape restored the persisted title without writing')
  await reset('空名称保留原来的标题'); await evaluate(field + '.focus();' + field + '.select()'); await key('Backspace'); await key('Enter'); await sleep(100)
  assert.equal(await evaluate(field + '.value'), '空名称保留原来的标题'); assert.equal((await evaluate('fetch("/fixture").then(r=>r.json())')).writes.length, 0)
  evidence.interactions.push('Submitting an empty name restored the existing name without writing')
  await reset('中文输入法'); await evaluate(field + '.focus();' + field + '.select();' + field + '.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}))')
  await input('正在选择中文候选'); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229, isComposing: true }, sessionId)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229 }, sessionId)
  assert.equal(await evaluate('document.activeElement===' + field), true); assert.equal((await evaluate('fetch("/fixture").then(r=>r.json())')).writes.length, 0)
  const beforeSettling = await evaluate(field + '.value')
  await evaluate(field + '.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:"候选"}))'); await key('Enter'); await sleep(35)
  assert.equal(await evaluate('document.activeElement===' + field), true); assert.equal((await evaluate('fetch("/fixture").then(r=>r.json())')).writes.length, 0)
  assert.ok(!/[\r\n]/.test(await evaluate(field + '.value')), 'IME settling Enter must not add a stored newline')
  if (await evaluate(field + '.value') !== beforeSettling) evidence.failures.push('IME settling Enter inserted text after composition ended')
  await sleep(90); await key('Enter'); await until('document.activeElement?.classList.contains("ProseMirror")')
  evidence.interactions.push('Composition and settling Enter did not save or leave title; deliberate Enter after settling entered body')
  await reset('前缀后缀'); await evaluate(field + '.focus();' + field + '.setSelectionRange(2,2)')
  await input('甲乙'); await key('z', 'KeyZ', 2); await sleep(60)
  assert.equal(await evaluate(field + '.value'), '前缀后缀', 'plain insertion confirms the browser undo shortcut works')
  await reset('前缀后缀'); await evaluate(field + '.focus();' + field + '.setSelectionRange(2,2)')
  // insertText delivers a real browser editing operation, including the native
  // undo unit, rather than assigning value then dispatching a fake input event.
  await input('甲\n乙'); await sleep(80)
  assert.equal(await evaluate(field + '.value'), '前缀甲 乙后缀', 'multiline insertion becomes one logical title')
  const caret = await evaluate('({start:' + field + '.selectionStart,end:' + field + '.selectionEnd})')
  assert.deepEqual(caret, { start: 5, end: 5 }, 'caret remains after normalized pasted fragment')
  await key('z', 'KeyZ', 2); await sleep(90)
  if (await evaluate(field + '.value') !== '前缀后缀') evidence.failures.push('Native undo did not remove the normalized multiline browser insertion')
  else evidence.interactions.push('Multiline browser insertion in the middle normalized to spaces, kept caret after fragment and undid in one native undo')
  await key('y', 'KeyY', 2); await sleep(70)
  assert.equal(await evaluate(field + '.value'), '前缀甲 乙后缀', 'Ctrl+Y redoes the normalized browser insertion')
  await reset('前缀后缀'); await evaluate(field + '.focus();' + field + '.setSelectionRange(2,2)')
  await send('Browser.grantPermissions', { origin: 'http://127.0.0.1:' + server.address().port, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] })
  await send('Page.bringToFront', {}, sessionId)
  // Write only the known fixture string; never read the user's clipboard.
  await evaluate('navigator.clipboard.writeText("甲\\r\\n乙")'); await key('v', 'KeyV', 2); await sleep(100)
  assert.equal(await evaluate(field + '.value'), '前缀甲 乙后缀', 'real clipboard paste becomes one logical title')
  assert.deepEqual(await evaluate('({start:' + field + '.selectionStart,end:' + field + '.selectionEnd})'), { start: 5, end: 5 })
  await key('z', 'KeyZ', 2); await sleep(80)
  if (await evaluate(field + '.value') !== '前缀后缀') evidence.failures.push('Native undo did not remove the normalized real Ctrl+V clipboard paste')
  else evidence.interactions.push('Real Ctrl+V clipboard paste normalized CRLF, preserved middle caret, and undid once')
  await key('y', 'KeyY', 2); await sleep(70)
  assert.equal(await evaluate(field + '.value'), '前缀甲 乙后缀', 'Ctrl+Y redoes the normalized real paste')
  evidence.interactions.push('Ctrl+Y redid both normalized multiline insertion and real paste')
  const nearLimit = '前'.repeat(498) + '尾'
  await reset(nearLimit); await evaluate(field + '.focus();' + field + '.setSelectionRange(498,498)')
  await evaluate('navigator.clipboard.writeText("📚\\n甲")'); await key('v', 'KeyV', 2); await sleep(70)
  assert.equal(await evaluate(field + '.value'), nearLimit, 'a one-unit remainder cannot admit half an emoji')
  await evaluate(field + '.setSelectionRange(497,498)'); await key('v', 'KeyV', 2); await sleep(70)
  assert.equal(await evaluate(field + '.value'), '前'.repeat(497) + '📚尾', 'pasting into a selection reclaims its UTF-16 budget and preserves the suffix')
  await key('z', 'KeyZ', 2); await sleep(60); assert.equal(await evaluate(field + '.value'), nearLimit)
  evidence.interactions.push('At 499 units, a half-emoji paste is refused; replacement fits exactly 500 units, preserves the suffix and undoes')
  await reset(''); await evaluate(field + '.focus()'); await input('📚'.repeat(251))
  const limited = await evaluate(field + '.value')
  assert.equal(limited.length, 500); assert.equal(Array.from(limited).length, 250); assert.ok(!/[\uD800-\uDBFF]$/.test(limited), 'maxLength preserves an emoji boundary')
  evidence.interactions.push('Native maxLength admits 250 supplementary emoji within the server UTF-16 500-unit limit')
  await screenshot('desktop-emoji-maxlength')
  await reset(''); await evaluate(field + '.focus()'); await input('中'.repeat(501)); assert.equal((await evaluate(field + '.value')).length, 500)
  evidence.interactions.push('Native maxLength caps 501 pasted Chinese characters at 500 units')
  assert.deepEqual(evidence.browserErrors, [], 'the real mounted editor has no uncaught browser exception')
  await reset('短标题'); await evaluate(field + '.focus()'); await screenshot('desktop-short-focus')
  if(outOverride) {
    const text = value => ({type:'paragraph',content:[{type:'text',text:value}]})
    const showcase = {type:'doc',content:[
      {type:'blockquote',content:[text('让每一个好想法，都有落笔的地方。')]},
      {type:'heading',attrs:{level:2},content:[{type:'text',text:'01  项目概览'}]},
      {type:'paragraph',content:[{type:'text',text:'用文档连接想法，让 '},{type:'text',text:'讨论与行动',marks:[{type:'highlight',attrs:{color:'#fff3c4'}}]},{type:'text',text:' 都清晰可见。'}]},
      {type:'heading',attrs:{level:2},content:[{type:'text',text:'02  本周待办'}]},
      {type:'taskList',content:[{type:'taskItem',attrs:{checked:true},content:[text('整理团队知识库')]},{type:'taskItem',attrs:{checked:false},content:[text('一起完善设计与交互细节')]}]},
      {type:'heading',attrs:{level:2},content:[{type:'text',text:'03  协作安排'}]},
      {type:'table',content:[{type:'tableRow',content:[{type:'tableHeader',content:[text('事项')]},{type:'tableHeader',content:[text('负责人')]},{type:'tableHeader',content:[text('进度')]}]},{type:'tableRow',content:[{type:'tableCell',content:[text('界面与交互')]},{type:'tableCell',content:[text('林一')]},{type:'tableCell',content:[text('进行中')]}]}]},
    ]}
    for(const [width,height,prefix] of [[1440,1100,'desktop'],[390,844,'phone']]) {
      await viewport(width,height);await reset('设计协作计划',showcase)
      await evaluate(field+'.focus()')
      const pair=[]
      for(const theme of ['paper','handdrawn']) {
        await evaluate('document.documentElement.dataset.theme='+JSON.stringify(theme));await sleep(80)
        const sample=await inspect();pair.push(sample);evidence.layouts.push({name:'showcase-editor',width,height,theme,...sample});assertLayout('showcase '+prefix+'/'+theme,sample)
        if(theme==='handdrawn') {
          const material=await evaluate(`(async()=>{
            const background=getComputedStyle(document.querySelector('.document-title-art'),'::before').backgroundImage
            const loaded=await new Promise(resolve=>{const img=new Image();img.onload=()=>resolve({source:img.src,width:img.naturalWidth,height:img.naturalHeight});img.onerror=()=>resolve(null);img.src='/art/handdrawn-v1/decor/washi-sage.webp'})
            return {background,loaded}
          })()`)
          assert.ok(material.background.includes('washi-sage.webp'),'title notebook uses the new AI washi tape')
          assert.ok(material.loaded?.width>0&&material.loaded.height>0,'new AI washi tape loads in Chrome')
          evidence.materials.push({name:prefix+'-title-tape',...material})
        }
        await screenshot(prefix+'-editor-title-'+theme)
      }
      assert.deepEqual(pair[0].field,pair[1].field,'showcase title has the same geometry in both appearances')
      assert.deepEqual(pair[0].rects,pair[1].rects,'showcase title marker keeps the same line wrapping')
    }
  }
  assert.deepEqual(evidence.failures, [], 'all independent editing boundaries pass')
  await rm(join(OUT, 'title-failure.png'), { force: true })
  await writeFile(join(OUT, 'title-verification.json'), JSON.stringify(evidence, null, 2))
  console.log('Document title verified: ' + evidence.layouts.length + ' layout states and ' + evidence.interactions.length + ' editing boundaries')
} catch (error) {
  evidence.failure = error.stack || String(error)
  try { evidence.lastState = await evaluate?.('({active:document.activeElement?.outerHTML,notices:window.__notices})'); await screenshot?.('title-failure') } catch { /* retain the original failure */ }
  await writeFile(join(OUT, 'title-verification.json'), JSON.stringify(evidence, null, 2))
  throw error
} finally {
  socket?.close()
  if (chrome) { const stopped = new Promise(done => chrome.once('exit', done)); chrome.kill(); await Promise.race([stopped, sleep(2500)]) }
  server?.closeAllConnections(); if (server) await new Promise(done => server.close(done))
  assert.equal(dirname(resolve(work)), resolve(tmpdir())); assert.ok(basename(work).startsWith('mdocs-title-'))
  await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
