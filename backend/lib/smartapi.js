// backend/lib/smartapi.js — sole reader of SMARTAPI_KEY. Calligraphy's primary provider since
// 2026-09-26 (owner: «I want it all on smartapi»), with OpenRouter kept as automatic fallback.
//
// WHY SMARTAPI, AND WHY NOT ALONE. It sells `gpt-6-sol` image generation at ~30k tokens an image
// (owner's price: 15M tokens for $1.5 → ~$0.003 a plate, against ~$0.068 for an OpenRouter solo
// plate and ~$0.10 for a sheet). Measured the same day, it is also the flakier of the two: ~5
// concurrent requests trip `rate_limit_exceeded`, and `upstream_unavailable` hit mid-session. So
// this module retries with backoff, caps its own concurrency, and throws the SAME error codes
// lib/openrouter.js does, so every caller's outage handling (plates stay pending, never failed)
// keeps working — and lib/calligraphyProvider.js falls back on exactly those codes.
//
// ⚠️ THE STUDENT'S TEXT NEVER REACHES THE IMAGE MODEL AS WORDS TO INTERPRET. The name is typeset
// into an image (textImage, the bundled Amiri font) and the prompt tells the model to copy THAT
// image's letters. Measured 2026-09-26 on the same ten real names: text-only prompts gave 5–7/10
// with the extra-alif defect (امحمد · انور) copied from the style plate; name-as-image gave ~7/10
// and ZERO extra alifs. See docs/HANDOFF-archive.md, 2026-09-26.
const path = require('path');
const { countMarks } = require('./plateMarks');
const sharp = require('sharp');

const BASE_URL = 'https://smartapi.shop/v1';
const IMAGE_MODEL = process.env.SMARTAPI_IMAGE_MODEL || 'gpt-6-sol';
const TEXT_MODEL = process.env.SMARTAPI_TEXT_MODEL || 'claude-sonnet-5';
// Owner's price, 2026-09-26: 15M tokens for $1.5. Used only to ledger spend (calligraphySpend) —
// SmartAPI reports tokens, never dollars.
const USD_PER_TOKEN = Number(process.env.SMARTAPI_USD_PER_MTOK || 0.1) / 1e6;
const MAX_IN_FLIGHT = Number(process.env.SMARTAPI_CONCURRENCY || 3);
const RETRIES = Number(process.env.SMARTAPI_RETRIES ?? 3);
const BACKOFF_MS = Number(process.env.SMARTAPI_BACKOFF_MS ?? 4000);

const FONT_FILE = path.join(__dirname, '..', 'assets', 'fonts', 'Amiri-Regular.ttf');
const STYLE_REF_FILE = path.join(__dirname, '..', 'assets', 'calligraphy', 'style-ref.png');
// Two more besto plates: pass 2 shows the model THREE references so the ornament family is varied,
// not one plate's. (style-ref.png is also the PEN reference for pass 1.)
const STYLE_REF2_FILE = path.join(__dirname, '..', 'assets', 'calligraphy', 'style-ref-2.png');
const STYLE_REF3_FILE = path.join(__dirname, '..', 'assets', 'calligraphy', 'style-ref-3.png');
// Pass 2 is re-drawn (up to ORNAMENT_TRIES times, best kept) when a plate comes back thinner than this
// many marks per plate-height — see lib/plateMarks.js. Calibrated 2026-10-06 on the plates the owner
// approved (5.6–9.1) against the thin ones he rejected (3.3–5.0).
// 2026-10-07, owner: «اقل عددا الى النصف» — the target halved, so the bar is 3, not 5.
// Read at call time so the tests (and an emergency .env edit + restart) can change them.
const minMarks = () => Number(process.env.CALLIG_MIN_MARKS ?? 3);
const ornamentTries = () => Math.max(1, Number(process.env.CALLIG_ORNAMENT_TRIES ?? 3));

function tagged(message, status, code, extra = {}) {
  const e = new Error(message); e.status = status; e.expose = true; e.code = code;
  return Object.assign(e, extra);
}

// A process-wide gate: the worker and the HTTP endpoints share it, so a reroll pressed while a
// batch runs cannot push the account over the rate limit.
let inFlight = 0;
const waiting = [];
async function acquire() {
  if (inFlight < MAX_IN_FLIGHT) { inFlight += 1; return; }
  await new Promise((resolve) => waiting.push(resolve));
  inFlight += 1;
}
function release() {
  inFlight -= 1;
  const next = waiting.shift();
  if (next) next();
}

const RETRIABLE = /rate_limit|upstream_unavailable|overloaded|timeout|temporarily/i;

