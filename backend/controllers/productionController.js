const { query, tx } = require('../lib/db');
const { canStaffTransition, STATUS_LABEL_AR, TRANSITIONS, orderZoneClause } = require('./orderController');
const { signSseTicket, staffScopeAllows, staffTypesOf } = require('../middleware/auth');
const { imageUpload, publicUrl } = require('../lib/upload');
const { addClient, publish } = require('../lib/eventBus');
// رف التجهيز: a piece leaving التجهيز (revert) or being deleted must give up its خانة,
// otherwise the shelf shows a bin occupied by something no longer physically there.
// NB lib/shelf.js lazily requires THIS module back (for performAdvance) — that cycle is
// resolved by its require sitting inside the function, not at module top level.
const { releaseForOrder } = require('../lib/shelf');

// ---------- SSE stream: live presence + order events for staff/admin ----------
function issueEventsTicket(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({ ticket: signSseTicket(req.user), expires_in: 60 });
}

function streamEvents(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering so events flush immediately
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write('retry: 3000\n\n'); // tell EventSource to reconnect after 3s if dropped
  const remove = addClient(res);
  req.on('close', () => {
    remove();
    res.end();
  });
}

// Broadcast helpers — keep event shapes in one place.
function emitOrderChanged(orderId, status) {
  publish({ type: 'order', orderId, status });
}
function emitPresence(orderId, staffId, staffName) {
  publish({ type: 'presence', orderId, working_staff_id: staffId, working_staff_name: staffName });
}

// Resolve the order-source filter for a request: a scoped staff member is pinned to their
// users.order_scope; manager/admin (and 'both'-scope staff) may filter freely via ?source.
function resolveSourceFilter(user, querySource) {
  const scope = user.order_scope || 'both';
  const free = user.role === 'admin' || staffTypesOf(user).includes('manager') || scope === 'both';
  if (free) {
    return querySource === 'retail' || querySource === 'wholesaler' ? querySource : null;
  }
  return scope; // 'retail' | 'wholesaler'
}

function sourceClause(sourceFilter) {
  if (sourceFilter === 'retail') return 'AND s.wholesaler_id IS NULL';
  if (sourceFilter === 'wholesaler') return 'AND s.wholesaler_id IS NOT NULL';
  return '';
}

// Which production stages each staff_type works (its queue). Manager/admin see the whole line.
const QUEUE_STAGES = {
  designer: ['design_complete'],
  digitizer: ['converting'],
  embroiderer: ['embroidery'],
  presser: ['pressing'],
  // Preparer also sees تم التسليم (delivered) — they're the ones who hand orders over,
  // so the "done" column lives in their queue (recency-capped in getQueue).
  preparer: ['preparing', 'ready', 'delivered'],
  // مفصل (tailor) — read-only viewer of every in-production order (recognises sashes by
  // name). No transitions exist for tailor, so available_actions stays empty (read-only).
  tailor: ['design_complete', 'converting', 'embroidery', 'pressing', 'preparing', 'ready'],
};
const MANAGER_STAGES = ['design_complete', 'converting', 'embroidery', 'pressing', 'preparing', 'ready'];
// What a manager/admin SEES in the production console — same as MANAGER_STAGES plus the
// تم التسليم "done" column. Kept separate so monitor()'s WIP math stays on the 6 live stages.
const MANAGER_VIEW_STAGES = [...MANAGER_STAGES, 'delivered'];

// Presence is heartbeat-based: a viewer re-claims every ~30s while the order tab
// is open. An order is "actively worked" only while its last heartbeat is fresh.
const PRESENCE_TTL_SECONDS = 90;

function isManager(u) {
  return u.role === 'admin' || staffTypesOf(u).includes('manager');
}

// Canonical embroidery zones, detected from an order's spec lines (order_items.label_snapshot) that carry real
// content (customer_text or customer_image_url). Mirrors orderController's ORDER_ZONE_MATCH heuristics in JS.
const ZONE_DEFS = [
  { key: 'sash_right', label: 'الوشاح — جهة الاسم',  test: (l) => /يمين|اليمن/.test(l) },
  { key: 'sash_left',  label: 'الوشاح — جهة السنة',  test: (l) => /يسار|اليسر/.test(l) },
  { key: 'sash_back',  label: 'الوشاح — من الخلف',   test: (l) => /خلف/.test(l) },
  { key: 'sash_front', label: 'الوشاح — من الأمام',  test: (l) => /وشاح/.test(l) && /أمام/.test(l) },
  // NOTE: «شال امريكي» is deliberately NOT a zone — the American shawl is an add-on, not embroidery
  // (تطريز). It carries a required photo (so it's "content") but must be IGNORED by the embroiderer's
  // checklist, which is ONLY the 5 real embroidery zones: sash (name/year/back) + cap (top/side).
  { key: 'cap_top',    label: 'القبعة — من الأعلى',  test: (l) => /أعلى|اعلى/.test(l) },
  { key: 'cap_side',   label: 'القبعة — من الجانب',  test: (l) => /جانب/.test(l) },
  { key: 'robe_sleeve_right', label: 'الروب — الردن الأيمن', test: (l) => /ردن/.test(l) && /أيمن/.test(l) },
  { key: 'robe_sleeve_left',  label: 'الروب — الردن الأيسر', test: (l) => /ردن/.test(l) && /أيسر/.test(l) },
];
async function detectEmbroideryZones(orderId, progress) {
  const { rows } = await query(
    `SELECT label_snapshot, customer_text, customer_image_url FROM order_items WHERE order_id = $1`, [orderId]);
  const seen = new Set();
  const zones = [];
  for (const it of rows) {
    const label = it.label_snapshot || '';
    const hasContent = (it.customer_text && it.customer_text.trim() !== '') || it.customer_image_url;
    if (!hasContent) continue;
    for (const z of ZONE_DEFS) {
      if (!seen.has(z.key) && z.test(label)) {
        seen.add(z.key);
        zones.push({ key: z.key, label: z.label, done: !!(progress && progress[z.key]) });
      }
    }
  }
  return zones;
}

// Zones + image-presence for the calligraphy workbench: which embroidery zones does this
// order carry, and does each already have its artwork (plate/photo) attached? Same ZONE_DEFS
// matching as the embroiderer checklist, but keyed on has_image instead of the tick-progress.
async function detectZonesWithImages(orderId) {
  const { rows } = await query(
    `SELECT label_snapshot, customer_text, customer_image_url FROM order_items WHERE order_id = $1`, [orderId]);
  const seen = new Map();
  for (const it of rows) {
    const label = it.label_snapshot || '';
    const hasContent = (it.customer_text && it.customer_text.trim() !== '') || it.customer_image_url;
    if (!hasContent) continue;
    for (const z of ZONE_DEFS) {
      if (z.test(label)) {
        const prev = seen.get(z.key);
        const has_image = !!it.customer_image_url || !!(prev && prev.has_image);
        seen.set(z.key, { key: z.key, label: z.label, has_image });
      }
    }
  }
  return [...seen.values()];
}

// Batched detectEmbroideryZones for the station console («عرض بالطلب»/«عرض بالقطع»):
// ONE order_items query for every id, same content rule + first-match-wins semantics as
// the single-order version, plus each zone's stitch content (text + image) so the list
// can show WHAT to embroider without opening the order. progressById: id → jsonb map.
async function detectZonesForOrders(ids, progressById) {
  const byOrder = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return byOrder;
  const { rows } = await query(
    `SELECT order_id, label_snapshot, customer_text, customer_image_url
     FROM order_items WHERE order_id = ANY($1) ORDER BY order_id`,
    [ids]
  );
  const seenByOrder = new Map();
  for (const it of rows) {
    const label = it.label_snapshot || '';
    const text = (it.customer_text || '').trim();
    const hasContent = text !== '' || it.customer_image_url;
    if (!hasContent) continue;
    for (const z of ZONE_DEFS) {
      let seen = seenByOrder.get(it.order_id);
      if (!seen) { seen = new Set(); seenByOrder.set(it.order_id, seen); }
      if (!seen.has(z.key) && z.test(label)) {
        seen.add(z.key);
        const progress = progressById.get(it.order_id) || {};
        byOrder.get(it.order_id)?.push({
          key: z.key,
          label: z.label,
          done: !!progress[z.key],
          text: text || null,
          image_url: it.customer_image_url || null,
        });
      }
    }
  }
  return byOrder;
}

// Route-aware next stage: design-bearing sashes must use approve (not advance).
// Advance is for: embroidery, pressing, preparing, ready + design-less embroidery orders
// from design_complete. An APPROVED design at design_complete may also advance (sash done, move on).
// STAGE-2 REMOVED (user 2026-07-15): «تحويل التصميم لتطريز» (converting) is no longer part of
// the live pipeline — design goes straight to التطريز; conversion happens inside that station.
// The 'converting' case below is DRAIN-ONLY (legacy rows + orders created by prod before deploy).
function nextStageFor(order) {
  const { status, design_id, needs_pressing, design_approval_status } = order;
  switch (status) {
    case 'design_complete':
      // design-bearing sash: must be approved before it can advance to embroidery.
      // Pending or rejected designs still need the designer's verdict first.
      if (design_id) {
        if (design_approval_status === 'approved') return 'embroidery';
        return null; // pending/rejected → use approve endpoint
      }
      return 'embroidery';
    case 'converting': // drain-only
      return 'embroidery';
    case 'embroidery':
      return needs_pressing ? 'pressing' : 'preparing';
    case 'pressing':
      return 'preparing';
    case 'preparing':
      return 'ready';
    case 'ready':
      return 'delivered';
    default:
      return null;
  }
}

