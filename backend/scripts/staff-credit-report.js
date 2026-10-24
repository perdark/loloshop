'use strict';
// «تقرير الحركات باستحقاق» — read-only, writes one self-contained HTML page to stdout.
// Owner 2026-10-25: «اريد تقارير كاملة عن الحركات بس باستحقاق».
//
// staff_activity_log records who PRESSED the button. That is not always who did the work:
// a helper draws the design and someone else sends it; محمد عماد stitches and someone else
// moves the piece on. This report credits each move to whoever the data says did the work:
//
//   التصميم  → the أيادي التصميم member whose plate text matches the order line (WINDOW days
//              before the send), else the creator of a plate linked to the order, else the sender.
//   التطريز  → whoever ticked most of the order's zones (audit_log embroidery_zone, done=true),
//              else the sender.
//   الباقي   → the sender (no other evidence exists for التجميع/الكوي/التجهيز/التسليم).
//   الفصال   → audit_log tailor_complete actor.
//
//   node scripts/staff-credit-report.js --days 30 > report.html
require('dotenv').config();
const { query, pool } = require('../lib/db');

const args = process.argv.slice(2);
const num = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const DAYS = num('days', 30);
const WINDOW = num('window', 10);

const STAGE_AR = {
  design: 'التصميم', embroidery: 'التطريز', assembly: 'التجميع', pressing: 'الكوي',
  preparing: 'التجهيز', ready: 'التسليم', tailor: 'الفصال',
};
const COLS = ['design', 'embroidery', 'assembly', 'pressing', 'preparing', 'ready', 'tailor'];
const NORM = (col) => `regexp_replace(${col}, '[[:space:]\\u064B-\\u0652\\u0640]', '', 'g')`;

async function load() {
  const moves = await query(
    `WITH adv AS (
       SELECT s.order_id, s.user_id AS sender_id, s.from_stage, s.created_at AS at
         FROM staff_activity_log s
        WHERE s.action IN ('advance', 'advance_shawl')
          AND s.created_at > NOW() - make_interval(days => $1)
     ),
     design_adv AS (SELECT * FROM adv WHERE from_stage = 'design_complete'),
     txt AS (
       SELECT DISTINCT oi.order_id, ${NORM('oi.customer_text')} AS t
         FROM order_items oi
        WHERE oi.order_id IN (SELECT order_id FROM design_adv)
          AND oi.customer_text IS NOT NULL AND length(oi.customer_text) BETWEEN 3 AND 120
     ),
     helper AS (
       SELECT ${NORM('p.render_text')} AS t, p.created_by, p.created_at
         FROM calligraphy_plates p JOIN users u ON u.id = p.created_by
        WHERE u.role = 'design_helper' AND p.status = 'done'
          AND p.created_at > NOW() - make_interval(days => $1 + $2)
     ),
     helper_hit AS (
       SELECT DISTINCT ON (d.order_id) d.order_id, h.created_by AS worker_id
         FROM design_adv d
         JOIN txt ON txt.order_id = d.order_id
         JOIN helper h ON h.t = txt.t AND h.created_at BETWEEN d.at - make_interval(days => $2) AND d.at
        ORDER BY d.order_id, h.created_at DESC
     ),
     plate_hit AS (
       SELECT DISTINCT ON (oi.order_id) oi.order_id, p.created_by AS worker_id
         FROM calligraphy_plates p JOIN order_items oi ON oi.id = p.order_item_id
        WHERE oi.order_id IN (SELECT order_id FROM design_adv) AND p.created_by IS NOT NULL
        ORDER BY oi.order_id, p.created_at DESC
     ),
     zone_hit AS (
       SELECT DISTINCT ON (a.entity_id) a.entity_id AS order_id, a.actor_id AS worker_id
         FROM audit_log a
        WHERE a.action = 'embroidery_zone' AND (a.details->>'done')::boolean IS TRUE
          AND a.created_at > NOW() - make_interval(days => $1 + 60)
        GROUP BY a.entity_id, a.actor_id
        ORDER BY a.entity_id, count(*) DESC
     )
     SELECT adv.order_id, adv.from_stage, adv.at, adv.sender_id,
            CASE adv.from_stage
              WHEN 'design_complete' THEN COALESCE(hh.worker_id, ph.worker_id, adv.sender_id)
              WHEN 'embroidery' THEN COALESCE(zh.worker_id, adv.sender_id)
              ELSE adv.sender_id
            END AS worker_id,
            CASE adv.from_stage
              WHEN 'design_complete' THEN CASE WHEN hh.worker_id IS NOT NULL THEN 'نص الخط'
                                               WHEN ph.worker_id IS NOT NULL THEN 'صورة مربوطة' END
              WHEN 'embroidery' THEN CASE WHEN zh.worker_id IS NOT NULL THEN 'تأشير المناطق' END
            END AS evidence
       FROM adv
       LEFT JOIN helper_hit hh ON hh.order_id = adv.order_id AND adv.from_stage = 'design_complete'
       LEFT JOIN plate_hit ph ON ph.order_id = adv.order_id AND adv.from_stage = 'design_complete'
       LEFT JOIN zone_hit zh ON zh.order_id = adv.order_id AND adv.from_stage = 'embroidery'`,
    [DAYS, WINDOW]
  );
  const tailor = await query(
    `SELECT actor_id AS worker_id, created_at AS at FROM audit_log
      WHERE action = 'tailor_complete' AND created_at > NOW() - make_interval(days => $1)`,
    [DAYS]
  );
  const reverts = await query(
    `SELECT user_id, count(*)::int AS n FROM staff_activity_log
      WHERE action = 'revert' AND created_at > NOW() - make_interval(days => $1) GROUP BY 1`,
    [DAYS]
  );
  const users = await query(`SELECT id, name, role, staff_types FROM users WHERE role IN ('staff','admin','design_helper')`);
  return { moves: moves.rows, tailor: tailor.rows, reverts: reverts.rows, users: users.rows };
}

