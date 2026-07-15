// Shared full-set (طقم) order logic for rep-linked students — used by BOTH the
// wholesaler "fill on behalf" endpoint and the student "fill my own" endpoint, so
// the two paths write byte-identical orders (one source of truth).
//
// This is the WhatsApp intake form digitized: فصال measurements + sash/cap type
// (عادي/ملكي) + 4 embroidery zones (name + optional photo) + note → a full-set
// package order (3 linked orders: sash/robe/cap). No delivery intake (the rep's
// batch handles delivery); types/embroidery are captured as manufacturing spec
// lines on order_items, not priced options. Mirrors orderController.configureFullSet's
// pipeline. Order-status rules stay here (backend-only).
const { query, tx } = require('./db');
const { publish } = require('./eventBus');

function normalizeDigits(s) {
  return String(s ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}
function clean(v, max) {
  const t = v == null ? '' : String(v).trim();
  return t ? t.slice(0, max) : null;
}

const MEAS_RANGE = { shoulder_cm: [25, 80], chest_cm: [60, 180], robe_length_cm: [70, 190], sleeve_length_cm: [30, 100] };
const MEAS_LABEL = { shoulder_cm: 'عرض الكتف', chest_cm: 'محيط الصدر', robe_length_cm: 'طول الروب', sleeve_length_cm: 'طول الردن' };
const PIECE_TYPES = ['عادي', 'ملكي'];
const PRODUCT_PIECES = ['sash', 'robe', 'cap'];
const PIECE_LABEL = { sash: 'وشاح', robe: 'روب', cap: 'قبعة' };
const DEFAULT_PACKAGE_PRICE = 50000;

// ── «التسعيرة» (per-wholesaler pricing) ──────────────────────────────────────
// Defaults seeded by migration 032; merged here too so a missing/legacy key is safe.
// Every amount is an immutable admin/selling pair. The difference belongs to the rep.
const DEFAULT_ADDONS = {
  royal_sash: { admin: 15000, selling: 15000 },
  royal_cap_when_normal_sash: { admin: 3000, selling: 3000 },
  extra_cap_embroidery: { admin: 3000, selling: 3000 },
  robe_sleeve_each: { admin: 5000, selling: 5000 },
  american_shawl: { admin: 20000, selling: 25000 },
  piece_sash_normal: { admin: 20000, selling: 20000 },
  piece_sash_royal: { admin: 25000, selling: 25000 },
  piece_cap_normal: { admin: 15000, selling: 15000 },
  piece_cap_royal: { admin: 20000, selling: 20000 },
  piece_robe_normal: { admin: 25000, selling: 25000 },
  piece_robe_royal: { admin: 25000, selling: 25000 },
};

function sanitizeAddons(raw) {
  const out = {};
  for (const k of Object.keys(DEFAULT_ADDONS)) {
    const legacy = Number(raw?.[k]);
    const admin = Number(raw?.[k]?.admin);
    const selling = Number(raw?.[k]?.selling);
    out[k] = {
      admin: Number.isFinite(admin) && admin >= 0 ? Math.round(admin)
        : Number.isFinite(legacy) && legacy >= 0 ? Math.round(legacy) : DEFAULT_ADDONS[k].admin,
      selling: Number.isFinite(selling) && selling >= 0 ? Math.round(selling)
        : Number.isFinite(legacy) && legacy >= 0 ? Math.round(legacy) : DEFAULT_ADDONS[k].selling,
    };
  }
  return out;
}

function addonAmounts(addons, side) {
  return Object.fromEntries(Object.entries(addons).map(([key, pair]) => [key, pair[side]]));
}

// Load a rep's effective pricing. adminPrice/wholesalerPrice are base طقم prices;
// 0 means "not configured" → the caller falls back to the package price.
async function loadWholesalerPricing(wholesalerId) {
  let row = null;
  if (wholesalerId) {
    const r = await query(
      `SELECT admin_price, wholesaler_price, pricing_addons FROM wholesalers WHERE id = $1`,
      [wholesalerId]
    );
    row = r.rows[0] || null;
  }
  return {
    adminPrice: Math.max(0, Math.round(Number(row?.admin_price || 0))),
    wholesalerPrice: Math.max(0, Math.round(Number(row?.wholesaler_price || 0))),
    addons: sanitizeAddons(row?.pricing_addons),
  };
}

/**
 * Compute the applicable «اضافات على السعر» as labelled line items.
 * @returns {{ label:string, amount:number }[]} only the add-ons that apply (amount > 0 omitted lines skipped)
 */
function addonLinesFor(addons, sel) {
  const lines = [];
  const selected = new Set(sel.selectedPieces || []);
  if (sel.isFullPackage && sel.sashType === 'ملكي' && addons.royal_sash > 0) {
    lines.push({ type: 'sash', label: 'إضافة: وشاح ملكي', amount: addons.royal_sash });
  }
  if (sel.isFullPackage && sel.sashType === 'عادي' && sel.capType === 'ملكي' && addons.royal_cap_when_normal_sash > 0) {
    lines.push({ type: 'cap', label: 'إضافة: قبعة ملكية', amount: addons.royal_cap_when_normal_sash });
  }
  if (selected.has('cap') && sel.capEmbCount >= 2 && addons.extra_cap_embroidery > 0) {
    lines.push({ type: 'cap', label: 'إضافة: تطريز قبعة ثانٍ', amount: addons.extra_cap_embroidery });
  }
  const sleeves = Math.min(2, Math.max(0, sel.robeSleeveCount));
  if (selected.has('robe') && sleeves > 0 && addons.robe_sleeve_each > 0) {
    lines.push({ type: 'robe', label: `إضافة: تطريز ردن الروب ×${sleeves}`, amount: addons.robe_sleeve_each * sleeves });
  }
  if (selected.has('sash') && sel.shawlEnabled && addons.american_shawl > 0) {
    lines.push({ type: 'sash', label: 'إضافة: شال امريكي', amount: addons.american_shawl });
  }
  return lines;
}

const err = (status, error, code = 'ERR_VALIDATION') => ({ status, json: { error, code } });

/**
 * @param {object} student  { id, name, phone, wholesaler_id }
 * @param {object} body     request body (package_id, measurements, sash_type, cap_type, embroidery, notes)
 * @param {string} actorUserId  user id to attribute the audit row to (rep or student)
 * @returns {{ status:number, json:object }}
 */
async function persistFullSetOrder({ student, body, actorUserId }) {
  const { package_id, measurements, sash_type, cap_type, embroidery, notes } = body || {};

  // package_id is now OPTIONAL — if provided we pin sub-products to it; if absent we
  // fall back to the first-active-per-type resolution below (byType fill from prods query).
  let packageRow = null;
  if (package_id) {
    const pkg = await query(
      `SELECT id, name_ar, price FROM packages WHERE id = $1 AND active = TRUE AND is_full_set = TRUE`,
      [package_id]
    );
    if (!pkg.rows.length) return err(404, 'الطقم غير موجود', 'ERR_NOT_FOUND');
    packageRow = pkg.rows[0];
  }

  const hasSelectedPieces = Object.prototype.hasOwnProperty.call(body || {}, 'selected_pieces');
  const rawSelectedPieces = Array.isArray(body?.selected_pieces) ? body.selected_pieces : null;
  const selectedPieces = hasSelectedPieces
    ? PRODUCT_PIECES.filter((p) => rawSelectedPieces?.includes(p))
    : PRODUCT_PIECES;
  if (!selectedPieces.length) {
    return err(400, 'اختر قطعة واحدة على الأقل', 'ERR_VALIDATION');
  }
  const selectedSet = new Set(selectedPieces);

  // robe measurements (قياسات الروب) — typo-guarded. محيط الصدر (chest_cm) is a required
  // measurement; ملاحظات لفصال الروب (tailor_notes) is an optional free-text note that rides
  // the measurements JSON (no range check — skipped because it isn't in MEAS_RANGE).
  // EVERYTHING in the طقم form is OPTIONAL (per request): a rep/student can save the order
  // with nothing filled and complete it later. Measurements are kept per-field only when a
  // valid positive number is given (null otherwise); a value that IS provided is still
  // range-checked to catch obvious typos (e.g. 5000 سم).
  const m = measurements || {};
  const measNum = (v) => {
    const n = Number(normalizeDigits(v));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const meas = {
    shoulder_cm: measNum(m.shoulder_cm),
    chest_cm: measNum(m.chest_cm),
    robe_length_cm: measNum(m.robe_length_cm),
    sleeve_length_cm: measNum(m.sleeve_length_cm),
    tailor_notes: clean(m.tailor_notes, 500),
  };
  for (const [k, [lo, hi]] of Object.entries(MEAS_RANGE)) {
    if (meas[k] != null && (meas[k] < lo || meas[k] > hi)) {
      return err(400, `قياسات الروب غير صالحة — ${MEAS_LABEL[k]} يجب أن يكون بين ${lo} و ${hi} سم`);
    }
  }
  const hasAnyMeasurement =
    ['shoulder_cm', 'chest_cm', 'robe_length_cm', 'sleeve_length_cm'].some((k) => meas[k] != null) ||
    !!meas.tailor_notes;

  // النوع (عادي/ملكي) — selected sash/cap default to عادي when omitted.
  const sashType = selectedSet.has('sash') ? (PIECE_TYPES.includes(sash_type) ? sash_type : 'عادي') : null;
  const capType = selectedSet.has('cap') ? (PIECE_TYPES.includes(cap_type) ? cap_type : 'عادي') : null;

  const e = embroidery || {};
  const zone = (z) => ({ text: clean(z?.text, 200), image_url: clean(z?.image_url, 500) });
  const emb = {
    cap_side: zone(e.cap_side),
    cap_top: zone(e.cap_top),
    sash_front: zone(e.sash_front),
    sash_back: zone(e.sash_back),
    // تطريز ردن الروب — الروب له ردنان فقط (priced add-on: كل ردن).
    robe_sleeve_right: zone(e.robe_sleeve_right),
    robe_sleeve_left: zone(e.robe_sleeve_left),
  };
  const groupNotes = clean(notes, 500);

  // كسرة الكتف (robe shoulder pleat) — yes/no tailoring flag, captured as a spec line.
  const shoulderPleat =
    body.shoulder_pleat === true || body.shoulder_pleat === 'true' || body.shoulder_pleat === 'نعم';
  // شال امريكي (American shawl) — yes/no; when enabled a reference photo is REQUIRED.
  const shawlIn = body.american_shawl || {};
  const shawlEnabled =
    selectedSet.has('sash') && (shawlIn.enabled === true || shawlIn.enabled === 'true' || shawlIn.enabled === 'نعم');
  // شال امريكي photo is OPTIONAL now (was required when enabled). Stored when present.
  const shawlImage = clean(shawlIn.image_url, 500);
  const shawlNote = clean(shawlIn.notes, 500);

  // لون الوشاح (sash color) — optional typed free-text color + optional reference photo.
  // Captured as a sash spec line only when non-empty (frontend no longer sends it; kept
  // for backward compatibility with any existing submissions that include it).
  const colorIn = body.sash_color || {};
  const colorText = clean(colorIn.text, 200);
  const colorImage = clean(colorIn.image_url, 500);

  // لون التطريز (embroidery/thread color) — comes from the WHOLESALER record, NOT the request body.
  // A per-wholesaler setting (admin or rep sets it once); all that rep's orders inherit it automatically.
  // If the wholesaler has no embroidery_color set (null/empty), the spec line is omitted entirely.
  let embroideryColor = null;
  if (student.wholesaler_id) {
    const ec = await query(
      `SELECT embroidery_color FROM wholesalers WHERE id = $1`,
      [student.wholesaler_id]
    );
    embroideryColor = clean(ec.rows[0]?.embroidery_color, 200);
  }

  // resolve sash/robe/cap: package-pinned wins (when package_id given), else first active per type
  const byType = {};
  if (package_id) {
    const pinned = await query(
      `SELECT p.id, p.type FROM package_products pl JOIN products p ON p.id = pl.product_id
       WHERE pl.package_id = $1 AND p.active = TRUE AND p.type IN ('sash','robe','cap')`,
      [package_id]
    );
    for (const p of pinned.rows) byType[p.type] = p.id;
  }
  const prods = await query(
    `SELECT id, type FROM products WHERE type IN ('sash','robe','cap') AND active = TRUE
     ORDER BY type, featured DESC, sort, created_at`
  );
  for (const p of prods.rows) if (!byType[p.type]) byType[p.type] = p.id;
  if (selectedPieces.some((type) => !byType[type])) {
    return err(500, 'منتجات الطلب غير مكتملة في النظام', 'ERR_CONFIG');
  }

  const sashHasEmb = selectedSet.has('sash') && !!(emb.sash_front.text || emb.sash_front.image_url || emb.sash_back.text || emb.sash_back.image_url);
  const sashHasContent = (z) => !!(z.text || z.image_url);
  const capEmbCount = selectedSet.has('cap')
    ? (sashHasContent(emb.cap_side) ? 1 : 0) + (sashHasContent(emb.cap_top) ? 1 : 0)
    : 0;
  const capHasEmb = capEmbCount > 0;
  const robeSleeveCount = selectedSet.has('robe')
    ? (sashHasContent(emb.robe_sleeve_right) ? 1 : 0) + (sashHasContent(emb.robe_sleeve_left) ? 1 : 0)
    : 0;
  const robeHasEmb = robeSleeveCount > 0;
  // A شال امريكي carries a custom reference photo, so the sash needs design attention
  // even without front/back embroidery → route it to design_complete like an embroidered piece.
  const sashHasDesign = sashHasEmb || shawlEnabled;

  // ── «التسعيرة»: full package uses the rep/admin package base (or 50k default).
  // Partial selections use editable per-piece base prices from pricing_addons.
  const pricing = await loadWholesalerPricing(student.wholesaler_id);
  const isFullPackage = selectedSet.has('sash') && selectedSet.has('robe') && selectedSet.has('cap');
  const fullPackageBase = pricing.wholesalerPrice > 0 ? pricing.wholesalerPrice : DEFAULT_PACKAGE_PRICE;
  const sellingAddons = addonAmounts(pricing.addons, 'selling');
  const adminAddons = addonAmounts(pricing.addons, 'admin');
  const itemBasePrice = isFullPackage
    ? { sash: fullPackageBase, robe: 0, cap: 0 }
    : {
        sash: selectedSet.has('sash')
          ? (sashType === 'ملكي' ? sellingAddons.piece_sash_royal : sellingAddons.piece_sash_normal)
          : 0,
        cap: selectedSet.has('cap')
          ? (capType === 'ملكي' ? sellingAddons.piece_cap_royal : sellingAddons.piece_cap_normal)
          : 0,
        robe: selectedSet.has('robe')
          ? (sashType === 'ملكي' || capType === 'ملكي'
              ? sellingAddons.piece_robe_royal
              : sellingAddons.piece_robe_normal)
          : 0,
      };
  const addonLines = addonLinesFor(sellingAddons, {
    selectedPieces, capEmbCount, robeSleeveCount, shawlEnabled, isFullPackage, sashType, capType,
  });
  const addonByType = { sash: 0, robe: 0, cap: 0 };
  for (const line of addonLines) addonByType[line.type] += line.amount;
  const itemPrice = {
    sash: itemBasePrice.sash + addonByType.sash,
    robe: itemBasePrice.robe + addonByType.robe,
    cap: itemBasePrice.cap + addonByType.cap,
  };
  const totalPrice = selectedPieces.reduce((s, type) => s + itemPrice[type], 0);
  const adminBase = isFullPackage
    ? { sash: pricing.adminPrice, robe: 0, cap: 0 }
    : {
        sash: selectedSet.has('sash') ? (sashType === 'ملكي' ? adminAddons.piece_sash_royal : adminAddons.piece_sash_normal) : 0,
        cap: selectedSet.has('cap') ? (capType === 'ملكي' ? adminAddons.piece_cap_royal : adminAddons.piece_cap_normal) : 0,
        robe: selectedSet.has('robe') ? (sashType === 'ملكي' || capType === 'ملكي' ? adminAddons.piece_robe_royal : adminAddons.piece_robe_normal) : 0,
      };
  // Add-ons use each rep's per-add-on ADMIN value as the admin due. Only شال امريكي carries a rep
  // margin (admin 20,000 < selling); all other add-ons are configured admin == selling (100% admin).
  const adminAddonLines = addonLinesFor(adminAddons, {
    selectedPieces, capEmbCount, robeSleeveCount, shawlEnabled, isFullPackage, sashType, capType,
  });
  const adminAddonByType = { sash: 0, robe: 0, cap: 0 };
  for (const line of adminAddonLines) adminAddonByType[line.type] += line.amount;
  const itemCost = {
    sash: adminBase.sash + adminAddonByType.sash,
    robe: adminBase.robe + adminAddonByType.robe,
    cap: adminBase.cap + adminAddonByType.cap,
  };

  const itemFlags = {
    // Plain (no design work) sash/robe start at الكوي — المكوجي gets everything except
    // caps (user 2026-07-15). Plain caps keep entering at التجهيز.
    sash: { has_embroidery: sashHasEmb, status: sashHasDesign ? 'design_complete' : 'pressing' },
    cap: { has_embroidery: capHasEmb, status: capHasEmb ? 'design_complete' : 'preparing' },
    robe: { has_embroidery: robeHasEmb, status: robeHasEmb ? 'design_complete' : 'pressing' },
  };

  const specLines = {
    sash: [
      // لون الوشاح is optional — only emitted when the frontend actually sends it.
      ...(colorText
        ? [{ label: 'لون الوشاح', customer_text: colorText, customer_image_url: colorImage }] : []),
      ...(embroideryColor
        ? [{ label: 'لون التطريز', customer_text: embroideryColor }] : []),
      ...(sashType ? [{ label: 'نوع الوشاح', customer_text: sashType }] : []),
      ...(shawlEnabled
        ? [{ label: 'شال امريكي', customer_text: shawlNote || 'نعم', customer_image_url: shawlImage }] : []),
      ...(emb.sash_front.text || emb.sash_front.image_url
        ? [{ label: 'تطريز الوشاح من الأمام', customer_text: emb.sash_front.text, customer_image_url: emb.sash_front.image_url }] : []),
      ...(emb.sash_back.text || emb.sash_back.image_url
        ? [{ label: 'تطريز الوشاح من الخلف', customer_text: emb.sash_back.text, customer_image_url: emb.sash_back.image_url }] : []),
    ],
    cap: [
      ...(capType ? [{ label: 'نوع القبعة', customer_text: capType }] : []),
      ...(emb.cap_side.text || emb.cap_side.image_url
        ? [{ label: 'تطريز القبعة من الجانب', customer_text: emb.cap_side.text, customer_image_url: emb.cap_side.image_url }] : []),
      ...(emb.cap_top.text || emb.cap_top.image_url
        ? [{ label: 'تطريز القبعة من الأعلى', customer_text: emb.cap_top.text, customer_image_url: emb.cap_top.image_url }] : []),
    ],
    robe: [
      { label: 'كسرة الكتف', customer_text: shoulderPleat ? 'نعم' : 'لا' },
      ...(sashHasContent(emb.robe_sleeve_right)
        ? [{ label: 'تطريز ردن الروب الأيمن', customer_text: emb.robe_sleeve_right.text, customer_image_url: emb.robe_sleeve_right.image_url }] : []),
      ...(sashHasContent(emb.robe_sleeve_left)
        ? [{ label: 'تطريز ردن الروب الأيسر', customer_text: emb.robe_sleeve_left.text, customer_image_url: emb.robe_sleeve_left.image_url }] : []),
    ],
  };

  let resolvedBatchId = null;
  if (student.wholesaler_id) {
    const b = await query(
      `SELECT id FROM batches WHERE wholesaler_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [student.wholesaler_id]
    );
    resolvedBatchId = b.rows[0]?.id || null;
  }

  const result = await tx(async (client) => {
    const prevGroup = await client.query(
      `SELECT cg.id FROM checkout_groups cg
       JOIN orders o ON o.checkout_group_id = cg.id
       WHERE o.student_id = $1 AND o.status <> 'cancelled'
       ORDER BY cg.created_at DESC LIMIT 1`,
      [student.id]
    );
    let cgId;
    const cgParams = [student.name, student.phone ?? '', groupNotes];
    if (prevGroup.rows.length) {
      cgId = prevGroup.rows[0].id;
      await client.query(
        `UPDATE checkout_groups SET customer_name=$1, phone_primary=$2, notes=$3 WHERE id=$4`,
        [...cgParams, cgId]
      );
    } else {
      const cg = await client.query(
        `INSERT INTO checkout_groups (customer_name, phone_primary, notes) VALUES ($1,$2,$3) RETURNING id`,
        cgParams
      );
      cgId = cg.rows[0].id;
    }

    for (const type of PRODUCT_PIECES) {
      if (selectedSet.has(type) || !byType[type]) continue;
      await client.query(
        `UPDATE orders SET status='cancelled', wholesaler_approval='pending', wholesaler_reject_reason=NULL
         WHERE student_id = $1 AND product_id = $2 AND design_id IS NULL AND status <> 'cancelled'`,
        [student.id, byType[type]]
      );
    }

    const ids = {};
    for (const type of selectedPieces) {
      const prodId = byType[type];
      const flags = itemFlags[type];
      const needsPressing = type !== 'cap';
      // Store robe measurements only when at least one field/note was given (else null, so the
      // edit form re-opens clean instead of showing "null"s).
      const measurementsJson = type === 'robe' && hasAnyMeasurement ? JSON.stringify(meas) : null;
      const existing = await client.query(
        `SELECT id FROM orders
         WHERE student_id = $1 AND product_id = $2 AND design_id IS NULL AND status <> 'cancelled'`,
        [student.id, prodId]
      );
      let oid;
      if (existing.rows.length) {
        oid = existing.rows[0].id;
        // Any edit re-enters approval: reset wholesaler_approval to 'pending' and clear reject reason.
        // status is NOT touched — the production state machine lives in orderController only.
        await client.query(
          `UPDATE orders SET price=$1, cost=$2, batch_id=$3, package_id=$4, checkout_group_id=$5,
             status=$6, has_embroidery=$7, needs_pressing=$8, measurements=$9, notes=$10,
             wholesaler_approval='pending', wholesaler_reject_reason=NULL,
             returned_to_customer=FALSE, returned_reason=NULL
           WHERE id=$11`,
          [itemPrice[type], itemCost[type], resolvedBatchId, package_id, cgId, flags.status, flags.has_embroidery, needsPressing, measurementsJson, groupNotes, oid]
        );
        await client.query(`DELETE FROM order_items WHERE order_id = $1`, [oid]);
      } else {
        const o = await client.query(
          `INSERT INTO orders (student_id, product_id, batch_id, package_id, checkout_group_id,
                               price, cost, status, has_embroidery, needs_pressing, measurements, notes,
                               wholesaler_approval)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending') RETURNING id`,
          [student.id, prodId, resolvedBatchId, package_id, cgId,
           itemPrice[type], itemCost[type], flags.status, flags.has_embroidery, needsPressing, measurementsJson, groupNotes]
        );
        oid = o.rows[0].id;
      }

      const pieceName =
        type === 'sash' && sashType
          ? `${PIECE_LABEL[type]} ${sashType}`
          : type === 'cap' && capType
            ? `${PIECE_LABEL[type]} ${capType}`
            : PIECE_LABEL[type];
      const baseLine = {
        label: isFullPackage && type === 'sash' ? 'طقم كامل' : `قطعة: ${pieceName}`,
        price: itemBasePrice[type],
        admin_price: adminBase[type],
      };
      const lines = [
        baseLine,
        ...specLines[type].map((l) => ({ ...l, price: 0, admin_price: 0 })),
        ...addonLines
          .filter((l) => l.type === type)
          .map((l) => ({
            label: l.label, price: l.amount,
            admin_price: adminAddonLines.find((a) => a.type === type && a.label === l.label)?.amount || 0,
          })),
      ];
      for (const it of lines) {
        await client.query(
          `INSERT INTO order_items (order_id, group_id, option_id, label_snapshot, price_snapshot, admin_price_snapshot, qty,
                                    customer_image_url, customer_text)
           VALUES ($1,NULL,NULL,$2,$3,$4,1,$5,$6)`,
          [oid, it.label, it.price || 0, it.admin_price || 0, it.customer_image_url || null, it.customer_text || null]
        );
      }
      ids[type] = oid;
    }
    return { cgId, ids };
  });

  const primaryOrderId = result.ids.sash || result.ids.robe || result.ids.cap;

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'rep_create_fullset', 'order', $2, $3)`,
    [actorUserId, primaryOrderId, JSON.stringify({ student_id: student.id, package_id, selected_pieces: selectedPieces })]
  );
  publish({ type: 'order_new', orderId: primaryOrderId });
  return {
    status: 201,
    json: {
      data: {
        checkout_group_id: result.cgId,
        package_id: package_id || null,
        package_name: packageRow?.name_ar || 'طلب التخرج',
        total: totalPrice,
        orders: result.ids,
      },
    },
  };
}

// Reconstruct a student's existing full-set order into form shape (or null). Reverses
// persistFullSetOrder's spec-line mapping so EDIT pre-fills instead of opening blank.
async function readFullSetOrder(studentId) {
  const orders = await query(
    `SELECT o.id, o.package_id, o.measurements, o.notes, o.checkout_group_id, p.type
     FROM orders o JOIN products p ON p.id = o.product_id
     WHERE o.student_id = $1 AND o.status <> 'cancelled' AND o.design_id IS NULL
       AND p.type IN ('sash','robe','cap')
     ORDER BY o.created_at DESC`,
    [studentId]
  );
  if (!orders.rows.length) return null;

  const cgId = orders.rows[0].checkout_group_id;
  const set = orders.rows.filter((o) => o.checkout_group_id === cgId);
  const byType = {};
  for (const o of set) if (!byType[o.type]) byType[o.type] = o;

  const items = await query(
    `SELECT order_id, label_snapshot, customer_text, customer_image_url
     FROM order_items WHERE order_id = ANY($1::uuid[])`,
    [set.map((o) => o.id)]
  );
  const lineFor = (oid, label) =>
    items.rows.find((i) => i.order_id === oid && i.label_snapshot === label) || null;
  const sashId = byType.sash?.id || null;
  const capId = byType.cap?.id || null;
  const robeId = byType.robe?.id || null;
  const z = (oid, label) => {
    const l = oid ? lineFor(oid, label) : null;
    return { text: l?.customer_text || '', image_url: l?.customer_image_url || '' };
  };
  const shawlLine = sashId ? lineFor(sashId, 'شال امريكي') : null;
  const colorLine = sashId ? lineFor(sashId, 'لون الوشاح') : null;
  const embColorLine = sashId ? lineFor(sashId, 'لون التطريز') : null;

  return {
    package_id: set[0].package_id,
    selected_pieces: PRODUCT_PIECES.filter((type) => !!byType[type]),
    notes: byType.sash?.notes || byType.robe?.notes || byType.cap?.notes || '',
    measurements: byType.robe?.measurements || null,
    sash_color: { text: colorLine?.customer_text || '', image_url: colorLine?.customer_image_url || '' },
    embroidery_color: embColorLine?.customer_text || '',
    sash_type: sashId ? lineFor(sashId, 'نوع الوشاح')?.customer_text || null : null,
    cap_type: capId ? lineFor(capId, 'نوع القبعة')?.customer_text || null : null,
    shoulder_pleat: robeId ? lineFor(robeId, 'كسرة الكتف')?.customer_text === 'نعم' : false,
    american_shawl: { enabled: !!shawlLine, image_url: shawlLine?.customer_image_url || '', notes: shawlLine && shawlLine.customer_text && shawlLine.customer_text !== 'نعم' ? shawlLine.customer_text : '' },
    embroidery: {
      sash_front: z(sashId, 'تطريز الوشاح من الأمام'),
      sash_back: z(sashId, 'تطريز الوشاح من الخلف'),
      cap_side: z(capId, 'تطريز القبعة من الجانب'),
      cap_top: z(capId, 'تطريز القبعة من الأعلى'),
      robe_sleeve_right: z(robeId, 'تطريز ردن الروب الأيمن'),
      robe_sleeve_left: z(robeId, 'تطريز ردن الروب الأيسر'),
    },
  };
}

module.exports = {
  persistFullSetOrder, readFullSetOrder,
  loadWholesalerPricing, DEFAULT_ADDONS, sanitizeAddons,
};