// REVERT map: one step back for each status.
// design_complete → designing so the student/staff can submit a new design.
// When reverting to designing the advance() handler resets the design approval_status to 'pending'.
const REVERT_MAP = {
  delivered: 'preparing',
  ready: 'preparing',
  preparing: 'embroidery',
  pressing: 'embroidery',
  embroidery: 'design_complete', // stage-2 (converting) removed — one step back = the design desk
  converting: 'design_complete', // drain-only
  design_complete: 'designing',
};

// «إرجاع للطالب» is only offered while the order is at its FIRST production stage — i.e. nothing
// has been produced yet, so it is safe to hand back to the student for editing. A designed/
// embroidered piece starts at design_complete (or designing); a plain piece starts at preparing.
// has_embroidery distinguishes a plain order sitting at its first 'preparing' stage from an
// embroidered order that REACHED 'preparing' after embroidery (the latter is NOT first-stage).
// Key the advance label on the actual EDGE (status→next), not just the current status —
// at 'embroidery' the next stage is pressing OR preparing (needs_pressing-driven), so a
// status-keyed label would lie ("نقل للكوي" even when going straight to التجهيز).
// Module-scoped: also consumed by the calligraphy workbench («تحويل للتطريز» button label).
const ADVANCE_LABEL_AR = {
  'design_complete→embroidery': 'تحويل للتطريز',
  'design_complete→converting': 'إرسال للتحويل / التطريز', // drain-only (stage-2 removed)
  'converting→embroidery':      'إنهاء التحويل، نقل للتطريز', // drain-only
  'embroidery→pressing':        'إنهاء التطريز، نقل للكوي',
  'embroidery→preparing':       'إنهاء التطريز، نقل للتجهيز',
  'pressing→preparing':         'إنهاء الكوي، نقل للتجهيز',
  'preparing→ready':            'إنهاء التجهيز، تحديد جاهز',
  'ready→delivered':            'تأكيد التسليم',
};

function isFirstProductionStage(order) {
  const designed = !!order.has_embroidery || !!order.design_id;
  return designed
    ? (order.status === 'designing' || order.status === 'design_complete')
    // Plain pieces: non-cap now starts at الكوي ('pressing'); caps (and legacy rows)
    // start at التجهيز ('preparing').
    : (order.status === 'preparing' || order.status === 'pressing');
}

// One-step-back target, aware of PLAIN pieces (no design/embroidery): they never visited
// التطريز, so REVERT_MAP's embroidery targets would invent a ghost stage for them. A plain
// piece at its first stage has nothing to revert to; a plain piece at التجهيز goes back to
// الكوي (where it came from) when it pressed, else nowhere. Needs order.{status, design_id,
// has_embroidery, needs_pressing}.
function resolveRevertTarget(order) {
  const plain = !order.design_id && !order.has_embroidery;
  if (plain) {
    if (order.status === 'pressing') return null; // first stage for plain non-cap
    if (order.status === 'preparing') return order.needs_pressing ? 'pressing' : null;
  }
  return REVERT_MAP[order.status] ?? null;
}

// ---------- Stage-scoped work queue for the requesting staff member ----------
async function getQueue(req, res) {
  const u = req.user;
  let stages;
  if (isManager(u)) {
    const filter = req.query.stage;
    stages = filter && MANAGER_VIEW_STAGES.includes(filter) ? [filter] : MANAGER_VIEW_STAGES;
  } else {
    // Multi-role: union the stage queues of every role the staff member holds.
    const set = new Set();
    for (const t of staffTypesOf(u)) (QUEUE_STAGES[t] || []).forEach((st) => set.add(st));
    stages = [...set];
  }
  if (!stages.length) return res.json({ data: [] });

  // A designer only reviews designs still awaiting a verdict — but this narrows ONLY the
  // design_complete stage, so a multi-role designer (e.g. designer+embroiderer) still sees
  // their other merged stages unfiltered. Design-less embroidery orders (cap/robe) the
  // designer also handles (design_id IS NULL).
  const designerPending = staffTypesOf(u).includes('designer') && !isManager(u);
  const srcClause = sourceClause(resolveSourceFilter(u, req.query.source));
  // Embroidery-zone / pleat filter (sash R/L/back · cap side/top · robe pleats).
  const zoneClause = req.query.zone ? orderZoneClause(req.query.zone, 'o') : null;
  const { rows } = await query(
    `SELECT o.id, o.status, o.created_at, o.design_id, o.checkout_group_id,
            o.student_id, o.needs_pressing, o.embroidery_zones,
            o.working_staff_id, o.working_since,
            o.final_design_url, o.has_embroidery,
            EXISTS(SELECT 1 FROM order_items oi2
                    WHERE oi2.order_id = o.id AND oi2.customer_image_url IS NOT NULL) AS has_design_images,
            u.name AS student_name, s.university_name, s.department, s.study_type,
            p.name_ar AS product_name, p.type AS product_type,
            -- Catalog product photo. Already exposed on the order DETAIL for every staff
            -- role; carried on the queue row too so a station can show «which item is this»
            -- beside the embroidery artwork without opening each piece (owner 2026-08-05).
            p.image_url AS product_image_url,
            b.name_ar AS batch_name, b.deadline,
            d.approval_status, d.rejection_reason,
            CASE WHEN s.wholesaler_id IS NULL THEN 'retail' ELSE 'wholesaler' END AS source,
            wu.name AS wholesaler_name,
            -- Only expose the worker while their heartbeat is fresh, so the queue
            -- tag reflects who has the tab open RIGHT NOW (stale claims read free).
            CASE WHEN o.working_since > NOW() - INTERVAL '${PRESENCE_TTL_SECONDS} seconds'
                 THEN wk.name END AS working_staff_name
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     JOIN products p ON p.id = o.product_id
     LEFT JOIN batches b ON b.id = o.batch_id
     LEFT JOIN designs d ON d.id = o.design_id
     LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
     LEFT JOIN users wu ON wu.id = w.user_id
     LEFT JOIN users wk ON wk.id = o.working_staff_id
     WHERE o.status::text = ANY($1)
       -- تم التسليم column is bounded to the last 90 days so the console can't grow unbounded.
       -- NULL delivered_at (legacy/migrated rows) is kept so a delivered order never just vanishes.
       AND (o.status::text <> 'delivered' OR o.delivered_at IS NULL OR o.delivered_at > NOW() - INTERVAL '90 days')
       -- Wholesaler approval gate: only show approved (or retail, i.e. NULL) orders to staff.
       AND (s.wholesaler_id IS NULL OR o.wholesaler_approval = 'approved')
       -- «إرجاع للطالب»: an order returned to the student leaves the production queue until resubmitted.
       AND o.returned_to_customer = FALSE
       ${designerPending
         ? "AND (o.status::text <> 'design_complete' OR ((o.design_id IS NOT NULL AND d.approval_status = 'pending') OR (o.design_id IS NULL AND o.has_embroidery = TRUE)))"
         : ''}
       ${srcClause}
       ${zoneClause ? 'AND ' + zoneClause : ''}
     ORDER BY b.deadline ASC NULLS LAST, o.created_at ASC`,
    [stages]
  );
  // Station-console enrichment (?station=1): per-piece embroidery zones (with the stitch
  // content) for التطريز + التجهيز rows, and a backend-granted advance for الكوي + التجهيز
  // rows — so the console never re-derives state-machine rules client-side.
  //
  // WHY التجهيز gets zones too (2026-08-05, owner request): the preparer packs the physical
  // set and has to check that what is in their hands matches what the student ordered —
  // sash front AND back, cap top AND side, both robe sleeves. They were packing blind: the
  // shelf/queue screens carried no artwork at all. Same detector as the embroiderer's
  // checklist, so both stations read one source of truth for "what is stitched on this
  // piece"; the DIFFERENCE is that the preparer only ever READS them (no tick endpoint is
  // exposed for 'preparing'), which is why `done` is irrelevant downstream.
  if (String(req.query.station || '') === '1') {
    // 'preparing' rows carry no tick progress of their own — the zones are already
    // stitched by the time a piece reaches التجهيز — but detectZonesForOrders wants a
    // progress map keyed by id, so the (empty) jsonb is passed through unchanged.
    //
    // 'ready' is in the SAME set, and it has to be: التجهيز's console shows «قيد التجهيز»
    // and «جاهزة للتسليم» as two tabs of one screen. Enriching only the first made the
    // second claim «لا تطريز على هذه القطعة» for every packed piece — the sheet cannot
    // tell "no artwork" from "artwork never fetched", so an absent list reads as a
    // statement of fact. A bagged piece is exactly when the preparer double-checks the
    // set against the student at handover, so the artwork belongs there too.
    // Costs no extra round-trip: detectZonesForOrders is one `order_id = ANY($1)` query.
    // 'delivered' is deliberately NOT included — it is a history column, not work.
    const ZONE_STAGES = new Set(['embroidery', 'preparing', 'ready']);
    const zoneIds = rows.filter((r) => ZONE_STAGES.has(r.status)).map((r) => r.id);
    const zonesById = await detectZonesForOrders(
      zoneIds,
      new Map(rows.map((r) => [r.id, r.embroidery_zones || {}]))
    );
    for (const r of rows) {
      if (ZONE_STAGES.has(r.status)) {
        r.zones = zonesById.get(r.id) || [];
      }
      if (r.status === 'pressing' || r.status === 'preparing') {
        const next = nextStageFor({
          status: r.status,
          design_id: r.design_id,
          needs_pressing: r.needs_pressing,
          design_approval_status: r.approval_status,
        });
        r.next_status = next;
        r.can_advance = !!next && next !== 'delivered' && canStaffTransition(u, r.status, next);
        r.advance_label = next ? ADVANCE_LABEL_AR[`${r.status}→${next}`] ?? null : null;
      }
    }
  }
  // The raw progress jsonb is internal — expose only the computed zones list.
  for (const r of rows) delete r.embroidery_zones;
  res.json({ data: rows });
}

