// backend/lib/staffEngagement.js — the three staff notices the owner asked for (2026-10-14).
//
//   1. «فلان انخصم منه X» — when a worker comes back from a خروج مؤقت that went past their
//      allowance, EVERY staff member and every admin is told, with the name and the amount.
//      Owner ruling: public, by name. The worker gets their own, personal version.
//   2. «نجم اليوم» — shortly before the shop's scheduled close, everyone is told who made the
//      most work moves and who spent the most time in the app.
//   3. «رسالة لولو» — at the same moment, the AI writes each worker one short personal message
//      from their own day's numbers and sends it WITHOUT review (owner ruling). The admin gets a
//      digest, and every message is stored in `staff_ai_messages` for the admin console.
//
// ── DELIVERY ───────────────────────────────────────────────────────────────────────────────
// A `notifications` row IS the delivery: lib/pushOutbox.js turns pending rows into FCM/APNs.
// Same path staffReportJob.js uses; nothing here knows about a push provider.
//
// ── WHY A SWEEP AND NOT A HOOK IN attendanceBreak.recomputeMonth ───────────────────────────
// A deduction is born in ELEVEN recomputeMonth call sites (device punch, phone return, admin
// correction, approval, stale-day close…), all inside a transaction. A notification INSERT
// there would abort the punch batch on failure (see attendanceNotices.js' header), and adding
// one per call site is eleven chances to miss one. A once-a-minute sweep over the committed
// result sees every path, runs after every commit, and needs one ledger to stay idempotent.
//
// ⚠️ THE LEDGER IS KEYED ON THE BREAK, NEVER THE TRANSACTION. syncDeductionTxn REPLACES the
// salary row whenever an admin correction changes the amount (soft-delete + insert). Keying on
// the transaction would announce the same break to the whole shop a second time.
//
// ⚠️ THE AI GUARD. The model sees only the facts block below, and its answer must pass
// lib/adminAnswerGuard.inspect (no number that is not in the facts) plus the tone check here.
// Anything that fails is replaced by a TEMPLATE message built from the same facts, so a worker
// always gets something true and a bad model day never reaches a phone. Kill switch:
// STAFF_AI_MESSAGES=off → templates only, no model call, no cost.

const { query } = require('./db');
const presence = require('./staffPresence');
const { localParts, fmtShopDate, DEFAULT_TZ: TZ } = require('./shopTime');
const { loadWeek, timeToMinutes } = require('./staffSchedule');
const answerGuard = require('./adminAnswerGuard');

const QUEUE_DEDUCTIONS = 'staff-break-deduction-announce';
const QUEUE_DAY_CLOSE = 'staff-day-close';
const CRON_DEDUCTIONS = '* * * * *';
const CRON_DAY_CLOSE = '*/15 * * * *';

// How long before the scheduled close the day's notices go out. Late enough that the day's
// work is in, early enough that people are still in the shop to read it.
const DAY_CLOSE_LEAD_MINUTES = 45;

// A break that returned longer ago than this is history, not news. Bounds the first run after
// deploy as well: nothing older than this is ever announced.
const ANNOUNCE_WINDOW = '3 hours';

const fmtIQD = (n) => `${Number(n || 0).toLocaleString('en-US')} دينار`;

