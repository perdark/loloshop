// backend/lib/supportContext.js — builds the facts the support chatbot is allowed to state.
//
// WHY NO TOOL-CALLING: a $0.04/1,000-messages model is not reliable at multi-step tool loops,
// and letting any model near ad-hoc SQL on this database is a security hole (there is no RLS
// here — every guard is application-side). So the server fetches the asker's own row set up
// front with hand-written, parameterised queries scoped to their user_id, and the model's only
// job is to phrase it in Arabic. One API call, no loop, nothing the model can reach that the
// student could not already see on /track.
//
// The context is per-user and never shared: everything below is keyed on the authenticated
// user_id, so one student's prompt can never contain another student's order.

const { query } = require('./db');

// Mirrors frontend/lib/constants.ts ORDER_STATUS_LABELS. Duplicated rather than imported
// because backend and frontend share no package (see CLAUDE.md → Architecture). If a status
// is added to the enum, add it in BOTH places — an unmapped status falls back to the raw
// value, which is ugly but never wrong.
const STATUS_AR = {
  pending_approval: 'بانتظار موافقة ممثل الجامعة',
  designing: 'قيد التصميم',
  design_complete: 'بانتظار التصميم',
  converting: 'تحويل التصميم لتطريز',
  staff_review: 'مراجعة الموظف',
  printing: 'قيد الطباعة',
  embroidery: 'قيد التطريز',
  pressing: 'قيد الكوي',
  preparing: 'قيد التجهيز',
  ready: 'جاهز للاستلام',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
};

const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const fmtIQD = (n) => `${Number(n || 0).toLocaleString('en-US')} دينار`;

/**
 * Turn one profile row + their orders into the fact block the model is allowed to phrase.
 * Pure — no database — so the rules that matter (bundle prices, the deadline label) are
 * testable without seeding an order. See test/aiChat.test.js.
 */
function formatContext(p, orders = []) {
  const lines = [];
  lines.push(`- اسم الزبون: ${p.full_name_third || p.user_name || 'غير معروف'}`);
  if (p.university_name) lines.push(`- الجامعة/الكلية: ${p.university_name}`);
  if (p.department) lines.push(`- القسم: ${p.department}`);

  if (p.rep_name) {
    lines.push(`- ممثل الجامعة: ${p.rep_name}${p.rep_phone ? ` (رقمه ${p.rep_phone})` : ''}`);
  } else {
    lines.push('- ما عنده ممثل جامعة (زبون تجزئة)');
  }

  if (p.rep_deadline) {
    // Labelled unambiguously: in live testing every model tried to reuse this as a delivery
    // date. The system prompt forbids that too — belt and braces, because a wrong delivery
    // promise is the one hallucination that costs the shop real money.
    lines.push(`- آخر موعد لتقديم الطلبات (مو موعد تسليم): ${fmtDate(p.rep_deadline)}`);
  }

  if (p.student_status === 'pending_approval') {
    lines.push('- حسابه لسه بانتظار موافقة ممثل الجامعة');
  }

  if (!orders.length) {
    lines.push('- ماكو طلبات مسجّلة لهذا الزبون');
  } else {
    lines.push(`- عدد طلباته: ${orders.length}`);
    orders.forEach((o, i) => {
      const status = STATUS_AR[o.status] || o.status;
      const delivered = o.delivered_at ? ` — تسلّمه بتاريخ ${fmtDate(o.delivered_at)}` : '';
      // price = 0 does NOT mean free: bundle lines carry the whole bundle's price on one
      // row and 0 on the rest (see checkout_groups). Stating "0 دينار" would tell a student
      // their robe is free, so the price is omitted and the bot is told to redirect instead.
      const price = Number(o.price) > 0 ? ` — السعر: ${fmtIQD(o.price)}` : ' — السعر ضمن طلب مشترك';
      lines.push(`  ${i + 1}. "${o.product_name}" — الحالة: ${status}${price}${delivered}`);
    });
  }

  return lines.join('\n');
}

/**
 * Everything the bot may say to this user, as plain text.
 * Returns null for a signed-out visitor — they get the generic FAQ-only prompt.
 */
async function forUser(userId) {
  if (!userId) return null;

  const { rows: profile } = await query(
    `SELECT u.name                AS user_name,
            s.id                  AS student_id,
            s.full_name_third,
            s.university_name,
            s.department,
            s.status              AS student_status,
            w.deadline            AS rep_deadline,
            wu.name               AS rep_name,
            wu.phone              AS rep_phone
       FROM users u
       LEFT JOIN students    s  ON s.user_id = u.id
       LEFT JOIN wholesalers w  ON w.id = s.wholesaler_id
       LEFT JOIN users       wu ON wu.id = w.user_id
      WHERE u.id = $1`,
    [userId]
  );
  if (!profile.length) return null;
  const p = profile[0];

  // Orders are read through students.user_id, so this can only ever return the caller's own.
  const { rows: orders } = p.student_id
    ? await query(
        `SELECT o.status, o.price, o.created_at, o.delivered_at, pr.name_ar AS product_name
           FROM orders o
           JOIN products pr ON pr.id = o.product_id
          WHERE o.student_id = $1 AND o.status <> 'cancelled'
          ORDER BY o.created_at DESC
          LIMIT 10`,
        [p.student_id]
      )
    : { rows: [] };

  return formatContext(p, orders);
}

module.exports = { forUser, STATUS_AR, formatContext };