// ---------- Stage-appropriate order projection (presser NEVER receives the canvas) ----------
async function getOrder(req, res) {
  const { id } = req.params;
  const u = req.user;
  // A "sole-role" worker gets the lean, station-specific projection; a multi-role user
  // (e.g. designer+embroiderer) keeps the richer union, so block only when it IS the sole role.
  const uTypes = staffTypesOf(u);
  const mgr = isManager(u);
  const soleRole = (r) => !mgr && uTypes.includes(r) && uTypes.every((t) => t === r);
  // Presser: no canvas/contact — colour + status only (sash info for الكوي).
  const presserOnly = soleRole('presser');
  // مفصل (tailor): READ-ONLY فصال view (photo + measurements + sizes). Allow-list rebuilt below.
  const tailorOnly = soleRole('tailor');
  // تطريز (embroiderer / محمد عماد): minimal station — student name + the embroidery text/photo
  // lines + the per-zone checklist. NO contact, money, measurements, design canvas, or package.
  const embroidererOnly = soleRole('embroiderer');
  // Front-desk / delivery (preparer) + managers see the full record (contact, money,
  // measurements, the whole package). Every OTHER production station gets a "lean" view.
  const frontDesk = mgr || uTypes.includes('preparer');
  const lean = !frontDesk;
  // المصمم contacts the student to confirm the artwork (user 2026-07-17) — designers get the
  // full contact + intake context like the أيادي التصميم desk. Money stays front-desk/manager.
  const designer = uTypes.includes('designer');
  // Capability flags — also returned to the client so the UI never re-derives visibility
  // (single source of truth, mirrors the available_actions pattern).
  const canSeeContact = frontDesk || designer;
  const canSeeMoney = frontDesk;
  // الفصال needs the robe قياسات; المكوجي needs the sizes too (his station shows
  // name + product photo + sizes + design images — user 2026-07-15).
  const canSeeMeasurements = frontDesk || tailorOnly || presserOnly;
  const canSeePackage = frontDesk;                    // only front-desk/manager hop between siblings
  const canSeeDesign = !presserOnly && !tailorOnly && !embroidererOnly;

  const base = await query(
    `SELECT o.id, o.status, o.created_at, o.price, o.design_id, o.package_id, o.checkout_group_id,
            o.batch_id, o.student_id,
            o.has_embroidery, o.needs_pressing, o.measurements, o.final_design_url,
            o.embroidery_zones,
            o.working_staff_id, o.working_since,
            o.delivered_at, o.delivery_method, o.recipient_name, o.delivery_address,
            o.delivery_phone, o.delivery_notes, du.name AS delivered_by_name,
            u.name AS student_name, u.phone AS student_phone,
            s.university_name, s.department, s.gender, s.study_type, s.instagram_username,
            p.name_ar AS product_name, p.type AS product_type, p.image_url AS product_image_url,
            b.name_ar AS batch_name, b.deadline,
            CASE WHEN s.wholesaler_id IS NULL THEN 'retail' ELSE 'wholesaler' END AS source,
            wu.name AS wholesaler_name,
            wk.name AS working_staff_name,
            cg.customer_name AS intake_customer_name, cg.instagram_username AS intake_instagram,
            cg.phone_primary AS intake_phone_primary, cg.phone_secondary AS intake_phone_secondary,
            cg.governorate AS intake_governorate, cg.area_details AS intake_area_details,
            cg.event_date::text AS intake_event_date, cg.deposit AS intake_deposit, cg.notes AS intake_notes
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     JOIN products p ON p.id = o.product_id
     LEFT JOIN batches b ON b.id = o.batch_id
     LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
     LEFT JOIN users wu ON wu.id = w.user_id
     LEFT JOIN users wk ON wk.id = o.working_staff_id
     LEFT JOIN users du ON du.id = o.delivered_by
     LEFT JOIN checkout_groups cg ON cg.id = o.checkout_group_id
     WHERE o.id = $1`,
    [id]
  );
  if (!base.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  const order = { ...base.rows[0] };

  // Full-set form intake (delivery / phones / event date / deposit) — null for cart bundles.
  order.intake = order.intake_customer_name ? {
    customer_name: order.intake_customer_name,
    instagram_username: order.intake_instagram,
    phone_primary: order.intake_phone_primary,
    phone_secondary: order.intake_phone_secondary,
    governorate: order.intake_governorate,
    area_details: order.intake_area_details,
    event_date: order.intake_event_date,
    deposit: Number(order.intake_deposit) || 0,
    notes: order.intake_notes,
  } : null;
  for (const k of Object.keys(order)) if (k.startsWith('intake_')) delete order[k];

  // SECURITY: non-managers are scoped to either retail or wholesaler orders only.
  if (!isManager(u) && !staffScopeAllows(u, order.source === 'retail')) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }

  // PRICE VISIBILITY: only front-desk (preparer) + manager/admin see money. The embroiderer
  // no longer sees the price — his station needs the name + the stitch, not the cash.
  if (!canSeeMoney) {
    delete order.price;
    if (order.intake) delete order.intake.deposit;
  }
  // CONTACT VISIBILITY: front-desk/manager + designer (he calls the student to confirm the
  // design). The other stations (digitizer, embroiderer, presser) work from the design + spec.
  if (!canSeeContact) {
    order.student_phone = null;
    order.instagram_username = null;
  }
  // MEASUREMENTS: only the tailor (الفصال) + front-desk/manager need the robe قياسات.
  if (!canSeeMeasurements) order.measurements = null;
  // Presser gets no customer contact/address — just the event date for urgency.
  if (presserOnly && order.intake) {
    order.intake = { event_date: order.intake.event_date };
  }
  // Delivery details are PII (address + phone of the recipient) — keep them off the
  // presser view as well (tailor is already stripped by the allow-list above).
  if (presserOnly) {
    order.delivery_address = null;
    order.delivery_phone = null;
    order.recipient_name = null;
    order.delivery_notes = null;
  }
  // Tailor (مفصل / الفصال) sees فصال-relevant detail — student name, the catalog photo,
  // measurements/sizes, and university/batch context — but NEVER money or contact. Rebuild
  // `order` from an ALLOW-LIST so nothing else can ever leak via a direct API call (price,
  // intake, working_*, delivery_*, demographics, the final-design URL). Allow-list, not
  // deny-list, so a future column added to the SELECT can't silently re-open the hole.
  // Caps are out of the فصال scope entirely.
  if (tailorOnly) {
    if (order.product_type === 'cap') {
      return res.status(403).json({ error: 'هذا الطلب خارج نطاق الفصال', code: 'ERR_FORBIDDEN' });
    }
    const ALLOWED = new Set([
      'id', 'status', 'created_at', 'student_name', 'product_name', 'product_type',
      'product_image_url', 'measurements', 'university_name', 'department', 'batch_name', 'source',
    ]);
    for (const k of Object.keys(order)) if (!ALLOWED.has(k)) delete order[k];
  }

  // تطريز (embroiderer / محمد عماد) — minimal station view. Rebuild `order` from an ALLOW-LIST
  // (like the tailor) so nothing leaks: only the name + product/batch context and the routing
  // flags the checklist/advance need. NO contact, money, measurements, design, intake, delivery,
  // or package siblings (checkout_group_id/package_id dropped → no bundle below).
  if (embroidererOnly) {
    order.intake = null;
    const ALLOWED = new Set([
      'id', 'status', 'created_at', 'student_name', 'product_name', 'product_type',
      'product_image_url', 'batch_name', 'source', 'design_id', 'has_embroidery',
      'needs_pressing', 'embroidery_zones',
    ]);
    for (const k of Object.keys(order)) if (!ALLOWED.has(k)) delete order[k];
  }
  // LEAN production (digitizer, no front-desk role): keep the design/work layout but
  // drop the full-set intake card (phones/address/deposit). Contact, money + measurements are
  // already stripped above; the package siblings are gated by canSeePackage below.
  // The designer KEEPS the intake (phones/instagram/governorate/event date/notes — he contacts
  // the student); its deposit was already deleted by the canSeeMoney strip above.
  if (lean && !presserOnly && !tailorOnly && !embroidererOnly && !designer) {
    order.intake = null;
  }

  // Design fetch is gated by canSeeDesign (designer/digitizer/manager/admin get the full artwork;
  // presser gets colour-only; embroiderer/tailor get none).
  let design = null;
  if (order.design_id && canSeeDesign) {
    const d = await query(
      `SELECT id, sash_color, left_canvas, right_canvas, logo_url, extra_image_url,
              fonts_used, notes, approval_status, rejection_reason, completed
       FROM designs WHERE id = $1`,
      [order.design_id]
    );
    design = d.rows[0] || null;
  } else if (order.design_id && presserOnly) {
    // sash info only — colour + status, NO artwork/canvas/logos.
    const d = await query(
      `SELECT id, sash_color, approval_status, completed FROM designs WHERE id = $1`,
      [order.design_id]
    );
    design = d.rows[0] || null;
  }

  // Option selections (sizes etc.) + the zone/design images. The presser SEES the design
  // images now (his station is name + product photo + sizes + design — user 2026-07-15);
  // money/contact stay stripped below.
  const itemsRes = await query(
    `SELECT id, label_snapshot, price_snapshot, qty, customer_image_url, customer_text, group_id, option_id
     FROM order_items WHERE order_id = $1 ORDER BY created_at`,
    [id]
  );
  let items = itemsRes.rows;
  // Per-line price is money — strip it for everyone but front-desk/manager (covers tailor,
  // embroiderer + lean designer/digitizer). The UI never renders it, but defence in depth.
  if (!canSeeMoney) {
    items = items.map((it) => ({ ...it, price_snapshot: null }));
  }

  // Bundle siblings — only front-desk/manager may hop between the package pieces. Production
  // stations (embroiderer, designer, digitizer, presser, tailor) see their one piece only.
  let bundle = null;
  const hasBundle = canSeePackage && (order.checkout_group_id != null || order.package_id != null);
  if (hasBundle) {
    const sib = await query(
      `SELECT o.id, o.status, o.price, p.name_ar AS product_name, p.type AS product_type
       FROM orders o JOIN products p ON p.id = o.product_id
       WHERE o.student_id = $1
         AND ( (o.checkout_group_id IS NOT NULL AND o.checkout_group_id = $2)
               OR (o.package_id IS NOT NULL AND o.package_id = $3) )
       ORDER BY p.type`,
      [order.student_id, order.checkout_group_id, order.package_id]
    );
    if (sib.rows.length >= 2) {
      bundle = sib.rows.map((row) => ({
        id: row.id,
        status: row.status,
        price: row.price,
        product_name: row.product_name,
        product_type: row.product_type,
        is_current: row.id === order.id,
      }));
    }
  }

  // Compute available_actions from the same state machine used by POST handlers,
  // so the frontend never shows a button the backend would reject.
  const orderForActions = {
    ...order,
    design_approval_status: design?.approval_status ?? null,
  };
  const nextTo = nextStageFor(orderForActions);
  const revertTo = resolveRevertTarget(order);

  const { canStaffTransition: canTransition } = require('./orderController');

  // Per-zone embroidery checklist (محمد عماد ticks each zone; all-done auto-advances).
  // Computed BEFORE available_actions so it can gate the manual advance. Only meaningful at the
  // embroidery stage. Never leak the raw o.embroidery_zones jsonb on the order — strip it after.
  let embroidery_zones = [];
  if (order.status === 'embroidery') {
    embroidery_zones = await detectEmbroideryZones(order.id, order.embroidery_zones);
  }
  delete order.embroidery_zones;
  // Mandatory checklist: a non-manager embroiderer must tick EVERY zone. While any zone is
  // unticked the manual advance is hidden here AND rejected in advance() — so the per-zone
  // checklist can't be skipped. Manager/admin keep the manual advance as a fallback.
  const embroideryIncomplete =
    order.status === 'embroidery' && embroidery_zones.length > 0 && !embroidery_zones.every((z) => z.done);

  // Admin/مدير الإنتاج editing: quick per-field edits on any order; the full طقم form only
  // for design-less orders of rep-linked or admin-created (name-only) students — never
  // retail bundles (the form would re-price them with rep pricing).
  let canEditFullSet = false;
  if (isManager(u) && !order.design_id) {
    if (order.source !== 'retail') canEditFullSet = true;
    else {
      const st = await query(
        `SELECT u2.phone FROM students s JOIN users u2 ON u2.id = s.user_id WHERE s.id = $1`,
        [order.student_id]
      );
      canEditFullSet = st.rows.length > 0 && st.rows[0].phone == null;
    }
  }

  const available_actions = {
    advance: nextTo && canTransition(u, order.status, nextTo) && !(embroideryIncomplete && !isManager(u))
      ? { to: nextTo, label: ADVANCE_LABEL_AR[`${order.status}→${nextTo}`] ?? 'تقدم للمرحلة التالية' }
      : null,
    revert: revertTo && canTransition(u, order.status, revertTo)
      ? { to: revertTo }
      : null,
    can_approve:
      !!design &&
      design.approval_status === 'pending' &&
      order.status === 'design_complete' &&
      (uTypes.includes('designer') || isManager(u)),
    can_reject:
      !!design &&
      design.approval_status === 'pending' &&
      order.status === 'design_complete' &&
      (uTypes.includes('designer') || isManager(u)),
    // «إرجاع للزبون لتعديله» — hand an early-stage order back to the student to edit + resubmit.
    // Retail AND wholesaler; offered only while the order is still at its first production stage
    // and the staffer is scoped to it (manager/admin bypass inside staffScopeAllows).
    return_to_customer:
      isFirstProductionStage(order) &&
      (isManager(u) || staffScopeAllows(u, order.source === 'retail')),
    can_upload_final_design:
      isManager(u) || uTypes.some((type) => ['designer', 'digitizer', 'embroiderer'].includes(type)),
    can_delete: isManager(u),
    can_edit: isManager(u),
    can_edit_full_set: canEditFullSet,
  };

  res.json({
    data: {
      order,
      design,
      items,
      bundle,
      package_orders: bundle, // backward-compat alias
      can_see_design: canSeeDesign,
      embroidery_zones,
      available_actions,
      // The UI never re-derives visibility from roles — it reads this layout discriminator
      // (mirrors the available_actions single-source pattern).
      view: {
        layout: embroidererOnly ? 'embroidery' : tailorOnly ? 'tailor' : presserOnly ? 'presser' : 'full',
      },
    },
  });
}

