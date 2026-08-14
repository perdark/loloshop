// backend/controllers/calligraphyController.js
const crypto = require('crypto');
const fs = require('fs');
// archiver v8 dropped the callable default export in favour of named classes.
// The instance API (file/append/pipe/finalize/on) is unchanged. v8 is required:
// every release up to 7.0.1 is inside GHSA-mh99-v99m-4gvg (brace-expansion DoS).
const { ZipArchive } = require('archiver');
const sharp = require('sharp');
const { query } = require('../lib/db');
const { generateImage, MODELS } = require('../lib/openrouter');
const { cropSheet } = require('../lib/sheetCrop');
const { buildSheetPrompt, buildSinglePrompt } = require('../lib/calligraphyPrompt');
const { saveBufferToUploads } = require('../lib/upload');
const {
  processNextBatch, toPlate, autoLinkPlate, attachOrderContext,
  jobCounts, jobCost, promptVariant, BATCH,
} = require('../lib/calligraphyEngine');
const {
  isRealName, looksLikeInstruction, checkRenderText,
} = require('../lib/calligraphyText');
const { matchPlateGeometry } = require('../lib/imageFx');
const { enqueueGeneration } = require('../lib/queue');

const FRONT_LABEL    = 'تطريز الوشاح من الأمام';
const BACK_LABEL     = 'تطريز الوشاح من الخلف';
const CAP_TOP_LABEL  = 'تطريز القبعة من الأعلى';
const CAP_SIDE_LABEL = 'تطريز القبعة من الجانب';
const LABEL_VARIANT = {
  [FRONT_LABEL]: 'front', [BACK_LABEL]: 'back',
  [CAP_TOP_LABEL]: 'cap', [CAP_SIDE_LABEL]: 'cap_side',
};
const VARIANTS = ['front', 'back', 'cap', 'cap_side'];
// promptVariant / BATCH / plate helpers moved to lib/calligraphyEngine.js (shared
// with the pg-boss worker) and re-imported above.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(res, msg, code = 'ERR_VALIDATION', status = 400) {
  return res.status(status).json({ error: msg, code });
}
function pickModel(model) {
  return model === 'premium' ? MODELS.premium : MODELS.standard;
}
// isRealName + looksLikeInstruction moved to lib/calligraphyText.js 2026-08-13 (imported
// above) — the junk guard is now shared with the queue/pool and the reroll endpoint, and it
// gained a sibling that catches text the student wrote AT us rather than for the sash. Both
// are unit-tested against the real prod strings in test/calligraphyText.test.js.

// GET /wholesalers — pickers
async function listWholesalers(req, res) {
  const { rows } = await query(
    `SELECT w.id, u.name, COUNT(s.id)::int AS student_count
       FROM wholesalers w JOIN users u ON u.id = w.user_id
       LEFT JOIN students s ON s.wholesaler_id = w.id
      GROUP BY w.id, u.name ORDER BY u.name`);
  res.json({ data: rows });
}

