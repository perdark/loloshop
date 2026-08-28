// backend/lib/calligraphyEngine.js
// Single source of truth for "process the next batch of ≤10 pending plates" of a
// calligraphy job. Called by BOTH the HTTP endpoint (calligraphyController.processNext)
// and the pg-boss worker (worker.js) — it never touches req/res. `req` is optional and
// only threads into saveBufferToUploads for dev-host public URLs (null in the worker).
const { query } = require('./db');
const { generateImage, MODELS } = require('./openrouter');
const { cropSheet } = require('./sheetCrop');
const { buildSheetPrompt, buildSinglePrompt } = require('./calligraphyPrompt');
const { saveBufferToUploads } = require('./upload');
const { looksLikeInstruction } = require('./calligraphyText');
const { checkBudget, budgetError, logSpend, notifyCreditExhausted } = require('./calligraphySpend');

const BATCH = 10;
// Upstream failures that are about the SHOP's account or the wire, never about these names.
// Callers must not retire a plate for one — see the catch in processNextBatch.
const INFRA_CODES = new Set(['ERR_OPENROUTER_CREDIT', 'ERR_OPENROUTER_NET', 'ERR_OPENROUTER_KEY']);
// The prompt library only knows front/back/cap styles — cap_side renders with the cap style.
const promptVariant = (v) => (v === 'cap_side' ? 'cap' : v);

function toPlate(r) {
  return {
    id: r.id, render_text: r.render_text, status: r.status,
    variant: r.variant, element_text: r.element_text,
    // Style id from the closed list, or null for the shop default (migration 083). The card
    // shows it so a designer can see WHY two plates of the same zone look different.
    style: r.style || null,
    plate_path: r.plate_path, sheet_path: r.sheet_path,
    student_id: r.student_id, order_item_id: r.order_item_id,
    linked: !!r.linked_at, cost_usd: Number(r.cost_usd || 0), error: r.error,
    // How many paid regenerations this plate has already had, so the workbench can grey
    // «إعادة التوليد» out at the cap instead of letting the button 429.
    reroll_count: Number(r.reroll_count || 0),
    // The stored text reads as a message to the shop rather than a name. The classifier lives
    // on the server so the workbench and the queue can never disagree about what counts —
    // rerolling one of these without correcting the text just buys the same mistake again.
    text_is_instruction: looksLikeInstruction(r.render_text),
  };
}

