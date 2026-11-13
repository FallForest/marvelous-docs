import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9451
const proc = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=' + PORT,'--user-data-dir=C:\\Windows\\Temp\\dsh-rt2','--window-size=1600,900','about:blank'], { stdio: 'ignore' })
await new Promise(r => setTimeout(r, 3500))
const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()
const page = targets.find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise(r => ws.addEventListener('open', r))
const send = (method, params) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })) })
const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined }
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync('./app-stub.js', 'utf8') })
await send('Page.navigate', { url: 'http://127.0.0.1:4450/' })
await new Promise(r => setTimeout(r, 5500))
const trace = await evalJs(`(async () => {
  const rows = [...document.querySelectorAll('.tree-doc')].filter(b => !b.className.includes('tree-folder'));
  const out = [];
  const t0 = performance.now();
  rows[1].click();
  for (let i = 0; i < 30; i++) {
    await new Promise(r => requestAnimationFrame(() => r()));
    const root = document.documentElement;
    const col = document.querySelector('.editor-column');
    out.push({ t: Math.round(performance.now() - t0),
      flag: root.getAttribute('data-vt-swapping') !== null,
      vt: root.matches(':active-view-transition'),
      colOpacity: col ? getComputedStyle(col).opacity : null,
      colMatches: col ? col.matches(".workspace-content .motion-enter") : null,
      colAnim: col ? getComputedStyle(col).animationName : null });
  }
  return out;
})()`);
for (const s of trace) console.log(String(s.t).padStart(4), 'flag=' + (s.flag ? 'Y' : 'n'), 'vt=' + (s.vt ? 'Y' : 'n'), 'matches=' + (s.colMatches ? 'Y' : 'n'), String(s.colOpacity).padEnd(9), s.colAnim || '-');
proc.kill()