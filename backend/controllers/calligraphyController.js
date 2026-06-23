// backend/controllers/calligraphyController.js
const crypto = require('crypto');
const archiver = require('archiver');
const { query } = require('../lib/db');
const { generateImage, MODELS } = require('../lib/openrouter');
const { cropSheet } = require('../lib/sheetCrop');
const { buildSheetPrompt, buildSinglePrompt } = require('../lib/calligraphyPrompt');
const { saveBufferToUploads } = require('../lib/upload');

const FRONT_LABEL = 'تطريز الوشاح من الأمام';
const BATCH = 10;

function bad(res, msg, code = 'ERR_VALIDATION', status = 400) {
  return res.status(status).json({ error: msg, code });
}
function pickModel(model) {
  return model === 'premium' ? MODELS.premium : MODELS.standard;
}
function toPlate(r) {
  return {
    id: r.id, render_text: r.render_text, status: r.status,
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

// GET /wholesalers/:id/names — grab list from the sash front-embroidery line
async function wholesalerNames(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    `SELECT s.id AS student_id, u.name AS student_name,
            oi.id AS order_item_id, oi.customer_text AS render_text,
            cp.id AS plate_id, cp.status AS plate_status, cp.plate_path, cp.linked_at
       FROM students s
       JOIN users u   ON u.id = s.user_id
       JOIN orders o  ON o.student_id = s.id AND o.status::text <> 'cancelled'
       JOIN products p ON p.id = o.product_id AND p.type = 'sash'
       JOIN order_items oi ON oi.order_id = o.id AND oi.label_snapshot = $2
       LEFT JOIN LATERAL (
            SELECT id, status, plate_path, linked_at FROM calligraphy_plates c
             WHERE c.order_item_id = oi.id ORDER BY created_at DESC LIMIT 1
       ) cp ON TRUE
      WHERE s.wholesaler_id = $1 AND COALESCE(oi.customer_text,'') <> ''
      ORDER BY u.name`, [id, FRONT_LABEL]);
  res.json({ data: rows.map((r) => ({
    student_id: r.student_id, student_name: r.student_name,
    order_item_id: r.order_item_id, render_text: r.render_text,
    plate_id: r.plate_id, plate_status: r.plate_status,
    plate_path: r.plate_path, linked: !!r.linked_at,
  })) });
}

// POST /jobs — create pending rows (dedup), no generation yet
async function createJob(req, res) {
  const { source, wholesaler_id = null, model = 'standard' } = req.body || {};
  let items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
  if (!['typed', 'wholesaler', 'txt'].includes(source)) return bad(res, 'مصدر غير صالح');
  items = items
    .map((it) => ({
      render_text: String((it && it.render_text) || '').trim(),
      student_id: (it && it.student_id) || null,
      order_item_id: (it && it.order_item_id) || null,
    }))
    .filter((it) => it.render_text);
  if (!items.length) return bad(res, 'لا توجد أسماء صالحة');
  if (items.length > 1000) return bad(res, 'الحد الأقصى 1000 اسم لكل مهمة');

  // Dedup: wholesaler → by order_item_id; typed/txt → by exact render_text.
  const seen = new Set();
  items = items.filter((it) => {
    const key = source === 'wholesaler' ? (it.order_item_id || it.render_text) : it.render_text;
    if (seen.has(key)) return false; seen.add(key); return true;
  });

  const jobId = crypto.randomUUID();
  const out = [];
  for (const it of items) {
    const { rows } = await query(
      `INSERT INTO calligraphy_plates (job_id, wholesaler_id, student_id, order_item_id, source, render_text, status, model, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8) RETURNING *`,
      [jobId, wholesaler_id, it.student_id, it.order_item_id, source, it.render_text, pickModel(model), req.user.id]);
    out.push(toPlate(rows[0]));
  }
  res.status(201).json({ data: { job_id: jobId, total: out.length, plates: out } });
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

// POST /jobs/:jobId/process — next batch of <=10 pending
async function processNext(req, res) {
  const { jobId } = req.params;
  const { rows: batch } = await query(
    `SELECT * FROM calligraphy_plates WHERE job_id=$1 AND status='pending' ORDER BY created_at LIMIT $2`,
    [jobId, BATCH]);
  if (!batch.length) {
    const c = await jobCounts(jobId);
    return res.json({ data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId), plates: [] } });
  }
  const model = batch[0].model || MODELS.standard;
  const names = batch.map((b) => b.render_text);

  let gen;
  try {
    gen = await generateImage({ model, prompt: buildSheetPrompt(names) });
  } catch (err) {
    // mark this batch failed (no charge persisted), surface error
    await query(`UPDATE calligraphy_plates SET status='failed', error=$2 WHERE id = ANY($1)`,
      [batch.map((b) => b.id), err.code || 'ERR_OPENROUTER']);
    const c = await jobCounts(jobId);
    return res.status(err.status || 502).json({ error: err.message || 'فشل التوليد', code: err.code || 'ERR_OPENROUTER',
      data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId), plates: [] } });
  }

  const sheet = saveBufferToUploads(req, 'calligraphy/sheets', gen.buffer, 'png');
  const perCost = batch.length ? gen.cost / batch.length : 0;

  let plates;
  try {
    const cropped = await cropSheet(gen.buffer, batch.length);
    plates = cropped.plates;
    if (cropped.count !== batch.length) {
      // spec §11: don't mis-slice — flag whole batch for manual review, keep the sheet
      await query(
        `UPDATE calligraphy_plates SET status='failed', model=$2, cost_usd=$3, sheet_path=$4,
                error=$5 WHERE id = ANY($1)`,
        [batch.map((b) => b.id), model, perCost, sheet.url,
         `crop mismatch: expected ${batch.length}, got ${cropped.count}`]);
      const c = await jobCounts(jobId);
      return res.json({ data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId),
        review: true, plates: [] } });
    }
  } catch (err) {
    console.error('crop failed:', err.message);
    await query(`UPDATE calligraphy_plates SET status='failed', sheet_path=$2, error='crop error' WHERE id = ANY($1)`,
      [batch.map((b) => b.id), sheet.url]);
    return res.status(500).json({ error: 'فشل تقطيع الورقة', code: 'ERR_CROP' });
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
  res.json({ data: { processed: updated.length, ...c, remaining: c.pending, job_cost: await jobCost(jobId), plates: updated } });
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
  try { gen = await generateImage({ model, prompt: buildSinglePrompt(p.render_text) }); }
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

module.exports = { listWholesalers, wholesalerNames, createJob, processNext, getJob, reroll, linkToOrder, downloadZip };
