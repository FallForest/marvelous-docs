import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9450
const proc = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=' + PORT,'--user-data-dir=C:\\Windows\\Temp\\dsh-rt','--window-size=1600,900','about:blank'], { stdio: 'ignore' })
await new Promise(r => setTimeout(r, 3500))
const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()
const page = targets.find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise(r => ws.addEventListener('open', r))
const send = (method, params) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })) })
const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) console.log('ERR', String(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description).slice(0,200)); return r.result && r.result.result ? r.result.result.value : undefined }
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync('./app-stub.js', 'utf8') })
await send('Page.navigate', { url: 'http://127.0.0.1:4450/' })
await new Promise(r => setTimeout(r, 5500))

const ready = await evalJs('({ rows: document.querySelectorAll(".tree-doc").length, col: !!document.querySelector(".editor-column") })')
console.log('READY', JSON.stringify(ready))

// Frame-by-frame: which animations run, and what opacity the canvas has.
const trace = await evalJs(`(async () => {
  const rows = [...document.querySelectorAll('.tree-doc')].filter(b => !b.className.includes('tree-folder'))
  if (rows.length < 2) return { error: 'need 2 rows', got: rows.length }
  const out = [];
  const t0 = performance.now();
  rows[1].click();
  for (let i = 0; i < 40; i++) {
    await new Promise(r => requestAnimationFrame(() => r()));
    const col = document.querySelector('.editor-column');
    const wc = document.querySelector('.workspace-content');
    out.push({
      t: Math.round(performance.now() - t0),
      colOpacity: col ? getComputedStyle(col).opacity : null,
      colAnim: col ? getComputedStyle(col).animationName : null,
      wcOpacity: wc ? getComputedStyle(wc).opacity : null,
      anims: [...document.getAnimations()].filter(a => a.animationName && a.animationName.indexOf('-ua-') !== 0).map(a => a.animationName + '@' + (a.effect && a.effect.target && a.effect.target.className || '').toString().slice(0,22)).join(' | '),
    });
  }
  return out;
})()`);

if (trace && trace.error) { console.log('TRACE', JSON.stringify(trace)) } else {
  const dips = trace.filter(s => s.colOpacity !== null && parseFloat(s.colOpacity) < 0.99);
  console.log('FRAMES', trace.length, 'DIPS', dips.length);
  for (const s of trace.slice(0, 22)) console.log(String(s.t).padStart(4), String(s.colOpacity).padEnd(9), (s.colAnim || '-').padEnd(14), (s.anims || '').slice(0, 90));
}
proc.kill()