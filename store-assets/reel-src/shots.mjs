/* Capture phone screenshots of the LIVE storefront over CDP.
   Usage: node shots.mjs --port 9333 --out assets/shots --dpr 3 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const PORT = arg('port', '9333');
const OUT  = arg('out', 'assets/shots');
const DPR  = +arg('dpr', '3');
const W = +arg('w', '390'), H = +arg('h', '844');
const BASE = arg('base', 'https://lolo-shop96.com');

const PAGES = JSON.parse(fs.readFileSync(arg('pages', 'shots.json'), 'utf8'));

fs.mkdirSync(OUT, { recursive: true });
const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});
await new Promise(r => ws.addEventListener('open', r));
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const _id = ++id; pending.set(_id, { res, rej });
  ws.send(JSON.stringify({ id: _id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable');
await S('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: true,
  screenOrientation: { angle: 0, type: 'portraitPrimary' } });
await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await S('Network.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });

/* Present as the native app shell. lib/app-gate.ts bounces any mobile *browser*
   to the store listing, and the storefront renders its native chrome (tab bar,
   safe areas) only when one of the two native signals is present. Setting
   window.androidBridge at document start is exactly that signal, so these shots
   are the real in-app UI rather than the web fallback. */
await S('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.androidBridge = window.androidBridge || {};
  try {
    localStorage.setItem('loloshop_web_ok','1');
    localStorage.setItem('loloshop_profile', JSON.stringify({name:null,gender:'female',seen:true}));
    sessionStorage.setItem('loloshop_discount_popup_seen','1');
    sessionStorage.setItem('loloshop_splash_seen','1');
  } catch(e) {}
  /* freeze motion so a frame is never caught mid-transition */
  const st = document.createElement('style');
  st.textContent = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
` });

const withTimeout = (pr, ms, what) => Promise.race([pr, new Promise((_,rj)=>setTimeout(()=>rj(new Error('timeout: '+what)), ms))]);
const evalJs = async expr => (await S('Runtime.evaluate',
  { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

for (const p of PAGES) {
  const url = BASE + p.path;
  process.stderr.write(`→ ${p.name} ${url}\n`);
  await withTimeout(S('Page.navigate', { url }), 45000, 'navigate ' + p.name);
  await sleep(p.wait ?? 3500);
  if (p.scroll) { await evalJs(`window.scrollTo({top:${p.scroll},behavior:'instant'});1`); await sleep(900); }
  if (p.js)     { await evalJs(p.js); await sleep(p.jsWait ?? 1200); }
  // let images settle (bounded — a lazy image that never loads must not stall the run)
  await evalJs(`(async()=>{try{await Promise.race([
      Promise.all([...document.images].filter(i=>!i.complete).map(i=>new Promise(r=>{i.onload=i.onerror=r}))),
      new Promise(r=>setTimeout(r,4000))]);}catch(e){} return 1})()`);
  await sleep(700);
  if (p.measure) console.log('   measure', p.name, JSON.stringify(await evalJs(p.measure)));
  if (p.hideSel) {
    await evalJs(`(()=>{document.querySelectorAll(${JSON.stringify(p.hideSel)}).forEach(e=>e.style.visibility='hidden');return 1})()`);
    await sleep(300);
  }
  const shot = { format: 'png', fromSurface: true, captureBeyondViewport: false };
  if (p.clipH) {                       // tall strip for an in-phone scroll
    Object.assign(shot, { captureBeyondViewport: true,
      clip: { x: 0, y: p.clipY ?? 0, width: W, height: p.clipH, scale: DPR } });
  }
  const { data } = await S('Page.captureScreenshot', shot);
  fs.writeFileSync(path.join(OUT, p.name + '.png'), Buffer.from(data, 'base64'));
  const title = await evalJs('document.title');
  console.log('✔', p.name, '←', url, '|', title);
}
await send('Target.closeTarget', { targetId });
ws.close();
