// backend/lib/adminActions.js — the CLOSED set of things «لولو الإدارة» may actually DO.
//
// Sibling of lib/adminMetrics.js and built on the same principle. There, the model picks one
// key from a fixed catalogue and this codebase owns every query; here the model picks one
// action id from the registry below and this file owns every write. The blast radius of a bad
// model output is "wrong action PROPOSED", never "arbitrary write" — and a proposal cannot
// execute at all without a second, human step.
//
// ── THE THREE-STEP PROTOCOL, AND WHY EACH STEP EXISTS ──────────────────────────────────────
//
//   1. PROPOSE.  The model returns {action, params} as JSON. That is a suggestion and nothing
//                more. It never reaches the database.
//   2. VALIDATE. THIS FILE re-derives everything. Every id must resolve to a real row, every
//                number must be an integer inside a bound written here, every date must parse
//                and sit in a sane window. A param that fails is NOT repaired by asking the
//                model again — the proposal dies. The model is an untrusted parser of Arabic,
//                not a source of values.
//   3. CONFIRM.  The validated proposal is HMAC-signed (adminId + action + params + expiry) and
//                shown to the admin as a sentence naming the real subject: not «مدد الموعد»
//                but «مدد آخر موعد لـ ممثل كلية بلاد الرافدين من ٢٦ أيار إلى ٥ حزيران». Only a
//                tap on تأكيد calls /act, and /act re-verifies the signature, the admin identity
//                and the expiry before running anything.
//
// The signature is what makes step 3 real: without it the client could post any {action,
// params} it liked to /act, and the whole validation above would be advisory. Signing means the
// only proposals that can execute are ones this server built and this admin was shown. No
// server-side state, same primitive as lib/anonSession.js.
//
// ── WHAT IS PERMANENTLY EXCLUDED, AND WHY ──────────────────────────────────────────────────
// Excluded does not mean invisible: the console still SUGGESTS these and deep-links to the
// screen where a human does them. It means no code path in this file can perform them.
//
//   · ANY approval or rejection of a rep order. HANDOFF ruling 2026-08-14: the ~471 orders in
//     «بانتظار موافقة الممثل» are parked on unresolved student↔rep disputes, and that state is
//     deliberate — it keeps the shop out of an argument it is not party to. An AI touching that
//     queue would take a side in someone else's dispute, the damage is social, and no test,
//     migration or revert would catch or undo it. Not one order, not in bulk, not ever.
//   · EVERY DELETE (order, rep, staff, salary transaction). Not reversible, so it fails the
//     one rule that makes an AI-executable action acceptable.
//   · Passwords and the money-gate secret. An AI must never move a credential.
//   · staff_attendance_settings.verification_mode. Moving it off 'none' while shop_latitude /
//     shop_longitude are NULL 403s every بصمة for every worker on every platform. It is a
//     landmine with an ordering requirement (coordinates first, mode last), not a toggle.
//   · ANYTHING CUSTOMERS SEE — the promo banner, maintenance mode, catalogue copy, prices.
//     This console is the owner's internal instrument. A surface a stranger can read is a
//     different risk class from a surface only the owner reads, and the line is worth keeping
//     bright even though the endpoints themselves are harmless.
//   · Deductions from anyone's pay. Technically reversible (soft-deleted transactions), and
//     deliberately still out: an AI docking an employee's wages on a misparsed Arabic sentence
//     is a category of mistake the shop should not be able to make. Bonuses are in; the
//     asymmetry is the point.

const crypto = require('crypto');
const { query } = require('./db');
const memoCache = require('./memoCache');

// 10 minutes. Long enough to read the confirmation and think about it, short enough that a
// proposal cannot be replayed from a stale tab tomorrow against changed data.
const PROPOSAL_TTL_MS = 10 * 60 * 1000;

const fmtIQD = (n) => `${Number(n || 0).toLocaleString('en-US')} دينار`;