// ---------- Advance an order to its next production stage ----------
// Load the row needed to compute + apply an advance (shared by single + bulk).
async function loadAdvanceRow(id) {
  const cur = await query(
    `SELECT o.id, o.status, o.design_id, o.has_embroidery, o.needs_pressing,
            s.user_id, s.wholesaler_id, d.approval_status AS design_approval_status
     FROM orders o JOIN students s ON s.id = o.student_id
     LEFT JOIN designs d ON d.id = o.design_id
     WHERE o.id = $1`,
    [id]
  );
  return cur.rows[0] || null;
}

// Apply ONE forward advance (guards must be checked by the caller). Writes the
// status + audit/activity/notification in a tx, then emits live events. Returns
// the updated {id, status} row.
async function performAdvance(order, user) {
  const from = order.status;
  const to = nextStageFor(order);
  const deliveredSet = to === 'delivered' ? ', delivered_at = NOW()' : '';
  const updated = await tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE orders SET status = $1${deliveredSet},
       working_staff_id = NULL, working_since = NULL
       WHERE id = $2 RETURNING id, status`,
      [to, order.id]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'status_change', 'order', $2, $3)`,
      [user.id, order.id, JSON.stringify({ from, to, by: user.staff_type || user.role })]
    );
    await client.query(
      `INSERT INTO staff_activity_log (user_id, action, order_id, from_stage, to_stage)
       VALUES ($1, 'advance', $2, $3, $4)`,
      [user.id, order.id, from, to]
    );
    await client.query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       VALUES ($1, 'status_change', $2, $3, '/')`,
      [order.user_id, 'تحديث حالة الطلب', `حالة طلبك الآن: ${STATUS_LABEL_AR[to]}`]
    );
    return rows[0];
  });
  emitOrderChanged(order.id, updated.status);
  emitPresence(order.id, null, null); // advancing clears the working_staff
  return updated;
}

async function advance(req, res) {
  const { id } = req.params;
  const order = await loadAdvanceRow(id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  if (!staffScopeAllows(req.user, order.wholesaler_id == null)) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }
  const to = nextStageFor(order);
  if (!to) {
    return res.status(409).json({ error: 'لا يمكن تقديم هذه الحالة', code: 'ERR_INVALID_TRANSITION' });
  }
  if (!canStaffTransition(req.user, order.status, to)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  // Mandatory checklist: a non-manager embroiderer can't manually leave التطريز while any
  // detected zone is still unticked — he must complete each zone (which auto-advances). This
  // closes the bypass so the manual «نقل للكوي» can't skip the per-zone tracking.
  if (order.status === 'embroidery' && !isManager(req.user)) {
    const prog = (await query('SELECT embroidery_zones FROM orders WHERE id = $1', [id])).rows[0]?.embroidery_zones || {};
    const zones = await detectEmbroideryZones(id, prog);
    if (zones.length > 0 && !zones.every((z) => z.done)) {
      return res.status(409).json({ error: 'أكمل مناطق التطريز أولاً', code: 'ERR_EMBROIDERY_ZONES_INCOMPLETE' });
    }
  }
  const updated = await performAdvance(order, req.user);
  res.json({ data: updated });
}

// ---------- Per-zone embroidery checklist (محمد عماد ticks each zone) ----------
// The embroiderer no longer flips the whole order in one click; he toggles each present
// embroidery zone. When EVERY present zone is done (and there's at least one), the order
// AUTO-ADVANCES through the normal advance path (embroidery→pressing/preparing via
// needs_pressing). Only embroiderer + manager/admin may tick; only while at 'embroidery'.
// Core per-order zone toggle shared by the single + bulk endpoints. The role gate
// (embroiderer OR manager/admin) is the CALLER's job; every order-level guard lives here.
// Returns {ok:true, zones, advanced, status} or {ok:false, reason}.
async function applyZoneTick(user, id, zone, done) {
  const order = await loadAdvanceRow(id);
  if (!order) return { ok: false, reason: 'not_found' };
  if (!staffScopeAllows(user, order.wholesaler_id == null)) return { ok: false, reason: 'forbidden' };
  if (order.status !== 'embroidery') return { ok: false, reason: 'wrong_stage' };
  // Validate the zone is one this order actually has, from current progress.
  const prog = (await query('SELECT embroidery_zones FROM orders WHERE id = $1', [id])).rows[0]?.embroidery_zones || {};
  const zones = await detectEmbroideryZones(id, prog);
  if (!zones.some((z) => z.key === zone)) return { ok: false, reason: 'invalid_zone' };
  // Merge the toggle into the jsonb progress map.
  await query(
    `UPDATE orders SET embroidery_zones = embroidery_zones || $1::jsonb WHERE id = $2`,
    [JSON.stringify({ [zone]: !!done }), id]
  );
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'embroidery_zone', 'order', $2, $3)`,
    [user.id, id, JSON.stringify({ zone, done: !!done })]
  );
  // Recompute with the new progress; if every present zone is now done → auto-advance.
  const newProg = (await query('SELECT embroidery_zones FROM orders WHERE id = $1', [id])).rows[0]?.embroidery_zones || {};
  const recomputed = await detectEmbroideryZones(id, newProg);
  let advanced = false;
  let status = 'embroidery';
  if (recomputed.length > 0 && recomputed.every((z) => z.done)) {
    const fresh = await loadAdvanceRow(id);
    const to = nextStageFor(fresh);
    // Gate the auto-advance through the SAME state-machine check the manual advance uses,
    // so this can never become a ghost transition if STAGE_AUTHZ for the embroidery edges
    // ever changes. Zones stay saved either way; only the stage move is gated.
    if (to && canStaffTransition(user, fresh.status, to)) {
      const updated = await performAdvance(fresh, user);
      advanced = true;
      status = updated?.status ?? 'embroidery';
    }
  }
  return { ok: true, zones: recomputed, advanced, status };
}

