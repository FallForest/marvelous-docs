/** Assert the v13 handdrawn audit fixes in real components and isolated HTTP. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { servePublicArt } from './public-art.mjs'

const WEB=resolve(import.meta.dirname,'../../apps/web')
const OUT=resolve(import.meta.dirname,'../../docs/design/handdrawn-v1/implementation-v14')
const {build}=createRequire(join(WEB,'package.json'))('esbuild')
const work=await mkdtemp(join(tmpdir(),'mdocs-audit-fixes-'))
const sleep=ms=>new Promise(done=>setTimeout(done,ms))
const report={fixture:'Actual pages, TreeItem, SlashMenu, Tiptap, ErrorBoundary; isolated HTTP, no DB. Toast/PDF are exact App.tsx markup with fixed data, not actual export/notification operations.',states:[],requests:[],checks:[],geometry:[],contrast:[]}
let chrome,socket,server
try {
  await mkdir(OUT,{recursive:true})
  await build({stdin:{resolveDir:WEB,loader:'tsx',contents:`
    import {useEffect,useState} from 'react'
    import {createRoot} from 'react-dom/client'
    import {X} from 'lucide-react'
    import {useEditor,EditorContent} from '@tiptap/react'
    import TreeItem from './src/components/tree/TreeItem'
    import SlashMenu from './src/components/editor/SlashMenu'
    import {buildEditorExtensions} from './src/lib/editor'
    import AdminWorkspace from './src/pages/AdminPage'
    import LoginPage from './src/pages/LoginPage'
    import SearchPage from './src/pages/SearchPage'
    import SharedDocumentPage from './src/pages/SharedDocumentPage'
    import CommandPalette from './src/pages/CommandPalette'
    import BootScreen from './src/pages/BootScreen'
    import HomeDashboard,{FolderOverview} from './src/pages/HomePage'
    import DocumentListPage from './src/pages/DocumentListPage'
    import ErrorBoundary from './src/components/ui/ErrorBoundary'
    import './src/styles/index.css'
    const noop=()=>{}, user={id:'audit-admin',name:'审计管理员',email:'admin@example.test',role:'admin'}
    const docs=[{id:'audit-doc',kind:'document',title:'设计协作计划',version:3,updatedAt:'2026-11-17T03:00:00Z'}, {id:'audit-folder',kind:'folder',title:'团队资料',version:1,updatedAt:'2026-11-16T04:00:00Z'}]
    const results=[{...docs[0],snippet:'在这里整理设计、讨论与行动，继续完善协作计划。'}, {...docs[1],snippet:'团队公共参考资料。'}]
    const inviteProps={email:'',setEmail:noop,role:'member',setRole:noop,link:'',error:'',busy:false,copied:false,onSubmit:e=>e.preventDefault(),onCopy:noop}
    function ThrowingChild(){throw new Error('审计 fixture：页面组件渲染失败示例')}
    function Home({recent=false}){return <div className="app-shell" style={{height:'100dvh'}}><main className="main-area"><HomeDashboard documents={recent?[]:docs} favorites={new Set(['audit-doc'])} query="" trash={false} favoritesView={false} recentView={recent} stats={{documents:1,folders:1,members:2,openComments:1,trashed:0}} onOpen={noop} onCreate={noop} onImport={noop} onCreateFolder={noop} onRestore={async()=>{}} onPermanentDelete={async()=>{}} onEmptyTrash={noop}/></main></div>}
    function TreeFixture(){
      const [checked,setChecked]=useState(new Set(['audit-doc']))
      const toggle=doc=>{window.__treeToggles=(window.__treeToggles||0)+1;setChecked(previous=>{const next=new Set(previous);if(next.has(doc.id))next.delete(doc.id);else next.add(doc.id);return next})}
      return <div className="app-shell"><aside className="sidebar"><div className="sidebar-scroll" style={{paddingTop:40}}><h3>多选文档</h3><div role="tree" aria-label="审计文档树">{docs.map((doc,index)=><TreeItem key={doc.id} node={{doc,children:[]}} depth={0} index={index} activeId={null} selectedFolderId={null} expandedFolders={new Set()} favoriteIds={new Set()} onToggle={noop} onSelectFolder={noop} onSelectDocument={noop} onAction={noop} checkedIds={checked} onToggleChecked={toggle} focusId="audit-doc"/>)}</div></div></aside></div>
    }
    function EditorFixture(){
      const [open,setOpen]=useState(true)
      const editor=useEditor({extensions:buildEditorExtensions(),content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'/'}]},{type:'paragraph',content:[{type:'text',text:'正文中的铅笔分隔线'}]},{type:'horizontalRule'},{type:'paragraph',content:[{type:'text',text:'分隔线后的正文'}]}]},editorProps:{attributes:{class:'tiptap-content'}}})
      useEffect(()=>{window.__qaEditor=editor},[editor])
      return <div className="paper" style={{margin:'50px auto',padding:'35px 24px',width:'min(900px,calc(100vw - 32px))'}}><EditorContent editor={editor}/><SlashMenu editor={editor} anchor={open?{left:Math.min(80,innerWidth-320),top:180}:null} query="" range={{from:1,to:2}} onClose={()=>setOpen(false)} onImage={noop}/></div>
    }
    function Harness(){
      const scene=new URLSearchParams(location.search).get('scene')||'admin-failed'
      const [scope,setScope]=useState('all'),[index,setIndex]=useState(2)
      useEffect(()=>{window.__auditScene=scene},[scene])
      if(scene==='tree')return <TreeFixture/>
      if(scene==='slash')return <EditorFixture/>
      if(scene==='recent')return <Home recent/>
      if(scene==='disabled')return <div className="app-shell"><main className="main-area"><div className="topbar"><button className="share-btn" disabled>共享</button></div><div className="confirm-modal modal-panel" style={{margin:'50px auto',width:'min(460px,calc(100vw - 32px))'}}><h2>不可用按钮</h2><div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button className="primary-btn" disabled>正在保存</button><button className="secondary-btn" disabled>暂不可用</button><button className="btn-danger" disabled>删除</button><button className="primary-btn btn-danger" disabled>确认删除</button></div></div></main></div>
      if(scene.startsWith('admin-'))return <AdminWorkspace user={user} members={[user,{id:'member',name:'林一',email:'lin@example.test',role:'member'}]} membersBusy={scene==='admin-loading'} updateInfo={{version:'0.1.79',url:'https://example.test/release',status:scene==='admin-failed'?'failed':scene==='admin-running'?'running':'available'}} notice={scene==='admin-failed'?'数据库备份失败，服务仍保持原版本。':''} showInvite={false} onBack={noop} onOpenInvite={noop} onStartUpdate={noop} onLogout={noop} onCloseInvite={noop} inviteProps={inviteProps}/>
      if(scene.startsWith('login-'))return <LoginPage onLogin={noop} onAccepted={noop} error={scene==='login-error'?'邮箱或密码不正确，请重新输入。':''} busy={scene==='login-busy'}/>
      if(scene==='boot')return <BootScreen/>
      if(scene.startsWith('shared-'))return <SharedDocumentPage token={scene}/>
      if(scene.startsWith('search-'))return <div className="app-shell" style={{height:'100dvh'}}><main className="main-area"><SearchPage query="协作计划" scope={scope} onScope={setScope} results={scene==='search-results'?results:[]} loading={scene==='search-loading'} onOpen={noop}/></main></div>
      if(scene==='palette')return <><Home/><CommandPalette query="协作" onQuery={noop} scope={scope} onScope={setScope} index={index} onIndex={setIndex} results={results} loading={false} onClose={noop} onOpen={noop} onCreate={noop} onHome={noop}/></>
      if(scene==='folder-empty')return <div className="app-shell"><main className="main-area"><FolderOverview folder={docs[1]} items={[]} onCreate={noop} onImport={noop} onCreateFolder={noop} onOpen={noop}/></main></div>
      if(scene==='document-list-empty')return <div className="app-shell"><main className="main-area"><DocumentListPage documents={[]} favorites={new Set()} query="" onOpen={noop} onCreate={noop}/></main></div>
      if(scene==='error-boundary')return <ErrorBoundary><ThrowingChild/></ErrorBoundary>
      if(scene==='toast')return <><Home/><div className="notice-toast">分享链接已复制<button aria-label="关闭提示" title="关闭提示" onClick={noop}><X size={13}/></button></div></>
      if(scene==='pdf')return <><Home/><div className="pdf-progress motion-fade" role="dialog" aria-modal="true" aria-label="正在生成 PDF"><div className="pdf-progress-card motion-sheet"><span className="pdf-progress-title">正在生成 PDF…</span><span className="pdf-progress-track" aria-hidden="true"><i style={{'--progress':.66}}/></span><span className="pdf-progress-hint">文档较长时需要几秒钟，请保持页面打开。</span></div></div></>
      return <Home/>
    }
    createRoot(document.getElementById('root')).render(<Harness/>);
  `},bundle:true,format:'iife',platform:'browser',target:'chrome110',jsx:'automatic',outfile:join(work,'app.js'),external:['/art/*'],logLevel:'warning',define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'}})
  const js=await readFile(join(work,'app.js')), css=(await readFile(join(work,'app.css'),'utf8')).replace(/^@import[^\n]*\n/gm,'')
  const p=text=>({type:'paragraph',content:[{type:'text',text}]})
  const shared={id:'read-only-fixture',title:'设计协作手册 · 只读分享',permission:'viewer',updatedAt:'2026-11-17T03:00:00Z',content:{schemaVersion:1,doc:{type:'doc',content:[
    {type:'blockquote',content:[p('每一个好想法，都值得认真记录。')]},
    {type:'heading',attrs:{level:2},content:[{type:'text',text:'本周待办'}]},
    {type:'taskList',content:[{type:'taskItem',attrs:{checked:true},content:[p('确认需求：已经完成'),{type:'taskList',content:[{type:'taskItem',attrs:{checked:false},content:[p('嵌套子任务：尚未完成')]}]}]},{type:'taskItem',attrs:{checked:false},content:[p('交互方案：等待补充')]}]},
    {type:'horizontalRule'},
    {type:'table',content:[{type:'tableRow',content:[{type:'tableHeader',content:[p('事项')]},{type:'tableHeader',content:[p('负责人')]}]},{type:'tableRow',content:[{type:'tableCell',content:[p('界面与交互')]},{type:'tableCell',content:[p('林一')]}]}]},
    {type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'const status = "已完成";\nconsole.log(status);'}]}
  ]}}}
  server=createServer((req,res)=>{
    if(servePublicArt(req,res))return
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return}
    if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css);return}
    if(req.url?.startsWith('/api/')){
      report.requests.push({method:req.method,path:req.url})
      res.setHeader('Content-Type','application/json')
      if(req.url.includes('shared-loading'))return
      if(req.url.includes('shared-error')){res.statusCode=404;res.end(JSON.stringify({error:{message:'expired'}}));return}
      if(req.url.startsWith('/api/v1/shared/')){res.end(JSON.stringify({document:shared}));return}
      res.statusCode=404;res.end('{}');return
    }
    res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html lang="zh-CN" data-theme="handdrawn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>')
  })
  await new Promise(done=>server.listen(0,'127.0.0.1',done))
  const origin='http://127.0.0.1:'+server.address().port
  chrome=spawn(process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+join(work,'profile'),'--window-size=1280,900','about:blank'],{stdio:'ignore'})
  let port
  for(let i=0;i<70;i++){try{port=(await readFile(join(work,'profile/DevToolsActivePort'),'utf8')).split('\n')[0];break}catch{await sleep(150)}}
  assert.ok(port)
  const version=await(await fetch('http://127.0.0.1:'+port+'/json/version')).json()
  socket=new WebSocket(version.webSocketDebuggerUrl);await new Promise((done,reject)=>{socket.onopen=done;socket.onerror=reject})
  let id=0;const pending=new Map()
  socket.onmessage=event=>{const m=JSON.parse(event.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(new Error(JSON.stringify(m.error)));else p.done(m.result)}
  const send=(method,params={},sessionId)=>new Promise((done,reject)=>{const seq=++id,timer=setTimeout(()=>{pending.delete(seq);reject(new Error(method+' timed out'))},10000);pending.set(seq,{done,reject,timer});socket.send(JSON.stringify({id:seq,method,params,sessionId}))})
  const {targetId}=await send('Target.createTarget',{url:origin}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||'browser exception');return r.result.value}
  const until=async expression=>{for(let i=0;i<80;i++){if(await evaluate(expression))return;await sleep(70)}throw new Error('condition not reached: '+expression)}
  const check=(condition,message,data)=>{report.checks.push({passed:Boolean(condition),message,data});assert.ok(condition,message+(data?' '+JSON.stringify(data):''))}
  const key=async(key,code=key)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code},sessionId);await send('Input.dispatchKeyEvent',{type:'keyUp',key,code},sessionId);await sleep(90)}
  const material=async(selector,name)=>evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return false;return [null,'::before','::after'].some(p=>{const s=getComputedStyle(n,p);return (s.backgroundImage+' '+s.borderImageSource).includes(${JSON.stringify(name)})})})()`)
  const capture=async file=>{await sleep(280);const metrics=await send('Page.getLayoutMetrics',{},sessionId),size=metrics.cssContentSize;const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:Math.ceil(size.width),height:Math.min(1800,Math.ceil(size.height)),scale:1}},sessionId);await writeFile(join(OUT,file),Buffer.from(shot.data,'base64'))}
  const rgb=value=>{const values=value.match(/[\d.]+/g).map(Number);return [values[0],values[1],values[2],values[3]??1]}
  const over=(a,b)=>{const alpha=a[3]+b[3]*(1-a[3]);return [...[0,1,2].map(i=>(a[i]*a[3]+b[i]*b[3]*(1-a[3]))/alpha),alpha]}
  const luminance=color=>color.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0)
  const validate=async(scene,width,theme)=>{
    const hd=theme==='handdrawn'
    if(scene==='recent'){
      const asset=await evaluate(`(()=>{const n=document.querySelector('.home-empty img[src$="/recent.webp"]');return {loaded:Boolean(n?.complete&&n.naturalWidth>0),failed:Boolean(n?.closest('[data-art-failed]')),fallback:n?getComputedStyle(n.nextElementSibling).display:null}})()`)
      check(asset.loaded&&!asset.failed,'recent artwork loads without an image-error fallback',asset)
      if(hd)check(asset.fallback==='none','handdrawn recent uses its real raster asset')
    }
    if(scene==='tree'){
      const initial=await evaluate(`Array.from(document.querySelectorAll('.tree-check')).map(n=>({checked:n.checked,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,background:getComputedStyle(n).backgroundImage}))`)
      check(initial.length===2&&initial[0].checked&&!initial[1].checked,'native tree checkboxes preserve initial checked/unchecked states',initial)
      if(hd)check(initial[0].background.includes('check-filled')&&initial[1].background.includes('check-empty'),'tree shows checked and unchecked AI checkbox materials')
      await evaluate("document.querySelector('.tree-check').focus();window.__treeToggles=0")
      await key(' ','Space');check(await evaluate('!document.querySelector(".tree-check").checked&&window.__treeToggles===1'),'Space toggles native tree checkbox exactly once')
      await key(' ','Space');check(await evaluate('document.querySelector(".tree-check").checked&&window.__treeToggles===2'),'second Space restores checked state once')
      await key('Tab');check(await evaluate('document.activeElement===document.querySelectorAll(".tree-check")[1]'),'native Tab reaches the next checkbox')
      const focus=await evaluate('({visible:document.activeElement.matches(":focus-visible"),outline:getComputedStyle(document.activeElement).outlineStyle,width:getComputedStyle(document.activeElement).outlineWidth})')
      check(focus.visible&&focus.outline!=='none'&&parseFloat(focus.width)>=1,'tree keyboard focus remains visible',focus)
      await capture('tree-keyboard-'+width+'-'+theme+'.png')
    }
    if(scene==='slash'){
      await key('ArrowDown');check(await evaluate('document.querySelector(".slash-item[aria-selected=true] b").textContent==="标题 1"'),'actual ArrowDown changes SlashMenu selection')
      if(hd)check(await material('.slash-item[aria-selected=true]','marker-sage'),'actual SlashMenu aria-selected row retains marker material')
      await capture('slash-arrow-'+width+'-'+theme+'.png')
      await key('Enter');await until('!document.querySelector(".slash-menu")')
      check(await evaluate('window.__qaEditor.state.doc.firstChild.type.name==="heading"&&window.__qaEditor.state.doc.firstChild.attrs.level===1'),'actual Enter executes the selected slash command')
      if(hd){
        check(await material('.tiptap-content hr','pencil-rule'),'real editor horizontalRule has pencil artwork')
        check(await evaluate('(()=>{const n=document.querySelector(".tiptap-content hr");return n.getBoundingClientRect().height>=1&&getComputedStyle(n).backgroundOrigin==="border-box"})()'),'editor hr artwork paints in the visible 1px border box')
      }
      await capture('editor-hr-'+width+'-'+theme+'.png')
    }
    if(scene==='admin-running'){
      const moving=await evaluate('getComputedStyle(document.querySelector(".admin-update-icon.is-running > .art-icon")).animationName')
      check(moving!=='none','Admin animates the visible ArtIcon wrapper',{theme,moving})
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},sessionId)
      check(await evaluate('getComputedStyle(document.querySelector(".admin-update-icon.is-running > .art-icon")).animationName==="none"'),'Admin running animation stops under reduced motion')
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]},sessionId)
    }
    if(scene==='admin-failed'&&hd){
      check(await evaluate('document.querySelector(".admin-update-card").classList.contains("is-failed")'),'Admin exposes actual failed state class')
      check(await evaluate('(()=>{const n=document.querySelector(".admin-update-copy b"),probe=document.createElement("span");document.body.append(probe);const wanted=["--danger","--danger-strong"].map(token=>{probe.style.color="var("+token+")";return getComputedStyle(probe).color});probe.remove();return wanted.includes(getComputedStyle(n).color)})()'),'Admin failed title uses danger ink')
    }
    if(scene==='shared-readonly'){
      const tasks=await evaluate(`(()=>{const inputs=Array.from(document.querySelectorAll('.task-list input[type=checkbox]')),before=inputs.map(n=>n.checked);inputs.forEach(n=>n.click());return {before,after:inputs.map(n=>n.checked),disabled:inputs.every(n=>n.disabled),nested:Boolean(document.querySelector('.task-list .task-list')),nestedDecoration:getComputedStyle(document.querySelector('.task-list .task-list .task-item-content p')).textDecorationLine}})()`)
      check(JSON.stringify(tasks.before)==='[true,false,false]'&&JSON.stringify(tasks.after)===JSON.stringify(tasks.before)&&tasks.disabled&&tasks.nested,'readonly true/false/nested task state survives rendering and clicks',tasks)
      check(!tasks.nestedDecoration.includes('line-through'),'unchecked nested task does not inherit completed strike-through',tasks)
      if(hd){
        check(await evaluate('getComputedStyle(document.querySelector(".shared-logo")).backgroundColor==="rgba(0, 0, 0, 0)"'),'public logo has a transparent handdrawn background')
        check(await material('.shared-document-title span','marker-yellow'),'shared title has a text marker')
        check(await material('.shared-content blockquote','marker-sage'),'readonly quote has marker material')
        check(await material('.shared-content pre','pencil-frame'),'readonly code has a pencil perimeter')
        check(await material('.shared-content td','pencil-frame'),'readonly table cells have pencil perimeters')
        check(await material('.shared-content hr','pencil-rule'),'readonly horizontalRule has pencil artwork')
        if(width===1280){
          const clip=await evaluate('(()=>{const r=document.querySelector(".shared-content table").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()')
          const withArt=await send('Page.captureScreenshot',{format:'png',clip},sessionId)
          await evaluate('document.querySelectorAll(".shared-content th,.shared-content td").forEach(n=>n.style.borderImageSource="none")')
          const withoutArt=await send('Page.captureScreenshot',{format:'png',clip},sessionId)
          await evaluate('document.querySelectorAll(".shared-content th,.shared-content td").forEach(n=>n.style.borderImageSource="")')
          await writeFile(join(OUT,'shared-table-pencil.png'),Buffer.from(withArt.data,'base64'))
          await writeFile(join(OUT,'shared-table-no-pencil-probe.png'),Buffer.from(withoutArt.data,'base64'))
          check(withArt.data!==withoutArt.data,'shared cell border-image changes actual rendered pixels, beyond computed CSS')
        }
      }
    }
    if(hd&&['error-boundary','toast','pdf'].includes(scene)){
      const selector=scene==='error-boundary'?'.error-card':scene==='toast'?'.notice-toast':'.pdf-progress-card'
      check(await material(selector,'pencil-frame'),scene+' inherits the real pencil perimeter')
      check(await material(selector,'paper-ivory'),scene+' inherits paper texture')
      if(scene==='toast')check(await evaluate('getComputedStyle(document.querySelector(".notice-toast")).backdropFilter==="none"'),'toast no longer uses a glass blur')
    }
    if(scene==='toast'){
      await evaluate('document.querySelector(".notice-toast").firstChild.textContent="https://example.test/"+"LongUnbrokenUploadError".repeat(14)')
      const toast=await evaluate('(()=>{const n=document.querySelector(".notice-toast"),b=n.querySelector("button"),r=n.getBoundingClientRect(),c=b.getBoundingClientRect();return {overflow:n.scrollWidth>n.clientWidth,documentOverflow:document.documentElement.scrollWidth>innerWidth,buttonInside:c.right<=r.right&&c.left>=r.left,box:[r.x,r.y,r.width,r.height],button:[c.x,c.y,c.width,c.height]}})()')
      check(!toast.overflow&&!toast.documentOverflow&&toast.buttonInside,'long unbroken toast stays within its viewport and preserves the close button',toast)
      await capture('toast-long-'+width+'-'+theme+'.png')
    }
    if(hd&&['tree','shared-readonly','pdf','error-boundary'].includes(scene)){
      await send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]},sessionId)
      check(await evaluate('matchMedia("(forced-colors: active)").matches'),'forced-colors media is active in real Chrome')
      if(scene==='tree'||scene==='shared-readonly'){
        const native=await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(scene==='tree'?'.tree-check':'.task-list input[type=checkbox]')})).map(n=>({appearance:getComputedStyle(n).appearance,background:getComputedStyle(n).backgroundImage,checked:n.checked}))`)
        check(native.every(n=>n.appearance!=='none'&&n.background==='none'),'forced-colors checkbox falls back to native appearance',native)
      }else{
        if(scene==='pdf')await evaluate('document.querySelector(".pdf-progress-track i").style.setProperty("--progress","0")')
        const selector=scene==='pdf'?'.pdf-progress-track':'.error-icon'
        const outline=await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(n);return {outline:s.outlineStyle,width:s.outlineWidth,height:n.getBoundingClientRect().height}})()`)
        check(outline.outline!=='none'&&parseFloat(outline.width)>=1&&outline.height>=1,'forced-colors '+scene+' retains a visible outline at zero progress',outline)
      }
      await capture('forced-'+scene+'-'+width+'.png')
      await send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'none'},{name:'prefers-reduced-motion',value:'no-preference'}]},sessionId)
    }
    if(scene==='disabled'){
      const buttons=await evaluate(`Array.from(document.querySelectorAll('button')).map(n=>{const s=getComputedStyle(n),parents=[];for(let p=n.parentElement;p;p=p.parentElement)parents.push(getComputedStyle(p).backgroundColor);return {label:n.textContent,color:s.color,bg:s.backgroundColor,opacity:Number(s.opacity),parents,disabled:n.disabled}})`)
      for(const b of buttons){let parent=[255,255,255,1];for(const color of b.parents.reverse())parent=over(rgb(color),parent);const insideBg=over(rgb(b.bg),parent),insideText=over(rgb(b.color),insideBg),paintBg=over([...insideBg.slice(0,3),b.opacity],parent),paintText=over([...insideText.slice(0,3),b.opacity],parent),a=luminance(paintText),c=luminance(paintBg),ratio=(Math.max(a,c)+.05)/(Math.min(a,c)+.05);report.contrast.push({theme,width,...b,paintBg,paintText,ratio});check(b.disabled&&ratio>=4.5,'disabled label remains readable after alpha/opacity compositing',{theme,width,label:b.label,ratio,color:b.color,bg:b.bg,opacity:b.opacity})}
    }
  }
  const cases=[
    ['recent','.home-empty',['.home-empty','.home-empty .art-icon']],
    ['tree','.tree-check',['.sidebar','.tree-check','.tree-entry']],
    ['slash','.slash-menu',['.slash-menu','.slash-item[aria-selected=true]','.tiptap-content hr']],
    ['disabled','button:disabled',['.confirm-modal','.primary-btn:disabled','.secondary-btn:disabled','.btn-danger:disabled']],
    ['admin-failed','.admin-update-card',['.admin-section','.admin-update-card','.admin-update-icon','.admin-update-copy b','.role-badge','.admin-status','.notice-toast']],
    ['admin-running','.admin-update-card',['.admin-update-icon img','.admin-update-icon svg','.admin-update-copy b']],
    ['login-error','.login-error',['.login-card','.login-card input','.login-error','.login-card::before']],
    ['login-busy','.login-spinner',['.login-spinner','.login-submit']],
    ['search-results','.search-hit',['.search-page','.search-scope button.active','.search-hit','.search-hit .art-icon']],
    ['search-empty','.home-empty',['.home-empty','.search-hero h1']],
    ['shared-readonly','.shared-document-title',['.shared-logo','.shared-content','.shared-document-title','.shared-content blockquote','.shared-content pre','.shared-content table','.shared-content ul.task-list','.shared-badge']],
    ['shared-error','[role=alert]',['.shared-content','.shared-state','.secondary-btn']],
    ['shared-loading','[role=status]',['.shared-state','.login-spinner']],
    ['palette','.command-palette',['.command-palette','.command-backdrop','.command-list button.active']],
    ['error-boundary','.error-card',['.error-card','.error-icon','.error-card pre']],
    ['toast','.notice-toast',['.notice-toast','.notice-toast button']],
    ['pdf','.pdf-progress-card',['.pdf-progress-card','.pdf-progress-track','.pdf-progress']],
  ]
  for(const width of [1280,390]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:900,deviceScaleFactor:1,mobile:false},sessionId)
    for(const [scene,ready,selectors] of cases){
      const boxes=[]
      for(const theme of ['paper','handdrawn']) {
      await send('Page.navigate',{url:origin+'/?scene='+scene},sessionId)
      await until('window.__auditScene==='+JSON.stringify(scene)+'&&Boolean(document.querySelector('+JSON.stringify(ready)+'))')
      await evaluate('document.documentElement.dataset.theme='+JSON.stringify(theme))
      await evaluate('document.fonts.ready');await sleep(700)
      const state=await evaluate(`(()=>{
        const result={};for(const selector of ${JSON.stringify(selectors)}){
          const pseudo=selector.endsWith('::before')?'::before':null,n=document.querySelector(pseudo?selector.slice(0,-8):selector);if(!n){result[selector]=null;continue}
          const s=getComputedStyle(n,pseudo),r=n.getBoundingClientRect();result[selector]={tag:n.tagName,box:[r.x,r.y,r.width,r.height],background:s.backgroundImage,backgroundColor:s.backgroundColor,border:s.border,borderImage:s.borderImageSource,borderRadius:s.borderRadius,shadow:s.boxShadow,backdrop:s.backdropFilter,color:s.color,fontFamily:s.fontFamily,animation:s.animationName,display:s.display,overflowX:n.scrollWidth>n.clientWidth}
        }
        return {styles:result,taskMarkup:document.querySelector('.task-list')?.outerHTML,documentOverflowX:document.documentElement.scrollWidth>innerWidth}
      })()`)
      const geometrySelector={'recent':'.home-dashboard','tree':'.sidebar','disabled':'.confirm-modal','login-busy':'.login-card','shared-loading':'.shared-page'}[scene]||ready
      const box=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(geometrySelector)}).getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`)
      boxes.push(box)
      check(!state.documentOverflowX,'no document-wide horizontal overflow',{scene,width,theme})
      const file='verified-'+scene+'-'+(width===390?'phone':'desktop')+'-'+theme+'.png'
      await capture(file)
      report.states.push({scene,width,theme,file,evidence:scene==='toast'||scene==='pdf'?'exact App markup; copied DOM only':'actual page/component',...state})
      await validate(scene,width,theme)
      }
      const delta=boxes[0].map((value,index)=>Math.abs(value-boxes[1][index]))
      report.geometry.push({scene,width,paper:boxes[0],handdrawn:boxes[1],delta})
      check(delta.every(value=>value<=.15),'both themes retain the same component geometry',{scene,width,delta})
      console.log('verified '+scene+' '+width)
    }
  }
  await writeFile(join(OUT,'verification.json'),JSON.stringify(report,null,2)+'\n')
  console.log('Audit fixes verified: '+report.states.length+' themed states, '+report.geometry.length+' geometry pairs, '+report.checks.length+' checks in '+OUT)
} catch(error) {
  report.failure=error.stack||String(error)
  await writeFile(join(OUT,'verification.json'),JSON.stringify(report,null,2)+'\n')
  throw error
} finally {
  socket?.close();if(chrome){const stopped=new Promise(done=>chrome.once('exit',done));chrome.kill();await Promise.race([stopped,sleep(2500)])}
  server?.closeAllConnections();if(server)await new Promise(done=>server.close(done))
  assert.equal(dirname(resolve(work)),resolve(tmpdir()));assert.ok(basename(work).startsWith('mdocs-audit-fixes-'))
  await rm(work,{recursive:true,force:true,maxRetries:5,retryDelay:200})
}