/** Arabic-friendly date, for the confirmation sentence. */
const fmtDate = (d) =>
  new Date(d).toLocaleDateString('ar-IQ', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

// ── Param coercion. Every one of these REJECTS rather than repairs. ─────────────────────────

function intIn(raw, min, max) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function isoDateWithin(raw, maxDaysAhead) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return null;
  const d = new Date(`${raw.trim()}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const days = (d - Date.now()) / 86400000;
  // Must be in the future, and not absurdly so — an AI that reads «باچر» as 2126 should fail
  // loudly here rather than set a goal a century out.
  if (days < -1 || days > maxDaysAhead) return null;
  return d.toISOString();
}

function textAr(raw, max) {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  return t.slice(0, max);
}

async function lookup(sql, params) {
  const { rows } = await query(sql, params);
  return rows[0] || null;
}

// ── THE REGISTRY ───────────────────────────────────────────────────────────────────────────
//
// Each entry:
//   desc      — what the router model sees. One line, Arabic, names the params.
//   params    — the parameter names, for the router prompt.
//   validate  — async (raw) => { ok:true, params, subject, confirm } | { ok:false, error }
//               `subject` is the human name of the thing being changed; `confirm` is the exact
//               sentence the admin agrees to.
//   run       — async (params, admin) => { ok, message } — performs the write.
//   audit     — the audit_log `action` and `entity` this writes.

const ACTIONS = {
  extend_rep_deadline: {
    desc: 'تمديد آخر موعد لممثل جامعة بعدد أيام (params: rep_name, days)',
    params: ['rep_name', 'days'],
    audit: { action: 'ai_extend_deadline', entity: 'wholesaler' },
    async validate(raw) {
      const name = textAr(raw.rep_name, 120);
      if (!name) return { ok: false, error: 'ما حددت أي ممثل' };
      // Forward only, and bounded. "Extend" that could move a deadline backwards is a
      // different, destructive operation wearing the same word.
      const days = intIn(raw.days, 1, 90);
      if (days === null) return { ok: false, error: 'عدد الأيام لازم يكون بين ١ و ٩٠' };

      const rep = await findRep(name);
      if (!rep) return { ok: false, error: `ما لكيت ممثل بهذا الاسم: ${name}` };
      if (rep.ambiguous) {
        return { ok: false, error: `أكثر من ممثل يطابق «${name}» — حدد الاسم بالضبط: ${rep.ambiguous}` };
      }

      const from = rep.deadline ? fmtDate(rep.deadline) : 'بدون موعد';
      const base = rep.deadline ? new Date(rep.deadline) : new Date();
      const to = fmtDate(new Date(base.getTime() + days * 86400000));
      return {
        ok: true,
        params: { wholesaler_id: rep.id, days },
        subject: rep.label,
        confirm: `تمديد آخر موعد لـ «${rep.label}» ${days} يوم — من ${from} إلى ${to}.`,
      };
    },
    async run(p) {
      const row = await lookup(
        `UPDATE wholesalers
            SET deadline = COALESCE(deadline, NOW()) + ($1 || ' days')::interval
          WHERE id = $2
      RETURNING id, deadline`,
        [p.days, p.wholesaler_id]
      );
      if (!row) return { ok: false, message: 'الممثل ما موجود' };
      // ⚠️ joinController caches `join:representatives` (5 min) and `join:<code>` (60s), both
      // keyed off this table. The referral page is where the student READS the deadline they
      // are racing, so skipping this shows them the old date for a minute. adminController's
      // updateDeadline does exactly this for the same reason.
      memoCache.del('join:');
      return { ok: true, message: `تم — آخر موعد صار ${fmtDate(row.deadline)}`, entityId: row.id };
    },
  },

  set_order_cost: {
    desc: 'تحديد كلفة الإنتاج لطلب معيّن (params: order_id, cost)',
    params: ['order_id', 'cost'],
    audit: { action: 'ai_set_order_cost', entity: 'order' },
    async validate(raw) {
      const id = textAr(raw.order_id, 64);
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'رقم الطلب مو صحيح' };
      const cost = intIn(raw.cost, 0, 10_000_000);
      if (cost === null) return { ok: false, error: 'الكلفة لازم تكون بين ٠ و ١٠,٠٠٠,٠٠٠' };

      const order = await lookup(
        `SELECT o.id, o.price, o.cost, u.name AS student_name, p.name AS product_name
           FROM orders o
           LEFT JOIN users u ON u.id = o.student_id
           LEFT JOIN products p ON p.id = o.product_id
          WHERE o.id = $1`,
        [id]
      );
      if (!order) return { ok: false, error: 'الطلب ما موجود' };

      const subject = `${order.student_name || 'طالب'} — ${order.product_name || 'قطعة'}`;
      const was = order.cost == null ? 'غير محددة' : fmtIQD(order.cost);
      return {
        ok: true,
        params: { order_id: order.id, cost },
        subject,
        confirm: `تغيير كلفة «${subject}» من ${was} إلى ${fmtIQD(cost)} (السعر ${fmtIQD(order.price)}).`,
      };
    },
    async run(p) {
      const row = await lookup(`UPDATE orders SET cost = $1 WHERE id = $2 RETURNING id, cost, profit`, [
        p.cost,
        p.order_id,
      ]);
      if (!row) return { ok: false, message: 'الطلب ما موجود' };
      return { ok: true, message: `تم — الكلفة ${fmtIQD(row.cost)}، الربح ${fmtIQD(row.profit)}`, entityId: row.id };
    },
  },

  approve_break: {
    desc: 'الموافقة على طلب خروج مؤقت لموظف (params: staff_name)',
    params: ['staff_name'],
    audit: { action: 'ai_approve_break', entity: 'attendance_break' },
    async validate(raw) {
      const b = await findPendingBreak(raw.staff_name);
      if (b.error) return { ok: false, error: b.error };
      return {
        ok: true,
        params: { break_id: b.row.id },
        subject: b.row.name,
        confirm: `الموافقة على خروج «${b.row.name}» المؤقت${b.row.reason_ar ? ` (${b.row.reason_ar})` : ''}.`,
      };
    },
    async run(p, admin) {
      const row = await lookup(
        `UPDATE staff_attendance_breaks
            SET approval = 'approved', decided_by = $1, decided_at = NOW(), updated_at = NOW()
          WHERE id = $2 AND approval = 'pending' AND state <> 'cancelled'
      RETURNING id`,
        [admin.id, p.break_id]
      );
      // A break the worker cancelled, or that another admin already decided, between the
      // proposal and the tap. Not an error — a race, and the honest answer is that it is gone.
      if (!row) return { ok: false, message: 'الطلب انلغى أو انبتّ بيه قبل شوية' };
      return { ok: true, message: 'تمت الموافقة', entityId: row.id };
    },
  },

  reject_break: {
    desc: 'رفض طلب خروج مؤقت لموظف (params: staff_name, reason_ar)',
    params: ['staff_name', 'reason_ar'],
    audit: { action: 'ai_reject_break', entity: 'attendance_break' },
    async validate(raw) {
      const b = await findPendingBreak(raw.staff_name);
      if (b.error) return { ok: false, error: b.error };
      const reason = textAr(raw.reason_ar, 200);
      return {
        ok: true,
        params: { break_id: b.row.id, reason_ar: reason },
        subject: b.row.name,
        confirm: `رفض خروج «${b.row.name}» المؤقت${reason ? ` — السبب: ${reason}` : ''}.`,
      };
    },
    async run(p, admin) {
      const row = await lookup(
        `UPDATE staff_attendance_breaks
            SET approval = 'rejected', decided_by = $1, decided_at = NOW(),
                decision_note_ar = $2, updated_at = NOW()
          WHERE id = $3 AND approval = 'pending' AND state <> 'cancelled'
      RETURNING id`,
        [admin.id, p.reason_ar, p.break_id]
      );
      if (!row) return { ok: false, message: 'الطلب انلغى أو انبتّ بيه قبل شوية' };
      return { ok: true, message: 'تم الرفض', entityId: row.id };
    },
  },

  add_staff_bonus: {
    desc: 'إضافة مكافأة لموظف (params: staff_name, amount, reason_ar)',
    params: ['staff_name', 'amount', 'reason_ar'],
    audit: { action: 'ai_add_bonus', entity: 'staff_salary' },
    async validate(raw) {
      const staff = await findStaff(raw.staff_name);
      if (staff.error) return { ok: false, error: staff.error };
      // Ceiling is this file's, not the endpoint's — the manual screen may pay any amount, and
      // an AI reading «انطيه مليون» from a misheard sentence should not be able to.
      const amount = intIn(raw.amount, 1000, 1_000_000);
      if (amount === null) return { ok: false, error: 'المكافأة لازم تكون بين ١,٠٠٠ و ١,٠٠٠,٠٠٠ دينار' };
      const reason = textAr(raw.reason_ar, 200);
      return {
        ok: true,
        params: { user_id: staff.row.id, amount, reason_ar: reason },
        subject: staff.row.name,
        confirm: `إضافة مكافأة ${fmtIQD(amount)} لـ «${staff.row.name}»${reason ? ` — ${reason}` : ''}.`,
      };
    },
    async run(p, admin) {
      const row = await lookup(
        `INSERT INTO staff_salary_transactions (user_id, type, amount, reason_ar, source_type, created_by)
         VALUES ($1, 'bonus', $2, $3, 'manual', $4) RETURNING id`,
        [p.user_id, p.amount, p.reason_ar, admin.id]
      );
      return { ok: true, message: `تمت إضافة ${fmtIQD(p.amount)}`, entityId: row.id };
    },
  },

  set_staff_goal: {
    desc: 'وضع هدف إنتاج لموظف مع مكافأة وموعد (params: staff_name, target_count, bonus_amount, deadline)',
    params: ['staff_name', 'target_count', 'bonus_amount', 'deadline'],
    audit: { action: 'ai_set_goal', entity: 'staff_goal' },
    async validate(raw) {
      const staff = await findStaff(raw.staff_name);
      if (staff.error) return { ok: false, error: staff.error };
      const target = intIn(raw.target_count, 1, 1000);
      if (target === null) return { ok: false, error: 'عدد القطع لازم يكون بين ١ و ١٠٠٠' };
      const bonus = intIn(raw.bonus_amount ?? 0, 0, 1_000_000);
      if (bonus === null) return { ok: false, error: 'المكافأة لازم تكون بين ٠ و ١,٠٠٠,٠٠٠' };
      const deadline = isoDateWithin(raw.deadline, 365);
      if (!deadline) return { ok: false, error: 'الموعد لازم يكون تاريخ قادم خلال سنة' };
      return {
        ok: true,
        params: { user_id: staff.row.id, target_count: target, bonus_amount: bonus, deadline },
        subject: staff.row.name,
        confirm:
          `هدف لـ «${staff.row.name}»: ${target} قطعة قبل ${fmtDate(deadline)}` +
          `${bonus ? ` مقابل مكافأة ${fmtIQD(bonus)}` : ' بدون مكافأة'}.`,
      };
    },
    async run(p, admin) {
      const row = await lookup(
        `INSERT INTO staff_goals (user_id, target_count, bonus_amount, deadline, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [p.user_id, p.target_count, p.bonus_amount, p.deadline, admin.id]
      );
      return { ok: true, message: 'تم وضع الهدف', entityId: row.id };
    },
  },
};