async function markEmbroideryZone(req, res) {
  const { id } = req.params;
  const { zone, done } = req.body;
  const uTypes = staffTypesOf(req.user);
  if (!isManager(req.user) && !uTypes.includes('embroiderer')) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const r = await applyZoneTick(req.user, id, zone, done);
  if (!r.ok) {
    if (r.reason === 'not_found') return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
    if (r.reason === 'forbidden') return res.status(403).json({ error: 'هذا الطلب خارج نطاقك', code: 'ERR_FORBIDDEN' });
    if (r.reason === 'wrong_stage') return res.status(409).json({ error: 'لا يمكن تعديل التطريز في هذه المرحلة', code: 'ERR_INVALID_TRANSITION' });
    return res.status(400).json({ error: 'منطقة تطريز غير صالحة', code: 'ERR_VALIDATION' });
  }
  res.json({ data: { zones: r.zones, advanced: r.advanced, status: r.status } });
}

// ---------- Bulk zone tick — «عرض بالقطع» batch mode (all يمين, then all يسار…) ----------
// items: [{order_id, zone}] — each ticked DONE independently with the same guards as the
// single endpoint (scope, stage, zone-validity); completed pieces auto-advance. One bad
// item never blocks the rest (mirrors advanceBulk's skip-and-report contract).
async function markEmbroideryZoneBulk(req, res) {
  const uTypes = staffTypesOf(req.user);
  if (!isManager(req.user) && !uTypes.includes('embroiderer')) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const raw = Array.isArray(req.body.items) ? req.body.items : [];
  const seen = new Set();
  const items = [];
  for (const it of raw) {
    if (!it || typeof it.order_id !== 'string' || !it.order_id) continue;
    if (typeof it.zone !== 'string' || !it.zone) continue;
    const k = `${it.order_id}:${it.zone}`;
    if (seen.has(k)) continue;
    seen.add(k);
    items.push({ order_id: it.order_id, zone: it.zone });
    if (items.length >= 200) break;
  }
  if (!items.length) {
    return res.status(400).json({ error: 'لم تُحدد أي قطع', code: 'ERR_VALIDATION' });
  }
  const results = [];
  let done = 0;
  let advanced = 0;
  for (const it of items) {
    try {
      const r = await applyZoneTick(req.user, it.order_id, it.zone, true);
      if (r.ok) {
        done++;
        if (r.advanced) advanced++;
        results.push({ order_id: it.order_id, zone: it.zone, ok: true, advanced: r.advanced, status: r.status });
      } else {
        results.push({ order_id: it.order_id, zone: it.zone, ok: false, reason: r.reason });
      }
    } catch {
      results.push({ order_id: it.order_id, zone: it.zone, ok: false, reason: 'error' });
    }
  }
  res.json({ data: { done, advanced, skipped: items.length - done, results } });
}

// ---------- Bulk advance: "إكمال" multiple orders one stage at a time ----------
// Each order is guarded INDEPENDENTLY (scope + state-machine + role) and advanced in
// its own tx, so one bad/locked order never blocks the rest. Orders the caller can't
// move are skipped (never error the whole call) and reported back.
async function advanceBulk(req, res) {
  const ids = Array.isArray(req.body.ids)
    ? [...new Set(req.body.ids.filter((x) => typeof x === 'string' && x))].slice(0, 200)
    : [];
  if (!ids.length) {
    return res.status(400).json({ error: 'لم تُحدد أي طلبات', code: 'ERR_VALIDATION' });
  }
  const results = [];
  let advanced = 0;
  for (const id of ids) {
    const order = await loadAdvanceRow(id);
    if (!order) { results.push({ id, ok: false, reason: 'not_found' }); continue; }
    if (!staffScopeAllows(req.user, order.wholesaler_id == null)) {
      results.push({ id, ok: false, reason: 'forbidden' }); continue;
    }
    const to = nextStageFor(order);
    if (!to || !canStaffTransition(req.user, order.status, to)) {
      results.push({ id, ok: false, reason: 'not_advanceable' }); continue;
    }
    // ready→delivered must capture hand-off details (recipient/method/address) via /deliver —
    // a bulk advance would set delivered with NULLs. Skip it; the detail-page modal handles it.
    if (to === 'delivered') {
      results.push({ id, ok: false, reason: 'needs_delivery' }); continue;
    }
    // Mandatory checklist (same as single advance): a non-manager embroiderer can't bulk-skip
    // التطريز while any zone is unticked — close the bulk bypass too.
    if (order.status === 'embroidery' && !isManager(req.user)) {
      const prog = (await query('SELECT embroidery_zones FROM orders WHERE id = $1', [id])).rows[0]?.embroidery_zones || {};
      const zones = await detectEmbroideryZones(id, prog);
      if (zones.length > 0 && !zones.every((z) => z.done)) {
        results.push({ id, ok: false, reason: 'embroidery_zones_incomplete' }); continue;
      }
    }
    try {
      const updated = await performAdvance(order, req.user);
      advanced++;
      results.push({ id, ok: true, status: updated.status });
    } catch {
      results.push({ id, ok: false, reason: 'error' });
    }
  }
  res.json({ data: { advanced, skipped: ids.length - advanced, results } });
}