// «ربط بالطلب» removed (user 2026-07-15): a finished plate attaches itself to its order
// line immediately — the plate IS the design the later stations see. Idempotent; a deleted
// order line just leaves the plate unlinked (it falls into the «بدون طلب» group).
//
// ⚠️ THIS WRITES `plate_image_url`, NEVER `customer_image_url` (migration 080). Until
// 2026-08-13 it wrote the customer's column unconditionally, so every generate / reroll /
// compose deleted the reference photo the student had uploaded — 459 prod lines across 628
// link events, 27 of them carrying text that pointed AT the photo being deleted. The two
// meanings now live in two columns and this one owns exactly one of them. Any future writer
// of student-supplied media belongs in customer_image_url and nowhere near here.
async function autoLinkPlate(plateRow) {
  if (!plateRow || !plateRow.order_item_id || !plateRow.plate_path) return plateRow;
  const upd = await query(
    `UPDATE order_items SET plate_image_url = $2 WHERE id = $1 RETURNING id`,
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
    `SELECT variant, style FROM calligraphy_plates WHERE job_id=$1 AND status='pending' ORDER BY created_at LIMIT 1`,
    [jobId]);
  if (!head.length) {
    const c = await jobCounts(jobId);
    return { data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId), plates: [] } };
  }
  const variant = head[0].variant;
  // STYLE is part of the sheet identity, not just the variant (migration 083). One sheet is one
  // prompt, and a prompt carries exactly one style clause — mixing «مد الحروف» with the default
  // in one image makes the model drift across all ten names, and a ruined sheet is a $0.10
  // re-run, not a free retry. Grouping costs nothing: ten styled names still ride ONE image.
  const style = head[0].style || null;
  const { rows: batch } = await query(
    `SELECT * FROM calligraphy_plates
      WHERE job_id=$1 AND status='pending' AND variant=$3 AND COALESCE(style,'') = COALESCE($4,'')
      ORDER BY created_at LIMIT $2`,
    [jobId, BATCH, variant, style]);
  if (!batch.length) {
    const c = await jobCounts(jobId);
    return { data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId), plates: [] } };
  }
  const model = batch[0].model || MODELS.standard;

  // CROSS-JOB TOP-UP (2026-08-18 cost audit). A sheet costs the same $0.10 whether it carries
  // 1 name or 10, and 47% of lifetime spend went to under-filled sheets (34 sheets carried a
  // single name). When this job cannot fill the sheet, take the oldest pending plates of the
  // SAME variant and model from other jobs — the style prompt is per-variant, not per-job, so
  // the artwork is identical; every pending plate has already passed createJob's guards
  // (retail rows are reviewed BEFORE their job exists). Hitchhikers are updated in the DB but
  // NOT reported in this response: counts and `plates` stay scoped to the requested job so the
  // workbench and the worker's drain loop see exactly what they always saw, and each
  // hitchhiker's own job simply finds less to do.
  let hitchhikers = [];
  if (batch.length < BATCH) {
    const { rows } = await query(
      `SELECT * FROM calligraphy_plates
        WHERE status='pending' AND variant=$1 AND job_id <> $2
          AND COALESCE(model,'') = COALESCE($3,'')
          AND COALESCE(style,'') = COALESCE($5,'')
        ORDER BY created_at LIMIT $4`,
      [variant, jobId, batch[0].model || null, BATCH - batch.length, style]);
    hitchhikers = rows;
  }
  const sheetBatch = batch.concat(hitchhikers);
  const names = sheetBatch.map((b) => ({ text: b.render_text, element: b.element_text }));

  // Daily ceiling BEFORE any money leaves. Plates stay PENDING, never failed: the worker
  // throws this and pg-boss retries twice (~90s) then gives the ticket up, after which the
  // plates are drained by the workbench's «معالجة» press once the 24h window frees — or by
  // ANY later job's batch, which picks them up as hitchhikers via the top-up above.
  const budget = await checkBudget();
  if (!budget.allowed) {
    const c = await jobCounts(jobId);
    return {
      error: budgetError(budget),
      data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId), plates: [] },
    };
  }

  // Generate + crop with AUTO-RETRY. The model spaces lines randomly, so a sheet
  // that crops to the wrong band count usually slices cleanly on a fresh generation.
  // cropSheet now also salvages too-few-band sheets (gap segmentation), so a single
  // retry is enough in the rare case it still mismatches — keep the cap LOW to bound
  // cost (each retry is a full paid image). Flag for manual review only if every
  // attempt mismatches (never mis-slice — §11).
  const MAX_CROP_TRIES = 2;
  // A BATCH OF ONE IS NOT A SHEET — buy what a reroll buys (2026-08-28 cost audit). Measured on
  // prod over the 10 days the ledger existed: 110 of 175 paid images carried a single name, at
  // $0.101 each, which is 63% of all sheet money bought at TEN TIMES the per-name price of a
  // full sheet ($0.010). The 2K 9:16 canvas exists to stack ten bands with croppable gaps; one
  // name uses none of that and the band is normalized to the sibling geometry afterwards
  // anyway. This is byte-for-byte the configuration `reroll` has used since 2026-08-18 —
  // 1K 1:1, buildSinglePrompt, ~$0.067 — across 62 accepted presses, so it is proven artwork,
  // not a new experiment. Resolution does not drop, it RISES: a 2K 9:16 sheet gives each of ten
  // stacked bands ~200px of height, while a 1K 1:1 canvas gives this one name up to 1024px.
  // buildSheetPrompt is wrong here for a second reason — it would order the model to "spread
  // them out to fill the whole height" with a single line to spread.
  //
  // ⚠️ The crop path below is deliberately NOT shortcut for solo. `reroll` may fall back to the
  // uncropped canvas because matchPlateGeometry reframes it onto the original band afterwards;
  // nothing on THIS path does, so an uncropped plate would reach order_items.plate_image_url
  // full of white margin and be stitched that way. A solo crop mismatch takes the same paid
  // retry, then the same manual review, that a ten-name sheet takes.
  const solo = sheetBatch.length === 1;
  let plates = null;
  let sheet = null;
  let totalCost = 0;
  let lastCount = null;
  let attemptsUsed = 0;
  for (let attempt = 1; attempt <= MAX_CROP_TRIES; attempt++) {
    attemptsUsed = attempt;
    let gen;
    try {
      gen = solo
        ? await generateImage({
            model,
            prompt: buildSinglePrompt(sheetBatch[0].render_text, promptVariant(variant),
              sheetBatch[0].element_text || null, style),
            resolution: '1K',
            aspectRatio: '1:1',
          })
        : await generateImage({ model, prompt: buildSheetPrompt(names, promptVariant(variant), style) });
    } catch (err) {
      // ⚠️ AN OUTAGE IS NOT THE PLATE'S FAULT — do not burn the work for it (2026-08-28).
      // Out of credit or the network down says nothing about these names: the same batch will
      // generate perfectly once money or connectivity returns. Marking them `failed` threw
      // that away — on 2026-08-28 nine real students' plates were retired by one 402 — while
      // the ceiling in checkBudget above, for the very same "cannot buy right now" situation,
      // has always left them PENDING. These now agree. Pending is also self-healing: the
      // workbench's «معالجة» press or ANY later job's top-up picks them straight back up.
      if (INFRA_CODES.has(err.code)) {
        // AWAITED, not fired and forgotten: this is a rare error path where latency costs
        // nothing, and the worker may be recycled by pg-boss the moment we return — a
        // detached insert would be the notification that never arrives.
        if (err.code === 'ERR_OPENROUTER_CREDIT') await notifyCreditExhausted();
        const c = await jobCounts(jobId);
        return {
          error: { status: err.status || 502, message: err.message, code: err.code },
          data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId), plates: [] },
        };
      }
      // A real generation failure. Only the requesting job's plates fail — nothing was paid for
      // THIS attempt, and a hitchhiker left pending simply rides its own job's next batch.
      await query(`UPDATE calligraphy_plates SET status='failed', error=$2 WHERE id = ANY($1)`,
        [batch.map((b) => b.id), err.code || 'ERR_OPENROUTER']);
      const c = await jobCounts(jobId);
      return {
        error: { status: err.status || 502, message: err.message || 'فشل التوليد', code: err.code || 'ERR_OPENROUTER' },
        data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId), plates: [] },
      };
    }
    totalCost += Number(gen.cost || 0);
    await logSpend('sheet', gen.cost); // ledger the image the moment it is paid — retries included
    sheet = saveBufferToUploads(req, 'calligraphy/sheets', gen.buffer, 'png'); // keep latest (review fallback)
    let cropped;
    try {
      cropped = await cropSheet(gen.buffer, sheetBatch.length);
    } catch (err) {
      console.error('crop threw:', err.message);
      cropped = { plates: [], count: -1 };
    }
    lastCount = cropped.count;
    if (cropped.count === sheetBatch.length) { plates = cropped.plates; break; }
    console.warn(`crop mismatch attempt ${attempt}/${MAX_CROP_TRIES}: expected ${sheetBatch.length}, got ${cropped.count} — regenerating`);
  }

  const perCost = sheetBatch.length ? totalCost / sheetBatch.length : 0;

  if (!plates) {
    // every attempt mismatched — flag for manual review rather than mis-slice (spec §11).
    // Hitchhikers fail too: their bands are on the paid sheet that needs the review.
    await query(
      `UPDATE calligraphy_plates SET status='failed', model=$2, cost_usd=$3, sheet_path=$4, error=$5 WHERE id = ANY($1)`,
      [sheetBatch.map((b) => b.id), model, perCost, sheet ? sheet.url : null,
       `crop mismatch after ${MAX_CROP_TRIES} tries: expected ${sheetBatch.length}, got ${lastCount}`]);
    const c = await jobCounts(jobId);
    return { data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId), review: true, attempts: attemptsUsed, plates: [] } };
  }

  const updated = [];
  for (let i = 0; i < sheetBatch.length; i++) {
    const plate = saveBufferToUploads(req, 'calligraphy/plates', plates[i], 'png');
    const { rows } = await query(
      `UPDATE calligraphy_plates SET status='done', model=$2, cost_usd=$3, sheet_path=$4, plate_path=$5, error=NULL,
              original_plate_path = COALESCE(original_plate_path, $5)
        WHERE id=$1 RETURNING *`,
      [sheetBatch[i].id, model, perCost, sheet.url, plate.url]);
    updated.push(toPlate(await autoLinkPlate(rows[0])));
  }
  // Response stays scoped to the requested job (sheetBatch = batch ++ hitchhikers, order kept).
  const own = updated.slice(0, batch.length);
  const c = await jobCounts(jobId);
  return { data: { processed: own.length, ...c, remaining: c.pending, job_cost: await jobCost(jobId), attempts: attemptsUsed, hitchhikers: hitchhikers.length, plates: await attachOrderContext(own) } };
}

module.exports = {
  processNextBatch, toPlate, autoLinkPlate, attachOrderContext,
  jobCounts, jobCost, promptVariant, BATCH,
};
