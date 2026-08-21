// backend/lib/adminSuggestions.js — «شنو المفروض أنتبه إله اليوم».
//
// The owner asked for a console that can SUGGEST actions, not only answer questions. This is
// the suggesting half, and it uses NO MODEL AT ALL.
//
// ── WHY NO MODEL ───────────────────────────────────────────────────────────────────────────
// A suggestion is a claim about the shop that the owner will act on. Asking a model to invent
// them means every refresh can produce a different list, a plausible-but-false one costs a real
// decision, and there is no way to test it. Every item below is a SQL predicate over real rows:
// it is free, instant, deterministic, testable, and it cannot hallucinate a problem that does
// not exist or miss one that does. Same reasoning as lib/supportActions.js choosing keyword
// matching over a second model call — where the cheap deterministic method is also the correct
// one, the model is not an upgrade.
//
// The model's job on this surface is phrasing answers to questions the owner asked. Deciding
// what deserves his attention is not a phrasing problem.
//
// ── WHAT IS DELIBERATELY NOT SUGGESTED ─────────────────────────────────────────────────────
// ⚠️ «بانتظار موافقة الممثل» — the ~471 rep orders parked awaiting a rep's approval — is NOT
// in this file and must never be added. HANDOFF ruling 2026-08-14: those rows sit on unresolved
// student↔rep disputes and the pending state is deliberate. It looks exactly like a backlog
// worth surfacing («~11.7M IQD stranded!»), which is precisely why the temptation has to be
// refused in writing here. That money is WITHHELD, not stuck, and an admin nudged to "clear
// the queue" would take a side in every dispute at once. Counting it is fine; calling it a
// task is not.

const { query } = require('./db');
const presence = require('./staffPresence');
// The retail/rep split has ONE definition and it lives in counts.js. It is keyed on
// `wholesaler_approval`, deliberately NOT on `students.wholesaler_id`: deleting a rep NULLs
// its students' wholesaler_id while leaving their orders 'approved', so the naive predicate
// would silently reclassify a deleted rep's whole cohort as retail. (`orders.wholesaler_id`
// does not exist at all — the first draft of this file assumed it did.)
const { retailRowSql, liveSql } = require('./counts');

const fmtIQD = (n) => `${Number(n || 0).toLocaleString('en-US')} دينار`;

/**
 * severity: 'urgent' | 'attention' | 'info' — drives colour only, never behaviour.
 * href:     where a human goes to deal with it. Every suggestion ends somewhere tappable —
 *           a suggestion with nothing to tap is a complaint.
 * ask:      an optional question to pre-fill the console with, so "tell me more" is one tap.
 */
function item(id, severity, title, detail, href, ask = null) {
  return { id, severity, title, detail, href, ask };
}

