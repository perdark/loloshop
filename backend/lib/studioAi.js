// backend/lib/studioAi.js — «الاستوديو»: a ChatGPT-like tool for design staff, on SmartAPI.
//
// Deliberately its OWN fetch, not lib/smartapi.js's shared post() gate. That gate is tuned for
// calligraphy IMAGE jobs — 3 concurrent in flight, 4s→36s backoff, 180s timeouts — because a
// plate can wait behind a batch. A designer typing into a chat box cannot: a chat reply gets a
// short timeout and no retries of its own, so one slow calligraphy batch never queues a human
// waiting on a reply. Image generation here gets its own long timeout (image jobs are
// legitimately slow) but still never shares the calligraphy concurrency gate.
//
// Zero new npm dependencies — `fetch` and `sharp` (already a dependency) are enough, same
// reasoning as lib/push.js and lib/aiChat.js: CI's `npm audit --omit=dev --audit-level=moderate`
// blocks the whole deploy on a new advisory, so a new package here would put the Studio tool
// permanently inside that gate for no benefit.
const sharp = require('sharp');

const BASE_URL = 'https://smartapi.shop/v1';

// UI stores only 'gpt'|'claude' on the conversation row; the real model id is an env knob so
// it can move without a migration, same indirection lib/aiChat.js and lib/smartapi.js use.
const CHAT_MODEL_FOR = {
  gpt: process.env.STUDIO_GPT_MODEL || 'gpt-5.5',
  claude: process.env.STUDIO_CLAUDE_MODEL || 'claude-sonnet-5',
};
const IMAGE_MODEL = process.env.STUDIO_IMAGE_MODEL || 'gpt-6-sol';

// Owner's SmartAPI rate (same env as lib/smartapi.js / lib/aiChat.js): 15M tokens for $1.5.
const USD_PER_TOKEN = Number(process.env.SMARTAPI_USD_PER_MTOK || 0.1) / 1e6;

const CHAT_TIMEOUT_MS = Number(process.env.STUDIO_CHAT_TIMEOUT_MS || 60000);
const IMAGE_TIMEOUT_MS = Number(process.env.STUDIO_IMAGE_TIMEOUT_MS || 180000);

function tagged(message, status, code, extra = {}) {
  const e = new Error(message);
  e.status = status;
  e.expose = true;
  e.code = code;
  return Object.assign(e, extra);
}

/** 'gpt'|'claude' (or anything else) → the real SmartAPI model id. Unknown defaults to gpt. */
function modelIdFor(uiModel) {
  return CHAT_MODEL_FOR[uiModel] || CHAT_MODEL_FOR.gpt;
}

function usageUsd(usage) {
  if (!usage) return 0;
  const tokens = Number(usage.total_tokens
    || (Number(usage.input_tokens || usage.prompt_tokens || 0) + Number(usage.output_tokens || usage.completion_tokens || 0)));
  return Number((tokens * USD_PER_TOKEN).toFixed(6));
}