// ---------- Confirm delivery (ready → delivered) with hand-off details ----------
// Captures HOW the order was handed over so the shop can see, afterwards, which
// orders were delivered, who received them, and whether by توصيل (delivery, with
// address + phone) or استلام من المحل (pickup).
async function deliver(req, res) {
  const { id } = req.params;
  const method = String(req.body.delivery_method || '').trim();
  const recipientName = String(req.body.recipient_name || '').trim();
  const address = String(req.body.delivery_address || '').trim();
  const phone = String(req.body.delivery_phone || '').trim();
  const dnotes = String(req.body.delivery_notes || '').trim();

  if (method !== 'delivery' && method !== 'pickup') {
    return res.status(400).json({ error: 'حدّد طريقة التسليم (توصيل أو استلام من المحل)', code: 'ERR_VALIDATION' });
  }
  if (!recipientName) {
    return res.status(400).json({ error: 'اسم مستلم الطلب مطلوب', code: 'ERR_VALIDATION' });
  }
  if (method === 'delivery' && (!address || !phone)) {
    return res.status(400).json({ error: 'عنوان ورقم هاتف التوصيل مطلوبان', code: 'ERR_VALIDATION' });
  }

  const cur = await query(
    `SELECT o.id, o.status, s.user_id, s.wholesaler_id
     FROM orders o JOIN students s ON s.id = o.student_id WHERE o.id = $1`,
    [id]
  );
  if (!cur.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  const order = cur.rows[0];
  if (!staffScopeAllows(req.user, order.wholesaler_id == null)) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }
  const from = order.status;
  if (from !== 'ready') {
    return res.status(409).json({ error: 'لا يمكن تأكيد تسليم هذا الطلب', code: 'ERR_INVALID_TRANSITION' });
  }
  if (!canStaffTransition(req.user, 'ready', 'delivered')) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const updated = await tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE orders SET status = 'delivered', delivered_at = NOW(),
              delivery_method = $1, recipient_name = $2,
              delivery_address = $3, delivery_phone = $4, delivery_notes = $5,
              delivered_by = $6, working_staff_id = NULL, working_since = NULL
       WHERE id = $7 AND status = 'ready' RETURNING id, status`,
      [method, recipientName,
       method === 'delivery' ? address : null,
       method === 'delivery' ? phone : null,
       dnotes || null, req.user.id, id]
    );
    if (!rows.length) {
      throw Object.assign(new Error('لا يمكن تأكيد تسليم هذا الطلب'), {
        expose: true, status: 409, code: 'ERR_INVALID_TRANSITION',
      });
    }
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'delivery_confirmed', 'order', $2, $3)`,
      [req.user.id, id, JSON.stringify({ from, to: 'delivered', delivery_method: method, recipient_name: recipientName })]
    );
    await client.query(
      `INSERT INTO staff_activity_log (user_id, action, order_id, from_stage, to_stage)
       VALUES ($1, 'advance', $2, $3, 'delivered')`,
      [req.user.id, id, from]
    );
    await client.query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       VALUES ($1, 'status_change', $2, $3, '/')`,
      [order.user_id, 'تم تسليم طلبك',
       method === 'delivery' ? 'تم تسليم طلبك عبر التوصيل' : 'تم تسليم طلبك من المحل']
    );
    return rows[0];
  });
  emitOrderChanged(id, updated.status);
  emitPresence(id, null, null);
  res.json({ data: updated });
}

// ---------- Revert an order one step back ----------
async function revert(req, res) {
  const { id } = req.params;
  const cur = await query(
    `SELECT o.id, o.status, o.design_id, o.has_embroidery, o.needs_pressing, s.user_id, s.wholesaler_id
     FROM orders o JOIN students s ON s.id = o.student_id WHERE o.id = $1`,
    [id]
  );
  if (!cur.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  const order = cur.rows[0];
  if (!staffScopeAllows(req.user, order.wholesaler_id == null)) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }
  const from = order.status;
  const to = resolveRevertTarget(order);
  if (!to) {
    return res.status(409).json({ error: 'لا يمكن التراجع عن هذه الحالة', code: 'ERR_INVALID_TRANSITION' });
  }
  if (!canStaffTransition(req.user, from, to)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const updated = await tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE orders SET status = $1, working_staff_id = NULL, working_since = NULL
       WHERE id = $2 RETURNING id, status`,
      [to, id]
    );
    // Leaving التجهيز means the piece is no longer on the shelf — free its خانة, else the
    // bin stays "occupied" by a piece that has physically gone back up the line.
    if (from === 'preparing') {
      await releaseForOrder(id, client);
    }
    // Reverting to designing resets the design to pending so the student/staff
    // can submit a new design and the approve→advance flow works again.
    if (to === 'designing' && order.design_id) {
      await client.query(
        `UPDATE designs SET approval_status = 'pending', rejection_reason = NULL
         WHERE id = $1`,
        [order.design_id]
      );
    }
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'status_revert', 'order', $2, $3)`,
      [req.user.id, id, JSON.stringify({ from, to, by: req.user.staff_type || req.user.role })]
    );
    await client.query(
      `INSERT INTO staff_activity_log (user_id, action, order_id, from_stage, to_stage)
       VALUES ($1, 'revert', $2, $3, $4)`,
      [req.user.id, id, from, to]
    );
    await client.query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       VALUES ($1, 'status_change', $2, $3, '/')`,
      [order.user_id, 'تحديث حالة الطلب', `حالة طلبك الآن: ${STATUS_LABEL_AR[to]}`]
    );
    return rows[0];
  });
  emitOrderChanged(id, updated.status);
  emitPresence(id, null, null);
  res.json({ data: updated });
}

