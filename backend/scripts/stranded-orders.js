#!/usr/bin/env node
'use strict';
/**
 * npm run stranded-orders            → REPORT ONLY. Writes nothing.
 * npm run stranded-orders -- --fix   → applies the two narrow repairs in sections 1 and 3.
 *
 * WHAT «STRANDED» MEANS. An order past التصميم that NO station queue can show, because
 * `productionController.getQueue` filters
 *     AND (s.wholesaler_id IS NULL OR o.wholesaler_approval = 'approved')
 *     AND o.returned_to_customer = FALSE
 *
 * ⚠️ MOST OF THESE ARE NOT A BUG, AND THE FIRST DRAFT OF THIS SCRIPT WOULD HAVE WRECKED THEM.
 * Measured on the 2026-08-31 prod copy: 224 orders match that description and only **4** of
 * them were ever MOVED there. The other 220 were BORN in a production stage — since commit
 * 4176fb3 a plain piece is created straight at الكوي (non-cap) or التجهيز (cap) — and they
 * are simply waiting on their ممثل. Hiding them is exactly right, and «بانتظار موافقة الممثل»
 * is not a queue to drain (owner ruling 2026-08-14): those rows are unresolved disputes
 * between a student and their ممثل, and touching them takes a side in every one at once.
 *
 * So the population this script repairs is the one an AUDIT ROW proves was advanced while
 * blocked — `audit_log.action = 'status_change'` on an order that is still unapproved. That
 * is the الخط العربي side door: the workbench («تحويل للتطريز») filtered neither approval nor
 * returned_to_customer, so it pushed the piece into a stage where every screen hides it. The
 * gate that stops NEW ones is productionController.advanceBlockReason (2026-08-31); this is
 * for the rows already out there, and it is why the designer counted 140 at التصميم while
 * التطريز counted 137.
 *
 * The repair is to send those pieces BACK to design_complete — where an unapproved order is
 * supposed to wait — so their ممثل decides. It NEVER approves anything. Restricted to
 * embroidery/converting: a piece already at الكوي or التجهيز has been physically handled, and
 * rewinding it to the design desk would make the record lie about what happened to the cloth.
 *
 * THIRD SECTION — الشال الأمريكي that skips الكوي. Before commit 4176fb3 (2026-07-15)
 * `needs_pressing` was `type === 'sash' || type === 'robe'`, so every shawl created before
 * that date carries FALSE and `nextStageFor` routes it embroidery → التجهيز, straight past
 * محمد عادل. The rule was fixed for new orders; the existing rows were never backfilled. Only
 * rows still UPSTREAM of الكوي are touched — a shawl already at التجهيز has physically passed
 * that station, and flipping its flag would not un-skip anything.
 */
require('dotenv').config();

const { query } = require('../lib/db');

const FIX = process.argv.includes('--fix');
const line = (s = '') => process.stdout.write(s + '\n');
const rule = () => line('─'.repeat(78));

const STRANDED_WHERE = `
  o.status::text IN ('embroidery','converting','pressing','preparing','ready')
  AND ((s.wholesaler_id IS NOT NULL AND o.wholesaler_approval::text <> 'approved')
       OR o.returned_to_customer)`;

/** Proven-moved: an advance audit row exists, so a human pressed a button it should not have. */
async function advancedWhileBlocked() {
  const { rows } = await query(
    `SELECT o.id, o.status::text AS status, o.wholesaler_approval::text AS approval,
            o.returned_to_customer, u.name AS student, uw.name AS rep, p.name_ar AS product,
            (SELECT max(a.created_at) FROM audit_log a
              WHERE a.entity_id = o.id AND a.action = 'status_change') AS moved_at
       FROM orders o
       JOIN students s ON s.id = o.student_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN wholesalers w ON w.id = s.wholesaler_id
       LEFT JOIN users uw ON uw.id = w.user_id
       JOIN products p ON p.id = o.product_id
      WHERE ${STRANDED_WHERE}
        AND EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = o.id AND a.action = 'status_change')
      ORDER BY o.status::text, uw.name NULLS LAST, u.name`
  );
  return rows;
}

