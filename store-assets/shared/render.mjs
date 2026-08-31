import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const PORT = arg('port', '9333');
const URL_ = arg('url', 'http://127.0.0.1:8899/index.html');
const OUT  = arg('out', './frames');
const ONLY = arg('only', '');            // comma list of times (probe mode)
const FPS  = +arg('fps', '30');
const DUR  = +arg('dur', '16');
const FMT  = arg('fmt', 'png');
const Q    = +arg('q', '95');

fs.mkdirSync(OUT, { recursive: true });

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
});
await new Promise(r => ws.addEventListener('open', r));
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const _id = ++id; pending.set(_id, { res, rej });
  ws.send(JSON.stringify({ id: _id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);

await S('Page.enable');
await S('Runtime.enable');
await S('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });
await S('Page.navigate', { url: URL_ });

// wait for fonts + images
const evalJs = async expr => (await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const t0 = Date.now();
while (Date.now() - t0 < 30000) {
  const ok = await evalJs(`(()=>{try{return !!window.__ready && [...document.images].every(i=>i.complete&&i.naturalWidth>0)}catch(e){return false}})()`);
  if (ok) break;
  await new Promise(r => setTimeout(r, 150));
}
const meta = await evalJs('JSON.stringify(window.__meta||{})');
console.log('page ready. meta =', meta);

const times = ONLY
  ? ONLY.split(',').map(Number).map((t, i) => [i, t])
  : Array.from({ length: Math.round(DUR * FPS) }, (_, i) => [i, i / FPS]);

let n = 0; const start = Date.now();
for (const [i, t] of times) {
  await evalJs(`window.__seek(${t});"ok"`);
  const shotOpts = { format: FMT, captureBeyondViewport: false, fromSurface: true };
  if (FMT === 'jpeg') shotOpts.quality = Q;
  const { data } = await S('Page.captureScreenshot', shotOpts);
  fs.writeFileSync(path.join(OUT, String(i).padStart(5, '0') + '.' + (FMT === 'jpeg' ? 'jpg' : 'png')), Buffer.from(data, 'base64'));
  n++;
  if (n % 30 === 0 || n === times.length) {
    const el = (Date.now() - start) / 1000;
    process.stdout.write(`\r  ${n}/${times.length} frames  ${el.toFixed(1)}s  (${(n / el).toFixed(1)} fps)   `);
  }
}
console.log(`\ndone: ${n} frames -> ${OUT}`);
await send('Target.closeTarget', { targetId });
ws.close();
