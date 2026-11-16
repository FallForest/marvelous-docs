import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const MENUS = [
  ['paragraph','[aria-label="段落样式"]','.popover[aria-label="段落样式"]'],
  ['font-size','[aria-label="字号"]','.popover[aria-label="字号"]'],
  ['alignment','[aria-label="对齐方式"]','.popover[aria-label="对齐方式"]'],
  ['color','[aria-label="文字颜色"]','.popover[aria-label="文字颜色"]'],
  ['highlight','[aria-label="高亮"]','.popover[aria-label="高亮颜色"]'],
  ['insert','[aria-label="更多插入"]','.popover[aria-label="插入"]'],
]

export async function verifyMotion({evaluate,send,sessionId,key,scene,setViewport,screenshot,OUT,baseline}) {
  const runs=[],resizes=[],layout=[],failures=[]
  const check=(passed,message,data)=>{if(!passed)failures.push({message,...data})}
  const sample=async(trigger,selector)=>evaluate(`new Promise((resolve,reject)=>{
    const frames=[],start=performance.now();let first=null;
    const tick=now=>{
      const n=document.querySelector(${JSON.stringify(selector)});
      if(n){
        first??=now;
        const r=n.getBoundingClientRect(),s=getComputedStyle(n),rows=[...n.querySelectorAll('.tb-menu-item')];
        frames.push({at:now-first,clientHeight:n.clientHeight,scrollHeight:n.scrollHeight,clientWidth:n.clientWidth,scrollWidth:n.scrollWidth,offsetWidth:n.offsetWidth,width:r.width,height:r.height,top:r.top,bottom:r.bottom,transform:s.transform,maxHeight:s.maxHeight,overflowX:s.overflowX,overflowY:s.overflowY,lastRowTransform:rows.length?getComputedStyle(rows[rows.length-1]).transform:null});
      }
      if(first!==null&&now-first>=600){resolve(frames);return}
      if(now-start>3000){reject(new Error('Popover never mounted'));return}
      requestAnimationFrame(tick)
    };
    requestAnimationFrame(tick);
    ${trigger?'const trigger=document.querySelector('+JSON.stringify(trigger)+');trigger.focus();trigger.click();':''}
  })`)
  for(const reduced of (baseline?[false]:[false,true])) {
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:reduced?'reduce':'no-preference'}]},sessionId)
    for(const zoom of (baseline?[1]:[1,1.25,1.5,2])) {
      await evaluate(`document.documentElement.style.zoom=${zoom}`)
      for(const height of (baseline?[900]:[900,320])) {
        await setViewport(1600,height)
        await scene('editor')
        for(const [name,trigger,selector] of MENUS) {
          const frames=await sample(trigger,selector)
          const overflow=frames.filter(frame=>frame.scrollHeight>frame.clientHeight||frame.scrollWidth>frame.clientWidth)
          const run={name,reduced,zoom,height,frames,overflowFrames:overflow.length}
          runs.push(run)
          if(height===900&&overflow.length)failures.push({name,reduced,zoom,height,overflowFrames:overflow.length,first:overflow[0],last:overflow[overflow.length-1]})
          if(!baseline) {
            const last=frames.at(-1)
            check(frames.at(-1).at>=600,'full animation window sampled',{name,reduced,zoom,height})
            check(frames.every(frame=>frame.scrollWidth<=frame.clientWidth),'no horizontal menu scroll',{name,reduced,zoom,height})
            if(height===900)check(Math.max(...frames.map(frame=>frame.offsetWidth))-Math.min(...frames.map(frame=>frame.offsetWidth))<=1,'layout width stable during animation',{name,reduced,zoom,height})
            else if(last.scrollHeight<=last.clientHeight)check(overflow.length===0,'fitting short-space menu never flashes a scrollbar',{name,reduced,zoom,height,overflowFrames:overflow.length})
            if(!reduced&&zoom===1&&name==='font-size')await screenshot(height===900?'menu-size-normal':'menu-size-short')
            if(height===320) {
              const observed=sample(null,selector)
              await setViewport(1600,900)
              const grown=await observed
              const normal=runs.find(item=>item.name===name&&item.zoom===zoom&&item.reduced===reduced&&item.height===900).frames.at(-1)
              const restored=grown.at(-1)
              resizes.push({name,reduced,zoom,short:last,normal,frames:grown})
              check(Math.abs(normal.clientHeight-restored.clientHeight)<=1,'resize restores the natural menu height',{name,reduced,zoom,normal:normal.clientHeight,restored:restored.clientHeight})
              check(restored.scrollHeight<=restored.clientHeight,'restored tall menu does not scroll',{name,reduced,zoom,restored})
              await setViewport(1600,320)
            }
          }
          await key('Escape')
        }
      }
      console.log('motion sampled: reduced='+reduced+', zoom='+zoom+', runs='+runs.length)
    }
  }
  if(!baseline) {
    await evaluate("document.documentElement.style.zoom=1")
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]},sessionId)
    for(const [width,height] of [[1280,900],[800,900],[390,844]]) {
      await setViewport(width,height)
      await scene('documents')
      await evaluate('document.fonts.ready')
      for(const theme of ['paper','handdrawn']) {
        await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
        const star=await evaluate(`(()=>{const node=document.querySelector('.document-list-star'),art=node.querySelector('.art-icon'),img=art.querySelector('img'),row=node.closest('button');const box=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {node:box(node),art:box(art),image:box(img),row:box(row),visible:getComputedStyle(node).display!=='none',fallback:getComputedStyle(art.querySelector('.art-icon-fallback')).display}})()`)
        layout.push({kind:'favorite-star',width,height,theme,...star})
        if(width>560) {
          check(star.visible,'favorite star visible on desktop/tablet',{width,theme,star})
          check(Math.abs(star.art.width-18)<.1&&Math.abs(star.art.height-18)<.1,'favorite artwork has its 18px slot',{width,theme,star})
          check(Math.abs(star.node.x+star.node.width/2-star.art.x-star.art.width/2)<.1&&Math.abs(star.node.y+star.node.height/2-star.art.y-star.art.height/2)<.1,'favorite artwork centered in slot',{width,theme,star})
          check(Math.abs(star.node.y+star.node.height/2-star.row.y-star.row.height/2)<.1,'favorite slot centered in row',{width,theme,star})
          if(theme==='paper')check(star.fallback!=='none','paper theme keeps star fallback',{width,theme,star})
        } else check(!star.visible,'phone favorite slot follows shared compact layout',{width,theme,star})
        await screenshot((width===390?'phone':width===800?'tablet':'desktop')+'-document-list-'+theme)
      }
      await scene('history')
      for(let i=0;i<70;i++){if(await evaluate('document.querySelectorAll(".history-entry").length>=4'))break;await new Promise(done=>setTimeout(done,100))}
      for(const theme of ['paper','handdrawn']) {
        await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
        const history=await evaluate(`(()=>{const p=document.querySelector('.history-panel'),rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {panel:rect(p),overflowX:p.scrollWidth>p.clientWidth,rows:[...p.querySelectorAll('.history-entry')].map(n=>{const a=n.querySelector('.history-avatar'),c=n.querySelector('.history-entry-copy'),s=getComputedStyle(n),b=n.querySelector('button.history-snapshot');return {classes:n.className,tag:n.tagName,box:rect(n),avatar:rect(a),copy:rect(c),direction:s.flexDirection,borderImage:s.borderImageSource,background:s.backgroundImage,card:b?{tag:b.tagName,box:rect(b),borderImage:getComputedStyle(b).borderImageSource,hasAccessibleName:Boolean(b.getAttribute('aria-label'))}:null}})}})()`)
        layout.push({kind:'history',width,height,theme,...history})
        check(history.rows.length>=4,'mixed snapshot and event fixture loaded',{width,theme,history})
        check(!history.overflowX,'history fits its horizontal panel',{width,theme,history})
        for(const row of history.rows) {
          check(row.tag==='LI'&&row.direction==='row','timeline entry remains a horizontal list row',{width,theme,row})
          check(!row.classes.split(' ').includes('history-snapshot'),'timeline row does not inherit snapshot button class',{width,theme,row})
          check(row.borderImage==='none'&&row.background==='none','snapshot card material only paints its button',{width,theme,row})
          check(Math.abs(row.avatar.width-27)<.1&&Math.abs(row.avatar.height-27)<.1,'history avatar retains its 27px slot',{width,theme,row})
          check(Math.abs(row.copy.x-row.avatar.x-row.avatar.width-10)<.1,'history text has a stable gap after avatar',{width,theme,row})
          if(row.card)check(row.card.tag==='BUTTON'&&row.card.hasAccessibleName,'snapshot card remains an accessible button',{width,theme,row})
        }
        await screenshot((width===390?'phone':width===800?'tablet':'desktop')+'-history-'+theme)
      }
    }
  }
  await writeFile(join(OUT,baseline?'motion-baseline.json':'motion-verification.json'),JSON.stringify({runs,resizes,layout,failures},null,2)+'\n')
  console.log(JSON.stringify({mode:baseline?'baseline':'motion',runs:runs.length,resizes:resizes.length,layouts:layout.length,failures},null,2))
  if(!baseline)assert.equal(failures.length,0,'normal-space menus must never need a transient scrollbar')
}
