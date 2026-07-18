// backend/lib/calligraphyEngine.js
// Single source of truth for "process the next batch of ≤10 pending plates" of a
// calligraphy job. Called by BOTH the HTTP endpoint (calligraphyController.processNext)
// and the pg-boss worker (worker.js) — it never touches req/res. `req` is optional and
// only threads into saveBufferToUploads for dev-host public URLs (null in the worker).
const { query } = require('./db');
const { generateImage, MODELS } = require('./openrouter');
const { cropSheet } = require('./sheetCrop');
const { buildSheetPrompt } = require('./calligraphyPrompt');
const { saveBufferToUploads } = require('./upload');

const BATCH = 10;
// The prompt library only knows front/back/cap styles — cap_side renders with the cap style.
const promptVariant = (v) => (v === 'cap_side' ? 'cap' : v);

function toPlate(r) {
  return {
    id: r.id, render_text: r.render_text, status: r.status,
    variant: r.variant, element_text: r.element_text,
    plate_path: r.plate_path, sheet_path: r.sheet_path,
    student_id: r.student_id, order_item_id: r.order_item_id,
    linked: !!r.linked_at, cost_usd: Number(r.cost_usd || 0), error: r.error,
  };
}

// «ربط بالطلب» removed (user 2026-07-15): a finished plate attaches itself to its order
// line immediately — the plate IS the design the later stations see. Idempotent; a deleted
// order line just leaves the plate unlinked (it falls into the «بدون طلب» group).
async function autoLinkPlate(plateRow) {
  if (!plateRow || !plateRow.order_item_id || !plateRow.plate_path) return plateRow;
  const upd = await query(
    `UPDATE order_items SET customer_image_url = $2 WHERE id = $1 RETURNING id`,
    [plateRow.order_item_id, plateRow.plate_path]);
  if (!upd.rows.length) return plateRow;
  const { rows } = await query(
    `UPDATE calligraphy_plates SET linked_at = NOW() WHERE id = $1 RETURNING *`, [plateRow.id]);
  return rows[0] || plateRow;
}

// Batch-attach order context (student/product/status/zone/rep) onto plate DTOs so the
// workbench can group by order without N+1 requests. Plates with no order line pass through.
async function attachOrderContext(plates) {
  const ids = [...new Set(plates.map((p) => p.order_item_id).filter(Boolean))];
  if (!ids.length) return plates.map((p) => ({ ...p, order_id: null }));
  const { rows } = await query(
    `SELECT oi.id AS order_item_id, oi.order_id, oi.label_snapshot,
            o.status::text AS order_status,
            u.name AS student_name, p.name_ar AS product_name, p.type AS product_type,
            s.wholesaler_id, wu.name AS wholesaler_name
       FROM order_items oi
       JOIN orders o    ON o.id = oi.order_id
       JOIN students s  ON s.id = o.student_id
       JOIN users u     ON u.id = s.user_id
       JOIN products p  ON p.id = o.product_id
       LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
       LEFT JOIN users wu ON wu.id = w.user_id
      WHERE oi.id = ANY($1)`, [ids]);
  const byId = new Map(rows.map((r) => [r.order_item_id, r]));
  return plates.map((p) => {
    const ctx = p.order_item_id ? byId.get(p.order_item_id) : null;
    if (!ctx) return { ...p, order_id: null };
    return {
      ...p,
      order_id: ctx.order_id,
      order_status: ctx.order_status,
      zone_label: ctx.label_snapshot,
      student_name: ctx.student_name,
      product_name: ctx.product_name,
      product_type: ctx.product_type,
      wholesaler_id: ctx.wholesaler_id,
      wholesaler_name: ctx.wholesaler_name,
    };
  });
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

// Process the next batch of ≤BATCH pending plates (single-variant per sheet).
// Returns { data } on success/no-work/crop-review, or { error: {status,message,code},
// data } when the upstream generator failed (the HTTP wrapper turns that into the
// same status/JSON the endpoint always sent; the worker throws it for pg-boss retry).
async function processNextBatch(jobId, req = null) {
  // Pick the variant of the OLDEST pending plate, then take up to BATCH of that variant.
  // This guarantees one sheet = one prompt (front and back must never share a sheet).
  const { rows: head } = await query(
    `SELECT variant FROM calligraphy_plates WHERE job_id=$1 AND status='pending' ORDER BY created_at LIMIT 1`,
    [jobId]);
  if (!head.length) {
    const c = await jobCounts(jobId);
    return { data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId), plates: [] } };
  }
  const variant = head[0].variant;
  const { rows: batch } = await query(
    `SELECT * FROM calligraphy_plates WHERE job_id=$1 AND status='pending' AND variant=$3 ORDER BY created_at LIMIT $2`,
    [jobId, BATCH, variant]);
  if (!batch.length) {
    const c = await jobCounts(jobId);
    return { data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId), plates: [] } };
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
      gen = await generateImage({ model, prompt: buildSheetPrompt(names, promptVariant(variant)) });
    } catch (err) {
      await query(`UPDATE calligraphy_plates SET status='failed', error=$2 WHERE id = ANY($1)`,
        [batch.map((b) => b.id), err.code || 'ERR_OPENROUTER']);
      const c = await jobCounts(jobId);
      return {
        error: { status: err.status || 502, message: err.message || 'فشل التوليد', code: err.code || 'ERR_OPENROUTER' },
        data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId), plates: [] },
      };
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
    return { data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId), review: true, attempts: attemptsUsed, plates: [] } };
  }

  const updated = [];
  for (let i = 0; i < batch.length; i++) {
    const plate = saveBufferToUploads(req, 'calligraphy/plates', plates[i], 'png');
    const { rows } = await query(
      `UPDATE calligraphy_plates SET status='done', model=$2, cost_usd=$3, sheet_path=$4, plate_path=$5, error=NULL
        WHERE id=$1 RETURNING *`,
      [batch[i].id, model, perCost, sheet.url, plate.url]);
    updated.push(toPlate(await autoLinkPlate(rows[0])));
  }
  const c = await jobCounts(jobId);
  return { data: { processed: updated.length, ...c, remaining: c.pending, job_cost: await jobCost(jobId), attempts: attemptsUsed, plates: await attachOrderContext(updated) } };
}

module.exports = {
  processNextBatch, toPlate, autoLinkPlate, attachOrderContext,
  jobCounts, jobCost, promptVariant, BATCH,
};
