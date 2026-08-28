// backend/lib/openrouter.js — sole reader of OPENROUTER_API_KEY.
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/images';

// Nano Banana 2 — live-tested 2026-06-24: 10/10 CORRECT Arabic spelling, clean Thuluth,
// ~$0.10/image @2K (= ~$0.01/student, ~$10 per 1,000 at 10 names/sheet).
// gemini-2.5-flash-image is cheaper (~$0.039) but GARBLES Arabic (0/10) — never use it for names.
const CALLIGRAPHY_MODEL = 'google/gemini-3.1-flash-image';
const MODELS = {
  standard: CALLIGRAPHY_MODEL,
  premium:  'google/gemini-3-pro-image', // optional: bolder Thuluth, ~$0.24/image @4K
};

function tagged(message, status, code, extra = {}) {
  const e = new Error(message); e.status = status; e.expose = true; e.code = code;
  return Object.assign(e, extra);
}

// ⚠️ THE THREE UPSTREAM FAILURES ARE NOT INTERCHANGEABLE — added 2026-08-28 after a day when
// all three wore the same code and the shop could not tell "we are out of money" from "the
// model hiccuped". Each one needs a different response, so each gets its own code:
//
//   ERR_OPENROUTER_CREDIT   402. Nothing to retry — retrying just fails twice. The plates are
//                           blameless, so callers leave them PENDING and tell the admin.
//   ERR_OPENROUTER_NO_IMAGE Gemini finished with no image at all (finish_reason STOP,
//                           block_reason null) — 10 times in the logs by 2026-08-28. Nothing
//                           is billed for that response and the SAME prompt usually succeeds
//                           on a fresh call, so it is the one failure worth retrying here.
//   ERR_OPENROUTER          everything else. Unchanged behaviour, unchanged code, so every
//                           existing caller and test keeps its old meaning.
const NO_IMAGE_RE = /no image data|could not generate an image/i;
const MAX_ATTEMPTS = 2; // one retry, and ONLY for ERR_OPENROUTER_NO_IMAGE. Each retry is free
                        // (no image was billed) but a loop against a broken model is not.

function errorFor(status, detail) {
  if (status === 402) {
    return tagged('انتهى رصيد توليد صور الخط — أضِف رصيداً في OpenRouter ليعود التوليد',
      402, 'ERR_OPENROUTER_CREDIT');
  }
  if (NO_IMAGE_RE.test(detail || '')) {
    return tagged('المولّد رجّع بلا صورة — أعد المحاولة', 502, 'ERR_OPENROUTER_NO_IMAGE',
      { retriable: true });
  }
  return tagged('فشل توليد صورة الخط', 502, 'ERR_OPENROUTER');
}

async function attemptImage({ model, prompt, resolution, aspectRatio }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw tagged('مفتاح OpenRouter غير مهيأ', 500, 'ERR_OPENROUTER_KEY');

  let resp;
  try {
    resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.PUBLIC_URL || 'https://lolo-shop96.com',
        'X-Title': 'LoloShop Calligraphy',
      },
      body: JSON.stringify({ model, prompt, resolution, aspect_ratio: aspectRatio, n: 1, output_format: 'png' }),
    });
  } catch (err) {
    console.error('OpenRouter network error:', err.message);
    throw tagged('تعذّر الاتصال بخدمة توليد الصور', 502, 'ERR_OPENROUTER_NET');
  }

  if (!resp.ok) {
    let detail = '';
    try { detail = JSON.stringify(await resp.json()); } catch { /* ignore */ }
    console.error('OpenRouter non-200:', resp.status, detail.slice(0, 500));
    throw errorFor(resp.status, detail);
  }

  const data = await resp.json();
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) {
    console.error('OpenRouter unexpected shape:', JSON.stringify(data).slice(0, 500));
    throw tagged('استجابة غير صالحة من مولّد الصور', 502, 'ERR_OPENROUTER_SHAPE');
  }
  const cost = Number((data.usage && data.usage.cost) || 0);
  return { buffer: Buffer.from(b64, 'base64'), cost };
}

async function generateImage({ model, prompt, resolution = '2K', aspectRatio = '9:16' }) {
  let last;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await attemptImage({ model, prompt, resolution, aspectRatio });
    } catch (err) {
      last = err;
      if (!err.retriable || attempt === MAX_ATTEMPTS) throw err;
      console.warn(`OpenRouter ${err.code} — retrying (${attempt}/${MAX_ATTEMPTS})`);
    }
  }
  throw last;
}

module.exports = { generateImage, MODELS, OPENROUTER_URL };