async function post(pathname, body, { timeoutMs = 180000 } = {}) {
  const key = process.env.SMARTAPI_KEY;
  if (!key) throw tagged('مفتاح SmartAPI غير مهيأ', 500, 'ERR_OPENROUTER_KEY', { provider: 'smartapi' });
  await acquire();
  try {
    for (let attempt = 0; ; attempt += 1) {
      if (attempt) await new Promise((r) => setTimeout(r, BACKOFF_MS * attempt * attempt));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let resp;
      let text = '';
      try {
        resp = await fetch(`${BASE_URL}${pathname}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        text = await resp.text();
      } catch (err) {
        if (attempt < RETRIES) continue;
        throw tagged('تعذّر الاتصال بـ SmartAPI', 502, 'ERR_OPENROUTER_NET', { provider: 'smartapi', cause: err.message });
      } finally {
        clearTimeout(timer);
      }
      if (resp.ok) {
        try { return JSON.parse(text); } catch { throw tagged('استجابة غير صالحة من SmartAPI', 502, 'ERR_OPENROUTER_SHAPE', { provider: 'smartapi' }); }
      }
      if ((resp.status === 429 || resp.status >= 500 || RETRIABLE.test(text)) && attempt < RETRIES) continue;
      console.error('SmartAPI non-200:', resp.status, text.slice(0, 300));
      if (resp.status === 402 || /insufficient|quota|balance|credit/i.test(text)) {
        throw tagged('انتهى رصيد SmartAPI', 402, 'ERR_OPENROUTER_CREDIT', { provider: 'smartapi' });
      }
      // Still rate-limited / down after every retry: an OUTAGE, not these names' fault.
      if (resp.status === 429 || resp.status >= 500 || RETRIABLE.test(text)) {
        throw tagged('SmartAPI مو متوفر حالياً', 502, 'ERR_OPENROUTER_NET', { provider: 'smartapi' });
      }
      throw tagged('فشل طلب SmartAPI', 502, 'ERR_OPENROUTER', { provider: 'smartapi' });
    }
  } finally {
    release();
  }
}

function usageUsd(usage) {
  if (!usage) return 0;
  const tokens = Number(usage.total_tokens
    || (Number(usage.input_tokens || usage.prompt_tokens || 0) + Number(usage.output_tokens || usage.completion_tokens || 0)));
  return Number((tokens * USD_PER_TOKEN).toFixed(6));
}

/**
 * OpenAI-style chat completion — the same `{ text, costUsd }` contract as aiChat.complete, so
 * lib/calligraphyProvider.js can swap one for the other.
 */
async function chat({ messages, maxTokens = 1000, temperature = 0, jsonMode = false, model = TEXT_MODEL }) {
  const body = { model, messages, max_tokens: maxTokens, temperature };
  if (jsonMode) {
    body.response_format = { type: 'json_object' };
    // Upstream refuses json_object unless some message contains the word "json", and SmartAPI
    // reports that refusal as `upstream_unavailable` — which post() retries as an outage, burning
    // ~1 min per call. Measured 2026-09-27: same body, 400 without the word, 200 with it.
    if (!messages.some((m) => /json/i.test(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))) {
      body.messages = [{ role: 'system', content: 'Respond in JSON.' }, ...messages];
    }
  }
  const data = await post('/chat/completions', body, { timeoutMs: 120000 });
  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  let text = msg && typeof msg.content === 'string' ? msg.content : '';
  // Some upstream models wrap JSON in a fence even in json mode; unwrap rather than lose the line.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMode && fence) text = fence[1];
  return { text, costUsd: usageUsd(data && data.usage) };
}

const escapeMarkup = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The exact text, typeset in Amiri — the spelling reference the model re-letters. */
async function textImage(text) {
  const png = await sharp({
    text: {
      text: `<span foreground="black">${escapeMarkup(text)}</span>`,
      font: 'Amiri 72',
      fontfile: FONT_FILE,
      rgba: true,
      dpi: 150,
    },
  }).png().toBuffer();
  return sharp(png).flatten({ background: '#ffffff' })
    .extend({ top: 40, bottom: 40, left: 60, right: 60, background: '#ffffff' })
    .png().toBuffer();
}

let styleRefCache = null;
async function shopStyleRef() {
  if (!styleRefCache) styleRefCache = await require('fs').promises.readFile(STYLE_REF_FILE);
  return styleRefCache;
}
let extraRefsCache = null;
async function shopExtraRefs() {
  if (!extraRefsCache) {
    const fsp = require('fs').promises;
    extraRefsCache = await Promise.all([fsp.readFile(STYLE_REF2_FILE), fsp.readFile(STYLE_REF3_FILE)]);
  }
  return extraRefsCache;
}

async function toDataUrl(buffer, max = 1400) {
  const png = await sharp(buffer, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(max, max, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

// One image-edit call: the prompt plus the given images, back as a flattened, trimmed PNG on white.
async function editImage(prompt, images) {
  const urls = await Promise.all(images.map((b, i) => toDataUrl(b, i === 0 ? 1400 : 1024)));
  const data = await post('/responses', {
    model: IMAGE_MODEL,
    input: [{ role: 'user', content: [
      { type: 'input_text', text: prompt },
      ...urls.map((u) => ({ type: 'input_image', image_url: u })),
    ] }],
    tools: [{ type: 'image_generation', size: '1536x1024', quality: 'high', background: 'opaque' }],
    tool_choice: { type: 'image_generation' },
  });
  const call = (data.output || []).find((o) => o && o.type === 'image_generation_call' && o.result);
  if (!call) {
    // Same meaning as OpenRouter's "no image": nothing to show for it, safe to try again.
    throw tagged('المولّد رجّع بلا صورة — أعد المحاولة', 502, 'ERR_OPENROUTER_NO_IMAGE', { retriable: true, provider: 'smartapi' });
  }
  const buffer = await sharp(Buffer.from(call.result, 'base64'))
    .flatten({ background: '#ffffff' })
    .trim({ threshold: 40 })
    .extend({ top: 16, bottom: 16, left: 16, right: 16, background: '#ffffff' })
    .png()
    .toBuffer();
  return { buffer, cost: usageUsd(data.usage) };
}

/**
 * One plate, in two passes (lib/calligraphyPrompt.js, 2026-09-29 measurement):
 *   1. `prompt` re-inks the typeset `text` (IMAGE 1) with the pen of the style reference
 *      (IMAGE 2: the student's photo when they asked for it, else the shop's plate). Letters only.
 *   2. `ornamentPrompt` adds the decorative marks into the gaps without touching a letter.
 *      Skipped when null. A failed pass 2 is NOT a failed plate: the pass-1 plate is complete and
 *      spelled as well as it will be, so it ships plain rather than the name going back to pending.
 * Returns `{ buffer, cost }` like openrouter.generateImage; cost covers both passes.
 */
async function generatePlate({ text, prompt, ornamentPrompt = null, styleReference = null }) {
  const style = styleReference || await shopStyleRef();
  const letters = await editImage(prompt, [await textImage(text), style]);
  if (!ornamentPrompt) return letters;
  // The shop's three references only when the shop plate is the style; a customer's photo stays alone.
  const refs = styleReference ? [style] : [style, ...(await shopExtraRefs())];
  let best = null; let cost = letters.cost;
  for (let attempt = 0; attempt < ornamentTries(); attempt++) {
    try {
      const decorated = await editImage(ornamentPrompt, [letters.buffer, ...refs]);
      cost += decorated.cost;
      // The model's ornament density varies a lot run to run on one prompt; a customer's own photo
      // is a different look entirely, so only the shop recipe is held to the density bar.
      const { perHeight } = styleReference ? { perHeight: Infinity } : await countMarks(decorated.buffer);
      if (!best || perHeight > best.perHeight) best = { buffer: decorated.buffer, perHeight };
      if (perHeight >= minMarks()) break;
    } catch (err) {
      console.warn(`SmartAPI ornament pass failed (${err.code || err.message})${best ? ' — keeping the best earlier draw' : ' — shipping the plain plate'}`);
      if (!best) break; // nothing decorated yet: a retry would hit the same outage
    }
  }
  return best ? { buffer: best.buffer, cost } : { ...letters, cost };
}

/** A prompt-only image (the motif «element» tool). Same flatten-on-white as a plate. */
async function generateImageFromPrompt({ prompt, size = '1024x1024' }) {
  const data = await post('/responses', {
    model: IMAGE_MODEL,
    input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
    tools: [{ type: 'image_generation', size, quality: 'high', background: 'opaque' }],
    tool_choice: { type: 'image_generation' },
  });
  const call = (data.output || []).find((o) => o && o.type === 'image_generation_call' && o.result);
  if (!call) throw tagged('المولّد رجّع بلا صورة — أعد المحاولة', 502, 'ERR_OPENROUTER_NO_IMAGE', { retriable: true, provider: 'smartapi' });
  const buffer = await sharp(Buffer.from(call.result, 'base64')).flatten({ background: '#ffffff' }).png().toBuffer();
  return { buffer, cost: usageUsd(data.usage) };
}

module.exports = { chat, generatePlate, generateImageFromPrompt, textImage, IMAGE_MODEL, TEXT_MODEL, _internals: { usageUsd, escapeMarkup, editImage } };