/** Born in a production stage and simply waiting — reported, never touched. */
async function bornBlocked() {
  const { rows } = await query(
    `SELECT o.status::text AS status,
            CASE WHEN o.returned_to_customer THEN 'مُرجَع للطالب'
                 ELSE 'موافقة الممثل: ' || o.wholesaler_approval::text END AS cause,
            count(*)::int AS n
       FROM orders o JOIN students s ON s.id = o.student_id
      WHERE ${STRANDED_WHERE}
        AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id = o.id AND a.action = 'status_change')
      GROUP BY 1,2 ORDER BY 1,2`
  );
  return rows;
}

/**
 * Pieces parked at التصميم/التطريز with nothing to design or stitch (migration 096).
 *
 * A piece belongs on the design/embroidery half of the line when it carries ARTWORK: a
 * design, a generated plate, or a line the student filled in that belongs to a real
 * embroidery group. «صورة الشال» / «صورة القبعة» are product PICKERS — the student choosing
 * which shawl or cap they want — and they used to count, which is how 468 شال امريكي orders
 * reached التطريز carrying not one «تطريز» line between them.
 *
 * The query below is the NEW rule read backwards over existing rows, so the repair and the
 * runtime can never disagree: an order has real work iff it has a design, or any line with
 * content that is NOT from an `is_embroidery = FALSE` group. Ungrouped lines count — the real
 * zone lines («تطريز الوشاح من الأمام») carry no group_id at all, they are written by the
 * configurator, and treating them as embroidery is the whole point.
 *
 * Destination is the piece's own correct first stage, the same rule orderController uses for
 * a plain piece: caps go to التجهيز, everything else to الكوي.
 */
async function parkedWithNothingToDo() {
  const { rows } = await query(
    `SELECT o.id, o.status::text AS status, p.type AS product_type, p.name_ar AS product,
            u.name AS student,
            CASE WHEN p.type = 'cap' THEN 'preparing' ELSE 'pressing' END AS destination
       FROM orders o
       JOIN products p ON p.id = o.product_id
       JOIN students s ON s.id = o.student_id
       JOIN users u ON u.id = s.user_id
      WHERE o.status::text IN ('design_complete', 'embroidery')
        AND o.design_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM order_items oi
           LEFT JOIN option_groups g ON g.id = oi.group_id
           WHERE oi.order_id = o.id
             AND (COALESCE(oi.customer_text, '') <> ''
                  OR oi.customer_image_url IS NOT NULL
                  OR oi.plate_image_url IS NOT NULL)
             AND COALESCE(g.is_embroidery, TRUE) = TRUE
        )
      ORDER BY p.type, o.created_at`
  );
  return rows;
}

async function shawlsSkippingPressing() {
  const { rows } = await query(
    `SELECT o.id, o.status::text AS status
       FROM orders o JOIN products p ON p.id = o.product_id
      WHERE p.type = 'shawl' AND o.needs_pressing = FALSE
        AND o.status::text IN ('designing','design_complete','converting','embroidery')
      ORDER BY o.created_at`
  );
  return rows;
}