async function build(now = new Date()) {
  const out = [];
  const date = presence.shopToday(now);

  // ── 1. STAFF, TODAY ──────────────────────────────────────────────────────────────────────
  // The owner's standing question. Reported as two DIFFERENT facts, never one: someone who
  // stamped بصمة but never opened the app is a different situation from someone who did
  // neither, and the second is "did not come in" while the first is "came in and is not using
  // the system". Collapsing them would hide the one the owner can actually act on.
  try {
    const rep = await presence.dailyReport(date, now);
    const t = rep.totals;

    const ghosts = rep.rows.filter((r) => r.check_in_at && !r.opened);
    if (ghosts.length) {
      out.push(
        item(
          'staff_stamped_not_opened',
          'attention',
          `${ghosts.length} موظف بصم بس ما فتح التطبيق اليوم`,
          ghosts.map((r) => r.name).join(' · '),
          '/admin/attendance',
          'منو بصم اليوم بس ما فتح التطبيق؟'
        )
      );
    }

    if (t.absent > 0) {
      const absent = rep.rows.filter((r) => r.attendance_required && !r.check_in_at);
      out.push(
        item(
          'staff_absent',
          t.absent >= Math.max(2, Math.ceil(t.staff / 2)) ? 'urgent' : 'attention',
          `${t.absent} من ${t.staff} موظف ما بصموا اليوم`,
          absent.slice(0, 8).map((r) => r.name).join(' · '),
          '/admin/attendance',
          'شنو حالة الموظفين اليوم؟'
        )
      );
    }

    if (t.still_in > 0) {
      out.push(
        item(
          'staff_still_in',
          'info',
          `${t.still_in} موظف لا زال بالدوام`,
          'ما سجّلوا انصراف لحد الآن',
          '/admin/attendance'
        )
      );
    }
  } catch (e) {
    console.error('suggestion staff block failed:', e.message);
  }

  // ── 2. BREAKS AWAITING A DECISION ────────────────────────────────────────────────────────
  // The one queue in the shop that IS a queue: a worker is standing there waiting for an
  // answer, and «طلع بدون موافقة» means they already left. Actionable straight from the
  // console (approve_break / reject_break are in the action registry).
  try {
    const { rows } = await query(
      `SELECT u.name, b.left_without_approval, b.requested_at
         FROM staff_attendance_breaks b
         JOIN users u ON u.id = b.user_id
        WHERE b.approval = 'pending' AND b.state <> 'cancelled'
        ORDER BY b.requested_at ASC`
    );
    if (rows.length) {
      const gone = rows.filter((r) => r.left_without_approval).length;
      out.push(
        item(
          'breaks_pending',
          gone ? 'urgent' : 'attention',
          `${rows.length} طلب خروج مؤقت بانتظار قرارك`,
          gone
            ? `${gone} منهم طلع بدون موافقة`
            : rows.slice(0, 5).map((r) => r.name).join(' · '),
          '/admin/attendance',
          'منو طالب خروج مؤقت؟'
        )
      );
    }
  } catch (e) {
    console.error('suggestion breaks block failed:', e.message);
  }

  // ── 3. DEADLINES ─────────────────────────────────────────────────────────────────────────
  // Directly actionable: extend_rep_deadline is in the registry, so this suggestion and the
  // fix are one conversation.
  try {
    const { rows } = await query(
      `SELECT u.name AS rep_name, w.university_name,
              (w.deadline::date - CURRENT_DATE) AS days_left
         FROM wholesalers w
         JOIN users u ON u.id = w.user_id
        WHERE w.deadline IS NOT NULL AND w.deadline < NOW() + INTERVAL '7 days'
        ORDER BY w.deadline ASC
        LIMIT 10`
    );
    const past = rows.filter((r) => Number(r.days_left) < 0);
    const soon = rows.filter((r) => Number(r.days_left) >= 0);
    if (soon.length) {
      out.push(
        item(
          'deadlines_soon',
          'attention',
          `${soon.length} ممثل موعدهم ينتهي خلال أسبوع`,
          soon.map((r) => `${r.university_name || r.rep_name} (${Number(r.days_left)} يوم)`).join(' · '),
          '/admin/wholesalers',
          'منو الممثلين اللي موعدهم قرب؟'
        )
      );
    }
    if (past.length) {
      out.push(
        item(
          'deadlines_past',
          'info',
          `${past.length} ممثل فات موعدهم`,
          past.slice(0, 6).map((r) => r.university_name || r.rep_name).join(' · '),
          '/admin/wholesalers',
          'منو الممثلين اللي فات موعدهم؟'
        )
      );
    }
  } catch (e) {
    console.error('suggestion deadlines block failed:', e.message);
  }

  // ── 4. RETAIL ORDERS WITH NO PRODUCTION COST ─────────────────────────────────────────────
  // Why this one matters more than it looks: the /admin dashboard REFUSES to print a net
  // profit while no retail cost has been entered, and adminMetrics.revenue_summary refuses in
  // the same breath. So this is not a tidiness nag — it names the exact reason the owner
  // cannot see his own profit, and set_order_cost is in the registry.
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(o.price), 0)::bigint AS revenue
         FROM orders o
        WHERE ${liveSql('o')}
          AND ${retailRowSql('o')}
          AND o.cost IS NULL
          AND o.created_at > NOW() - INTERVAL '90 days'`
    );
    const r = rows[0];
    if (Number(r.n) > 0) {
      out.push(
        item(
          'retail_cost_missing',
          'info',
          `${r.n} طلب تجزئة بدون كلفة إنتاج`,
          `مبيعاتها ${fmtIQD(r.revenue)} — بدون الكلفة ما ينحسب صافي الربح`,
          '/admin/orders',
          'شكد دخل المحل آخر ٣٠ يوم؟'
        )
      );
    }
  } catch (e) {
    console.error('suggestion cost block failed:', e.message);
  }

  // ── 5. STALLED PIECES ────────────────────────────────────────────────────────────────────
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n
         FROM orders o
        WHERE o.status <> 'cancelled'
          AND o.status NOT IN ('ready', 'delivered', 'pending_approval')
          AND o.updated_at < NOW() - INTERVAL '14 days'`
    );
    if (Number(rows[0].n) > 0) {
      out.push(
        item(
          'orders_stalled',
          'attention',
          `${rows[0].n} قطعة ما تحركت من أكثر من أسبوعين`,
          'واقفة بنفس المرحلة',
          '/staff',
          'شنو القطع اللي واقفة من مدة؟'
        )
      );
    }
  } catch (e) {
    console.error('suggestion stalled block failed:', e.message);
  }

  // ── 6. AI SPEND ──────────────────────────────────────────────────────────────────────────
  // Both assistants bill the same account; the owner should learn about a runaway from his own
  // console rather than from the assistant going dark.
  try {
    const { rows } = await query(
      `SELECT COALESCE(SUM(cost_usd), 0)::numeric(12,6) AS ai,
              (SELECT COALESCE(SUM(cost_usd), 0)::numeric(12,6)
                 FROM calligraphy_spend_log
                WHERE created_at > NOW() - INTERVAL '24 hours') AS callig
         FROM ai_chat_messages
        WHERE created_at > NOW() - INTERVAL '24 hours'`
    );
    const ai = Number(rows[0].ai);
    const callig = Number(rows[0].callig);
    const warn = Number(process.env.AI_CHAT_DAILY_USD_WARN || 1.0);
    if (warn > 0 && ai >= warn) {
      out.push(
        item(
          'ai_spend_high',
          'urgent',
          `كلفة المساعد $${ai.toFixed(2)} خلال ٢٤ ساعة`,
          `الحد اليومي $${Number(process.env.AI_CHAT_DAILY_USD_MAX || 3)}`,
          '/admin/assistant',
          'شكد كلفة المساعد آخر ٧ أيام؟'
        )
      );
    }
    const calligWarn = Number(process.env.CALLIG_DAILY_USD_WARN || 5);
    if (calligWarn > 0 && callig >= calligWarn) {
      out.push(
        item(
          'calligraphy_spend_high',
          'urgent',
          `كلفة مولّد الخط $${callig.toFixed(2)} خلال ٢٤ ساعة`,
          `الحد اليومي $${Number(process.env.CALLIG_DAILY_USD_MAX || 10)}`,
          '/admin/calligraphy',
          'شكد كلفة مولّد الخط آخر ٧ أيام؟'
        )
      );
    }
  } catch (e) {
    console.error('suggestion spend block failed:', e.message);
  }

  // ── 7. FAILED CALLIGRAPHY PLATES ─────────────────────────────────────────────────────────
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM calligraphy_plates WHERE status = 'failed'`
    );
    if (Number(rows[0].n) > 0) {
      out.push(
        item(
          'calligraphy_failed',
          'attention',
          `${rows[0].n} لوحة خط فاشلة`,
          'تحتاج إعادة توليد',
          '/admin/calligraphy',
          'شنو حالة لوحات الخط؟'
        )
      );
    }
  } catch (e) {
    console.error('suggestion calligraphy block failed:', e.message);
  }

  // Urgent first, then attention, then info — a stable order so the list does not reshuffle
  // between refreshes and make the owner re-read it.
  const RANK = { urgent: 0, attention: 1, info: 2 };
  out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  return { date, suggestions: out };
}

module.exports = { build };
