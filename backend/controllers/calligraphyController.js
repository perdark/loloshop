// backend/controllers/calligraphyController.js
const crypto = require('crypto');
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
// A real embroiderable name has at least two Arabic letters. Rejects pure numbers,
// Latin, emoji, single chars and punctuation so the PAID generator is never spent
// on junk (the "no API call for a retarded name" guard). Tatweel/diacritics aren't
// letters and don't count. This is the server-side choke point; the UI mirrors it.
const ARABIC_LETTER = /[ء-يٱ-ۓۺ-ۼ]/g;
function isRealName(text) {
  const m = String(text || '').match(ARABIC_LETTER);
  return !!m && m.length >= 2;
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
            oi.id AS order_item_id, oi.label_snapshot, oi.customer_text, oi.customer_image_url,
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
      has_plate: r.has_plate,
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

async function poolFor(variant, limit = 1000, wholesalerId = null) {
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
        AND ($3::uuid IS NULL OR s.wholesaler_id = $3)
        AND NOT EXISTS (
              SELECT 1 FROM calligraphy_plates cp
               WHERE cp.order_item_id = oi.id AND cp.status = 'done')
      ORDER BY o.created_at
      LIMIT $2`,
    [label, limit, wholesalerId]);
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

  // Junk guard (defense-in-depth): drop anything that isn't a real Arabic name
  // BEFORE any paid generation. The UI flags these too, but a direct API call can't
  // bypass it. Batch SIZE is intentionally NOT capped here (admin's choice).
  const dropped = items.filter((it) => !isRealName(it.render_text)).map((it) => it.render_text);
  items = items.filter((it) => isRealName(it.render_text));
  if (!items.length) return bad(res, 'لا توجد أسماء صالحة — يجب أن يحتوي الاسم على حروف عربية');
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
  res.status(201).json({ data: { job_id: jobId, total: out.length, dropped, plates: await attachOrderContext(out) } });
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

// POST /plates/:id/reroll
async function reroll(req, res) {
  const { id } = req.params;
  const { rows: pr } = await query(`SELECT * FROM calligraphy_plates WHERE id=$1`, [id]);
  if (!pr.length) return bad(res, 'الصورة غير موجودة', 'ERR_NOT_FOUND', 404);
  const p = pr[0];
  const model = p.model || MODELS.standard;
  let gen;
  try { gen = await generateImage({ model, prompt: buildSinglePrompt(p.render_text, promptVariant(p.variant), p.element_text) }); }
  catch (err) { return res.status(err.status || 502).json({ error: err.message, code: err.code || 'ERR_OPENROUTER' }); }
  // single-name image: trim to one band (expected 1); fall back to full image
  let plateBuf = gen.buffer;
  try { const { plates } = await cropSheet(gen.buffer, 1); if (plates[0]) plateBuf = plates[0]; } catch { /* keep full */ }
  const plate = saveBufferToUploads(req, 'calligraphy/plates', plateBuf, 'png');
  const { rows } = await query(
    `UPDATE calligraphy_plates SET status='done', plate_path=$2, cost_usd = cost_usd + $3, error=NULL,
            linked_at = NULL WHERE id=$1 RETURNING *`,
    [id, plate.url, Number(gen.cost || 0)]);
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
  for (const variant of VARIANTS) {
    // TRUE count: pool with a high limit so we never under-count
    const full = await poolFor(variant, 10000, wid);
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
  // only fills lines that still have no image; newest plate per line wins).
  await query(
    `UPDATE order_items oi SET customer_image_url = cp.plate_path
       FROM (SELECT DISTINCT ON (order_item_id) order_item_id, plate_path
               FROM calligraphy_plates
              WHERE status='done' AND plate_path IS NOT NULL AND order_item_id IS NOT NULL
              ORDER BY order_item_id, created_at DESC) cp
      WHERE cp.order_item_id = oi.id AND oi.order_id = $1 AND oi.customer_image_url IS NULL`,
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