const STAGE_OF = { design_complete: 'design', embroidery: 'embroidery', assembly: 'assembly', pressing: 'pressing', preparing: 'preparing', ready: 'ready' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (n ? n.toLocaleString('en-US') : '<span class="z">·</span>');

function build({ moves, tailor, reverts, users }) {
  const name = new Map(users.map((u) => [u.id, u.name]));
  const nm = (id) => name.get(id) || 'غير معروف';
  const credit = new Map(); // worker → {stage: n}
  const bump = (id, st) => {
    const row = credit.get(id) || {};
    row[st] = (row[st] || 0) + 1;
    credit.set(id, row);
  };
  const mismatch = new Map(); // `${stage}|${worker}|${sender}` → n
  const daily = new Map(); // date → worker → n
  for (const m of moves) {
    const st = STAGE_OF[m.from_stage];
    if (!st) continue;
    bump(m.worker_id, st);
    if (m.worker_id !== m.sender_id) {
      const k = `${st}|${m.worker_id}|${m.sender_id}|${m.evidence || ''}`;
      mismatch.set(k, (mismatch.get(k) || 0) + 1);
    }
    const d = new Date(new Date(m.at).getTime() + 3 * 3600e3).toISOString().slice(0, 10); // Baghdad day
    const dm = daily.get(d) || new Map();
    dm.set(m.worker_id, (dm.get(m.worker_id) || 0) + 1);
    daily.set(d, dm);
  }
  for (const t of tailor) bump(t.worker_id, 'tailor');
  const rev = new Map(reverts.map((r) => [r.user_id, r.n]));

  const people = [...credit.entries()]
    .map(([id, row]) => ({ id, row, total: COLS.reduce((a, c) => a + (row[c] || 0), 0) }))
    .sort((a, b) => b.total - a.total);
  const colTotals = COLS.map((c) => people.reduce((a, p) => a + (p.row[c] || 0), 0));

  const mis = [...mismatch.entries()]
    .map(([k, n]) => { const [st, w, s, ev] = k.split('|'); return { st, w, s, ev, n }; })
    .sort((a, b) => b.n - a.n);
  const misTotal = mis.reduce((a, m) => a + m.n, 0);

  const days = [...daily.keys()].sort();
  const topIds = people.slice(0, 12).map((p) => p.id);

  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>تقرير الحركات باستحقاق</title>
<style>
:root{--bg:#FAEBD7;--card:#FFF8F0;--ink:#1A1A1A;--soft:#5b5b5b;--line:#e6d6c2;--acc:#c2410c;--warn:#fde3d3}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 "Cairo",system-ui,sans-serif;padding:16px}
main{max-width:1100px;margin:auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}
.sub{color:var(--soft);font-size:13px}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:560px}th,td{padding:7px 9px;border-bottom:1px solid var(--line);text-align:center;white-space:nowrap}
th{font-size:12px;color:var(--soft);font-weight:700}td:first-child,th:first-child{text-align:start}
tfoot td{font-weight:800}.z{color:#c9b9a5}.tot{font-weight:800;color:var(--acc)}
.kpi{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.kpi div{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px}
.kpi b{display:block;font-size:22px}.note{font-size:13px;color:var(--soft);margin:6px 0 0}
tr.hl td{background:var(--warn)}
</style></head><body><main>
<h1>تقرير الحركات باستحقاق</h1>
<p class="sub">آخر ${DAYS} يوم · بيانات الإنتاج لحد ${now} UTC · كل حركة محسوبة للي اشتغلها مو للي ضغط الزر</p>
<div class="kpi">
<div><b>${moves.length.toLocaleString('en-US')}</b>حركة نقل</div>
<div><b>${tailor.length.toLocaleString('en-US')}</b>فصال</div>
<div><b>${misTotal.toLocaleString('en-US')}</b>حركة اشتغلها شخص وضغطها غيره</div>
</div>

<h2>شغل كل موظف (باستحقاق)</h2>
<div class="card"><table><thead><tr><th>الموظف</th>${COLS.map((c) => `<th>${STAGE_AR[c]}</th>`).join('')}<th>المجموع</th><th>رجّع</th></tr></thead>
<tbody>${people.map((p) => `<tr><td>${esc(nm(p.id))}</td>${COLS.map((c) => `<td>${fmt(p.row[c])}</td>`).join('')}<td class="tot">${fmt(p.total)}</td><td>${fmt(rev.get(p.id))}</td></tr>`).join('')}</tbody>
<tfoot><tr><td>المجموع</td>${colTotals.map((n) => `<td>${fmt(n)}</td>`).join('')}<td class="tot">${fmt(colTotals.reduce((a, b) => a + b, 0))}</td><td></td></tr></tfoot></table>
<p class="note">التصميم والتطريز ينحسبن لصاحب الشغل حسب الدليل (نص الخط، الصورة المربوطة، تأشير المناطق). باقي المراحل ما بيها دليل غير الضغطة، فتنحسب للي ضغط. «رجّع» = إرجاع قطعة لمرحلة سابقة.</p></div>

<h2>اشتغلها شخص وانطى «تم» غيره</h2>
<div class="card"><table><thead><tr><th>المرحلة</th><th>اشتغلها</th><th>ضغط الزر</th><th>الدليل</th><th>عدد</th></tr></thead>
<tbody>${mis.length ? mis.map((m) => `<tr${m.n >= 50 ? ' class="hl"' : ''}><td>${STAGE_AR[m.st]}</td><td>${esc(nm(m.w))}</td><td>${esc(nm(m.s))}</td><td>${esc(m.ev)}</td><td class="tot">${fmt(m.n)}</td></tr>`).join('') : '<tr><td colspan="5">ماكو</td></tr>'}</tbody></table>
<p class="note">مطابقة نص الخط هي أقل رقم ممكن: الاسم اللي انكتب بشكل ثاني ما ينحسب.</p></div>

<h2>باليوم</h2>
<div class="card"><table><thead><tr><th>اليوم</th>${topIds.map((id) => `<th>${esc(nm(id))}</th>`).join('')}</tr></thead>
<tbody>${days.reverse().map((d) => `<tr><td>${d}</td>${topIds.map((id) => `<td>${fmt(daily.get(d).get(id))}</td>`).join('')}</tr>`).join('')}</tbody></table>
<p class="note">حركات النقل باستحقاق لكل يوم (بدون الفصال).</p></div>
</main></body></html>
`;
}

load()
  .then((d) => process.stdout.write(build(d)))
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
