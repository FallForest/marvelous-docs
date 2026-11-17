/** Read-only visual audit: actual pages, isolated HTTP responses, no workspace DB. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { servePublicArt } from './public-art.mjs'

const WEB=resolve(import.meta.dirname,'../../apps/web')
const OUT=resolve(import.meta.dirname,'../../docs/design/handdrawn-v1/audit-v13')
const {build}=createRequire(join(WEB,'package.json'))('esbuild')
const work=await mkdtemp(join(tmpdir(),'mdocs-pages-audit-'))
const sleep=ms=>new Promise(done=>setTimeout(done,ms))
const report={fixture:'Actual page components and ErrorBoundary; isolated HTTP shared-document fixture. Toast/PDF are exact App.tsx markup with fixed data, not an export or notification operation.',states:[],requests:[]}
let chrome,socket,server
try {
  await mkdir(OUT,{recursive:true})
  await build({stdin:{resolveDir:WEB,loader:'tsx',contents:`
    import {useEffect,useState} from 'react'
    import {createRoot} from 'react-dom/client'
    import {X} from 'lucide-react'
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
    function Home(){return <div className="app-shell" style={{height:'100dvh'}}><main className="main-area"><HomeDashboard documents={docs} favorites={new Set(['audit-doc'])} query="" trash={false} favoritesView={false} recentView={false} stats={{documents:1,folders:1,members:2,openComments:1,trashed:0}} onOpen={noop} onCreate={noop} onImport={noop} onCreateFolder={noop} onRestore={async()=>{}} onPermanentDelete={async()=>{}} onEmptyTrash={noop}/></main></div>}
    function Harness(){
      const scene=new URLSearchParams(location.search).get('scene')||'admin-failed'
      const [scope,setScope]=useState('all'),[index,setIndex]=useState(2)
      useEffect(()=>{window.__auditScene=scene},[scene])
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
    {type:'taskList',content:[{type:'taskItem',attrs:{checked:true},content:[p('确认需求：已经完成')]},{type:'taskItem',attrs:{checked:false},content:[p('交互方案：等待补充')]}]},
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
  const cases=[
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
      if(width===390&&!['admin-failed','login-error','search-results','shared-readonly','error-boundary','toast'].includes(scene))continue
      await send('Page.navigate',{url:origin+'/?scene='+scene},sessionId)
      await until('window.__auditScene==='+JSON.stringify(scene)+'&&Boolean(document.querySelector('+JSON.stringify(ready)+'))')
      await evaluate('document.fonts.ready');await sleep(700)
      const state=await evaluate(`(()=>{
        const result={};for(const selector of ${JSON.stringify(selectors)}){
          const pseudo=selector.endsWith('::before')?'::before':null,n=document.querySelector(pseudo?selector.slice(0,-8):selector);if(!n){result[selector]=null;continue}
          const s=getComputedStyle(n,pseudo),r=n.getBoundingClientRect();result[selector]={tag:n.tagName,box:[r.x,r.y,r.width,r.height],background:s.backgroundImage,backgroundColor:s.backgroundColor,border:s.border,borderImage:s.borderImageSource,borderRadius:s.borderRadius,shadow:s.boxShadow,backdrop:s.backdropFilter,color:s.color,fontFamily:s.fontFamily,animation:s.animationName,display:s.display,overflowX:n.scrollWidth>n.clientWidth}
        }
        return {styles:result,taskMarkup:document.querySelector('.task-list')?.outerHTML,documentOverflowX:document.documentElement.scrollWidth>innerWidth}
      })()`)
      const file='pages-'+scene+'-'+(width===390?'phone':'desktop')+'.png'
      const metrics=await send('Page.getLayoutMetrics',{},sessionId),size=metrics.cssContentSize
      const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:Math.ceil(size.width),height:Math.min(1800,Math.ceil(size.height)),scale:1}},sessionId)
      await writeFile(join(OUT,file),Buffer.from(shot.data,'base64'))
      report.states.push({scene,width,file,evidence:scene==='toast'||scene==='pdf'?'exact App markup; copied DOM only':'actual page/component',...state})
      console.log('audited '+scene+' '+width)
    }
  }
  await writeFile(join(OUT,'pages-visual-evidence.json'),JSON.stringify(report,null,2)+'\n')
  console.log('Read-only pages audit captured '+report.states.length+' states in '+OUT)
} finally {
  socket?.close();if(chrome){const stopped=new Promise(done=>chrome.once('exit',done));chrome.kill();await Promise.race([stopped,sleep(2500)])}
  server?.closeAllConnections();if(server)await new Promise(done=>server.close(done))
  assert.equal(dirname(resolve(work)),resolve(tmpdir()));assert.ok(basename(work).startsWith('mdocs-pages-audit-'))
  await rm(work,{recursive:true,force:true,maxRetries:5,retryDelay:200})
}