// ── Subject resolution ─────────────────────────────────────────────────────────────────────
//
// The model hands us a NAME, because that is what the owner typed. Turning a name into an id is
// this file's job, and it refuses on ambiguity rather than guessing: the shop has one university
// spelled three ways («بلاد الرافدين» · «بلاد الرفدين» · «كلية بلاد الرافدين», HANDOFF owner
// action 7), so a silent "closest match" would eventually extend the wrong rep's deadline.

async function findRep(name) {
  const { rows } = await query(
    `SELECT w.id, w.deadline, u.name,
            COALESCE(NULLIF(w.university_name, ''), u.name) AS label
       FROM wholesalers w
       JOIN users u ON u.id = w.user_id
      WHERE u.name ILIKE $1 OR w.university_name ILIKE $1
      LIMIT 5`,
    [`%${name}%`]
  );
  if (!rows.length) return null;
  if (rows.length > 1) return { ambiguous: rows.map((r) => r.label).join(' · ') };
  return rows[0];
}

async function findStaff(name) {
  const n = textAr(name, 120);
  if (!n) return { error: 'ما حددت أي موظف' };
  const { rows } = await query(
    `SELECT id, name FROM users
      WHERE role = 'staff' AND deleted_at IS NULL AND name ILIKE $1
      LIMIT 5`,
    [`%${n}%`]
  );
  if (!rows.length) return { error: `ما لكيت موظف بهذا الاسم: ${n}` };
  if (rows.length > 1) {
    return { error: `أكثر من موظف يطابق «${n}»: ${rows.map((r) => r.name).join(' · ')}` };
  }
  return { row: rows[0] };
}

