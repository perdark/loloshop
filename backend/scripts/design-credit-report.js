'use strict';
// «منو صمم ومنو انطى تم» — read-only. Owner 2026-10-25: أيادي التصميم draw the calligraphy in
// الخط العربي, then somebody else presses «تحويل للتطريز» and the advance is recorded under
// THEIR name (staff_activity_log is what payroll and staff goals count).
//
// The link between a helper's work and an order is not stored: most helper plates are free
// jobs with no student and no order line. So this matches on TEXT — a helper plate whose
// render_text equals (ignoring spaces, harakat and tatweel) one of the order's typed lines,
// generated within DAYS before the order left بانتظار التصميم. That is a floor, not the total:
// a design the helper retyped differently does not match.
//
//   npm run design-credit                      # last 30 days
//   npm run design-credit -- --days 60 --rows  # + every matched order
//
// Changes nothing. Since 2026-10-25 a helper can send the order herself, so new rows here
// mean the helper drew it but still did not press the button.
require('dotenv').config();
const { query, pool } = require('../lib/db');

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? Number(args[i + 1]) : dflt;
};
const DAYS = opt('days', 30);
const WINDOW_DAYS = opt('window', 10);
const SHOW_ROWS = args.includes('--rows');

const NORM = (col) => `regexp_replace(${col}, '[[:space:]\\u064B-\\u0652\\u0640]', '', 'g')`;

async function main() {
  const { rows } = await query(
    `WITH adv AS (
       SELECT s.order_id, s.user_id, s.created_at AS at
         FROM staff_activity_log s
        WHERE s.from_stage = 'design_complete' AND s.to_stage = 'embroidery'
          AND s.created_at > NOW() - make_interval(days => $1)
     ),
     txt AS (
       SELECT DISTINCT oi.order_id, ${NORM('oi.customer_text')} AS t
         FROM order_items oi
        WHERE oi.customer_text IS NOT NULL AND length(oi.customer_text) BETWEEN 3 AND 120
          AND oi.order_id IN (SELECT order_id FROM adv)
     ),
     helper AS (
       SELECT ${NORM('p.render_text')} AS t, p.created_by, p.created_at
         FROM calligraphy_plates p JOIN users u ON u.id = p.created_by
        WHERE u.role = 'design_helper' AND p.status = 'done'
     ),
     hits AS (
       SELECT DISTINCT ON (adv.order_id) adv.order_id, h.created_by AS designer_id
         FROM adv
         JOIN txt ON txt.order_id = adv.order_id
         JOIN helper h ON h.t = txt.t
                      AND h.created_at BETWEEN adv.at - make_interval(days => $2) AND adv.at
        ORDER BY adv.order_id, h.created_at DESC
     ),
     matched AS (
       SELECT adv.order_id, adv.user_id AS advancer_id, adv.at, hits.designer_id
         FROM adv LEFT JOIN hits USING (order_id)
     )
     SELECT m.order_id, m.at, ua.name AS advancer, ud.name AS designer,
            u2.name AS student
       FROM matched m
       JOIN users ua ON ua.id = m.advancer_id
       LEFT JOIN users ud ON ud.id = m.designer_id
       LEFT JOIN orders o ON o.id = m.order_id
       LEFT JOIN students st ON st.id = o.student_id
       LEFT JOIN users u2 ON u2.id = st.user_id
      ORDER BY m.at DESC`,
    [DAYS, WINDOW_DAYS]
  );

  const total = rows.length;
  const byPair = new Map();
  for (const r of rows) {
    if (!r.designer) continue;
    const key = `${r.designer} ← صممت · انطى تم: ${r.advancer}`;
    byPair.set(key, (byPair.get(key) || 0) + 1);
  }
  const helperTotal = [...byPair.values()].reduce((a, b) => a + b, 0);
  const otherPressed = rows.filter((r) => r.designer && r.designer !== r.advancer).length;

  console.log(`آخر ${DAYS} يوم — ${total} طلب طلع من «بانتظار التصميم» للتطريز`);
  console.log(`منها ${helperTotal} خطّها من أيادي التصميم (مطابقة نص، نافذة ${WINDOW_DAYS} أيام)`);
  console.log(`  ${otherPressed} منها انطى التم شخص غير اللي صممها\n`);
  for (const [k, n] of [...byPair.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);
  if (SHOW_ROWS) {
    console.log('\norder_id\tالتاريخ\tالطالب\tصممت\tانطى تم');
    for (const r of rows.filter((x) => x.designer && x.designer !== x.advancer)) {
      console.log(`${r.order_id}\t${r.at.toISOString().slice(0, 16)}\t${r.student || ''}\t${r.designer}\t${r.advancer}`);
    }
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
