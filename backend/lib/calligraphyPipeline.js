// backend/lib/calligraphyPipeline.js — «ولّد الكل»: read a whole zone, understand every line,
// check every photo, and hand back a PLAN the workbench can generate in one press.
//
// Owner, 2026-09-26: «اجي واولد 300 اسم بدون تعب مو اشوف اقتراح اقتراح». So the unit of review
// is the plan's SUMMARY and its short exception list, not each line:
//
//   lines ─► calligraphyUnderstand (text model fills a form; guard verifies it)
//         ─► calligraphyPhoto      (only for lines that asked for «نفس الخط الي بالصورة»)
//         ─► auto       : generate as-is, grouped into sheets by (zone, ornament)
//            exceptions : a person decides — with the reason and a proposed text beside it
//
// ⚠️ REP LINES ONLY. The owner's rule is «ممثل = generate in bulk then review · تجزئة = review
// first, then generate» (calligraphyController.createJob). Retail lines have their own review
// board and never enter a bulk run.
//
// ⚠️ A PLAN IS NOT TRUSTED ON THE WAY BACK. The workbench posts the plan's items to /smart/run;
// `resolveRunItems` re-reads every order line from the DB — the student, the zone, and above
// all the reference photo, which is ALWAYS the line's own `customer_image_url` and never a URL
// from the request. The text is the designer's to edit (the same trust createJob gives them),
// so it is re-checked by checkRenderText and nothing more.
const { query } = require('./db');
const { understandLines } = require('./calligraphyUnderstand');
const { describePhoto } = require('./calligraphyPhoto');
const { checkRenderText } = require('./calligraphyText');
const { normalizeOrnament } = require('./calligraphyPrompt');
const { FULL_SHEET } = require('./calligraphyBatching');
const { logSpend } = require('./calligraphySpend');

const MAX_LINES = 400;
// Measured 2026-09-26 on OpenRouter: a 2K sheet ~$0.10, a 1K solo or reference plate ~$0.068.
const SHEET_USD = 0.10;
const SOLO_USD = 0.068;

// Every rep line of this zone that has NO plate yet — neither done nor waiting in a job. The
// second half matters: pressing «ولّد الكل» twice must not buy the same names twice.
async function loadZoneLines(label, wholesalerId = null, limit = MAX_LINES) {
  const { rows } = await query(
    `SELECT oi.id AS order_item_id, oi.customer_text AS text, oi.customer_image_url,
            s.id AS student_id, s.wholesaler_id, u.name AS account_name
       FROM order_items oi
       JOIN orders o    ON o.id = oi.order_id AND o.status::text <> 'cancelled'
       JOIN products p  ON p.id = o.product_id AND p.type IN ('sash','cap')
       JOIN students s  ON s.id = o.student_id AND s.wholesaler_id IS NOT NULL
       JOIN users u     ON u.id = s.user_id
      WHERE oi.label_snapshot = $1 AND COALESCE(oi.customer_text,'') <> ''
        AND ($3::uuid IS NULL OR s.wholesaler_id = $3)
        AND NOT EXISTS (SELECT 1 FROM calligraphy_plates c
                         WHERE c.order_item_id = oi.id AND c.status IN ('done','pending'))
      ORDER BY o.created_at
      LIMIT $2`,
    [label, limit, wholesalerId]);
  return rows;
}

async function fetchOwnPhoto(url) {
  // Same rule as the engine: our own uploads, read from disk first; the network fallback only
  // exists for a dev box whose rows point at production, and only for our own host.
  const { absFromUrl } = require('./upload');
  const fs = require('fs');
  const abs = absFromUrl(url);
  if (abs) { try { return await fs.promises.readFile(abs); } catch { /* fall through */ } }
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:' || !/(^|\.)lolo-shop96\.com$/.test(u.hostname) || !u.pathname.startsWith('/uploads/')) return null;
    const r = await fetch(u);
    return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  } catch { return null; }
}

async function mapLimit(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const k = i++; await fn(list[k], k); }
  }));
}

/** Rough spend for a plan: sheets per ornament group + one solo image per reference plate. */
function estimate(auto) {
  const groups = new Map();
  let references = 0;
  for (const it of auto) {
    if (it.ref_image_url) { references += 1; continue; }
    const k = it.ornament || '';
    groups.set(k, (groups.get(k) || 0) + 1);
  }
  let sheets = 0;
  let usd = references * SOLO_USD;
  for (const n of groups.values()) {
    const full = Math.floor(n / FULL_SHEET);
    const rest = n % FULL_SHEET;
    sheets += full + (rest ? 1 : 0);
    usd += full * SHEET_USD + (rest === 1 ? SOLO_USD : rest ? SHEET_USD : 0);
  }
  return { sheets, references, usd: Number(usd.toFixed(2)) };
}

/**
 * Build the plan for one zone. Spends only text-model money (~$0.01 per 100 lines) plus
 * ~$0.0006 per photo it has to look at. Generates nothing.
 */