async function findPendingBreak(name) {
  const n = textAr(name, 120);
  if (!n) return { error: 'ما حددت أي موظف' };
  const { rows } = await query(
    `SELECT b.id, b.reason_ar, u.name
       FROM staff_attendance_breaks b
       JOIN users u ON u.id = b.user_id
      WHERE b.approval = 'pending' AND b.state <> 'cancelled' AND u.name ILIKE $1
      ORDER BY b.requested_at DESC
      LIMIT 5`,
    [`%${n}%`]
  );
  if (!rows.length) return { error: `ماكو طلب خروج معلّق لـ «${n}»` };
  if (rows.length > 1) return { error: `«${n}»عنده أكثر من طلب معلّق — قرره من صفحة البصمة` };
  return { row: rows[0] };
}

// ── The signed proposal ────────────────────────────────────────────────────────────────────

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not set — admin action proposals cannot be signed');
  return s;
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');

/**
 * Sign a VALIDATED proposal. The payload carries the admin's id so a token minted for one
 * admin cannot be replayed by another, and an expiry so a stale tab cannot fire it tomorrow.
 */
function signProposal({ adminId, action, params }) {
  const payload = b64(JSON.stringify({ adminId, action, params, exp: Date.now() + PROPOSAL_TTL_MS }));
  const sig = b64(crypto.createHmac('sha256', secret()).update(payload).digest());
  return `${payload}.${sig}`;
}