// ---------- «إرجاع للطالب» — return a RETAIL order to the student to edit + resubmit ----------
// Admin or scoped staff can hand back an early-stage retail order. It is flagged
// returned_to_customer = TRUE → leaves the production queue + orders list → the student edits it
// in /returned-orders and resubmits (POST /orders/configure), which clears the flag.
async function returnToCustomer(req, res) {
  const { id } = req.params;
  const reason = (req.body && typeof req.body.reason === 'string') ? req.body.reason.trim() : '';
  const cur = await query(
    `SELECT o.id, o.status, o.design_id, o.has_embroidery, o.returned_to_customer, o.checkout_group_id,
            s.user_id, s.wholesaler_id
     FROM orders o JOIN students s ON s.id = o.student_id WHERE o.id = $1`,
    [id]
  );
  if (!cur.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  const order = cur.rows[0];

  // Scope guard — manager/admin bypass inside staffScopeAllows. Retail AND wholesaler orders can
  // be returned to the student to edit + resubmit (wholesaler resubmit re-enters rep approval).
  if (!staffScopeAllows(req.user, order.wholesaler_id == null)) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }
  if (order.returned_to_customer) {
    return res.status(409).json({ error: 'الطلب مُرجَع للطالب بالفعل', code: 'ERR_ALREADY_RETURNED' });
  }
  // Only while nothing has been produced yet — same gate the button reads from getOrder.
  if (!isFirstProductionStage(order)) {
    return res.status(409).json({ error: 'لا يمكن إرجاع طلب بدأ تنفيذه', code: 'ERR_NOT_FIRST_STAGE' });
  }

  const updated = await tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE orders
          SET returned_to_customer = TRUE,
              returned_reason       = $2,
              returned_at           = NOW(),
              returned_by           = $3,
              working_staff_id      = NULL,
              working_since         = NULL
        WHERE id = $1
        RETURNING id, status, returned_to_customer`,
      [id, reason || null, req.user.id]
    );
    // Wholesaler طقم: return the WHOLE bundle to the student and re-open rep approval, so the
    // student can edit at /my-order — an 'approved' order would otherwise be locked from edits.
    if (order.wholesaler_id != null && order.checkout_group_id) {
      await client.query(
        `UPDATE orders
            SET returned_to_customer = TRUE, returned_reason = $2, returned_at = NOW(),
                returned_by = $3, working_staff_id = NULL, working_since = NULL,
                wholesaler_approval = 'pending', wholesaler_reject_reason = NULL
          WHERE checkout_group_id = $1`,
        [order.checkout_group_id, reason || null, req.user.id]
      );
    }
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'return_to_customer', 'order', $2, $3)`,
      [req.user.id, id, JSON.stringify({ reason: reason || null, by: req.user.staff_type || req.user.role })]
    );
    await client.query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       VALUES ($1, 'order_returned', $2, $3, $4)`,
      [
        order.user_id,
        'تم إرجاع طلبك للتعديل',
        reason ? `يرجى تعديل الطلب وإعادة إرساله. السبب: ${reason}` : 'يرجى تعديل الطلب وإعادة إرساله.',
        order.wholesaler_id != null ? '/my-order' : '/returned-orders',
      ]
    );
    return rows[0];
  });
  emitOrderChanged(id, updated.status);
  emitPresence(id, null, null);
  res.json({ data: updated });
}

// ---------- Claim an order (mark working_staff) — presence on tab open ----------
async function claim(req, res) {
  const { id } = req.params;
  const cur = await query(
    `SELECT o.id, o.working_staff_id, s.wholesaler_id,
            EXTRACT(EPOCH FROM (NOW() - o.working_since)) AS age_seconds,
            wk.name AS working_staff_name
     FROM orders o
     JOIN students s ON s.id = o.student_id
     LEFT JOIN users wk ON wk.id = o.working_staff_id
     WHERE o.id = $1`,
    [id]
  );
  if (!cur.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  const row = cur.rows[0];
  if (!staffScopeAllows(req.user, row.wholesaler_id == null)) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاقك', code: 'ERR_FORBIDDEN' });
  }

  // Someone else is actively in the tab (fresh heartbeat) → don't steal it.
  // Report the current owner so the UI can warn the second viewer.
  const heldByOther =
    row.working_staff_id &&
    row.working_staff_id !== req.user.id &&
    row.age_seconds != null &&
    Number(row.age_seconds) < PRESENCE_TTL_SECONDS;
  if (heldByOther) {
    return res.json({
      data: {
        claimed: false,
        working_staff_id: row.working_staff_id,
        working_staff_name: row.working_staff_name,
      },
    });
  }

  // Free, stale, or already mine → take it / refresh the heartbeat.
  const isFreshClaim = row.working_staff_id !== req.user.id;
  await query(
    `UPDATE orders SET working_staff_id = $1, working_since = NOW() WHERE id = $2`,
    [req.user.id, id]
  );
  if (isFreshClaim) {
    await query(
      `INSERT INTO staff_activity_log (user_id, action, order_id)
       VALUES ($1, 'claim', $2)`,
      [req.user.id, id]
    );
    // Broadcast only on a fresh claim — heartbeat refreshes are silent.
    emitPresence(id, req.user.id, req.user.name);
  }
  res.json({
    data: {
      claimed: true,
      working_staff_id: req.user.id,
      working_staff_name: req.user.name,
      working_since: new Date(),
    },
  });
}

// ---------- Release an order (clear working_staff) ----------
async function release(req, res) {
  const { id } = req.params;
  const cur = await query(
    `SELECT o.id, o.working_staff_id, s.wholesaler_id
     FROM orders o JOIN students s ON s.id = o.student_id WHERE o.id = $1`,
    [id]
  );
  if (!cur.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  const order = cur.rows[0];
  // Only the claimer or a manager/admin may release
  if (!isManager(req.user) && order.working_staff_id !== req.user.id) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  await query(
    `UPDATE orders SET working_staff_id = NULL, working_since = NULL WHERE id = $1`,
    [id]
  );
  emitPresence(id, null, null);
  res.json({ data: { released: true } });
}

// ---------- GET /completed — orders in ready/delivered for staff ----------
async function completed(req, res) {
  const u = req.user;
  const srcClause = sourceClause(resolveSourceFilter(u, req.query.source));
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const { rows } = await query(
    `SELECT o.id, o.status, o.created_at, o.checkout_group_id,
            o.working_staff_id,
            u.name AS student_name, s.university_name,
            p.name_ar AS product_name, p.type AS product_type,
            b.name_ar AS batch_name,
            CASE WHEN s.wholesaler_id IS NULL THEN 'retail' ELSE 'wholesaler' END AS source,
            wu.name AS wholesaler_name,
            CASE WHEN o.working_since > NOW() - INTERVAL '${PRESENCE_TTL_SECONDS} seconds'
                 THEN wk.name END AS working_staff_name
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     JOIN products p ON p.id = o.product_id
     LEFT JOIN batches b ON b.id = o.batch_id
     LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
     LEFT JOIN users wu ON wu.id = w.user_id
     LEFT JOIN users wk ON wk.id = o.working_staff_id
     WHERE o.status IN ('ready', 'delivered')
       ${srcClause}
     ORDER BY o.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json({ data: rows });
}

// ---------- Upload final design file for an order ----------
async function uploadFinalDesign(req, res) {
  const { id } = req.params;
  const u = req.user;
  // Any staff member (or admin) may upload the final design photo.
  // The route guard (requireRole 'admin','staff') already gates non-staff out.
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف', code: 'ERR_VALIDATION' });
  const url = publicUrl(req, 'images', req.file.filename);
  const cur = await query(
    `UPDATE orders SET final_design_url = $1 WHERE id = $2 RETURNING id`,
    [url, id]
  );
  if (!cur.rows.length) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, 'final_design', 'order', $2, $3)`,
    [u.id, id, JSON.stringify({ url })]
  );
  res.json({ data: { url } });
}

// ══════════════════════════════════════════════════════════════════════════════
// «الفصال» (tailor) — a PARALLEL, fully-independent track over RETAIL orders.
// ابو عبدو works a retail order's tailoring at the SAME TIME the designer pipeline
// runs. Marking tailoring done writes ONLY orders.tailor_status (+ done_at/by) — it
// never touches orders.status, and advancing the pipeline never touches the tailor
// track. Retail-only everywhere (students.wholesaler_id IS NULL).
// ══════════════════════════════════════════════════════════════════════════════

// Who may work the tailor track: the مفصل (tailor) staff_type, or a manager/admin.
function canTailor(u) {
  return isManager(u) || staffTypesOf(u).includes('tailor');
}

// ---------- GET /tailor-queue?done=0|1 — ابو عبدو's parallel to-do ----------
async function tailorQueue(req, res) {
  if (!canTailor(req.user)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  // Default (absent / '0') = pending; '1' = done.
  const wantDone = String(req.query.done || '') === '1';
  const tailorStatus = wantDone ? 'done' : 'pending';
  const { rows } = await query(
    `SELECT o.id, o.status, o.created_at,
            o.tailor_status, o.tailor_done_at, o.student_id,
            u.name AS student_name,
            p.name_ar AS product_name, p.type AS product_type,
            b.name_ar AS batch_name, b.deadline
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     JOIN products p ON p.id = o.product_id
     LEFT JOIN batches b ON b.id = o.batch_id
     WHERE s.wholesaler_id IS NULL
       AND o.status::text <> 'cancelled'
       AND p.type <> 'cap'
       AND o.tailor_status::text = $1
     ORDER BY b.deadline ASC NULLS LAST, o.created_at ASC`,
    [tailorStatus]
  );
  // status_label: pipeline status is DISPLAY-ONLY context here (never an action).
  const data = rows.map((r) => ({ ...r, status_label: STATUS_LABEL_AR[r.status] ?? r.status }));
  res.json({ data });
}

// Load the row needed to guard + apply a tailor mutation (shared by single + bulk).
async function loadTailorRow(id) {
  const cur = await query(
    `SELECT o.id, o.tailor_status, s.wholesaler_id
     FROM orders o JOIN students s ON s.id = o.student_id
     WHERE o.id = $1`,
    [id]
  );
  return cur.rows[0] || null;
}

// Apply ONE tailor mark (guards checked by caller). done=true → mark done; false → reopen.
// Writes tailor_status + audit row in a tx. Idempotent. Returns the updated row.
async function performTailorMark(orderId, user, done) {
  return tx(async (client) => {
    const { rows } = await client.query(
      done
        ? `UPDATE orders SET tailor_status = 'done', tailor_done_at = NOW(), tailor_done_by = $1
           WHERE id = $2 RETURNING id, tailor_status, tailor_done_at`
        : `UPDATE orders SET tailor_status = 'pending', tailor_done_at = NULL, tailor_done_by = NULL
           WHERE id = $1 RETURNING id, tailor_status, tailor_done_at`,
      done ? [user.id, orderId] : [orderId]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, $2, 'order', $3, $4)`,
      [user.id, done ? 'tailor_complete' : 'tailor_reopen', orderId,
       JSON.stringify({ tailor_status: done ? 'done' : 'pending' })]
    );
    return rows[0];
  });
}