// Attached images are sent to the chat model as data URLs, resized down so a 12MP phone photo
// does not blow the request body or the model's own image-token budget.
async function toChatDataUrl(buffer, max = 1024) {
  const jpg = await sharp(buffer, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(max, max, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 82 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

/**
 * One chat completion. `messages` is the standard [{role, content}] array — `content` may be
 * a plain string or an OpenAI-style content-part array (for messages carrying images).
 * Never throws for model-quality reasons — only transport/config/empty-reply failures.
 */
async function chat({ uiModel, messages, maxTokens = 4000, temperature = 0.6 }) {
  const key = process.env.SMARTAPI_KEY;
  if (!key) throw tagged('مفتاح SmartAPI غير مهيأ', 500, 'ERR_STUDIO_KEY');
  const model = modelIdFor(uiModel);
  const body = { model, messages, max_tokens: maxTokens, temperature };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  let resp;
  let text = '';
  try {
    resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    text = await resp.text();
  } catch (err) {
    console.error('studioAi chat network error:', err.name === 'AbortError' ? 'timeout' : err.message);
    throw tagged('تعذّر الاتصال بالاستوديو', 502, 'ERR_STUDIO_NET');
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    console.error('studioAi chat non-200:', resp.status, text.slice(0, 400));
    throw tagged('الاستوديو مو متوفر حالياً، جرّب بعد شوية', 502, 'ERR_STUDIO_UPSTREAM');
  }
  let data;
  try { data = JSON.parse(text); } catch {
    throw tagged('استجابة غير صالحة من الاستوديو', 502, 'ERR_STUDIO_SHAPE');
  }
  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  // gpt-* models on SmartAPI spend some of their budget on hidden reasoning tokens before the
  // visible reply, so a 200 with empty `content` is a real, expected failure mode here — not
  // just a transport hiccup — and must surface as a retriable Arabic error, never a blank bubble.
  const content = msg && typeof msg.content === 'string' ? msg.content.trim() : '';
  if (!content) {
    console.error('studioAi chat empty content from', model);
    throw tagged('ما وصلني رد، جرّب مرة ثانية', 502, 'ERR_STUDIO_EMPTY');
  }
  const usage = data.usage || {};
  const promptTokens = Number(usage.prompt_tokens || usage.input_tokens || 0);
  const completionTokens = Number(usage.completion_tokens || usage.output_tokens || 0);
  const costUsd = usageUsd(usage) || Number((((promptTokens + completionTokens) * USD_PER_TOKEN)).toFixed(6));
  return { text: content, model, promptTokens, completionTokens, costUsd };
}

/**
 * One image-generation call, `/responses` + the `image_generation` tool (same shape as
 * lib/smartapi.js's generateImageFromPrompt/editImage). `images` (optional) are reference/edit
 * inputs, attached as `input_image`. Returns `{ buffer, costUsd }`.
 */
async function generateImage({ prompt, images = [], size = '1024x1024' }) {
  const key = process.env.SMARTAPI_KEY;
  if (!key) throw tagged('مفتاح SmartAPI غير مهيأ', 500, 'ERR_STUDIO_KEY');

  const content = [{ type: 'input_text', text: prompt }];
  for (const buf of images) {
    const url = await toChatDataUrl(buf, 1024);
    content.push({ type: 'input_image', image_url: url });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  let resp;
  let text = '';
  try {
    resp = await fetch(`${BASE_URL}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        input: [{ role: 'user', content }],
        tools: [{ type: 'image_generation', size, quality: 'high', background: 'opaque' }],
        tool_choice: { type: 'image_generation' },
      }),
      signal: controller.signal,
    });
    text = await resp.text();
  } catch (err) {
    console.error('studioAi image network error:', err.name === 'AbortError' ? 'timeout' : err.message);
    throw tagged('تعذّر الاتصال بالاستوديو', 502, 'ERR_STUDIO_NET');
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    console.error('studioAi image non-200:', resp.status, text.slice(0, 400));
    throw tagged('تعذّر توليد الصورة حالياً، جرّب بعد شوية', 502, 'ERR_STUDIO_UPSTREAM');
  }
  let data;
  try { data = JSON.parse(text); } catch {
    throw tagged('استجابة غير صالحة من الاستوديو', 502, 'ERR_STUDIO_SHAPE');
  }
  const call = (data.output || []).find((o) => o && o.type === 'image_generation_call' && o.result);
  if (!call) {
    throw tagged('المولّد رجّع بلا صورة — أعد المحاولة', 502, 'ERR_STUDIO_NO_IMAGE', { retriable: true });
  }
  const buffer = await sharp(Buffer.from(call.result, 'base64')).png().toBuffer();
  return { buffer, costUsd: usageUsd(data.usage) };
}

module.exports = {
  chat,
  generateImage,
  toChatDataUrl,
  modelIdFor,
  CHAT_MODEL_FOR,
  IMAGE_MODEL,
  _internals: { usageUsd, tagged },
};