/**
 * Verify and decode. Returns { ok:true, action, params } or { ok:false, error }.
 * Timing-safe comparison, because the signature is the entire authorisation here.
 */
function verifyProposal(token, adminId) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return { ok: false, error: 'الطلب مو صالح' };
  const [payload, sig] = parts;

  const expected = b64(crypto.createHmac('sha256', secret()).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'الطلب مو صالح' };
  }

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, error: 'الطلب مو صالح' };
  }

  if (!decoded || decoded.adminId !== adminId) return { ok: false, error: 'الطلب مو صالح' };
  if (!ACTIONS[decoded.action]) return { ok: false, error: 'الطلب مو صالح' };
  if (!(Number(decoded.exp) > Date.now())) return { ok: false, error: 'انتهت صلاحية الطلب، اسأل مرة ثانية' };

  return { ok: true, action: decoded.action, params: decoded.params };
}

/** The action list, as the router model sees it. */
function catalogForPrompt() {
  return Object.entries(ACTIONS)
    .map(([key, a]) => `- ${key}: ${a.desc}`)
    .join('\n');
}

/**
 * Validate a raw model proposal and, if it holds up, sign it.
 * Returns { ok:true, proposal } | { ok:false, error }.
 */
async function propose(actionId, rawParams, admin) {
  const action = ACTIONS[actionId];
  if (!action) return { ok: false, error: 'ما أكدر أسوي هذا الشي' };

  const v = await action.validate(rawParams || {});
  if (!v.ok) return { ok: false, error: v.error };

  return {
    ok: true,
    proposal: {
      action: actionId,
      label: action.desc.split(' (')[0],
      subject: v.subject,
      confirm: v.confirm,
      token: signProposal({ adminId: admin.id, action: actionId, params: v.params }),
      expires_in_ms: PROPOSAL_TTL_MS,
    },
  };
}

/** Execute a verified proposal and write the audit row. */
async function execute(actionId, params, admin) {
  const action = ACTIONS[actionId];
  if (!action) return { ok: false, message: 'ما أكدر أسوي هذا الشي' };

  const result = await action.run(params, admin);

  // Audit only what actually happened. A no-op race (the break already decided) writes nothing,
  // because an audit trail that records attempts as changes is worse than none.
  //
  // ⚠️ audit_log.entity_id is UUID NOT NULL, so an action that succeeds without returning one
  // would write nothing and — because this insert is deliberately non-fatal — do it silently.
  // Every run() above returns entityId; this makes a future one that forgets fail loudly in
  // the log instead of quietly losing the trail for a real write.
  if (result.ok && !result.entityId) {
    console.error(`admin action ${actionId} succeeded with no entityId — NOT AUDITED`);
  }
  if (result.ok && result.entityId) {
    await query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        admin.id,
        action.audit.action,
        action.audit.entity,
        result.entityId,
        JSON.stringify({ via: 'admin_ai_console', params }),
      ]
    ).catch((e) => console.error('admin action audit failed:', e.message));
  }

  return result;
}

module.exports = {
  ACTIONS,
  catalogForPrompt,
  propose,
  execute,
  verifyProposal,
  PROPOSAL_TTL_MS,
  _internals: { signProposal, intIn, isoDateWithin, findRep, findStaff, findPendingBreak },
};
