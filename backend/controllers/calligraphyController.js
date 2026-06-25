// backend/controllers/calligraphyController.js
const crypto = require('crypto');
const archiver = require('archiver');
const { query } = require('../lib/db');
const { generateImage, MODELS } = require('../lib/openrouter');
const { cropSheet } = require('../lib/sheetCrop');
const { buildSheetPrompt, buildSinglePrompt } = require('../lib/calligraphyPrompt');
const { saveBufferToUploads } = require('../lib/upload');

const FRONT_LABEL   = 'تطريز الوشاح من الأمام';
const BACK_LABEL    = 'تطريز الوشاح من الخلف';
const CAP_TOP_LABEL = 'تطريز القبعة من الأعلى';
const LABEL_VARIANT = { [FRONT_LABEL]: 'front', [BACK_LABEL]: 'back', [CAP_TOP_LABEL]: 'cap' };
const VARIANTS = ['front', 'back', 'cap'];
const BATCH = 10;

function bad(res, msg, code = 'ERR_VALIDATION', status = 400) {
  return res.status(status).json({ error: msg, code });
}
function pickModel(model) {
  return model === 'premium' ? MODELS.premium : MODELS.standard;
}
// A real embroiderable name has at least two Arabic letters. Rejects pure numbers,
// Latin, emoji, single chars and punctuation so the PAID generator is never spent
// on junk (the "no API call for a retarded name" guard). Tatweel/diacritics aren't
// letters and don't count. This is the server-side choke point; the UI mirrors it.
const ARABIC_LETTER = /[ء-يٱ-ۓۺ-ۼ]/g;
function isRealName(text) {
  const m = String(text || '').match(ARABIC_LETTER);
  return !!m && m.length >= 2;
}
function toPlate(r) {
  return {
    id: r.id, render_text: r.render_text, status: r.status,
    variant: r.variant, element_text: r.element_text,
    plate_path: r.plate_path, sheet_path: r.sheet_path,
    student_id: r.student_id, order_item_id: r.order_item_id,
    linked: !!r.linked_at, cost_usd: Number(r.cost_usd || 0), error: r.error,
  };
}

// GET /wholesalers — pickers
async function listWholesalers(req, res) {
  const { rows } = await query(
    `SELECT w.id, u.name, COUNT(s.id)::int AS student_count
       FROM wholesalers w JOIN users u ON u.id = w.user_id
       LEFT JOIN students s ON s.wholesaler_id = w.id
      GROUP BY w.id, u.name ORDER BY u.name`);
  res.json({ data: rows });
}

// GET /wholesalers/:id/names — grab list from sash front/back AND cap-top embroidery lines
async function wholesalerNames(req, res) {
  const { id } = req.params;
  const ALL_LABELS = [FRONT_LABEL, BACK_LABEL, CAP_TOP_LABEL];
  const { rows } = await query(
    `SELECT s.id AS student_id, u.name AS student_name,
            oi.id AS order_item_id, oi.customer_text AS render_text,
            oi.label_snapshot AS label,
            cp.id AS plate_id, cp.status AS plate_status, cp.plate_path, cp.linked_at
       FROM students s
       JOIN users u   ON u.id = s.user_id
       JOIN orders o  ON o.student_id = s.id AND o.status::text <> 'cancelled'
       JOIN products p ON p.id = o.product_id AND p.type IN ('sash','cap')
       JOIN order_items oi ON oi.order_id = o.id AND oi.label_snapshot = ANY($2)
       LEFT JOIN LATERAL (
            SELECT id, status, plate_path, linked_at FROM calligraphy_plates c
             WHERE c.order_item_id = oi.id ORDER BY created_at DESC LIMIT 1
       ) cp ON TRUE
      WHERE s.wholesaler_id = $1 AND COALESCE(oi.customer_text,'') <> ''
      ORDER BY u.name,
               array_position(ARRAY['تطريز الوشاح من الأمام','تطريز الوشاح من الخلف','تطريز القبعة من الأعلى']::text[], oi.label_snapshot)`,
    [id, ALL_LABELS]);
  res.json({ data: rows.map((r) => ({
    student_id: r.student_id, student_name: r.student_name,
    order_item_id: r.order_item_id, render_text: r.render_text,
    variant: LABEL_VARIANT[r.label] || 'front',
    plate_id: r.plate_id, plate_status: r.plate_status,
    plate_path: r.plate_path, linked: !!r.linked_at,
  })) });
}

