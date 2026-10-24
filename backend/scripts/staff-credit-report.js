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
// The month section (owner 2026-10-25: «حركات الشهر بس من 10/1»). Baghdad midnight.
const MONTH_FROM = (args[args.indexOf('--month') + 1] && args.includes('--month'))
  ? args[args.indexOf('--month') + 1] : new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 8) + '01';

// ── Effort weights (ترتيب التعب). An ASSUMPTION, stated on the page: a design or an
// embroidered piece or a tailored robe is a long job; pressing/assembly a medium one;
// packing a short one; handing over the shortest. Change them here, not in the HTML.
const WEIGHT = { design: 3, embroidery: 3, tailor: 3, assembly: 2, pressing: 2, preparing: 1, ready: 0.5 };

// Attendance from the RAW device punches, never staff_attendance_records — those are wrong
// for whole stretches (offline batches, inverted keys, مضر's stored 22:16 shift). Same rules
// as the monthly payroll: business day = device_ts − 6h, start 10:00 (برزان 12:00), الجمعة
// 15:00, 15 min grace; a day more than 60 min late is counted on its own («نص شفت»).
async function loadAttendance(fromDate) {
  const { rows } = await query(
    `WITH p AS (
       SELECT COALESCE(r.user_id, sp.user_id) AS uid, r.device_ts,
              (r.device_ts - interval '6 hours')::date AS bday
         FROM punch_raw r LEFT JOIN staff_device_pins sp ON sp.pin::text = r.device_pin
        WHERE r.device_ts >= $1::date + interval '6 hours'
     ), d AS (
       SELECT uid, bday, min(device_ts) AS first_in, max(device_ts) AS last_out, count(*) AS n
         FROM p WHERE uid IS NOT NULL GROUP BY 1, 2
     ), x AS (
       SELECT d.*, extract(epoch FROM (d.first_in::time - CASE
                WHEN extract(dow FROM d.bday) = 5 THEN time '15:00'
                WHEN u.name LIKE 'برزان%' THEN time '12:00'
                ELSE time '10:00' END)) / 60 AS lm
         FROM d JOIN users u ON u.id = d.uid
     )
     , y AS (
       -- «نص شفت»: a non-Friday arrival at 14:00 or later is a half shift by the payroll rule,
       -- paid as half — NOT lateness. Only the rest can be late.
       SELECT x.*, (extract(dow FROM bday) <> 5 AND (first_in - interval '0')::time >= time '14:00'
                    AND (first_in - interval '0')::time < time '23:59') AS half
         FROM x
     )
     SELECT uid, count(*)::int AS days,
            count(*) FILTER (WHERE half)::int AS half_days,
            COALESCE(sum(lm - 15) FILTER (WHERE NOT half AND lm > 15 AND lm <= 60), 0)::int AS late_min,
            count(*) FILTER (WHERE NOT half AND lm > 60)::int AS late_days,
            round(sum(extract(epoch FROM last_out - first_in) / 3600)::numeric)::int AS hours
       FROM y GROUP BY uid`,
    [fromDate]
  );
  return new Map(rows.map((r) => [r.uid, r]));
}

// «رجعت عليه»: a piece sent BACK from stage S is charged to whoever moved it INTO S, but only
// when someone ELSE sent it back — reverting your own press is a correction, not a fault.
async function loadReturns(fromDate) {
  const { rows } = await query(
    `WITH rv AS (
       SELECT s.order_id, s.from_stage, s.user_id AS rby, s.created_at
         FROM staff_activity_log s
        WHERE s.action = 'revert' AND s.created_at >= $1::date - interval '3 hours'
     ), resp AS (
       SELECT rv.rby, (SELECT a.user_id FROM staff_activity_log a
                        WHERE a.order_id = rv.order_id AND a.action IN ('advance', 'advance_shawl')
                          AND a.to_stage = rv.from_stage AND a.created_at < rv.created_at
                        ORDER BY a.created_at DESC LIMIT 1) AS uid
         FROM rv
     )
     SELECT uid, count(*)::int AS n FROM resp WHERE uid IS NOT NULL AND uid <> rby GROUP BY uid`,
    [fromDate]
  );
  return new Map(rows.map((r) => [r.uid, r.n]));
}

const STAGE_AR = {
  design: 'التصميم', embroidery: 'التطريز', assembly: 'التجميع', pressing: 'الكوي',
  preparing: 'التجهيز', ready: 'التسليم', tailor: 'الفصال',
};
const COLS = ['design', 'embroidery', 'assembly', 'pressing', 'preparing', 'ready', 'tailor'];
const NORM = (col) => `regexp_replace(${col}, '[[:space:]\\u064B-\\u0652\\u0640]', '', 'g')`;