async function main() {
  const moved = await advancedWhileBlocked();
  // Only the design-desk stages may be rewound — see the header.
  const rewindable = moved.filter((r) => r.status === 'embroidery' || r.status === 'converting');
  const born = await bornBlocked();
  const shawls = await shawlsSkippingPressing();
  const parked = await parkedWithNothingToDo();

  rule();
  line(`1) دُفعت لمرحلة إنتاج وهي مقفولة — خطأ حقيقي  —  ${moved.length}`);
  rule();
  if (!moved.length) line('   لا شيء. ✓');
  for (const r of moved) {
    const why = r.returned_to_customer ? 'مُرجَع للطالب' : `موافقة الممثل: ${r.approval}`;
    const mark = rewindable.includes(r) ? '↩' : '·';
    line(`   ${mark} ${r.id}  ${r.status.padEnd(11)} ${r.product}  ·  ${r.student}  ·  ممثل: ${r.rep || '—'}  ·  ${why}`);
  }
  line();
  line(`   ↩ = يرجع لـ«بانتظار التصميم» مع --fix  (${rewindable.length})`);
  line(`     الباقي وصل الكوي/التجهيز فعلياً — ما ينلمس، يقرره الأدمن يدوياً.`);

  line();
  rule();
  line(`2) وُلدت داخل مرحلة إنتاج وتنتظر ممثلها — سلوك صحيح، ما ينلمس  —  ${born.reduce((a, r) => a + r.n, 0)}`);
  rule();
  for (const r of born) line(`   ${r.status.padEnd(11)} ${String(r.n).padStart(4)}   ${r.cause}`);
  line();
  line(`   القطعة السادة تُنشأ مباشرة بالكوي/التجهيز (4176fb3)، والطابور يخفيها لحد ما`);
  line(`   يوافق الممثل. إخفاؤها صحيح. ⚠️ لا موافقة جماعية — قرار الممثل وحده.`);

  line();
  rule();
  line(`3) شال أمريكي راح يقفز الكوي (needs_pressing = false)  —  ${shawls.length}`);
  rule();
  const byStage = shawls.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  for (const [st, n] of Object.entries(byStage)) line(`   ${st.padEnd(16)} ${n}`);
  if (!shawls.length) line('   لا شيء. ✓');
  line();
  line(`   يصير needs_pressing = TRUE مع --fix. القطع اللي بالتجهيز أصلاً ما تنلمس.`);

  line();
  rule();
  line(`4) واقفة بالتصميم/التطريز وما بيها شغل تطريز أصلاً  —  ${parked.length}`);
  rule();
  {
    const by = new Map();
    for (const r of parked) {
      const k = `${r.product_type}|${r.status}|${r.destination}`;
      by.set(k, (by.get(k) || 0) + 1);
    }
    if (!by.size) line('   لا شيء. ✓');
    for (const [k, n] of [...by.entries()].sort((a, b) => b[1] - a[1])) {
      const [type, from, to] = k.split('|');
      line(`   ${String(n).padStart(4)}  ${type.padEnd(6)} ${from.padEnd(16)} →  ${to}`);
    }
  }
  line();
  line(`   «صورة الشال»/«صورة القبعة» صورة منتج مو تطريز (ترحيل 096) — تنتقل لمرحلتها`);
  line(`   الصحيحة: القبعة للتجهيز وكل شي ثاني للكوي.`);

  if (!FIX) {
    line();
    rule();
    line('تقرير فقط — ما تغيّر شي. شغّل مع --fix للتنفيذ.');
    rule();
    return;
  }

  line();
  rule();
  line('التنفيذ…');
  rule();

  // Reversible on purpose: status only. Approval, plates and order_items are untouched, so
  // approving the order later puts it straight back on the designer's board where it was.
  for (const r of rewindable) {
    await query(
      `UPDATE orders SET status = 'design_complete', working_staff_id = NULL, working_since = NULL
        WHERE id = $1`,
      [r.id]
    );
    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES (NULL, 'status_revert', 'order', $1, $2)`,
      [r.id, JSON.stringify({ from: r.status, to: 'design_complete', by: 'script:stranded-orders' })]
    );
  }
  line(`   ✓ أُرجعت ${rewindable.length} طلب إلى «بانتظار التصميم».`);

  if (shawls.length) {
    const r2 = await query(
      `UPDATE orders SET needs_pressing = TRUE WHERE id = ANY($1) RETURNING id`,
      [shawls.map((r) => r.id)]
    );
    line(`   ✓ ${r2.rowCount} شال صار يمرّ بالكوي.`);
  }

  // has_embroidery is cleared with the status: it is the flag that put the piece here, and
  // leaving it TRUE would keep «إرجاع للطالب» and every downstream reader believing there is
  // artwork on a piece that has none. needs_pressing follows the same type rule as the
  // destination so the piece cannot skip الكوي on its way out (section 3's bug, one stage on).
  for (const r of parked) {
    await query(
      `UPDATE orders SET status = $1, has_embroidery = FALSE, needs_pressing = $2,
              working_staff_id = NULL, working_since = NULL
        WHERE id = $3`,
      [r.destination, r.product_type !== 'cap', r.id]
    );
    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES (NULL, 'status_change', 'order', $1, $2)`,
      [r.id, JSON.stringify({ from: r.status, to: r.destination, by: 'script:stranded-orders', reason: 'no_embroidery_work' })]
    );
  }
  if (parked.length) line(`   ✓ ${parked.length} قطعة انتقلت لمرحلتها الصحيحة.`);
  rule();
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
