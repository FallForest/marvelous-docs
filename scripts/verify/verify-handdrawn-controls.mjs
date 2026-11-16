/** Real themed controls in an isolated in-memory fixture. No workspace DB. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { servePublicArt } from './public-art.mjs'

const WEB = resolve(import.meta.dirname, '../../apps/web')
const motionMode = process.argv.includes('--motion') || process.argv.includes('--motion-baseline')
const OUT = resolve(import.meta.dirname, '../../docs/design/handdrawn-v1/implementation-v10')
const { build } = createRequire(join(WEB, 'package.json'))('esbuild')
const work = await mkdtemp(join(tmpdir(), 'mdocs-controls-'))
const sleep = ms => new Promise(done => setTimeout(done, ms))
const measurements = []
let chrome, socket, server
try {
  await build({
    stdin: { resolveDir: WEB, loader: 'tsx', contents: `
      import { useEffect, useState } from 'react'
      import { createRoot } from 'react-dom/client'
      import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react'
      import CodeBlockView from './src/components/editor/CodeBlockView'
      import EditorToolbar from './src/components/editor/EditorToolbar'
      import TableMenu from './src/components/editor/TableMenu'
      import ShareDialog from './src/components/dialogs/ShareDialog'
      import InviteDialog from './src/components/dialogs/InviteDialog'
      import DraftRecovery from './src/components/dialogs/DraftRecovery'
      import DocumentPanel from './src/components/panels/DocumentPanel'
      import VersionPreview from './src/components/panels/VersionPreview'
      import Select from './src/components/ui/Select'
      import DocumentListPage from './src/pages/DocumentListPage'
      import { useBlockGeometry } from './src/hooks/useBlockGeometry'
      import { buildEditorExtensions } from './src/lib/editor'
      import { writeDraft } from './src/lib/local-drafts'
      import './src/styles/index.css'
      const noop = () => {}
      const p = text => ({type:'paragraph',content:text?[{type:'text',text}]:[]})
      const content = {type:'doc',content:[
        {type:'heading',attrs:{level:2},content:[{type:'text',text:'设计协作计划'}]},
        p('让每一个想法，都有落笔的地方。'),
        {type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'const idea = "一起把事情做好";'}]},
        {type:'table',content:[
          {type:'tableRow',content:[{type:'tableHeader',content:[p('事项')]},{type:'tableHeader',content:[p('负责人')]}]},
          {type:'tableRow',content:[{type:'tableCell',content:[p('界面与交互')]},{type:'tableCell',content:[p('林一')]}]}
        ]},
        {type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'const idea = "开始记录";'}]},p('下一步：一起完善细节。')
      ]}
      const doc = {id:'skin-fixture',title:'设计协作计划',version:3,updatedAt:'2026-11-15T03:00:00Z',content:{schemaVersion:1,doc:content}}
      const members = [{id:'owner',name:'ZHZ',email:'zhz@example.test',role:'admin'},{id:'lin',name:'林一',email:'lin@example.test',role:'member'}]
      const comments = [{id:'comment-a',userId:'lin',userName:'林一',body:'下拉菜单的选中项也需要保持手绘质感。',status:'open',createdAt:'2026-11-15T03:15:00Z',anchor:{text:'让每一个想法，都有落笔的地方。'}},
        {id:'comment-b',userId:'owner',userName:'ZHZ',body:'这部分已经确认，可以继续。',status:'resolved',createdAt:'2026-11-14T07:15:00Z'}]
      function Harness() {
        const [scene,setScene] = useState('editor')
        const [tab,setTab] = useState('comments')
        const [permission,setPermission] = useState('viewer')
        const [role,setRole] = useState('member')
        const [email,setEmail] = useState('hello@example.test')
        const [commentText,setCommentText] = useState('')
        const [busy,setBusy] = useState(false)
        const [testValue,setTestValue] = useState('alpha')
        const editor = useEditor({extensions:buildEditorExtensions({codeBlockNodeView:ReactNodeViewRenderer(CodeBlockView)}),content,editorProps:{attributes:{class:'tiptap-content'}}})
        const blocks = useBlockGeometry(editor)
        useEffect(() => {
          window.__editor = editor
          window.__scene = setScene
          window.__setBusy = setBusy
          window.__permission = permission
          window.__role = role
          window.__testValue = testValue
          window.__selectTable = () => {
            let cell
            editor.state.doc.descendants((node,pos) => {if(cell === undefined && node.type.name==='tableCell') cell=pos})
            editor.chain().focus().setTextSelection(cell+2).run()
          }
          window.__draft = () => {writeDraft(localStorage,doc.id,'owner',{type:'doc',content:[p('这是一段上次离开时没有保存的文字。')]});setScene('draft')}
        },[editor,permission,role,testValue])
        const showPanel = scene==='comments' || scene==='history'
        if(scene==='documents') return <div className="app-shell" style={{height:'100dvh'}}><main className="main-area" style={{width:'100%',minWidth:0}}><DocumentListPage documents={[doc,{...doc,id:'second',title:'项目资料',parentId:'folder'},{...doc,id:'folder',kind:'folder',title:'团队资料'}]} favorites={new Set([doc.id])} query="" onOpen={noop} onCreate={noop}/></main></div>
        return <div className="app-shell" style={{height:'100dvh'}}>
          <main className="main-area" style={{width:'100%',minWidth:0}}>
            <div className="workspace-content">
              <div className="editor-column" style={{padding:'20px 16px'}}>
                <EditorToolbar editor={editor} actions={{onLink:noop,onImage:noop,onFind:noop,onOutline:noop,onComment:()=>setScene('comments')}}/>
                {scene==='select-test' && <div style={{padding:20}}><Select label="Keyboard fixture" value={testValue} onValueChange={setTestValue} options={[{value:'alpha',label:'Alpha'},{value:'beta',label:'Beta',disabled:true},{value:'bravo',label:'Bravo'},{value:'charlie',label:'Charlie'}]}/><button type="button" id="next-control">Next</button></div>}
                <div className="paper" style={{padding:'36px 28px',marginTop:18,overflow:'auto'}}><EditorContent editor={editor}/></div>
                <TableMenu editor={editor} table={blocks.find(b=>b.kind==='table')||null}/>
              </div>
              {showPanel && <DocumentPanel doc={doc} token="fixture" open tab={scene==='history'?'history':tab} comments={comments} commentText={commentText} commentAnchor={null} activeCommentId={null} commentLocations={{'comment-a':{status:'attached'}}} currentUserId="lin" onTab={setTab} onClose={()=>setScene('editor')} onCommentText={setCommentText} onClearAnchor={noop} onSubmitComment={noop} onActiveComment={noop} onReply={noop} onCommentStatus={noop} onPreviewVersion={noop} onEditComment={async()=>{}} onDeleteComment={async()=>{}}/>}
            </div>
          </main>
          {scene==='share' && <ShareDialog title={doc.title} members={members} permissions={[{userId:'lin',role:permission}]} restricted busy={busy} loadError="" shareLinks={[{id:'link-a',permission:'viewer',token:'fixture-preview',expiresAt:null}]} shareLinkCopied={false} onCreateShareLink={noop} onCopyShareLink={noop} onRetry={noop} onRevokeShareLink={noop} onRestrictedChange={noop} onPermissionChange={(_,next)=>setPermission(next)} onClose={()=>setScene('editor')}/>}
          {scene==='invite' && <InviteDialog email={email} setEmail={setEmail} role={role} setRole={setRole} link="" error="" busy={busy} copied={false} onSubmit={event=>event.preventDefault()} onCopy={noop} onClose={()=>setScene('editor')}/>}
          {scene==='draft' && <DraftRecovery doc={doc} token="fixture" userId="owner" onRecovered={noop} notify={noop}/>}
          {scene==='version' && <VersionPreview token="fixture" documentId={doc.id} version={{id:'v1',version:1,createdBy:'lin',createdByName:'林一',createdAt:'2026-11-14T03:00:00Z'}} currentContent={doc.content} currentTitle={doc.title} onRestore={async()=>true} onClose={()=>setScene('editor')}/>}
        </div>
      }
      createRoot(document.getElementById('root')).render(<Harness/>)
    ` },
    bundle: true, format: 'iife', platform: 'browser', target: 'chrome110', jsx: 'automatic',
    outfile: join(work, 'app.js'), external: ['/art/*'], logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  })
  const js = await readFile(join(work, 'app.js'))
  const css = (await readFile(join(work, 'app.css'), 'utf8')).replace(/^@import[^\n]*\n/gm, '')
  server = createServer((request, response) => {
    if (servePublicArt(request, response)) return
    if (request.url === '/app.js') { response.setHeader('Content-Type','text/javascript'); response.end(js); return }
    if (request.url === '/app.css') { response.setHeader('Content-Type','text/css'); response.end(css); return }
    if (request.url?.startsWith('/api/')) {
      response.setHeader('Content-Type','application/json')
      if(request.url.includes('/versions/')) {
        response.end(JSON.stringify({version:{id:'v1',version:1,title:'设计草案',createdBy:'lin',createdByName:'林一',createdAt:'2026-11-14T03:00:00Z',content:{schemaVersion:1,doc:{type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'设计草案'}]},{type:'paragraph',content:[{type:'text',text:'让每一个想法，都有留下的地方。'}]},{type:'paragraph',content:[{type:'text',text:'从一张白纸开始，共同确认细节。'}]}]}}}}));return
      }
      response.end(JSON.stringify({items:[
        {id:'snapshot',kind:'snapshot',versionId:'v3',version:3,title:'设计协作计划',userId:'owner',userName:'ZHZ',createdAt:'2026-11-15T03:00:00Z',summary:{added:26,removed:3}},
        {id:'snapshot-long',kind:'snapshot',versionId:'v2',version:2,title:'长标题：设计协作计划与全部交互细节',userId:'lin',userName:'一位名字比较长的团队成员',createdAt:'2026-11-15T02:45:00Z',reason:'manual',summary:{added:148,removed:29}},
        {id:'permission',kind:'event',action:'permission_changed',userId:'owner',userName:'ZHZ',createdAt:'2026-11-15T02:30:00Z',details:{beforeRole:'viewer',afterRole:'editor',targetUserName:'林一'}},
        {id:'renamed',kind:'event',action:'document_renamed',userId:'lin',userName:'林一',createdAt:'2026-11-14T02:00:00Z',details:{beforeTitle:'未命名文档',afterTitle:'设计协作计划'}}
      ],nextCursor:null})); return
    }
    response.setHeader('Content-Type','text/html; charset=utf-8')
    response.end('<!doctype html><html lang="zh-CN" data-theme="handdrawn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>')
  })
  await new Promise(done=>server.listen(0,'127.0.0.1',done))
  chrome = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+join(work,'profile'),'--window-size=1280,900','about:blank'], {stdio:'ignore'})
  let port
  for(let i=0;i<60;i++) {try {port=(await readFile(join(work,'profile/DevToolsActivePort'),'utf8')).split('\n')[0];break}catch{await sleep(250)}}
  assert.ok(port,'Chrome must expose DevTools')
  const version=await (await fetch('http://127.0.0.1:'+port+'/json/version')).json()
  socket=new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((done,reject)=>{socket.onopen=done;socket.onerror=reject})
  let sequence=0
  const pending=new Map()
  socket.onmessage=event=>{
    const message=JSON.parse(event.data), entry=pending.get(message.id)
    if(!entry)return
    pending.delete(message.id);clearTimeout(entry.timer)
    if(message.error)entry.reject(new Error(JSON.stringify(message.error)))
    else entry.done(message.result)
  }
  const send=(method,params={},sessionId)=>new Promise((done,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'))},10000)
    pending.set(id,{done,reject,timer});socket.send(JSON.stringify({id,method,params,sessionId}))
  })
  const {targetId}=await send('Target.createTarget',{url:'http://127.0.0.1:'+server.address().port})
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
  const evaluate=async expression=>{
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId)
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||'Browser exception')
    return result.result.value
  }
  const until=async expression=>{for(let i=0;i<70;i++){if(await evaluate(expression))return;await sleep(100)}throw new Error('Condition not reached: '+expression)}
  const click=async selector=>{
    const rect=await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled)return null;n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}})()`)
    assert.ok(rect&&rect.width&&rect.height,'visible enabled: '+selector)
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x,y:rect.y,button:'left',clickCount:1},sessionId)
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x,y:rect.y,button:'left',clickCount:1},sessionId)
    await sleep(220)
  }
  const key=async (key,code=key)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code},sessionId);await send('Input.dispatchKeyEvent',{type:'keyUp',key,code},sessionId);await sleep(100)}
  const scene=async name=>{await evaluate(`window.__scene(${JSON.stringify(name)})`);await sleep(250)}
  const closeMenus=async()=>{await key('Escape');await sleep(120)}
  const setViewport=async(width,height)=>{await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId);await sleep(180)}
  await mkdir(OUT,{recursive:true})
  const screenshot=async name=>{await evaluate('Promise.all([document.fonts.ready,...Array.from(document.images).map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=i.onerror=r}))])');const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(join(OUT,name+'.png'),Buffer.from(shot.data,'base64'))}
  const inspect=async selector=>evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return null;const r=n.getBoundingClientRect(),s=getComputedStyle(n),b=n.closest('.modal-backdrop');return {box:[r.x,r.y,r.width,r.height],background:s.backgroundImage,borderImage:s.borderImageSource,color:s.color,shadow:s.boxShadow,overflowX:n.scrollWidth>n.clientWidth+1,backdropOverflowX:Boolean(b&&b.scrollWidth>b.clientWidth+1),backdropOverflowY:Boolean(b&&b.scrollHeight>b.clientHeight+1),viewport:innerWidth}})()`)
  const compare=async(name,selector)=>{
    await evaluate("document.documentElement.dataset.theme='paper'");await sleep(120)
    const paper=await inspect(selector)
    await evaluate("document.documentElement.dataset.theme='handdrawn'");await sleep(120)
    const drawn=await inspect(selector)
    assert.ok(paper&&drawn,name+' exists in both themes')
    const delta=paper.box.map((value,index)=>Math.abs(value-drawn.box[index]))
    assert.ok(delta.every(value=>value<.15),name+' theme geometry changed: '+JSON.stringify({paper:paper.box,drawn:drawn.box,delta}))
    assert.ok(drawn.box[0]>=-1&&drawn.box[0]+drawn.box[2]<=drawn.viewport+1,name+' horizontal viewport bounds')
    assert.equal(drawn.overflowX,false,name+' must not horizontally scroll')
    assert.equal(drawn.backdropOverflowX,false,name+' modal backdrop must not horizontally scroll')
    assert.equal(drawn.backdropOverflowY,false,name+' modal backdrop must not vertically scroll')
    measurements.push({name,paper,handdrawn:drawn,delta})
    if(selector.includes('.popover')||selector==='[role="listbox"]'||selector==='.lang-picker-panel'||selector==='.tb-more-menu')assert.ok(drawn.borderImage.includes('menu-paper.webp'),name+' uses AI paper material')
  }
  await until('Boolean(window.__editor && document.querySelector(".tiptap-content"))')
  await evaluate('document.fonts.ready');await sleep(200)
  await setViewport(1280,900)

  if (motionMode) {
    const { verifyMotion } = await import('./handdrawn-motion-checks.mjs')
    await verifyMotion({evaluate,send,sessionId,key,scene,setViewport,screenshot,OUT,baseline:process.argv.includes('--motion-baseline')})
  } else {

  for(const [name,trigger,panel] of [
    ['paragraph','.tb-group-block .tb-anchor:first-child button','.popover[aria-label="段落样式"]'],
    ['font-size','.tb-size','.popover[aria-label="字号"]'],
    ['alignment','[aria-label="对齐方式"]','.popover[aria-label="对齐方式"]'],
    ['color','[aria-label="文字颜色"]','.popover[aria-label="文字颜色"]'],
    ['highlight','[aria-label="高亮"]','.popover[aria-label="高亮颜色"]'],
    ['insert','[aria-label="更多插入"]','.popover[aria-label="插入"]'],
  ]) {
    await click(trigger);await until('Boolean(document.querySelector('+JSON.stringify(panel)+'))')
    await compare(name,panel);await screenshot('desktop-'+name);await closeMenus()
  }
  await evaluate('window.__selectTable()');await sleep(200)
  await click('[title="表格操作"]');await compare('table','.popover[aria-label="表格操作"]')
  assert.ok(await evaluate('Boolean(document.querySelector(".popover button:disabled"))'),'table has unavailable actions')
  await screenshot('desktop-table');await closeMenus()
  await click('.lang-picker-button');await compare('code-language','.lang-picker-panel');await screenshot('desktop-code-language');await closeMenus()

  await scene('share')
  await compare('share-modal','.share-modal')
  assert.ok(await evaluate('getComputedStyle(document.querySelector(".share-restriction input")).backgroundImage.includes("check-filled.webp")'),'share restriction has AI checked material')
  await click('[aria-label="分享链接有效期"]')
  await compare('share-expiry','[role="listbox"]');await screenshot('desktop-share-expiry')
  await key('Escape')
  assert.ok(await evaluate('Boolean(document.querySelector(".share-modal"))'),'Escape closes only the selector, retaining share dialog')
  assert.equal(await evaluate('Boolean(document.querySelector("[role=listbox]"))'),false)
  await key('3','Digit3');assert.ok(await evaluate('document.querySelector(\'[aria-label="分享链接有效期"]\').textContent.startsWith("30")'),'typeahead selects a matching expiry')
  await key('3','Digit3');assert.ok(await evaluate('document.querySelector(\'[aria-label="分享链接有效期"]\').textContent.startsWith("365")'),'repeated typeahead cycles matching expiries')
  await key('Home');await key('ArrowDown');await key('Enter')
  await click('[aria-label="林一的文档权限"]')
  await compare('share-role','[role="listbox"]');await screenshot('desktop-share-role')
  assert.ok(await evaluate('getComputedStyle(document.querySelector(".select-option[aria-selected=true]")).backgroundImage.includes("marker-sage.webp")'),'selected option has marker material')
  const hover=await evaluate('(()=>{const n=document.querySelector(".select-option[data-value=editor]"),r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()')
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...hover},sessionId)
  await sleep(100)
  assert.equal(await evaluate('document.querySelector(".select-option[data-value=editor]").dataset.active'),'true','hover follows option')
  await key('End');await key('Enter')
  assert.equal(await evaluate('window.__permission'),'owner','End and Enter commit last permission')
  await click('[aria-label="林一的文档权限"]');await key('Home');await key('ArrowDown');await key('Enter')
  assert.equal(await evaluate('window.__permission'),'viewer','Home and ArrowDown commit a permission')
  await evaluate('window.__setBusy(true)');await sleep(100)
  assert.ok(await evaluate('Array.from(document.querySelectorAll(".share-modal [role=combobox]")).every(n=>n.disabled)'),'busy share selectors disabled')
  await screenshot('desktop-share-disabled');await evaluate('window.__setBusy(false)')
  await scene('invite');await click('[role="combobox"]');await compare('invite-role','[role="listbox"]');await screenshot('desktop-invite')
  await key('End');await key('Enter');assert.equal(await evaluate('window.__role'),'admin')
  await scene('comments');await compare('comments','.right-panel')
  await click('[aria-label="筛选评论"]');await compare('comment-filter','[role="listbox"]');await screenshot('desktop-comments');await closeMenus()
  await scene('history');await until('Boolean(document.querySelector(".history-entry"))');await compare('history','.right-panel');await screenshot('desktop-history')
  await scene('version');await until('Boolean(document.querySelector(".history-diff-block"))');await compare('version-preview','.history-preview');await screenshot('desktop-version-changes')
  assert.ok(await evaluate('getComputedStyle(document.querySelector(".history-diff-summary input")).backgroundImage.includes("check-empty.webp")'),'version comparison has AI unchecked material')
  await click('.history-diff-summary input')
  assert.ok(await evaluate('document.querySelector(".history-diff-summary input").checked&&getComputedStyle(document.querySelector(".history-diff-summary input")).backgroundImage.includes("check-filled.webp")'),'version comparison toggles AI checked material')
  await click('#version-original-tab');await compare('version-original','.history-preview');await screenshot('desktop-version-original')
  await scene('editor');await evaluate('window.__draft()');await until('Boolean(document.querySelector(".draft-preview"))');await compare('draft-recovery','[role="dialog"]');await screenshot('desktop-draft-recovery')
  await scene('editor')

  await scene('select-test');await click('[aria-label="Keyboard fixture"]')
  await key('ArrowDown');await key('Enter');assert.equal(await evaluate('window.__testValue'),'bravo','disabled option skipped by keyboard')
  await key('Home');await key('Enter');assert.equal(await evaluate('window.__testValue'),'alpha','closed Home opens at first option')
  await key('c','KeyC');assert.equal(await evaluate('window.__testValue'),'charlie','typeahead changes the selected option')
  await click('[aria-label="Keyboard fixture"]');await key('ArrowUp');await key('Escape');assert.equal(await evaluate('window.__testValue'),'charlie','Escape cancels uncommitted option')
  await click('[aria-label="Keyboard fixture"]');await key('Tab');assert.equal(await evaluate('document.activeElement.id'),'next-control','Tab continues to the next control')
  assert.equal(await evaluate('Boolean(document.querySelector("[role=listbox]"))'),false,'Tab closes the listbox')
  await click('[aria-label="Keyboard fixture"]');await click('#next-control');assert.equal(await evaluate('Boolean(document.querySelector("[role=listbox]"))'),false,'outside click closes listbox')
  await click('[aria-label="Keyboard fixture"]')
  await click('.select-option[aria-disabled="true"]');assert.equal(await evaluate('window.__testValue'),'charlie','disabled option cannot be clicked')
  await key('Escape')
  await scene('editor')

  await setViewport(390,844)
  await click('[aria-label="更多格式"]');await compare('phone-more','.tb-more-menu');await screenshot('phone-more');await closeMenus()
  await scene('share');await compare('phone-share','.share-modal');await click('[aria-label="分享链接有效期"]');await compare('phone-share-expiry','[role="listbox"]');await screenshot('phone-share-expiry');await key('Escape')
  await scene('invite');await compare('phone-invite','.invite-modal');await click('[role="combobox"]');await compare('phone-invite-role','[role="listbox"]');await screenshot('phone-invite-role')
  await scene('comments');await click('[aria-label="筛选评论"]');await compare('phone-comments-filter','[role="listbox"]');await screenshot('phone-comments')
  await closeMenus();await scene('share')
  await click('[aria-label="分享链接有效期"]');await compare('phone-share-expiry-reopened','[role="listbox"]');await screenshot('phone-share-expiry');await closeMenus()
  await click('[aria-label="林一的文档权限"]');await compare('phone-share-role','[role="listbox"]');await screenshot('phone-share-role');await closeMenus()
  await scene('version');await until('Boolean(document.querySelector(".history-diff-block"))');await compare('phone-version-preview','.history-preview');await screenshot('phone-version-changes')
  await scene('share');await setViewport(390,360)
  await click('[aria-label="分享链接有效期"]')
  const short=await evaluate('(()=>{const p=document.querySelector(".select-panel"),o=p.querySelector(".select-options"),r=p.getBoundingClientRect();return {box:[r.x,r.y,r.width,r.height],innerHeight,innerClientHeight:o.clientHeight,innerScrollHeight:o.scrollHeight,panelClient:p.clientHeight,panelScroll:p.scrollHeight}})()')
  await screenshot('phone-short-select')
  assert.ok(short.box[1]>=7&&short.box[1]+short.box[3]<=short.innerHeight-7,'short selector stays within vertical viewport')
  assert.ok(short.innerScrollHeight>short.innerClientHeight,'short selector choices scroll internally')
  await key('End')
  assert.ok(await evaluate('(()=>{const o=document.querySelector(".select-options"),n=o.lastElementChild,a=o.getBoundingClientRect(),b=n.getBoundingClientRect();return b.bottom<=a.bottom+1&&b.top>=a.top-1})()'),'End scrolls the last option fully into the short panel')
  await screenshot('phone-short-select-end')
  await setViewport(390,844)
  const restored=await inspect('.select-panel')
  assert.ok(restored.box[3]>short.box[3]+20,'select recovers natural height after viewport grows')
  measurements.push({name:'select-short-resize',short,restored})
  await writeFile(join(OUT,'verification.json'),JSON.stringify({fixture:'isolated real components; no workspace database',measurements},null,2)+'\n')
  console.log('Handdrawn controls verified: '+measurements.filter(item=>item.delta).length+' theme geometry comparisons plus short-screen resize; screenshots: '+OUT)
  }
} finally {
  socket?.close()
  if(chrome){const stopped=new Promise(done=>chrome.once('exit',done));chrome.kill();await Promise.race([stopped,sleep(3000)])}
  server?.closeAllConnections()
  if(server)await new Promise(done=>server.close(done))
  assert.equal(dirname(resolve(work)),resolve(tmpdir()))
  assert.ok(basename(work).startsWith('mdocs-controls-'))
  await rm(work,{recursive:true,force:true,maxRetries:5,retryDelay:200})
}
