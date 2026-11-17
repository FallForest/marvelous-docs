/** Real new document actions, metadata, selected-image tools and upload widgets. */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function verifyNewControls({evaluate,key,scene,setViewport,screenshot,compare,click,until,OUT,requireNewMaterials=false}) {
  const details=[]
  const bothShots=async name=>{
    for(const theme of ['paper','handdrawn']) {
      await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
      await screenshot(name+'-'+theme)
    }
  }
  const loaded=async(selector,names)=>{
    for(const name of names)await until(`(()=>{const n=document.querySelector(${JSON.stringify(selector+' img[src$="/'+name+'.webp"]')});return n?.complete&&n.naturalWidth>0&&!n.closest('[data-art-failed]')})()`)
    const icons=await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector+' .art-icon img')})).map(n=>({source:n.getAttribute('src'),loaded:n.complete&&n.naturalWidth>0,failed:Boolean(n.closest('[data-art-failed]')),width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}))`)
    assert.ok(icons.every(icon=>icon.loaded&&!icon.failed),'all '+selector+' icons load without fallback')
    return icons
  }
  for(const [width,height] of [[1280,900],[390,844]]) {
    const prefix=width===390?'phone':'desktop'
    await setViewport(width,height)
    await scene('document-menu')
    await click('[aria-label="更多文档操作"]')
    await until('Boolean(document.querySelector(".document-menu"))')
    const icons=await loaded('.document-menu',['print','move','info'])
    await compare(prefix+'-document-menu','.document-menu')
    if(requireNewMaterials) {
      const material=await evaluate(`(async()=>{
        const background=getComputedStyle(document.querySelector('.document-menu .menu-heading')).backgroundImage
        const loaded=await new Promise(resolve=>{const img=new Image();img.onload=()=>resolve({source:img.src,width:img.naturalWidth,height:img.naturalHeight});img.onerror=()=>resolve(null);img.src='/art/handdrawn-v1/decor/index-tab-blue.webp'})
        return {background,loaded}
      })()`)
      assert.ok(material.background.includes('index-tab-blue.webp'),'menu group heading uses the new AI paper tab')
      assert.ok(material.loaded?.width>0&&material.loaded.height>0,'new AI paper tab loads in Chrome')
      details.push({name:prefix+'-menu-material',...material})
    }
    await bothShots(prefix+'-document-menu')
    details.push({name:prefix+'-document-menu',icons})

    await click('.document-menu button:has(img[src$="/info.webp"])')
    await until('Boolean(document.querySelector(".document-info"))')
    await loaded('.confirm-modal',['info','document'])
    await compare(prefix+'-document-info-dialog','.confirm-modal')
    await compare(prefix+'-document-info-panel','.document-info')
    const info=await evaluate(`(()=>{
      const panel=document.querySelector('.document-info'),id=panel.querySelector('.document-info-id'),range=document.createRange();range.selectNodeContents(id);
      const row=id.parentElement,dt=row.querySelector('dt'),r=id.getBoundingClientRect(),p=panel.getBoundingClientRect(),t=dt.getBoundingClientRect();
      return {text:id.textContent,textLength:id.textContent.length,lineCount:range.getClientRects().length,userSelect:getComputedStyle(id).userSelect,overflowX:panel.scrollWidth>panel.clientWidth,idOverflowX:id.scrollWidth>id.clientWidth,idBox:[r.x,r.y,r.width,r.height],panelBox:[p.x,p.y,p.width,p.height],labelRight:t.right}
    })()`)
    assert.ok(info.textLength>=160,'metadata fixture includes a long unbroken document id')
    assert.ok(info.lineCount>=2,'long document id wraps across lines')
    assert.equal(info.userSelect,'text','document id remains selectable')
    assert.equal(info.overflowX,false,'metadata panel has no horizontal overflow')
    assert.equal(info.idOverflowX,false,'metadata id wraps without a horizontal scroller')
    assert.ok(info.idBox[0]>=info.labelRight+7,'metadata values have their own column')
    assert.ok(info.idBox[0]+info.idBox[2]<=info.panelBox[0]+info.panelBox[2]+1,'metadata id stays within panel')
    details.push({name:prefix+'-document-info',...info})
    await bothShots(prefix+'-document-info')
    await key('Escape')
    await until('!document.querySelector("[role=dialog]")')

    await scene('document-menu')
    await click('[aria-label="更多文档操作"]')
    await click('.document-menu button:has(img[src$="/move.webp"])')
    await until('Boolean(document.querySelector(".move-modal"))')
    await loaded('.move-modal',['move'])
    await compare(prefix+'-move-dialog','.move-modal')
    await bothShots(prefix+'-move-dialog')
    await scene('editor')

    await evaluate('window.__showImage()')
    await until('Boolean(document.querySelector(".block-tool-iconbar"))')
    await until('Boolean(document.querySelector(".tiptap-content img")?.complete&&document.querySelector(".tiptap-content img")?.naturalWidth)')
    assert.equal(await evaluate('window.__editor.state.selection.node?.type.name'),'image','the image toolbar is driven by a real node selection')
    await compare(prefix+'-image-toolbar','.block-tool-iconbar')
    assert.ok(await evaluate('getComputedStyle(document.querySelector(".block-tool-iconbar")).borderImageSource.includes("menu-paper.webp")'),'selected image toolbar uses the AI paper surface')
    await click('.block-tool-iconbar [aria-label="宽度 小"]')
    assert.equal(await evaluate('window.__editor.state.selection.node.attrs.width'),'35%','size preset updates the selected image')
    await click('.block-tool-iconbar [aria-label="居中"]')
    assert.equal(await evaluate('window.__editor.state.selection.node.attrs.textAlign'),'center','alignment updates the selected image')
    assert.ok(await evaluate('getComputedStyle(document.querySelector(".block-tool-iconbar [aria-pressed=true]")).backgroundImage.includes("marker-sage.webp")'),'active image preset uses marker material')
    await bothShots(prefix+'-image-toolbar')
    await evaluate('window.__editor.chain().focus().setTextSelection(1).run()')
    await until('!document.querySelector(".block-tool-iconbar")')
    await evaluate('window.__showImage()')
    await until('Boolean(document.querySelector(".block-tool-iconbar"))')
    await click('.block-tool-iconbar [aria-label="删除图片"]')
    await until('!document.querySelector(".block-tool-iconbar")')
    assert.equal(await evaluate('Boolean(document.querySelector(".tiptap-content img"))'),false,'deleting the selected image removes its toolbar and node')

    await evaluate('window.__showUpload()')
    await until('Boolean(document.querySelector(".upload-placeholder:not(.is-error)"))')
    await compare(prefix+'-upload-loading','.upload-placeholder')
    assert.equal(await evaluate('document.querySelector(".upload-placeholder").getAttribute("role")'),'status','upload placeholder is an announced status')
    assert.ok(await evaluate('getComputedStyle(document.querySelector(".upload-placeholder")).borderImageSource.includes("pencil-frame.webp")'),'upload reservation has a pencil perimeter')
    assert.equal(await evaluate('JSON.stringify(window.__editor.getJSON())===window.__uploadBody'),true,'upload decoration never enters the document body')
    await bothShots(prefix+'-upload-loading')
    await evaluate('window.__failUpload()')
    await until('Boolean(document.querySelector(".upload-placeholder.is-error .upload-placeholder-retry"))')
    await compare(prefix+'-upload-error','.upload-placeholder.is-error')
    await key('Tab')
    await evaluate('document.querySelector(".upload-placeholder-retry").focus()')
    /*
     * Whether a programmatic `.focus()` counts as keyboard focus is Chrome's
     * heuristic (`:focus-visible` depends on the last input modality), and it
     * disagreed between a local window and CI's headless run. Asserting on it made
     * a correct stylesheet look broken.
     *
     * What the product actually promises is that a keyboard-focused retry button
     * has a visible ring: that is a rule in the sheet, so the sheet is what gets
     * checked - plus the ordinary focus state, which is deterministic.
     */
    const upload=await evaluate(`(()=>{const p=document.querySelector('.upload-placeholder'),retry=p.querySelector('button'),r=p.getBoundingClientRect(),s=getComputedStyle(retry);
      const rules=[...document.styleSheets].flatMap(sheet=>{try{return [...sheet.cssRules]}catch{return []}});
      const ring=rules.some(rule=>rule.selectorText&&/\.upload-placeholder-retry:focus-visible/.test(rule.selectorText)&&/outline/.test(rule.style?.cssText||''));
      return {state:window.__uploadState(),box:[r.x,r.y,r.width,r.height],retryFocused:document.activeElement===retry,keyboardRing:ring,outlineStyle:s.outlineStyle,overflowX:p.scrollWidth>p.clientWidth}})()`)
    assert.equal(upload.retryFocused,true,'retry button receives keyboard focus')
    assert.equal(upload.keyboardRing,true,'retry has a declared keyboard focus ring')
    assert.equal(upload.overflowX,false,'upload error stays within its paper slip')
    details.push({name:prefix+'-upload-error',...upload})
    await bothShots(prefix+'-upload-error')
    await click('.upload-placeholder-retry')
    await until('Boolean(document.querySelector(".upload-placeholder:not(.is-error)"))')
    assert.equal(await evaluate('window.__retriedUpload'),'skin-upload','retry routes the original reservation id through its real plugin callback')
    assert.equal(await evaluate('window.__uploadState().entries.length'),1,'retry replaces the reservation instead of duplicating it')
    assert.equal(await evaluate('JSON.stringify(window.__editor.getJSON())===window.__uploadBody'),true,'retry keeps the saved document body unchanged')
    await bothShots(prefix+'-upload-retrying')
  }
  await writeFile(join(OUT,'new-controls-verification.json'),JSON.stringify({fixture:'actual components and upload-placeholder plugin; no workspace database',details},null,2)+'\n')
  console.log('New document actions, long-id metadata, selected-image tools and real upload/retry widgets verified at desktop and phone sizes')
}