async function load(since) {
  const moves = await query(
    `WITH adv AS (
       SELECT s.order_id, s.user_id AS sender_id, s.from_stage, s.created_at AS at
         FROM staff_activity_log s
        WHERE s.action IN ('advance', 'advance_shawl')
          AND s.created_at > $1::timestamptz
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
          AND p.created_at > $1::timestamptz - make_interval(days => $2)
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
          AND a.created_at > $1::timestamptz - interval '60 days'
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
    [since, WINDOW]
  );
  const tailor = await query(
    `SELECT actor_id AS worker_id, created_at AS at FROM audit_log
      WHERE action = 'tailor_complete' AND created_at > $1::timestamptz`,
    [since]
  );
  const reverts = await query(
    `SELECT user_id, count(*)::int AS n FROM staff_activity_log
      WHERE action = 'revert' AND created_at > $1::timestamptz GROUP BY 1`,
    [since]
  );
  const users = await query(`SELECT id, name, role, staff_types FROM users WHERE role IN ('staff','admin','design_helper')`);
  return { moves: moves.rows, tailor: tailor.rows, reverts: reverts.rows, users: users.rows };
}

const STAGE_OF = { design_complete: 'design', embroidery: 'embroidery', assembly: 'assembly', pressing: 'pressing', preparing: 'preparing', ready: 'ready' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (n ? n.toLocaleString('en-US') : '<span class="z">·</span>');

function tally(moves, tailor) {
  const credit = new Map();
  for (const m of moves) {
    const st = STAGE_OF[m.from_stage];
    if (!st) continue;
    const row = credit.get(m.worker_id) || {};
    row[st] = (row[st] || 0) + 1;
    credit.set(m.worker_id, row);
  }
  for (const t of tailor) {
    const row = credit.get(t.worker_id) || {};
    row.tailor = (row.tailor || 0) + 1;
    credit.set(t.worker_id, row);
  }
  return credit;
}

function build({ moves, tailor, reverts, users }, month) {
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
.tag{display:inline-block;border-radius:99px;padding:1px 10px;font-size:12px;font-weight:800;background:#eee3d4;color:#5b5b5b}
.tag.chk{background:#fff1b8;color:#7a5b00}.tag.up{background:#d9f2df;color:#17663a}.tag.down{background:#fbd9d0;color:#9a2a0c}
td.why{white-space:normal;min-width:180px;font-size:12px;color:var(--soft);text-align:start}
.bar{display:inline-block;width:80px;height:8px;border-radius:9px;background:#eee3d4;vertical-align:middle;overflow:hidden}.bar i{display:block;height:100%;background:var(--acc)}
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

${month ? monthSections(month, nm) : ''}
<h2>باليوم</h2>
<div class="card"><table><thead><tr><th>اليوم</th>${topIds.map((id) => `<th>${esc(nm(id))}</th>`).join('')}</tr></thead>
<tbody>${days.reverse().map((d) => `<tr><td>${d}</td>${topIds.map((id) => `<td>${fmt(daily.get(d).get(id))}</td>`).join('')}</tr>`).join('')}</tbody></table>
<p class="note">حركات النقل باستحقاق لكل يوم (بدون الفصال).</p></div>
</main></body></html>
`;
}

// ── الشهر: حافز / خصم + ترتيب التعب ───────────────────────────────────────────────
// Verdicts are a SUGGESTION for the owner, computed from four numbers on the page:
//   effort/day = weighted points ÷ days punched in (raw device), compared to the MEDIAN of
//   everyone on the line who punched in; returns = pieces sent back to them by someone else;
//   late days = days more than an hour late; late minutes = 15–60 min lateness.
//   حافز  — effort/day ≥ 1.25× median, returns ≤ 2% of their moves, ≤ 2 late days.
//   خصم   — effort/day ≤ 0.6× median, OR ≥ 5 late days, OR returns ≥ 5% of moves (min 10).
//   No device punches (admin, أيادي التصميم) → effort is shown, no verdict.
function monthSections({ data, att, ret, from }, nm) {
  const credit = tally(data.moves, data.tailor);
  // Points are summed per MOVE, not per column: a design or embroidery credit that rests on
  // no evidence (the sender by default) is a button press, worth 1 — otherwise pressing
  // «تحويل للتطريز» on someone else's design scores as if you had drawn it.
  const pts = new Map();
  const noEv = new Map();
  for (const m of data.moves) {
    const st = STAGE_OF[m.from_stage];
    if (!st) continue;
    const weak = (st === 'design' || st === 'embroidery') && !m.evidence;
    pts.set(m.worker_id, (pts.get(m.worker_id) || 0) + (weak ? 1 : WEIGHT[st]));
    if (weak) noEv.set(m.worker_id, (noEv.get(m.worker_id) || 0) + 1);
  }
  for (const t of data.tailor) pts.set(t.worker_id, (pts.get(t.worker_id) || 0) + WEIGHT.tailor);
  const rows = [...credit.entries()].map(([id, row]) => {
    const moves = COLS.reduce((a, c) => a + (row[c] || 0), 0);
    const points = pts.get(id) || 0;
    const a = att.get(id);
    return {
      id, row, moves, points, a,
      // A half shift is half a day of opportunity.
      perDay: a && a.days ? points / (a.days - a.half_days / 2) : null,
      returns: ret.get(id) || 0,
      weak: noEv.get(id) || 0,
    };
  }).filter((r) => r.moves > 0);
  const perDays = rows.filter((r) => r.perDay != null && r.moves >= 50).map((r) => r.perDay).sort((x, y) => x - y);
  const median = perDays.length ? perDays[Math.floor((perDays.length - 1) / 2)] : 0;

  for (const r of rows) {
    const why = [];
    if (r.perDay == null) { r.verdict = '—'; r.why = 'ما عنده بصمة جهاز'; continue; }
    // Punched in for days but almost nothing in the production log = work the system does
    // not record (packing help, errands), not idleness. Never suggest a deduction on that.
    if (r.moves < 50 && r.a.days >= 3) {
      r.verdict = 'تحقق';
      r.why = `داوم ${r.a.days} يوم وشغله بالنظام ${r.moves} حركة بس — شغله غالباً برّه النظام`;
      continue;
    }
    const ratio = median ? r.perDay / median : 1;
    const retRate = r.moves ? r.returns / r.moves : 0;
    const bad = [];
    if (ratio <= 0.6) bad.push(`تعبه باليوم ${Math.round(ratio * 100)}% من الوسط`);
    if (r.a.late_days >= 5) bad.push(`${r.a.late_days} أيام متأخر +ساعة`);
    if (r.returns >= 10 && retRate >= 0.05) bad.push(`${r.returns} قطعة رجعت عليه (${(retRate * 100).toFixed(1)}%)`);
    if (bad.length) { r.verdict = 'خصم'; r.why = bad.join(' · '); continue; }
    if (ratio >= 1.25 && retRate <= 0.02 && r.a.late_days <= 2) {
      r.verdict = 'حافز';
      why.push(`تعبه باليوم ${Math.round(ratio * 100)}% من الوسط`);
      if (!r.a.late_days && !r.a.late_min) why.push('ما متأخر');
      r.why = why.join(' · ');
      continue;
    }
    r.verdict = 'عادي';
    r.why = `تعبه باليوم ${Math.round(ratio * 100)}% من الوسط`;
  }

  const byMoves = [...rows].sort((a, b) => b.moves - a.moves);
  const byEffort = [...rows].sort((a, b) => (b.perDay ?? -1) - (a.perDay ?? -1) || b.points - a.points);
  const one = (n) => (Number.isInteger(n) ? n : n.toFixed(1));
  const tag = (v) => v === 'تحقق' ? '<span class="tag chk">تحقق</span>' : v === 'حافز' ? '<span class="tag up">حافز</span>' : v === 'خصم' ? '<span class="tag down">خصم</span>' : v === 'عادي' ? '<span class="tag">عادي</span>' : '<span class="z">—</span>';
  const colTotals = COLS.map((c) => rows.reduce((a, r) => a + (r.row[c] || 0), 0));

  return `
<h2>حركات الشهر — من ${from} (باستحقاق)</h2>
<div class="card"><table><thead><tr><th>الموظف</th>${COLS.map((c) => `<th>${STAGE_AR[c]}</th>`).join('')}<th>المجموع</th><th>رجعت عليه</th><th>أيام دوام</th><th>نص شفت</th><th>متأخر +ساعة</th><th>دقائق تأخير</th><th>التقييم</th><th>السبب</th></tr></thead>
<tbody>${byMoves.map((r) => `<tr><td>${esc(nm(r.id))}</td>${COLS.map((c) => `<td>${fmt(r.row[c])}</td>`).join('')}<td class="tot">${fmt(r.moves)}</td><td>${fmt(r.returns)}</td><td>${r.a ? r.a.days : '<span class="z">—</span>'}</td><td>${r.a ? fmt(r.a.half_days) : '<span class="z">—</span>'}</td><td>${r.a ? fmt(r.a.late_days) : '<span class="z">—</span>'}</td><td>${r.a ? fmt(r.a.late_min) : '<span class="z">—</span>'}</td><td>${tag(r.verdict)}</td><td class="why">${esc(r.why)}</td></tr>`).join('')}</tbody>
<tfoot><tr><td>المجموع</td>${colTotals.map((n) => `<td>${fmt(n)}</td>`).join('')}<td class="tot">${fmt(colTotals.reduce((a, b) => a + b, 0))}</td><td colspan="7"></td></tr></tfoot></table>
<p class="note"><b>هذا اقتراح مو قرار.</b> حافز = تعبه باليوم ربع أكثر من الوسط أو أكثر، والقطع اللي رجعت عليه أقل من 2% من شغله، وما تأخر أكثر من ساعة إلا يومين بالأكثر. خصم = تعبه باليوم 60% من الوسط أو أقل، أو تأخر أكثر من ساعة 5 أيام أو أكثر، أو رجعت عليه 10 قطع أو أكثر وهي 5% من شغله أو أكثر. «رجعت عليه» = قطعة رجّعها <i>غيره</i> للمرحلة اللي هو سلّمها (اللي يرجّع شغله بنفسه تصحيح، ما ينحسب). الدوام والتأخير محسوبين من بصمة الجهاز نفسها، مو من سجل الدوام بالنظام، وبقواعد كشف الراتب: الدوام يبدي 10:00، برزان 12:00، الجمعة 15:00، ومهلة 15 دقيقة. «نص شفت» = وصل الساعة 2 الظهر أو بعدها بغير الجمعة: ينحسب نص يوم، وما ينحسب تأخير. «دقائق تأخير» تنحسب بس للأيام اللي تأخيرها بين 15 دقيقة وساعة.</p>
<p class="note"><b>انتبه:</b> التصميم اللي ما بيه دليل (نص خط مطابق أو صورة مربوطة) ينحسب للي ضغط الزر، فرقم مضر بالتصميم يشمل طلبات صممتها أيادي التصميم بنص مكتوب بشكل ثاني. وعمّال الورشة (حمزة، ابو جمال، محمود) مو بهذا التقرير لأنهم ينحسبون بالقطعة بشاشة الورشة.</p></div>

<h2>ترتيب التعب — من ${from}</h2>
<div class="card"><table><thead><tr><th>#</th><th>الموظف</th><th>نقاط التعب</th><th>منها ضغط بلا دليل</th><th>أيام دوام (نص شفت)</th><th>نقاط باليوم</th><th>ساعات</th><th>مقارنة بالوسط</th></tr></thead>
<tbody>${byEffort.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(nm(r.id))}</td><td class="tot">${fmt(Math.round(r.points))}</td><td>${fmt(r.weak)}</td><td>${r.a ? r.a.days + (r.a.half_days ? ` (${r.a.half_days})` : '') : '<span class="z">—</span>'}</td><td>${r.perDay != null ? one(Math.round(r.perDay * 10) / 10) : '<span class="z">—</span>'}</td><td>${r.a ? fmt(r.a.hours) : '<span class="z">—</span>'}</td><td>${r.perDay != null && median ? `<span class="bar"><i style="width:${Math.min(100, Math.round((r.perDay / median) * 50))}%"></i></span> ${Math.round((r.perDay / median) * 100)}%` : '<span class="z">—</span>'}</td></tr>`).join('')}</tbody></table>
<p class="note">نقاط التعب = كل حركة × وزنها: التصميم 3 · التطريز 3 · الفصال 3 · التجميع 2 · الكوي 2 · التجهيز 1 · التسليم 0.5. تصميم أو تطريز بدون دليل إنه هو اشتغله (نص خط، صورة مربوطة، تأشير مناطق) ينحسب ضغطة زر = نقطة وحدة. الترتيب حسب «نقاط باليوم» حتى ما يظلم اللي داوم أيام أقل. الوسط = ${one(Math.round(median * 10) / 10)} نقطة باليوم. الأوزان تقدير، وتنعدّل. ⚠️ المقارنة بين شغلات مختلفة تقريبية: قطعة تطريز تاخذ وقت أكثر بهواية من تسليم، فالأدق تقارن الموظف بزميله بنفس المحطة (محمد عادل ↔ علي مهند بالكوي).</p></div>
`;
}

Promise.all([
  load(new Date(Date.now() - DAYS * 86400e3).toISOString()),
  load(new Date(`${MONTH_FROM}T00:00:00+03:00`).toISOString()),
  loadAttendance(MONTH_FROM),
  loadReturns(MONTH_FROM),
])
  .then(([d, data, att, ret]) => process.stdout.write(build(d, { data, att, ret, from: MONTH_FROM })))
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