// ---------- POST /orders/:id/tailor-complete — mark tailoring done (idempotent) ----------
async function tailorComplete(req, res) {
  if (!canTailor(req.user)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const { id } = req.params;
  const order = await loadTailorRow(id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  // Tailor track is retail-only — a wholesaler order is out of scope.
  if (order.wholesaler_id != null) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاق الفصال', code: 'ERR_FORBIDDEN' });
  }
  if (order.tailor_status === 'done') {
    return res.json({ data: { id: order.id, tailor_status: 'done' } }); // idempotent
  }
  const updated = await performTailorMark(id, req.user, true);
  res.json({ data: updated });
}

// ---------- POST /orders/:id/tailor-reopen — undo a mistaken completion ----------
async function tailorReopen(req, res) {
  if (!canTailor(req.user)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const { id } = req.params;
  const order = await loadTailorRow(id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  if (order.wholesaler_id != null) {
    return res.status(403).json({ error: 'هذا الطلب خارج نطاق الفصال', code: 'ERR_FORBIDDEN' });
  }
  if (order.tailor_status === 'pending') {
    return res.json({ data: { id: order.id, tailor_status: 'pending' } }); // idempotent
  }
  const updated = await performTailorMark(id, req.user, false);
  res.json({ data: updated });
}

// ---------- POST /tailor-complete-bulk { ids:[] } — mirror advanceBulk ----------
// Each order guarded INDEPENDENTLY (retail + permission); the rest are skipped + reported.
async function tailorCompleteBulk(req, res) {
  if (!canTailor(req.user)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const ids = Array.isArray(req.body.ids)
    ? [...new Set(req.body.ids.filter((x) => typeof x === 'string' && x))].slice(0, 200)
    : [];
  if (!ids.length) {
    return res.status(400).json({ error: 'لم تُحدد أي طلبات', code: 'ERR_VALIDATION' });
  }
  const results = [];
  let done = 0;
  for (const id of ids) {
    const order = await loadTailorRow(id);
    if (!order) { results.push({ id, ok: false, reason: 'not_found' }); continue; }
    if (order.wholesaler_id != null) {
      results.push({ id, ok: false, reason: 'not_retail' }); continue;
    }
    if (order.tailor_status === 'done') {
      // Already done → count as success (idempotent), no extra write/audit.
      done++; results.push({ id, ok: true }); continue;
    }
    try {
      await performTailorMark(id, req.user, true);
      done++;
      results.push({ id, ok: true });
    } catch {
      results.push({ id, ok: false, reason: 'error' });
    }
  }
  res.json({ data: { done, skipped: ids.length - done, results } });
}

// ---------- GET /tailor-summary — parallel-progress counts over RETAIL orders ----------
async function tailorSummary(req, res) {
  if (!canTailor(req.user)) {
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  }
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE o.tailor_status::text = 'pending')::int AS pending,
       COUNT(*) FILTER (WHERE o.tailor_status::text = 'done')::int    AS done,
       COUNT(*)::int AS total
     FROM orders o JOIN students s ON s.id = o.student_id
     WHERE s.wholesaler_id IS NULL AND o.status::text <> 'cancelled'`
  );
  const r = rows[0] || { pending: 0, done: 0, total: 0 };
  res.json({ data: { pending: r.pending, done: r.done, total: r.total } });
}

// ---------- Manager / admin: staff performance + pipeline health ----------
async function monitor(req, res) {
  const sc = sourceClause(resolveSourceFilter(req.user, req.query.source));
  const wip = await query(
    `SELECT o.status AS status, COUNT(*)::int AS count
     FROM orders o JOIN students s ON s.id = o.student_id
     WHERE o.status::text = ANY($1) ${sc}
     GROUP BY o.status`,
    [MANAGER_STAGES]
  );
  const throughput = await query(
    `SELECT a.actor_id, us.name, us.staff_type, COUNT(*)::int AS actions,
            MAX(a.created_at) AS last_action
     FROM audit_log a
     JOIN users us ON us.id = a.actor_id
     WHERE a.action IN ('status_change', 'approve_design', 'reject_design')
       AND us.role = 'staff'
       AND a.created_at > NOW() - INTERVAL '30 days'
     GROUP BY a.actor_id, us.name, us.staff_type
     ORDER BY actions DESC`
  );
  const overdue = await query(
    `SELECT o.id, u.name AS student_name, p.name_ar AS product_name, o.status,
            b.name_ar AS batch_name, b.deadline
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     JOIN products p ON p.id = o.product_id
     JOIN batches b ON b.id = o.batch_id
     WHERE b.deadline < NOW() AND o.status NOT IN ('ready', 'delivered', 'cancelled') ${sc}
     ORDER BY b.deadline ASC LIMIT 50`
  );
  const stale = await query(
    `SELECT o.id, u.name AS student_name, o.status, o.updated_at,
            ROUND(EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 3600)::int AS hours_in_stage
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     WHERE o.status IN ('design_complete', 'converting', 'embroidery', 'pressing', 'preparing') ${sc}
     ORDER BY o.updated_at ASC LIMIT 20`
  );
  // Currently claimed orders (within last 30 min)
  const working = await query(
    `SELECT o.id, o.status,
            u.name AS student_name,
            p.name_ar AS product_name,
            wk.name AS working_staff_name,
            o.working_since
     FROM orders o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     JOIN products p ON p.id = o.product_id
     JOIN users wk ON wk.id = o.working_staff_id
     WHERE o.working_staff_id IS NOT NULL
       AND o.working_since > NOW() - INTERVAL '30 minutes'
       ${sc}
     ORDER BY o.working_since DESC`
  );
  const byStage = {};
  wip.rows.forEach((r) => (byStage[r.status] = r.count));
  res.json({
    data: {
      wip: byStage,
      throughput: throughput.rows,
      overdue: overdue.rows,
      stale: stale.rows,
      working: working.rows,
    },
  });
}

// Permanent PIECE deletion from the staff workspace. Managers/admin only.
// Deletes ONLY the given order row (its order_items cascade); sibling pieces of the
// bundle survive. The empty checkout_group is removed when the last piece goes.
async function deleteOrder(req, res) {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'طلب غير صحيح', code: 'ERR_VALIDATION' });
  const result = await tx(async (client) => {
    const found = await client.query(`SELECT id,checkout_group_id,student_id,price,cost FROM orders WHERE id=$1 FOR UPDATE`, [id]);
    if (!found.rows.length) return null;
    const order = found.rows[0];

    // Lock every row in the bundle BEFORE counting/reassigning siblings so two concurrent
    // piece-deletes in the same checkout_group serialize instead of racing each other.
    if (order.checkout_group_id) {
      await client.query(`SELECT id FROM orders WHERE checkout_group_id=$1 FOR UPDATE`, [order.checkout_group_id]);
    }

    // Re-anchor the deleted piece's price/cost onto a surviving sibling in the SAME bundle
    // so settled revenue doesn't vanish when the SASH (which carries the whole طقم price)
    // is the piece being deleted while robe/cap siblings survive. Prefer robe, then cap,
    // then any surviving live sibling (deterministic tie-break by created_at).
    let priceReanchoredTo = null;
    if (order.checkout_group_id && (Number(order.price) > 0 || Number(order.cost) > 0)) {
      const survivor = await client.query(
        `SELECT o2.id
           FROM orders o2
           JOIN products p2 ON p2.id = o2.product_id
          WHERE o2.checkout_group_id = $1
            AND o2.design_id IS NULL
            AND o2.status <> 'cancelled'
            AND o2.id <> $2
          ORDER BY CASE p2.type WHEN 'robe' THEN 0 WHEN 'cap' THEN 1 ELSE 2 END ASC, o2.created_at ASC
          LIMIT 1`,
        [order.checkout_group_id, id]
      );
      if (survivor.rows.length) {
        priceReanchoredTo = survivor.rows[0].id;
        await client.query(
          `UPDATE orders SET price = price + $1, cost = cost + $2 WHERE id = $3`,
          [Number(order.price) || 0, Number(order.cost) || 0, priceReanchoredTo]
        );
      }
    }

    await client.query(`DELETE FROM staff_activity_log WHERE order_id=$1`, [id]);
    // The placement row cascades with the order, but the BIN would stay open holding
    // nothing — release first so an emptied خانة is properly closed and reusable.
    await releaseForOrder(id, client);
    await client.query(`DELETE FROM orders WHERE id=$1`, [id]);
    let remaining = [];
    let groupDeleted = false;
    if (order.checkout_group_id) {
      const sib = await client.query(`SELECT id FROM orders WHERE checkout_group_id=$1`, [order.checkout_group_id]);
      remaining = sib.rows.map((row) => row.id);
      if (!remaining.length) {
        await client.query(`DELETE FROM checkout_groups WHERE id=$1`, [order.checkout_group_id]);
        groupDeleted = true;
      }
    }
    await client.query(
      `INSERT INTO audit_log(actor_id,action,entity,entity_id,details) VALUES($1,'delete_order','order',$2,$3)`,
      [req.user.id, order.id, JSON.stringify({ piece_only: true, remaining_order_ids: remaining, checkout_group_id: order.checkout_group_id, student_id: order.student_id, source: 'staff_workspace', price_reanchored_to: priceReanchoredTo })]
    );
    return { remaining, groupDeleted };
  });
  if (!result) return res.status(404).json({ error: 'الطلب غير موجود', code: 'ERR_NOT_FOUND' });
  publish({ type: 'order_deleted', orderId: id });
  res.json({ data: { deleted: 1, remaining: result.remaining.length, checkout_group_deleted: result.groupDeleted } });
}

module.exports = {
  getQueue, getOrder, advance, advanceBulk, deliver, revert, returnToCustomer, claim, release, completed, uploadFinalDesign, monitor,
  issueEventsTicket, streamEvents, nextStageFor, markEmbroideryZone, markEmbroideryZoneBulk,
  tailorQueue, tailorComplete, tailorReopen, tailorCompleteBulk, tailorSummary,
  deleteOrder,
  // Shared with the calligraphy workbench («تحويل للتطريز» reuses the real state machine).
  loadAdvanceRow, performAdvance, ADVANCE_LABEL_AR, detectZonesWithImages,
};
