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

function tagged(message, status, code) {
  const e = new Error(message); e.status = status; e.expose = true; e.code = code; return e;
}

async function generateImage({ model, prompt, resolution = '2K', aspectRatio = '9:16' }) {
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
    throw tagged('فشل توليد صورة الخط', 502, 'ERR_OPENROUTER');
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

module.exports = { generateImage, MODELS, OPENROUTER_URL };
