'use strict';
// SmartAPI as the calligraphy provider (2026-09-26); OpenRouter only when CALLIG_FALLBACK=openrouter
// (owner 2026-09-29: «smartapi وبس»).
// No DB, no real network: global.fetch is stubbed per test and nothing is billed.
process.env.SMARTAPI_RETRIES = '1';
process.env.SMARTAPI_BACKOFF_MS = '1';
process.env.SMARTAPI_KEY = process.env.SMARTAPI_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const smartapi = require('../lib/smartapi');
const provider = require('../lib/calligraphyProvider');

async function pngB64() {
  const buf = await sharp({ create: { width: 200, height: 80, channels: 3, background: '#fff' } })
    .composite([{ input: Buffer.from('<svg width="200" height="80"><rect x="40" y="20" width="120" height="40" fill="#000"/></svg>') }])
    .png().toBuffer();
  return buf.toString('base64');
}

function stubFetch(handler) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: String(url), body });
    return handler(String(url), body);
  };
  return { calls, restore: () => { global.fetch = original; } };
}
const json = (status, obj) => ({ ok: status < 400, status, text: async () => JSON.stringify(obj), json: async () => obj });

const imageOk = (b64) => json(200, { output: [{ type: 'image_generation_call', result: b64 }], usage: { total_tokens: 30000 } });

test.beforeEach(() => { process.env.CALLIG_MIN_MARKS = '0'; });
test.after(() => { delete process.env.CALLIG_MIN_MARKS; });

test('a thin pass 2 is re-drawn up to the try limit and the plate still ships', async (t) => {
  const f = stubFetch(async () => imageOk(await pngB64())); // a blank pixel: zero marks, always thin
  t.after(f.restore);
  process.env.CALLIG_PROVIDER = 'smartapi';
  process.env.CALLIG_MIN_MARKS = '5';
  process.env.CALLIG_ORNAMENT_TRIES = '3';
  t.after(() => { process.env.CALLIG_MIN_MARKS = '0'; delete process.env.CALLIG_ORNAMENT_TRIES; });
  const out = await provider.generatePlate({ text: 'رتاج', variant: 'front', ornament: 'medium' });
  assert.equal(f.calls.length, 4, 'letters pass + three ornament draws');
  assert.ok(out.buffer.length > 0, 'a thin plate still ships — it is never lost');
});

test('a customer photo as the style reference is not held to the shop density bar', async (t) => {
  const f = stubFetch(async () => imageOk(await pngB64()));
  t.after(f.restore);
  process.env.CALLIG_PROVIDER = 'smartapi';
  process.env.CALLIG_MIN_MARKS = '5';
  t.after(() => { process.env.CALLIG_MIN_MARKS = '0'; });
  await provider.generatePlate({ text: 'رتاج', variant: 'front', ornament: 'medium', reference: await Buffer.from(await pngB64(), 'base64') });
  assert.equal(f.calls.length, 2, 'letters + ONE ornament draw');
  const imgs = f.calls[1].body.input[0].content.filter((c) => c.type === 'input_image').length;
  assert.equal(imgs, 2, 'letters + the customer photo only — never the shop plates');
});

test('pass 1 re-inks the typeset name (IMAGE 1) with the style plate (IMAGE 2); pass 2 only decorates', async (t) => {
  const b64 = await pngB64();
  const f = stubFetch(() => imageOk(b64));
  t.after(f.restore);
  process.env.CALLIG_PROVIDER = 'smartapi';
  const out = await provider.generatePlate({ text: 'رتاج', variant: 'front', ornament: 'medium' });
  assert.equal(out.provider, 'smartapi');
  assert.equal(f.calls.length, 2, 'letters pass + ornament pass');
  const [letters, ornaments] = f.calls.map((c) => c.body.input[0].content);
  assert.match(f.calls[0].url, /smartapi\.shop\/v1\/responses$/);
  assert.equal(letters.filter((c) => c.type === 'input_image').length, 2);
  // The student's words are never in the prompt as text to spell.
  assert.doesNotMatch(letters[0].text, /رتاج/);
  assert.match(letters[0].text, /no extra alif/);
  // The measured spelling killers stay out of pass 1 (2026-09-29: 4/14 with them, 11/14 without).
  assert.doesNotMatch(letters[0].text, /\b(stack(ed)? and|interlac)/i);
  assert.match(ornaments[0].text, /must stay identical/);
  // Pass 2 shows the shop's three besto references (letters + three plates) so the ornament family is varied.
  assert.equal(ornaments.filter((c) => c.type === 'input_image').length, 4);
  assert.ok(Math.abs(out.cost - 0.006) < 1e-9, 'both passes are ledgered at the owner\'s price');
});