// GET /wholesalers/:id/names — grab list from sash front/back AND cap top/side embroidery lines
async function wholesalerNames(req, res) {
  const { id } = req.params;
  const ALL_LABELS = [FRONT_LABEL, BACK_LABEL, CAP_TOP_LABEL, CAP_SIDE_LABEL];
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
               array_position(ARRAY['تطريز الوشاح من الأمام','تطريز الوشاح من الخلف','تطريز القبعة من الأعلى','تطريز القبعة من الجانب']::text[], oi.label_snapshot)`,
    [id, ALL_LABELS]);
  res.json({ data: rows.map((r) => ({
    student_id: r.student_id, student_name: r.student_name,
    order_item_id: r.order_item_id, render_text: r.render_text,
    variant: LABEL_VARIANT[r.label] || 'front',
    plate_id: r.plate_id, plate_status: r.plate_status,
    plate_path: r.plate_path, linked: !!r.linked_at,
    // This list is raw `customer_text`, so a share of it is students writing TO the shop.
    // Flagging it here is what lets «لصق أسماء» stop being the route those strings took into
    // the paid generator — the designer sees which rows are messages before ticking them.
    text_is_instruction: looksLikeInstruction(r.render_text),
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
// RETAIL (تجزئة) zone detection.
//
// The rep full-set form emits four EXACT labels (LABEL_VARIANT above) — that is what
// poolFor() and the automatic queue match on. Retail orders never do: they carry their
// own option labels ('تطريز يمين: تطريز يمين', 'القبعة من الجانب: بكتابة', …), so retail
// was invisible to the whole calligraphy tool and designers hand-copied every name into
// «لصق أسماء» (producing orphan plates with no order_item_id).
//
// Matching here is heuristic, deliberately mirroring productionController's ZONE_DEFS —
// the same regexes the embroidery checklist already trusts — so a zone the embroiderer
// sees is a zone the designer can plate. First match wins, like ZONE_DEFS.
//
// NOTE there is no variant mapping. Retail customer_text is free-form instruction
// ("تطريز من اليمين الدكتورة بان مع حرف ح"), not a clean name, so BOTH the text and the
// ornament variant are decided by the designer per zone in the workbench. Owner rule:
// ممثل = generate in bulk then review · تجزئة = review first, then generate.
// ---------------------------------------------------------------------------
const RETAIL_ZONES = [
  { key: 'sash_right', label: 'الوشاح — جهة اليمين', test: (l) => /يمين|اليمن/.test(l) },
  { key: 'sash_left',  label: 'الوشاح — جهة اليسار', test: (l) => /يسار|اليسر/.test(l) },
  { key: 'sash_back',  label: 'الوشاح — من الخلف',   test: (l) => /خلف/.test(l) },
  { key: 'sash_front', label: 'الوشاح — من الأمام',  test: (l) => /وشاح/.test(l) && /أمام/.test(l) },
  { key: 'cap_top',    label: 'القبعة — من الأعلى',  test: (l) => /أعلى|اعلى/.test(l) },
  { key: 'cap_side',   label: 'القبعة — من الجانب',  test: (l) => /جانب/.test(l) },
];
function retailZoneFor(label) {
  const l = String(label || '');
  if (/ردن/.test(l)) return null; // robe sleeves are not a calligraphy variant
  return RETAIL_ZONES.find((z) => z.test(l)) || null;
}

// GET /retail-queue — تجزئة students awaiting a calligraphy review («مراجعة قبل التوليد»).
// One card per retail order at «بانتظار التصميم» that carries embroidery text, with every
// detected zone, its RAW order text (reference only — never rewritten), any customer photo,
// and whether a plate already exists. Read-only: nothing is generated here.
async function retailQueue(req, res) {
  const search = String((req.query.search || '')).trim();
  const { rows } = await query(
    `SELECT o.id AS order_id, o.status::text AS order_status, o.created_at, o.notes,
            o.final_design_url,
            s.id AS student_id, s.instagram_username, s.university_name, s.department,
            u.name AS student_name,
            p.name_ar AS product_name, p.type AS product_type,
            oi.id AS order_item_id, oi.label_snapshot, oi.customer_text,
            oi.customer_image_url, oi.plate_image_url,
            EXISTS (SELECT 1 FROM calligraphy_plates cp
                     WHERE cp.order_item_id = oi.id AND cp.status = 'done') AS has_plate
       FROM orders o
       JOIN products p  ON p.id = o.product_id AND p.type IN ('sash','cap')
       JOIN students s  ON s.id = o.student_id AND s.wholesaler_id IS NULL
       JOIN users u     ON u.id = s.user_id
       JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status::text = 'design_complete'
        AND o.returned_to_customer = FALSE
        AND ($1 = '' OR u.name ILIKE '%' || $1 || '%'
                     OR COALESCE(s.university_name,'') ILIKE '%' || $1 || '%'
                     OR COALESCE(s.instagram_username,'') ILIKE '%' || $1 || '%')
      ORDER BY o.created_at DESC, oi.created_at`,
    [search]);

  const byOrder = new Map();
  for (const r of rows) {
    let card = byOrder.get(r.order_id);
    if (!card) {
      card = {
        order_id: r.order_id,
        order_status: r.order_status,
        created_at: r.created_at,
        notes: r.notes || null,
        final_design_url: r.final_design_url || null,
        student_id: r.student_id,
        student_name: r.student_name,
        instagram_username: r.instagram_username || null,
        university_name: r.university_name || null,
        department: r.department || null,
        product_name: r.product_name,
        product_type: r.product_type,
        zones: [],
        images: [],
      };
      byOrder.set(r.order_id, card);
    }
    // `images` is the student's OWN uploads and nothing else. Before migration 080 a
    // generated plate landed in this same column, so this strip filled up with machine
    // calligraphy presented to the designer as «صور الزبون» — the exact confusion that let
    // «تطريز هذه الصورة فقط» be rendered as words while the photo it named was deleted.
    if (r.customer_image_url && !card.images.includes(r.customer_image_url)) {
      card.images.push(r.customer_image_url);
    }
    const zone = retailZoneFor(r.label_snapshot);
    // A zone only needs a plate if the student actually wrote something for it.
    if (!zone || !String(r.customer_text || '').trim()) continue;
    if (card.zones.some((z) => z.zone_key === zone.key)) continue; // first match wins
    card.zones.push({
      order_item_id: r.order_item_id,
      zone_key: zone.key,
      zone_label: zone.label,
      label_snapshot: r.label_snapshot,
      raw_text: r.customer_text,
      customer_image_url: r.customer_image_url || null,
      plate_image_url: r.plate_image_url || null,
      has_plate: r.has_plate,
      // Reviewing BEFORE generating is the whole point of this screen (owner rule: «تجزئة =
      // review first, then generate»), so say out loud when the raw text is a message rather
      // than a name — the designer retypes it instead of paying for a plate of a sentence.
      text_is_instruction: looksLikeInstruction(r.customer_text),
    });
  }
  // Orders with no embroidery text at all are not calligraphy work — drop them.
  const orders = [...byOrder.values()].filter((c) => c.zones.length);
  res.json({
    data: {
      orders,
      pending_orders: orders.filter((c) => c.zones.some((z) => !z.has_plate)).length,
      pending_zones: orders.reduce((n, c) => n + c.zones.filter((z) => !z.has_plate).length, 0),
    },
  });
}

// ---------------------------------------------------------------------------
// Pool helper — un-plated embroidery names for a given zone variant.
// "Needs a plate" = order_item with the zone label + non-empty customer_text
// + no 'done' plate already. Applies isRealName junk-guard before returning.
// ---------------------------------------------------------------------------
const ZONE_LABEL = { front: FRONT_LABEL, back: BACK_LABEL, cap: CAP_TOP_LABEL, cap_side: CAP_SIDE_LABEL };

// EVERY line of this zone, partitioned into what the designer can act on. One query.
//
// WHY THIS REPLACED A "just give me the pool" QUERY (bug 6, 2026-08-13). The old poolFor
// asked SQL for lines with NO done plate and threw away anything that failed isRealName —
// so a line was either work or it silently did not exist. That produced two invisible
// populations the designer could never reach:
//
//   · plated — a junk plate generated from instruction text counts as `status='done'`, so the
//     line left the queue forever while its order stayed in «يخصّني الآن». Measured on prod:
//     55 orders across reps, محمد باقر 5 of 5, showing in his list and in no queue.
//   · held   — junk or instruction text, dropped by a JS filter after the query, reported
//     nowhere. The designer saw a smaller number and no reason.
//
// Nothing is dropped now; each line lands in exactly one bucket and getQueue returns all of
// them. `held` is the money-saving half (nothing paid runs on it) and `plated` is the
// visibility half (the queue and «يخصّني» finally describe the same orders).
async function zoneBuckets(variant, wholesalerId = null, limit = 10000) {
  const label = ZONE_LABEL[variant];
  if (!label) return { pool: [], held: [], plated: [] };
  const { rows } = await query(
    `SELECT oi.id AS order_item_id, s.id AS student_id, u.name AS student_name,
            oi.customer_text AS render_text, s.wholesaler_id, o.id AS order_id,
            cp.id AS plate_id, cp.plate_path
       FROM order_items oi
       JOIN orders o    ON o.id = oi.order_id AND o.status::text <> 'cancelled'
       JOIN products p  ON p.id = o.product_id AND p.type IN ('sash','cap')
       JOIN students s  ON s.id = o.student_id
       JOIN users u     ON u.id = s.user_id
       LEFT JOIN LATERAL (
            SELECT id, plate_path FROM calligraphy_plates c
             WHERE c.order_item_id = oi.id AND c.status = 'done'
             ORDER BY c.created_at DESC LIMIT 1
       ) cp ON TRUE
      WHERE oi.label_snapshot = $1 AND COALESCE(oi.customer_text,'') <> ''
        AND ($3::uuid IS NULL OR s.wholesaler_id = $3)
      ORDER BY o.created_at
      LIMIT $2`,
    [label, limit, wholesalerId]);

  const pool = []; const held = []; const plated = [];
  for (const r of rows) {
    const base = {
      order_item_id: r.order_item_id,
      student_id: r.student_id,
      student_name: r.student_name,
      render_text: r.render_text,
      variant,
      wholesaler_id: r.wholesaler_id,
    };
    if (r.plate_id) {
      plated.push({ ...base, order_id: r.order_id, plate_id: r.plate_id, plate_path: r.plate_path });
      continue;
    }
    const verdict = checkRenderText(r.render_text);
    if (verdict.ok) pool.push(base);
    else held.push({ ...base, order_id: r.order_id, reason: verdict.reason, hint: verdict.message });
  }
  return { pool, held, plated };
}

// The generatable pool only — what «توليد» is allowed to spend money on.
// `limit` now applies AFTER the guards, so asking for 1000 no longer returns 700 because
// 300 of the first thousand rows were junk.
async function poolFor(variant, limit = 1000, wholesalerId = null) {
  const { pool } = await zoneBuckets(variant, wholesalerId);
  return pool.slice(0, limit);
}

// POST /jobs — create pending rows (dedup), no generation yet
async function createJob(req, res) {
  const { source, wholesaler_id = null, model = 'standard' } = req.body || {};
  const jobVariant = VARIANTS.includes(req.body && req.body.variant) ? req.body.variant : 'front';
  let items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
  // 'txt' (upload a .txt of names) was removed from the UI 2026-07-21 and no caller remains;
  // 0 plates ever used it. The enum VALUE stays in the DB for safety, it is just not accepted.
  if (!['typed', 'wholesaler', 'retail'].includes(source)) return bad(res, 'مصدر غير صالح');
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

  // Junk + instruction guard (defense-in-depth), BEFORE any paid generation. The UI flags
  // these too, but a direct API call can't bypass it. Batch SIZE is intentionally NOT capped
  // here (admin's choice).
  //
  // THE GUARD IS SOURCE-AWARE, on the owner's rule «ممثل = generate in bulk then review ·
  // تجزئة = review first, then generate»:
  //   · typed/wholesaler — nobody has read these strings. A line that reads as a message to
  //     the shop («نفس الصوره») is dropped, not billed.
  //   · retail — a designer typed this text on the review board deliberately. Blocking them
  //     would be overruling the review that already happened, so instruction-looking text is
  //     WARNED about and still generated. Only genuine junk (no Arabic) is dropped.
  // `reviewed` is also settable per call — the workbench sets it when a designer has read one
  // held line and pressed generate on it deliberately. No word list is perfect (a sash verse
  // carrying «أريد» reads exactly like a request), and a guard with no override would strand
  // real work in «موقوف» forever, which is the failure this whole track is about.
  const reviewed = source === 'retail' || (req.body && req.body.reviewed === true);
  const dropped = [];
  const warned = [];
  items = items.filter((it) => {
    const verdict = checkRenderText(it.render_text);
    if (verdict.ok) return true;
    if (reviewed && verdict.reason === 'instruction') { warned.push(it.render_text); return true; }
    dropped.push(it.render_text);
    return false;
  });
  if (!items.length) return bad(res, 'لا توجد أسماء صالحة — تحقق من النص: قد يكون تعليمات للمحل وليس اسماً');
  if (items.length > 1000) return bad(res, 'الحد الأقصى 1000 اسم لكل مهمة');

  // Retail: the workbench sends a designer-cleaned render_text per order_item, so the TEXT is
  // trusted (that's the whole point) but the TARGET is not. Re-resolve every order_item_id
  // against the DB and keep only lines that really belong to a retail order — otherwise a
  // crafted call could staple arbitrary artwork onto a rep's order via autoLinkPlate().
  // student_id is taken from the DB too, never from the caller.
  if (source === 'retail') {
    const ids = [...new Set(items.map((it) => it.order_item_id).filter((id) => UUID_RE.test(String(id || ''))))];
    if (!ids.length) return bad(res, 'لا توجد مناطق صالحة');
    const { rows: owned } = await query(
      `SELECT oi.id AS order_item_id, s.id AS student_id
         FROM order_items oi
         JOIN orders o   ON o.id = oi.order_id AND o.status::text <> 'cancelled'
         JOIN products p ON p.id = o.product_id AND p.type IN ('sash','cap')
         JOIN students s ON s.id = o.student_id AND s.wholesaler_id IS NULL
        WHERE oi.id = ANY($1)`, [ids]);
    const studentByItem = new Map(owned.map((r) => [r.order_item_id, r.student_id]));
    items = items
      .filter((it) => studentByItem.has(it.order_item_id))
      .map((it) => ({ ...it, student_id: studentByItem.get(it.order_item_id) }));
    if (!items.length) return bad(res, 'لا توجد مناطق صالحة');
  }

  // Dedup:
  //   wholesaler/retail → by order_item_id (each zone row is already unique per student)
  //   typed/txt         → by variant::render_text (same name may appear as both front and back)
  const seen = new Set();
  items = items.filter((it) => {
    const key = (source === 'wholesaler' || source === 'retail')
      ? (it.order_item_id || it.render_text)
      : `${it.variant}::${it.render_text}`;
    if (seen.has(key)) return false; seen.add(key); return true;
  });

  const jobId = crypto.randomUUID();
  const out = await insertPlates(jobId, items.map((it) => ({ ...it, wholesaler_id })), {
    source, model: pickModel(model), createdBy: req.user.id,
  });
  enqueueGeneration(jobId); // server-side generation (worker); FE just polls getJob
  res.status(201).json({
    data: { job_id: jobId, total: out.length, dropped, warned, plates: await attachOrderContext(out) },
  });
}

// autoLinkPlate / attachOrderContext / jobCost / jobCounts moved to
// lib/calligraphyEngine.js (shared with the pg-boss worker) — imported above.

// POST /jobs/:jobId/process — next batch of <=10 pending (single-variant per sheet)
async function processNext(req, res) {
  const { jobId } = req.params;
  // Thin wrapper over the shared engine (lib/calligraphyEngine.js) — the pg-boss
  // worker runs the exact same code path. Response shape/statuses unchanged.
  const out = await processNextBatch(jobId, req);
  if (out.error) {
    return res.status(out.error.status).json({ error: out.error.message, code: out.error.code, data: out.data });
  }
  res.json({ data: out.data });
}

// GET /jobs/:jobId
async function getJob(req, res) {
  const { jobId } = req.params;
  const { rows } = await query(`SELECT * FROM calligraphy_plates WHERE job_id=$1 ORDER BY created_at`, [jobId]);
  if (!rows.length) return bad(res, 'المهمة غير موجودة', 'ERR_NOT_FOUND', 404);
  const c = await jobCounts(jobId);
  res.json({ data: { job_id: jobId, ...c, job_cost: await jobCost(jobId), plates: await attachOrderContext(rows.map(toPlate)) } });
}

// Ten paid images on ONE plate is already far past "the model had a bad day". Before this the
// endpoint had no ceiling at all: every press bought a fresh generation, cost_usd quietly
// accumulated, and a designer holding the button could spend without any surface saying so.
const REROLL_LIMIT = 10;

// POST /plates/:id/reroll   body (all optional): { render_text, element_text, variant }
//
// FOUR THINGS WERE WRONG HERE (bug 5, fixed 2026-08-13) and they compounded:
//   1. No guard at all — createJob refuses junk and instructions, this re-billed them happily.
//   2. It regenerated from the STORED render_text, which for these plates is exactly the text
//      that was wrong: «نفس الصوره» rerolled into another paid picture of «نفس الصوره». So the
//      designer can now hand over the corrected name, and it is SAVED onto the plate — the
//      queue and the artwork stop disagreeing about what this line says.
//   3. buildSinglePrompt + cropSheet(buf, 1) produced a different geometry from the 10-name
//      sheet the siblings came from (see matchPlateGeometry).
//   4. It re-ran autoLinkPlate, which used to overwrite the student's photo — every reroll
//      destroyed it again. Closed by migration 080; the link now targets plate_image_url.
async function reroll(req, res) {
  const { id } = req.params;
  const { rows: pr } = await query(`SELECT * FROM calligraphy_plates WHERE id=$1`, [id]);
  if (!pr.length) return bad(res, 'الصورة غير موجودة', 'ERR_NOT_FOUND', 404);
  const p = pr[0];

  if (Number(p.reroll_count || 0) >= REROLL_LIMIT) {
    return bad(res, `تم بلوغ الحد الأقصى لإعادة التوليد (${REROLL_LIMIT} مرات) لهذه الصورة`,
      'ERR_REROLL_LIMIT', 429);
  }

  const body = req.body || {};
  const hasOverride = typeof body.render_text === 'string' && body.render_text.trim() !== '';
  const renderText = hasOverride ? body.render_text.trim() : p.render_text;
  const verdict = checkRenderText(renderText);
  if (!verdict.ok) {
    return bad(res, verdict.message,
      verdict.reason === 'instruction' ? 'ERR_INSTRUCTION_TEXT' : 'ERR_VALIDATION');
  }
  const elementText = typeof body.element_text === 'string'
    ? (body.element_text.trim() || null) : p.element_text;
  const variant = VARIANTS.includes(body.variant) ? body.variant : p.variant;

  const model = p.model || MODELS.standard;
  let gen;
  try { gen = await generateImage({ model, prompt: buildSinglePrompt(renderText, promptVariant(variant), elementText) }); }
  catch (err) { return res.status(err.status || 502).json({ error: err.message, code: err.code || 'ERR_OPENROUTER' }); }
  // single-name image: trim to one band (expected 1); fall back to full image
  let plateBuf = gen.buffer;
  try { const { plates } = await cropSheet(gen.buffer, 1); if (plates[0]) plateBuf = plates[0]; } catch { /* keep full */ }

  // Reframe onto the geometry of the plate this one replaces, so it drops into the same slot
  // as the nine it was generated beside. No-op when the old file is gone.
  const { absFromUrl } = require('../lib/upload');
  const refAbs = absFromUrl(p.plate_path);
  if (refAbs) {
    try { plateBuf = await matchPlateGeometry(plateBuf, await fs.promises.readFile(refAbs)); }
    catch { /* reference unreadable — ship the new plate as generated */ }
  }

  const plate = saveBufferToUploads(req, 'calligraphy/plates', plateBuf, 'png');
  const { rows } = await query(
    `UPDATE calligraphy_plates
        SET status='done', plate_path=$2, cost_usd = cost_usd + $3, error=NULL, linked_at = NULL,
            render_text=$4, element_text=$5, variant=$6, reroll_count = reroll_count + 1
      WHERE id=$1 RETURNING *`,
    [id, plate.url, Number(gen.cost || 0), renderText, elementText, variant]);
  // Re-attach the fresh artwork onto the order line right away (auto-link, no manual step).
  const [withCtx] = await attachOrderContext([toPlate(await autoLinkPlate(rows[0]))]);
  res.json({ data: withCtx });
}

// Shared ZIP streamer for plate rows [{render_text, plate_path, sheet_path?}].
function streamPlatesZip(res, rows, filename, includeSheets = false) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const archive = new ZipArchive({ zlib: { level: 9 } });
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

// GET /jobs/:jobId/download
async function downloadZip(req, res) {
  const { jobId } = req.params;
  const includeSheets = String(req.query.sheets || '0') === '1';
  const { rows } = await query(
    `SELECT render_text, plate_path, sheet_path FROM calligraphy_plates
      WHERE job_id=$1 AND status='done' AND plate_path IS NOT NULL ORDER BY created_at`, [jobId]);
  if (!rows.length) return bad(res, 'لا توجد صور جاهزة للتنزيل', 'ERR_NOT_FOUND', 404);
  streamPlatesZip(res, rows, `calligraphy-${jobId.slice(0, 8)}.zip`, includeSheets);
}

// POST /plates/zip {ids} — ZIP an arbitrary selection (fallback for browsers without the
// File System Access folder picker used by «تنزيل إلى مجلد…»).
async function platesZip(req, res) {
  const raw = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  const ids = raw.filter((x) => typeof x === 'string' && UUID_RE.test(x)).slice(0, 500);
  if (!ids.length) return bad(res, 'لا توجد صور محددة');
  const { rows } = await query(
    `SELECT render_text, plate_path FROM calligraphy_plates
      WHERE id = ANY($1) AND status='done' AND plate_path IS NOT NULL ORDER BY created_at`, [ids]);
  if (!rows.length) return bad(res, 'لا توجد صور جاهزة للتنزيل', 'ERR_NOT_FOUND', 404);
  streamPlatesZip(res, rows, `calligraphy-plates-${rows.length}.zip`);
}

// ---------------------------------------------------------------------------
// GET /queue — per-zone pending count + up to 200 item previews
// ---------------------------------------------------------------------------
async function getQueue(req, res) {
  // Optional ممثل filter — counts + previews scoped to one wholesaler's students.
  const wid = req.query.wholesaler_id && UUID_RE.test(req.query.wholesaler_id)
    ? req.query.wholesaler_id : null;
  const data = {};
  const strip = ({ wholesaler_id: _wid, ...rest }) => rest; // wholesaler_id is not the FE's business
  for (const variant of VARIANTS) {
    const { pool, held, plated } = await zoneBuckets(variant, wid);
    data[variant] = {
      pending: pool.length,
      items: pool.slice(0, 200).map(strip),
      // Lines the generator REFUSED, with the reason, so «توليد» being smaller than the
      // designer expects is explained on screen instead of being a mystery.
      held: { count: held.length, items: held.slice(0, 200).map(strip) },
      // Lines that already carry a done plate. These are why an order can sit in «يخصّني
      // الآن» while the queue shows nothing to do — before this they were unreachable from
      // here, and re-plating one meant hunting it down by student name.
      plated: { count: plated.length, items: plated.slice(0, 200).map(strip) },
    };
  }
  res.json({ data });
}

// ---------------------------------------------------------------------------
// POST /queue/generate — create a job from the pending pool for one variant
// body: { variant: 'front'|'back'|'cap', mode: 'full'|'all' }
// ---------------------------------------------------------------------------
async function queueGenerate(req, res) {
  const { variant, mode, wholesaler_id } = req.body || {};
  if (!VARIANTS.includes(variant)) return bad(res, 'variant غير صالح — يجب أن يكون front أو back أو cap أو cap_side');
  if (!['full', 'all'].includes(mode)) return bad(res, 'mode غير صالح — يجب أن يكون full أو all');
  const wid = wholesaler_id && UUID_RE.test(wholesaler_id) ? wholesaler_id : null;

  const pool = await poolFor(variant, 1000, wid);
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
  enqueueGeneration(jobId); // server-side generation (worker); FE just polls getJob
  res.status(201).json({ data: { job_id: jobId, total: plates.length, dropped: [], plates: await attachOrderContext(plates) } });
}

// ---------------------------------------------------------------------------
// GET /recent?limit=60 — recent done plates for UI survival across refresh
// ---------------------------------------------------------------------------
async function recentPlates(req, res) {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 60));
  const { rows } = await query(
    `SELECT * FROM calligraphy_plates WHERE status='done' ORDER BY created_at DESC LIMIT $1`,
    [limit]);
  res.json({ data: { plates: await attachOrderContext(rows.map(toPlate)) } });
}

// POST /plates/:id/compose — receive merged PNG from the compositor, save as new plate image
async function composePlate(req, res) {
  const { id } = req.params;
  const { rows: pr } = await query(`SELECT * FROM calligraphy_plates WHERE id=$1`, [id]);
  if (!pr.length) return bad(res, 'الصورة غير موجودة', 'ERR_NOT_FOUND', 404);
  if (!req.file || !req.file.buffer) return bad(res, 'لم يتم استلام الصورة');
  // Multer's MIME is client-controlled. Decode the payload before storing it as `.png`
  // and cap total pixels to avoid arbitrary-file storage and image decompression bombs.
  let metadata;
  try {
    metadata = await sharp(req.file.buffer, { limitInputPixels: 40_000_000 }).metadata();
  } catch {
    return bad(res, 'ملف الصورة غير صالح', 'ERR_INVALID_IMAGE');
  }
  if (metadata.format !== 'png' || !metadata.width || !metadata.height) {
    return bad(res, 'يجب رفع صورة PNG صالحة', 'ERR_INVALID_IMAGE');
  }
  const saved = saveBufferToUploads(req, 'calligraphy/plates', req.file.buffer, 'png');
  const { rows } = await query(
    `UPDATE calligraphy_plates SET plate_path=$2, linked_at=NULL, status='done' WHERE id=$1 RETURNING *`,
    [id, saved.url]);
  // Composited artwork replaces the order-line image too (auto-link, no manual step).
  const [withCtx] = await attachOrderContext([toPlate(await autoLinkPlate(rows[0]))]);
  res.json({ data: withCtx });
}

// ---------------------------------------------------------------------------
// GET /orders-zones?ids=a,b,c — per-order zone/image status + send-readiness for
// the workbench. can_send + send_label are STATE-MACHINE-DRIVEN (nextStageFor +
// ADVANCE_LABEL_AR), so a future pipeline change re-labels the button for free.
// ---------------------------------------------------------------------------
async function ordersZones(req, res) {
  const ids = String(req.query.ids || '')
    .split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s)).slice(0, 100);
  if (!ids.length) return res.json({ data: [] });
  const production = require('./productionController');
  const out = [];
  for (const orderId of ids) {
    const row = await production.loadAdvanceRow(orderId);
    if (!row) continue;
    const zones = await production.detectZonesWithImages(orderId);
    const next = row.status === 'design_complete' ? production.nextStageFor(row) : null;
    out.push({
      order_id: orderId,
      order_status: row.status,
      zones,
      can_send: !!next,
      next_stage: next,
      send_label: next
        ? (production.ADVANCE_LABEL_AR[`design_complete→${next}`] || 'تحويل للتطريز')
        : null,
    });
  }
  res.json({ data: out });
}

// ---------------------------------------------------------------------------
// POST /orders/:orderId/send — «تحويل للتطريز»: push the order out of بانتظار
// التصميم through the REAL state machine (same tx/audit/notifications as the
// order-page advance). Route-gated to admin/manager/designer (design_helper 403s
// — the أيادي التصميم flow keeps going through محمد هيثم's approval).
// ---------------------------------------------------------------------------
async function sendOrder(req, res) {
  const { orderId } = req.params;
  if (!UUID_RE.test(orderId)) return bad(res, 'الطلب غير صحيح');
  const production = require('./productionController');
  const { canStaffTransition } = require('./orderController');
  const row = await production.loadAdvanceRow(orderId);
  if (!row) return bad(res, 'الطلب غير موجود', 'ERR_NOT_FOUND', 404);
  if (row.status !== 'design_complete') {
    return bad(res, 'الطلب ليس بانتظار التصميم', 'ERR_BAD_STATUS', 409);
  }
  const to = production.nextStageFor(row);
  if (!to) return bad(res, 'التصميم بحاجة لاعتماد المصمم أولاً', 'ERR_BAD_STATUS', 409);
  if (!canStaffTransition(req.user, 'design_complete', to)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  // Catch-up: attach any DONE plates generated before auto-linking shipped (idempotent —
  // only fills lines that still have no plate; newest plate per line wins).
  // Targets `plate_image_url` since migration 080 — this used to fill the customer's column,
  // which is the same data loss autoLinkPlate caused, just on a different trigger. The
  // `IS NULL` guard was already the right INTENT; it was pointed at the wrong column.
  await query(
    `UPDATE order_items oi SET plate_image_url = cp.plate_path
       FROM (SELECT DISTINCT ON (order_item_id) order_item_id, plate_path
               FROM calligraphy_plates
              WHERE status='done' AND plate_path IS NOT NULL AND order_item_id IS NOT NULL
              ORDER BY order_item_id, created_at DESC) cp
      WHERE cp.order_item_id = oi.id AND oi.order_id = $1 AND oi.plate_image_url IS NULL`,
    [orderId]);
  const updated = await production.performAdvance(row, req.user);
  res.json({ data: { ok: true, order_id: orderId, status: updated.status } });
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
  listWholesalers, wholesalerNames, createJob, processNext, getJob, reroll, downloadZip,
  getQueue, queueGenerate, recentPlates, composePlate, generateElement,
  ordersZones, sendOrder, platesZip, retailQueue,
};