// ---------------------------------------------------------------------------
// Shared insert helper — inserts pending plate rows and returns toPlate[].
// Each item must have: render_text, variant, element_text (nullable),
// student_id (nullable), order_item_id (nullable), wholesaler_id (nullable).
// ---------------------------------------------------------------------------
async function insertPlates(jobId, items, { source, model, createdBy }) {
  const out = [];
  for (const it of items) {
    const { rows } = await query(
      `INSERT INTO calligraphy_plates
         (job_id, wholesaler_id, student_id, order_item_id, source, render_text, variant, element_text, status, model, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10) RETURNING *`,
      [jobId, it.wholesaler_id || null, it.student_id || null, it.order_item_id || null,
       source, it.render_text, it.variant || 'front', it.element_text || null, model, createdBy]);
    out.push(toPlate(rows[0]));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pool helper — un-plated embroidery names for a given zone variant.
// "Needs a plate" = order_item with the zone label + non-empty customer_text
// + no 'done' plate already. Applies isRealName junk-guard before returning.
// ---------------------------------------------------------------------------
const ZONE_LABEL = { front: FRONT_LABEL, back: BACK_LABEL, cap: CAP_TOP_LABEL };

async function poolFor(variant, limit = 1000) {
  const label = ZONE_LABEL[variant];
  if (!label) return [];
  const { rows } = await query(
    `SELECT oi.id AS order_item_id, s.id AS student_id, u.name AS student_name,
            oi.customer_text AS render_text, s.wholesaler_id
       FROM order_items oi
       JOIN orders o    ON o.id = oi.order_id AND o.status::text <> 'cancelled'
       JOIN products p  ON p.id = o.product_id AND p.type IN ('sash','cap')
       JOIN students s  ON s.id = o.student_id
       JOIN users u     ON u.id = s.user_id
      WHERE oi.label_snapshot = $1 AND COALESCE(oi.customer_text,'') <> ''
        AND NOT EXISTS (
              SELECT 1 FROM calligraphy_plates cp
               WHERE cp.order_item_id = oi.id AND cp.status = 'done')
      ORDER BY o.created_at
      LIMIT $2`,
    [label, limit]);
  // Apply the same junk guard used in createJob — never pool non-Arabic junk
  return rows
    .filter((r) => isRealName(r.render_text))
    .map((r) => ({
      order_item_id: r.order_item_id,
      student_id: r.student_id,
      student_name: r.student_name,
      render_text: r.render_text,
      variant,
      wholesaler_id: r.wholesaler_id,
    }));
}

// POST /jobs — create pending rows (dedup), no generation yet
async function createJob(req, res) {
  const { source, wholesaler_id = null, model = 'standard' } = req.body || {};
  const jobVariant = VARIANTS.includes(req.body && req.body.variant) ? req.body.variant : 'front';
  let items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
  if (!['typed', 'wholesaler', 'txt'].includes(source)) return bad(res, 'مصدر غير صالح');
  items = items
    .map((it) => ({
      render_text: String((it && it.render_text) || '').trim(),
      element_text: String((it && it.element_text) || '').trim() || null,
      student_id: (it && it.student_id) || null,
      order_item_id: (it && it.order_item_id) || null,
      variant: VARIANTS.includes(it && it.variant) ? it.variant : jobVariant,
    }))
    .filter((it) => it.render_text);
  if (!items.length) return bad(res, 'لا توجد أسماء صالحة');

  // Junk guard (defense-in-depth): drop anything that isn't a real Arabic name
  // BEFORE any paid generation. The UI flags these too, but a direct API call can't
  // bypass it. Batch SIZE is intentionally NOT capped here (admin's choice).
  const dropped = items.filter((it) => !isRealName(it.render_text)).map((it) => it.render_text);
  items = items.filter((it) => isRealName(it.render_text));
  if (!items.length) return bad(res, 'لا توجد أسماء صالحة — يجب أن يحتوي الاسم على حروف عربية');
  if (items.length > 1000) return bad(res, 'الحد الأقصى 1000 اسم لكل مهمة');

  // Dedup:
  //   wholesaler → by order_item_id (each zone row is already unique per student)
  //   typed/txt  → by variant::render_text (same name may appear as both front and back)
  const seen = new Set();
  items = items.filter((it) => {
    const key = source === 'wholesaler'
      ? (it.order_item_id || it.render_text)
      : `${it.variant}::${it.render_text}`;
    if (seen.has(key)) return false; seen.add(key); return true;
  });

  const jobId = crypto.randomUUID();
  const out = await insertPlates(jobId, items.map((it) => ({ ...it, wholesaler_id })), {
    source, model: pickModel(model), createdBy: req.user.id,
  });
  res.status(201).json({ data: { job_id: jobId, total: out.length, dropped, plates: out } });
}

async function jobCost(jobId) {
  const { rows } = await query(`SELECT COALESCE(SUM(cost_usd),0) AS c FROM calligraphy_plates WHERE job_id=$1`, [jobId]);
  return Number(rows[0].c || 0);
}
async function jobCounts(jobId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int total,
            COUNT(*) FILTER (WHERE status='done')::int done,
            COUNT(*) FILTER (WHERE status='failed')::int failed,
            COUNT(*) FILTER (WHERE status='pending')::int pending
       FROM calligraphy_plates WHERE job_id=$1`, [jobId]);
  return rows[0];
}

// POST /jobs/:jobId/process — next batch of <=10 pending (single-variant per sheet)
async function processNext(req, res) {
  const { jobId } = req.params;

  // Pick the variant of the OLDEST pending plate, then take up to BATCH of that variant.
  // This guarantees one sheet = one prompt (front and back must never share a sheet).
  const { rows: head } = await query(
    `SELECT variant FROM calligraphy_plates WHERE job_id=$1 AND status='pending' ORDER BY created_at LIMIT 1`,
    [jobId]);
  if (!head.length) {
    const c = await jobCounts(jobId);
    return res.json({ data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId), plates: [] } });
  }
  const variant = head[0].variant;
  const { rows: batch } = await query(
    `SELECT * FROM calligraphy_plates WHERE job_id=$1 AND status='pending' AND variant=$3 ORDER BY created_at LIMIT $2`,
    [jobId, BATCH, variant]);
  if (!batch.length) {
    const c = await jobCounts(jobId);
    return res.json({ data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId), plates: [] } });
  }
  const model = batch[0].model || MODELS.standard;
  const names = batch.map((b) => ({ text: b.render_text, element: b.element_text }));

  // Generate + crop with AUTO-RETRY. The model spaces lines randomly, so a sheet
  // that crops to the wrong band count usually slices cleanly on a fresh generation.
  // cropSheet now also salvages too-few-band sheets (gap segmentation), so a single
  // retry is enough in the rare case it still mismatches — keep the cap LOW to bound
  // cost (each retry is a full paid image). Flag for manual review only if every
  // attempt mismatches (never mis-slice — §11).
  const MAX_CROP_TRIES = 2;
  let plates = null;
  let sheet = null;
  let totalCost = 0;
  let lastCount = null;
  let attemptsUsed = 0;
  for (let attempt = 1; attempt <= MAX_CROP_TRIES; attempt++) {
    attemptsUsed = attempt;
    let gen;
    try {
      gen = await generateImage({ model, prompt: buildSheetPrompt(names, variant) });
    } catch (err) {
      await query(`UPDATE calligraphy_plates SET status='failed', error=$2 WHERE id = ANY($1)`,
        [batch.map((b) => b.id), err.code || 'ERR_OPENROUTER']);
      const c = await jobCounts(jobId);
      return res.status(err.status || 502).json({ error: err.message || 'فشل التوليد', code: err.code || 'ERR_OPENROUTER',
        data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId), plates: [] } });
    }
    totalCost += Number(gen.cost || 0);
    sheet = saveBufferToUploads(req, 'calligraphy/sheets', gen.buffer, 'png'); // keep latest (review fallback)
    let cropped;
    try {
      cropped = await cropSheet(gen.buffer, batch.length);
    } catch (err) {
      console.error('crop threw:', err.message);
      cropped = { plates: [], count: -1 };
    }
    lastCount = cropped.count;
    if (cropped.count === batch.length) { plates = cropped.plates; break; }
    console.warn(`crop mismatch attempt ${attempt}/${MAX_CROP_TRIES}: expected ${batch.length}, got ${cropped.count} — regenerating`);
  }

  const perCost = batch.length ? totalCost / batch.length : 0;

  if (!plates) {
    // every attempt mismatched — flag for manual review rather than mis-slice (spec §11)
    await query(
      `UPDATE calligraphy_plates SET status='failed', model=$2, cost_usd=$3, sheet_path=$4, error=$5 WHERE id = ANY($1)`,
      [batch.map((b) => b.id), model, perCost, sheet ? sheet.url : null,
       `crop mismatch after ${MAX_CROP_TRIES} tries: expected ${batch.length}, got ${lastCount}`]);
    const c = await jobCounts(jobId);
    return res.json({ data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId), review: true, attempts: attemptsUsed, plates: [] } });
  }

  const updated = [];
  for (let i = 0; i < batch.length; i++) {
    const plate = saveBufferToUploads(req, 'calligraphy/plates', plates[i], 'png');
    const { rows } = await query(
      `UPDATE calligraphy_plates SET status='done', model=$2, cost_usd=$3, sheet_path=$4, plate_path=$5, error=NULL
        WHERE id=$1 RETURNING *`,
      [batch[i].id, model, perCost, sheet.url, plate.url]);
    updated.push(toPlate(rows[0]));
  }
  const c = await jobCounts(jobId);
  res.json({ data: { processed: updated.length, ...c, remaining: c.pending, job_cost: await jobCost(jobId), attempts: attemptsUsed, plates: updated } });
}

// GET /jobs/:jobId
async function getJob(req, res) {
  const { jobId } = req.params;
  const { rows } = await query(`SELECT * FROM calligraphy_plates WHERE job_id=$1 ORDER BY created_at`, [jobId]);
  if (!rows.length) return bad(res, 'المهمة غير موجودة', 'ERR_NOT_FOUND', 404);
  const c = await jobCounts(jobId);
  res.json({ data: { job_id: jobId, ...c, job_cost: await jobCost(jobId), plates: rows.map(toPlate) } });
}

// POST /plates/:id/reroll
async function reroll(req, res) {
  const { id } = req.params;
  const { rows: pr } = await query(`SELECT * FROM calligraphy_plates WHERE id=$1`, [id]);
  if (!pr.length) return bad(res, 'الصورة غير موجودة', 'ERR_NOT_FOUND', 404);
  const p = pr[0];
  const model = p.model || MODELS.standard;
  let gen;
  try { gen = await generateImage({ model, prompt: buildSinglePrompt(p.render_text, p.variant, p.element_text) }); }
  catch (err) { return res.status(err.status || 502).json({ error: err.message, code: err.code || 'ERR_OPENROUTER' }); }
  // single-name image: trim to one band (expected 1); fall back to full image
  let plateBuf = gen.buffer;
  try { const { plates } = await cropSheet(gen.buffer, 1); if (plates[0]) plateBuf = plates[0]; } catch { /* keep full */ }
  const plate = saveBufferToUploads(req, 'calligraphy/plates', plateBuf, 'png');
  const { rows } = await query(
    `UPDATE calligraphy_plates SET status='done', plate_path=$2, cost_usd = cost_usd + $3, error=NULL,
            linked_at = NULL WHERE id=$1 RETURNING *`,
    [id, plate.url, Number(gen.cost || 0)]);
  res.json({ data: toPlate(rows[0]) });
}

// POST /plates/:id/link — write plate onto the order_item's customer_image_url
async function linkToOrder(req, res) {
  const { id } = req.params;
  const { rows: pr } = await query(`SELECT * FROM calligraphy_plates WHERE id=$1`, [id]);
  if (!pr.length) return bad(res, 'الصورة غير موجودة', 'ERR_NOT_FOUND', 404);
  const p = pr[0];
  if (!p.order_item_id) return bad(res, 'لا يوجد طلب مرتبط بهذه الصورة');
  if (!p.plate_path || p.status !== 'done') return bad(res, 'الصورة غير جاهزة بعد');
  const upd = await query(`UPDATE order_items SET customer_image_url=$2 WHERE id=$1 RETURNING id`, [p.order_item_id, p.plate_path]);
  if (!upd.rows.length) return bad(res, 'بند الطلب غير موجود', 'ERR_NOT_FOUND', 404);
  await query(`UPDATE calligraphy_plates SET linked_at = NOW() WHERE id=$1`, [id]);
  res.json({ data: { ok: true, order_item_id: p.order_item_id, url: p.plate_path } });
}

// GET /jobs/:jobId/download
async function downloadZip(req, res) {
  const { jobId } = req.params;
  const includeSheets = String(req.query.sheets || '0') === '1';
  const { rows } = await query(
    `SELECT render_text, plate_path, sheet_path FROM calligraphy_plates
      WHERE job_id=$1 AND status='done' AND plate_path IS NOT NULL ORDER BY created_at`, [jobId]);
  if (!rows.length) return bad(res, 'لا توجد صور جاهزة للتنزيل', 'ERR_NOT_FOUND', 404);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="calligraphy-${jobId.slice(0, 8)}.zip"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (e) => { console.error('zip error', e); try { res.status(500).end(); } catch {} });
  archive.pipe(res);
  const { absFromUrl } = require('../lib/upload');
  const used = new Set();
  for (const r of rows) {
    const safe = (r.render_text || 'name').replace(/[\/\\:*?"<>|]+/g, '_').slice(0, 40);
    let name = `${safe}.png`; let n = 2;
    while (used.has(name)) name = `${safe}-${n++}.png`;
    used.add(name);
    const abs = absFromUrl(r.plate_path);
    if (abs) archive.file(abs, { name });
    if (includeSheets && r.sheet_path) { const s = absFromUrl(r.sheet_path); if (s) archive.file(s, { name: `sheets/${safe}-sheet.png` }); }
  }
  archive.finalize();
}

// ---------------------------------------------------------------------------
// GET /queue — per-zone pending count + up to 200 item previews
// ---------------------------------------------------------------------------
async function getQueue(req, res) {
  const data = {};
  for (const variant of VARIANTS) {
    // TRUE count: pool with a high limit so we never under-count
    const full = await poolFor(variant, 10000);
    const items = full.slice(0, 200).map(({ wholesaler_id: _wid, ...rest }) => rest); // strip wholesaler_id
    data[variant] = { pending: full.length, items };
  }
  res.json({ data });
}

// ---------------------------------------------------------------------------
// POST /queue/generate — create a job from the pending pool for one variant
// body: { variant: 'front'|'back'|'cap', mode: 'full'|'all' }
// ---------------------------------------------------------------------------
async function queueGenerate(req, res) {
  const { variant, mode } = req.body || {};
  if (!VARIANTS.includes(variant)) return bad(res, 'variant غير صالح — يجب أن يكون front أو back أو cap');
  if (!['full', 'all'].includes(mode)) return bad(res, 'mode غير صالح — يجب أن يكون full أو all');

  const pool = await poolFor(variant, 1000);
  if (!pool.length) return bad(res, 'لا توجد أسماء بانتظار التوليد', 'ERR_EMPTY', 400);

  let selected;
  if (mode === 'full') {
    const fullSheets = Math.floor(pool.length / BATCH);
    if (fullSheets === 0) {
      return bad(res, 'لا توجد أسماء كافية لورقة كاملة (١٠) — انتظر وصول المزيد', 'ERR_NOT_ENOUGH', 400);
    }
    selected = pool.slice(0, fullSheets * BATCH);
  } else {
    // mode === 'all'
    selected = pool;
  }

  const jobId = crypto.randomUUID();
  const plates = await insertPlates(jobId, selected.map((it) => ({ ...it })), {
    source: 'wholesaler', model: MODELS.standard, createdBy: req.user.id,
  });
  res.status(201).json({ data: { job_id: jobId, total: plates.length, dropped: [], plates } });
}

// ---------------------------------------------------------------------------
// GET /recent?limit=60 — recent done plates for UI survival across refresh
// ---------------------------------------------------------------------------
async function recentPlates(req, res) {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 60));
  const { rows } = await query(
    `SELECT * FROM calligraphy_plates WHERE status='done' ORDER BY created_at DESC LIMIT $1`,
    [limit]);
  res.json({ data: { plates: rows.map(toPlate) } });
}

// POST /plates/:id/compose — receive merged PNG from the compositor, save as new plate image
async function composePlate(req, res) {
  const { id } = req.params;
  const { rows: pr } = await query(`SELECT * FROM calligraphy_plates WHERE id=$1`, [id]);
  if (!pr.length) return bad(res, 'الصورة غير موجودة', 'ERR_NOT_FOUND', 404);
  if (!req.file || !req.file.buffer) return bad(res, 'لم يتم استلام الصورة');
  const saved = saveBufferToUploads(req, 'calligraphy/plates', req.file.buffer, 'png');
  const { rows } = await query(
    `UPDATE calligraphy_plates SET plate_path=$2, linked_at=NULL, status='done' WHERE id=$1 RETURNING *`,
    [id, saved.url]);
  res.json({ data: toPlate(rows[0]) });
}

// POST /element — generate a standalone motif for the compositor (white bg → transparent)
async function generateElement(req, res) {
  const word = String((req.body && req.body.word) || '').trim();
  if (!word) return bad(res, 'اكتب اسم العنصر');
  if (word.length > 60) return bad(res, 'اسم العنصر طويل جداً (الحد 60 حرفاً)');
  const { buildElementPrompt } = require('../lib/calligraphyPrompt');
  const { whiteToTransparent } = require('../lib/imageFx');
  let gen;
  try {
    gen = await generateImage({ model: MODELS.standard, prompt: buildElementPrompt(word), resolution: '1K', aspectRatio: '1:1' });
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message || 'فشل التوليد', code: err.code || 'ERR_OPENROUTER' });
  }
  const png = await whiteToTransparent(gen.buffer);
  const saved = saveBufferToUploads(req, 'calligraphy/elements', png, 'png');
  res.json({ data: { url: saved.url, cost: Number(gen.cost || 0) } });
}

module.exports = {
  listWholesalers, wholesalerNames, createJob, processNext, getJob, reroll, linkToOrder, downloadZip,
  getQueue, queueGenerate, recentPlates, composePlate, generateElement,
};