function fmtMinutes(mins) {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest} دقيقة`;
  return rest ? `${h} ساعة و${rest} دقيقة` : `${h} ساعة`;
}

async function insertFor(userIds, { type, title, body, link }) {
  if (!userIds.length) return 0;
  const { rowCount } = await query(
    `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
     SELECT id, $2, $3, $4, $5 FROM users WHERE id = ANY($1::uuid[])`,
    [userIds, type, title, body, link]
  );
  return rowCount;
}

async function audience() {
  const { rows } = await query(
    `SELECT id, role FROM users
      WHERE role IN ('staff', 'admin') AND deleted_at IS NULL`
  );
  return {
    staff: rows.filter((r) => r.role === 'staff').map((r) => r.id),
    admins: rows.filter((r) => r.role === 'admin').map((r) => r.id),
  };
}

// ── 1. BREAK DEDUCTIONS ──────────────────────────────────────────────────────────────────

/** Pure: the two messages one deduction produces. Exported for tests. */
function deductionCopy({ name, minutes, deductedMinutes, amount, remainingMinutes }) {
  const over = remainingMinutes <= 0
    ? 'خلص رصيد الخروج المؤقت'
    : 'طلع خروج مؤقت بدون موافقة';
  return {
    public: {
      title: 'خصم خروج مؤقت',
      body: `${name} ${over} — طلع ${fmtMinutes(minutes)} وانخصم منه ${fmtIQD(amount)} (${fmtMinutes(deductedMinutes)} فوق الرصيد).`,
    },
    personal: {
      title: 'انخصم من راتبك',
      body: `خروجك المؤقت كان ${fmtMinutes(minutes)}، منها ${fmtMinutes(deductedMinutes)} فوق رصيدك، فانخصم ${fmtIQD(amount)}. الخصم ينشاف لكل الموظفين.`,
    },
  };
}

/**
 * Announce every fresh break deduction exactly once. Returns how many breaks were announced.
 *
 * Claim-then-send: the ledger INSERT … ON CONFLICT DO NOTHING RETURNING is the lock, so two
 * workers running the same minute cannot both announce one break.
 */
async function announceBreakDeductions() {
  const { rows } = await query(
    `SELECT b.id, b.user_id, b.month_key, b.minutes, b.deducted_minutes, b.deduction_amount,
            u.name
       FROM staff_attendance_breaks b
       JOIN users u ON u.id = b.user_id
       JOIN staff_salary_transactions t
         ON t.id = b.deduction_transaction_id AND t.deleted_at IS NULL
      WHERE b.state = 'returned'
        AND b.deduction_amount > 0
        AND b.returned_at > NOW() - INTERVAL '${ANNOUNCE_WINDOW}'
        AND NOT EXISTS (SELECT 1 FROM break_deduction_announcements a WHERE a.break_id = b.id)
      ORDER BY b.returned_at`
  );
  if (!rows.length) return 0;

  const { staff, admins } = await audience();
  let announced = 0;

  for (const b of rows) {
    const claim = await query(
      `INSERT INTO break_deduction_announcements (break_id, user_id, amount)
       VALUES ($1, $2, $3) ON CONFLICT (break_id) DO NOTHING RETURNING break_id`,
      [b.id, b.user_id, b.deduction_amount]
    );
    if (!claim.rowCount) continue;

    // Remaining allowance for the wording only: «خلص الرصيد» vs «بدون موافقة» (an unapproved
    // break is charged from minute one even with allowance left — computeCharge's rule).
    let remaining = 0;
    try {
      const { rows: bal } = await query(
        `SELECT COALESCE(us.break_monthly_minutes, s.break_monthly_minutes, 0)::int
                - COALESCE((SELECT SUM(minutes) FROM staff_attendance_breaks
                             WHERE user_id = $1 AND month_key = $2 AND state = 'returned'), 0)::int
                AS remaining
           FROM (SELECT break_monthly_minutes FROM staff_attendance_settings LIMIT 1) s
           LEFT JOIN staff_attendance_user_settings us ON us.user_id = $1`,
        [b.user_id, b.month_key]
      );
      remaining = bal[0] ? Number(bal[0].remaining) : 0;
    } catch {
      remaining = 0;
    }

    const copy = deductionCopy({
      name: b.name,
      minutes: Number(b.minutes),
      deductedMinutes: Number(b.deducted_minutes),
      amount: Number(b.deduction_amount),
      remainingMinutes: remaining,
    });
    try {
      await insertFor([b.user_id], {
        type: 'break_deduction', ...copy.personal, link: '/staff/me',
      });
      const others = [...staff.filter((id) => id !== b.user_id), ...admins];
      await insertFor(others, {
        type: 'break_deduction_public', ...copy.public, link: '/staff',
      });
      announced += 1;
    } catch (err) {
      console.error('[engagement] deduction notice failed:', err.message);
    }
  }
  return announced;
}

// ── 2 + 3. DAY CLOSE: «نجم اليوم» + «رسالة لولو» ────────────────────────────────────────────

/** Pure: who led the day on each measure. Ties go to the earlier name — stable, not random. */
function pickStars(rows) {
  const lead = (key) => {
    const top = rows.reduce((best, r) => (r[key] > (best ? best[key] : 0) ? r : best), null);
    return top ? { name: top.name, user_id: top.user_id, value: top[key] } : null;
  };
  return { moves: lead('work_moves'), app: lead('active_minutes') };
}

function starCopy(stars) {
  const lines = [];
  if (stars.moves) lines.push(`أكثر حركات شغل: ${stars.moves.name} (${stars.moves.value} حركة)`);
  if (stars.app) lines.push(`أكثر وقت بالتطبيق: ${stars.app.name} (${fmtMinutes(stars.app.value)})`);
  if (!lines.length) return null;
  return { title: 'نجم اليوم ⭐', body: lines.join(' · ') };
}

/** The facts the AI may use for one worker. Every number it says must appear here. */
function factsFor(row, { rank, staffCount, monthBreak }) {
  const lines = [
    `الاسم: ${row.name}`,
    `حركات الشغل اليوم: ${row.work_moves}`,
    `ترتيبه بالحركات بين الموظفين: ${rank} من ${staffCount}`,
    `وقته بالتطبيق اليوم: ${fmtMinutes(row.active_minutes)}`,
    `تأخير اليوم: ${row.late_minutes ? fmtMinutes(row.late_minutes) : 'ما تأخر'}`,
    `خروج مؤقت اليوم: ${row.break_minutes ? fmtMinutes(row.break_minutes) : 'ما طلع'}`,
  ];
  if (monthBreak) {
    lines.push(`باقي من رصيد الخروج المؤقت هذا الشهر: ${fmtMinutes(monthBreak.remaining)}`);
    if (monthBreak.deducted_today > 0) {
      lines.push(`انخصم منه اليوم: ${fmtIQD(monthBreak.deducted_today)}`);
    }
  }
  return lines.join('\n');
}

/** Template fallback — always true, never clever. */
function templateMessage(row, { rank }) {
  if (row.work_moves > 0 && rank === 1) {
    return `${row.name}، اليوم إنت الأول بالشغل بـ ${row.work_moves} حركة. عاشت إيدك!`;
  }
  if (row.work_moves > 0) {
    return `${row.name}، سويت اليوم ${row.work_moves} حركة شغل. شكراً على تعبك، باچر نكمل.`;
  }
  return `${row.name}، ما انسجلت إلك حركات شغل اليوم. إذا اشتغلت، تأكد تضغط بالتطبيق حتى ينحسب تعبك.`;
}

// Words a message from the shop to an employee must never carry, whatever the model was led to.
const HARSH_RE = /غبي|كسول|فاشل|حمار|تافه|طرد|نفصلك|راح نفصل|عقوب|تهديد|مطرود/;

const SYSTEM_PROMPT = [
  'أنت «لولو»، مساعدة محل لولو شوب. تكتب رسالة قصيرة لموظف واحد بنهاية يومه.',
  'اكتب باللهجة العراقية، جملة أو جملتين بس، بدون إيموجي كثير.',
  'استعمل فقط الأرقام الموجودة بالحقائق. لا تخترع أي رقم أو مقارنة.',
  'إذا يومه زين: شجّعه بالاسم. إذا تأخر أو خلص رصيد الخروج المؤقت أو حركاته قليلة: ذكّره بلطف وباحترام.',
  'ممنوع الإهانة أو التهديد أو ذكر الفصل أو العقوبات. ممنوع تذكر موظفين ثانيين.',
  'اكتب الرسالة نفسها فقط، بدون مقدمة.',
].join('\n');

async function aiMessage(facts) {
  const aiChat = require('./aiChat');
  const out = await aiChat.complete({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `الحقائق:\n${facts}` },
    ],
    maxTokens: 160,
    temperature: 0.6,
  });
  return out.text;
}

/** Pure: is this model output allowed onto a worker's phone? */
function vetMessage(text, facts) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, reason: 'EMPTY' };
  if (t.length > 320) return { ok: false, reason: 'TOO_LONG' };
  if (/[a-zA-Z]{4,}/.test(t)) return { ok: false, reason: 'ENGLISH' };
  if (HARSH_RE.test(t)) return { ok: false, reason: 'HARSH' };
  const g = answerGuard.inspect(t, facts);
  if (!g.ok) return { ok: false, reason: `${g.reason} ${g.detail || ''}`.trim() };
  return { ok: true };
}

function aiEnabled() {
  return String(process.env.STAFF_AI_MESSAGES || 'on').toLowerCase() !== 'off';
}

/** Is it time for today's day-close notices? Pure; exported for tests. */
function dayCloseDue({ week, date, minutesNow, lead = DAY_CLOSE_LEAD_MINUTES }) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const day = week.find((w) => w.weekday === weekday);
  if (!day || day.is_off) return false;
  const start = timeToMinutes(day.start_time);
  let end = timeToMinutes(day.end_time);
  if (end <= start) end += 24 * 60; // الجمعة 15:00 → 00:00
  // A midnight-crossing end is past this calendar date; fire before the date rolls over.
  const fireAt = Math.min(end - lead, 24 * 60 - 15);
  return minutesNow >= fireAt;
}

/**
 * Send «نجم اليوم» + one «رسالة لولو» per worker who was there today. Idempotent per date:
 * the star by a NOT EXISTS on today's notification type, the messages by staff_ai_messages'
 * UNIQUE (user_id, work_date).
 */
async function runDayClose(now = new Date(), { force = false } = {}) {
  const { date, minutes } = localParts(now, TZ);
  if (!force) {
    const week = await loadWeek();
    if (!dayCloseDue({ week, date, minutesNow: minutes })) return { date, skipped: 'not_due' };
  }

  const report = await presence.dailyReport(date, now);
  // Only people who actually came or worked today. Messaging a worker on their day off is noise.
  const present = report.rows.filter(
    (r) => r.check_in_at || r.work_moves > 0 || r.active_minutes > 0
  );
  if (!present.length) return { date, skipped: 'nobody' };

  const { staff, admins } = await audience();
  const result = { date, star: false, messages: 0, ai: 0, template: 0 };

  // ── star ──
  const already = await query(
    `SELECT 1 FROM notifications
      WHERE type = 'staff_day_star' AND created_at > NOW() - INTERVAL '18 hours' LIMIT 1`
  );
  if (!already.rowCount) {
    const copy = starCopy(pickStars(present));
    if (copy) {
      await insertFor([...staff, ...admins], { type: 'staff_day_star', ...copy, link: '/staff' });
      result.star = true;
    }
  }

  // ── personal messages ──
  const ranked = [...present].sort((a, b) => b.work_moves - a.work_moves);
  const monthKey = date.slice(0, 7);
  const { rows: balances } = await query(
    `SELECT b.user_id,
            COALESCE(SUM(b.minutes) FILTER (WHERE b.state = 'returned'), 0)::int AS used,
            COALESCE(SUM(b.deduction_amount) FILTER (WHERE b.work_date = $2::date), 0)::bigint
              AS deducted_today
       FROM staff_attendance_breaks b
      WHERE b.month_key = $1 AND b.state = 'returned'
      GROUP BY b.user_id`,
    [monthKey, date]
  );
  // Effective allowance: a personal override beats the shop's number (loadEffectiveSettings' rule).
  const { rows: allowances } = await query(
    `SELECT u.id AS user_id,
            COALESCE(us.break_monthly_minutes, s.break_monthly_minutes, 0)::int AS allowance
       FROM users u
       CROSS JOIN (SELECT break_monthly_minutes FROM staff_attendance_settings LIMIT 1) s
       LEFT JOIN staff_attendance_user_settings us ON us.user_id = u.id
      WHERE u.role = 'staff' AND u.deleted_at IS NULL`
  );
  const allowanceBy = new Map(allowances.map((a) => [a.user_id, Number(a.allowance)]));
  const balanceBy = new Map(balances.map((b) => [b.user_id, b]));

  const digest = [];
  for (const row of present) {
    const exists = await query(
      `SELECT 1 FROM staff_ai_messages WHERE user_id = $1 AND work_date = $2::date`,
      [row.user_id, date]
    );
    if (exists.rowCount) continue;

    const rank = ranked.findIndex((r) => r.user_id === row.user_id) + 1;
    const bal = balanceBy.get(row.user_id);
    const allowance = allowanceBy.get(row.user_id) || 0;
    const monthBreak = allowance
      ? {
          remaining: Math.max(0, allowance - Number(bal ? bal.used : 0)),
          deducted_today: Number(bal ? bal.deducted_today : 0),
        }
      : null;
    const facts = factsFor(row, { rank, staffCount: present.length, monthBreak });

    let body = null;
    let source = 'template';
    let guardNote = null;
    if (aiEnabled()) {
      try {
        const text = await aiMessage(facts);
        const vet = vetMessage(text, facts);
        if (vet.ok) {
          body = text.trim();
          source = 'ai';
        } else {
          guardNote = `rejected: ${vet.reason} — ${String(text).slice(0, 200)}`;
        }
      } catch (err) {
        guardNote = `model failed: ${err.code || err.message}`;
      }
    } else {
      guardNote = 'STAFF_AI_MESSAGES=off';
    }
    if (!body) body = templateMessage(row, { rank });

    const ins = await query(
      `INSERT INTO staff_ai_messages (user_id, work_date, body_ar, facts, source, guard_note)
       VALUES ($1, $2::date, $3, $4, $5, $6)
       ON CONFLICT (user_id, work_date) DO NOTHING RETURNING id`,
      [row.user_id, date, body, facts, source, guardNote]
    );
    if (!ins.rowCount) continue;
    await insertFor([row.user_id], {
      type: 'staff_ai_message', title: 'رسالة من لولو', body, link: '/staff',
    });
    result.messages += 1;
    result[source] += 1;
    digest.push(`${row.name}: ${body}`);
  }

  if (digest.length) {
    // The admin's copy. The push is truncated on a lock screen; the full text is on the
    // console (`staff_ai_messages` metric) and in the table.
    await insertFor(admins, {
      type: 'staff_ai_digest',
      title: `رسائل لولو للموظفين — ${fmtShopDate(date)}`,
      body: digest.join(' · ').slice(0, 1500),
      link: '/admin/assistant',
    });
  }

  console.log(`[engagement] ${date}: star=${result.star} messages=${result.messages} (ai ${result.ai}, template ${result.template})`);
  return result;
}

async function register(boss) {
  await boss.createQueue(QUEUE_DEDUCTIONS).catch(() => {});
  await boss.createQueue(QUEUE_DAY_CLOSE).catch(() => {});
  await boss.schedule(QUEUE_DEDUCTIONS, CRON_DEDUCTIONS, {}, { tz: TZ });
  await boss.schedule(QUEUE_DAY_CLOSE, CRON_DAY_CLOSE, {}, { tz: TZ });
  await boss.work(QUEUE_DEDUCTIONS, { batchSize: 1 }, async () => {
    await announceBreakDeductions();
  });
  await boss.work(QUEUE_DAY_CLOSE, { batchSize: 1 }, async () => {
    await runDayClose();
  });
  console.log('[engagement] scheduled deductions every minute + day-close every 15 min');
}

module.exports = {
  announceBreakDeductions,
  runDayClose,
  register,
  _internals: {
    deductionCopy, pickStars, starCopy, factsFor, templateMessage, vetMessage, dayCloseDue,
  },
};