test('ornament «none» with no motif skips the second paid call', async (t) => {
  const f = stubFetch(async () => imageOk(await pngB64()));
  t.after(f.restore);
  process.env.CALLIG_PROVIDER = 'smartapi';
  await provider.generatePlate({ text: 'رتاج', ornament: 'none' });
  assert.equal(f.calls.length, 1);
});

test('a failed ornament pass ships the plain plate instead of failing the name', async (t) => {
  const b64 = await pngB64();
  let n = 0;
  const f = stubFetch(() => (n++ === 0 ? imageOk(b64) : json(400, { error: { message: 'bad request' } })));
  t.after(f.restore);
  process.env.CALLIG_PROVIDER = 'smartapi';
  const out = await provider.generatePlate({ text: 'رتاج', ornament: 'rich' });
  assert.equal(out.provider, 'smartapi');
  assert.ok(Buffer.isBuffer(out.buffer));
  assert.ok(Math.abs(out.cost - 0.003) < 1e-9, 'only the pass that produced an image is charged');
  assert.ok(f.calls.every((c) => c.url.includes('smartapi.shop')), 'never falls back to OpenRouter for decoration');
});

test('CALLIG_FALLBACK=openrouter: a SmartAPI failure falls back to OpenRouter and says so', async (t) => {
  const b64 = await pngB64();
  const f = stubFetch((url) => (url.includes('smartapi.shop')
    ? json(400, { error: { message: 'bad request' } })
    : json(200, { data: [{ b64_json: b64 }], usage: { cost: 0.067 } })));
  t.after(() => { f.restore(); delete process.env.CALLIG_FALLBACK; });
  process.env.CALLIG_PROVIDER = 'smartapi';
  process.env.CALLIG_FALLBACK = 'openrouter';
  const out = await provider.generatePlate({ text: 'رتاج', variant: 'front' });
  assert.equal(out.provider, 'openrouter');
  assert.ok(f.calls.some((c) => c.url.includes('openrouter.ai')));
});

test('by default a SmartAPI failure surfaces — OpenRouter is never called (owner: «smartapi وبس»)', async (t) => {
  const f = stubFetch(() => json(400, { error: { message: 'bad request' } }));
  t.after(f.restore);
  process.env.CALLIG_PROVIDER = 'smartapi';
  delete process.env.CALLIG_FALLBACK;
  await assert.rejects(provider.generatePlate({ text: 'رتاج' }), (e) => e.provider === 'smartapi');
  assert.ok(f.calls.every((c) => c.url.includes('smartapi.shop')));
});

test('a rate limit that outlasts the retries is an OUTAGE code, so plates stay pending', async (t) => {
  const f = stubFetch(() => json(429, { error: { message: 'rate_limit_exceeded' } }));
  t.after(f.restore);
  await assert.rejects(smartapi.chat({ messages: [{ role: 'user', content: 'x' }] }), (e) => e.code === 'ERR_OPENROUTER_NET');
});

test('CALLIG_PROVIDER=openrouter never touches SmartAPI', async (t) => {
  const b64 = await pngB64();
  const f = stubFetch(() => json(200, { data: [{ b64_json: b64 }], usage: { cost: 0.067 } }));
  t.after(() => { f.restore(); delete process.env.CALLIG_PROVIDER; });
  process.env.CALLIG_PROVIDER = 'openrouter';
  const out = await provider.generatePlate({ text: 'رتاج' });
  assert.equal(out.provider, 'openrouter');
  assert.ok(f.calls.every((c) => !c.url.includes('smartapi.shop')));
  assert.equal(provider.drawsSolo(), false);
});

test('the typeset name renders Arabic and escapes markup', async () => {
  const png = await smartapi.textImage('علي <b>& حسين');
  const m = await sharp(png).metadata();
  assert.ok(m.width > 200 && m.height > 80);
  assert.equal(smartapi._internals.escapeMarkup('<a&b>'), '&lt;a&amp;b&gt;');
});

test('json mode always carries the word "json" — upstream refuses it otherwise, disguised as an outage', async (t) => {
  const f = stubFetch(() => json(200, { choices: [{ message: { content: '{"ok":1}' } }], usage: { total_tokens: 10 } }));
  t.after(f.restore);
  await smartapi.chat({ messages: [{ role: 'user', content: 'reply {"ok":1}' }], jsonMode: true });
  assert.ok(f.calls[0].body.messages.some((m) => /json/i.test(m.content)), 'a json hint was added');
  // A prompt that already says JSON is sent untouched.
  await smartapi.chat({ messages: [{ role: 'user', content: 'أعد JSON فقط' }], jsonMode: true });
  assert.equal(f.calls[1].body.messages.length, 1);
});