async function planZone({ variant, label, wholesalerId = null, defaultOrnament = null }) {
  const lines = await loadZoneLines(label, wholesalerId);
  if (!lines.length) return { variant, auto: [], exceptions: [], counts: { lines: 0 }, cost_usd: 0 };

  const { items, cost_usd: textCost } = await understandLines(lines.map((l) => ({
    id: l.order_item_id, text: l.text, account_name: l.account_name,
    zone: variant, has_photo: !!l.customer_image_url,
  })));
  const spec = new Map(items.map((it) => [String(it.id), it]));

  // Photos: only where the student ASKED for the style of their photo, or where the photo is
  // the whole request — everywhere else the photo is not steering anything.
  let photoCost = 0;
  const photoNote = new Map();
  const needPhoto = lines.filter((l) => {
    const s = spec.get(String(l.order_item_id));
    return l.customer_image_url && s && (s.photo_style || s.kind === 'photo_only');
  });
  await mapLimit(needPhoto, 4, async (l) => {
    const buf = await fetchOwnPhoto(l.customer_image_url);
    if (!buf) { photoNote.set(l.order_item_id, null); return; }
    try {
      const { description, costUsd } = await describePhoto(buf);
      photoCost += costUsd;
      photoNote.set(l.order_item_id, description);
    } catch { photoNote.set(l.order_item_id, null); }
  });
  if (textCost + photoCost > 0) await logSpend('understand', textCost + photoCost);

  const auto = [];
  const exceptions = [];
  const fallbackOrnament = normalizeOrnament(defaultOrnament);
  for (const l of lines) {
    const s = spec.get(String(l.order_item_id));
    const flags = [...(s ? s.flags : ['ما انفهم'])];
    const photo = photoNote.get(l.order_item_id);
    let refImage = null;
    let ornament = s ? s.ornament : null;
    if (s && s.photo_style) {
      if (!photo) flags.push('ما كدرنا نقرا الصورة');
      // The photo's own description travels separately as `photo_note`; the flag only says why.
      else if (!photo.style_reference) flags.push('الصورة مو خط — ما تصلح مرجع');
      else {
        refImage = l.customer_image_url;
        if (!ornament && photo.ornament) ornament = photo.ornament;
      }
    }
    if (!ornament && fallbackOrnament) ornament = fallbackOrnament;
    const base = {
      order_item_id: l.order_item_id,
      student_id: l.student_id,
      student_name: l.account_name,
      student_text: l.text,
      has_photo: !!l.customer_image_url,
    };
    const ok = s && s.confidence === 'high' && !flags.length && s.text && checkRenderText(s.text).ok;
    if (ok) {
      auto.push({
        ...base,
        render_text: s.text,
        element_text: s.motif,
        ornament,
        ref_image_url: refImage,
        side_text: s.side_text,
      });
    } else {
      exceptions.push({
        ...base,
        proposed_text: s ? s.text : null,
        kind: s ? s.kind : 'unclear',
        ornament,
        flags,
        why: s ? s.why : '',
        photo_note: photo ? photo.note : null,
      });
    }
  }

  const byOrnament = {};
  for (const it of auto) { const k = it.ornament || 'default'; byOrnament[k] = (byOrnament[k] || 0) + 1; }
  return {
    variant,
    auto,
    exceptions,
    counts: {
      lines: lines.length,
      auto: auto.length,
      exceptions: exceptions.length,
      by_ornament: byOrnament,
      with_reference: auto.filter((it) => it.ref_image_url).length,
      side_texts: auto.filter((it) => it.side_text).length,
      estimate: estimate(auto),
    },
    cost_usd: Number((textCost + photoCost).toFixed(4)),
  };
}

/**
 * Turn posted plan items back into plate rows the engine can generate — re-resolving every
 * line from the DB. Returns `{ items, dropped }`.
 */
async function resolveRunItems(posted, label) {
  const want = (Array.isArray(posted) ? posted : []).slice(0, MAX_LINES);
  const ids = [...new Set(want.map((it) => String((it && it.order_item_id) || '')).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  if (!ids.length) return { items: [], dropped: [] };
  const { rows } = await query(
    `SELECT oi.id AS order_item_id, oi.customer_image_url, s.id AS student_id, s.wholesaler_id
       FROM order_items oi
       JOIN orders o   ON o.id = oi.order_id AND o.status::text <> 'cancelled'
       JOIN products p ON p.id = o.product_id AND p.type IN ('sash','cap')
       JOIN students s ON s.id = o.student_id AND s.wholesaler_id IS NOT NULL
      WHERE oi.id = ANY($1) AND oi.label_snapshot = $2
        AND NOT EXISTS (SELECT 1 FROM calligraphy_plates c
                         WHERE c.order_item_id = oi.id AND c.status IN ('done','pending'))`,
    [ids, label]);
  const byId = new Map(rows.map((r) => [r.order_item_id, r]));
  const items = [];
  const dropped = [];
  const seen = new Set();
  for (const it of want) {
    const row = byId.get(String(it && it.order_item_id));
    const text = String((it && it.render_text) || '').trim();
    if (!row || seen.has(row.order_item_id) || !checkRenderText(text).ok) { dropped.push(text || String(it && it.order_item_id)); continue; }
    seen.add(row.order_item_id);
    items.push({
      order_item_id: row.order_item_id,
      student_id: row.student_id,
      wholesaler_id: row.wholesaler_id,
      render_text: text,
      element_text: typeof it.element_text === 'string' && it.element_text.trim() ? it.element_text.trim().slice(0, 24) : null,
      ornament: normalizeOrnament(it.ornament),
      // The ONLY reference a plate may carry is its own line's photo, and only when asked for.
      ref_image_url: it.use_reference && row.customer_image_url ? row.customer_image_url : null,
    });
  }
  return { items, dropped };
}

module.exports = { planZone, resolveRunItems, _internals: { estimate, loadZoneLines } };
