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
const memoCache = require('./memoCache');

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

const TYPE_AR = {
  sash: 'وشاح تخرج',
  robe: 'روب تخرج',
  cap: 'قبعة تخرج',
  shawl: 'شال',
};

/**
 * Format a per-type price summary. Pure, so the «starts from» wording is testable.
 *
 * Ranges, not a product list: the catalogue is dozens of rows and would dominate the prompt
 * (and the bill) while adding nothing — «شكد سعر الروب؟» wants a number, not an inventory.
 * A range also cannot go stale per product the way a hand-written FAQ answer does.
 */
function formatPriceBook(rows, packages = []) {
  if (!rows.length) return null;
  const lines = rows
    .filter((r) => TYPE_AR[r.type])
    .map((r) => {
      const min = Number(r.min_price || 0);
      const max = Number(r.max_price || 0);
      // base_price is the STARTING price — options add to it — so every line says «يبدأ من».
      // Stating a flat price here would be a quote the checkout does not honour.
      return min === max
        ? `- ${TYPE_AR[r.type]}: يبدأ من ${fmtIQD(min)}`
        : `- ${TYPE_AR[r.type]}: يبدأ من ${fmtIQD(min)} (وأغلى موديل ${fmtIQD(max)})`;
    });

  for (const p of packages) {
    lines.push(`- ${p.name_ar} (طقم كامل): ${fmtIQD(p.price)}`);
  }
  if (!lines.length) return null;

  return [
    'قائمة الأسعار (أسعار البداية):',
    ...lines,
    'ملاحظة: هذي أسعار البداية، والسعر النهائي يعتمد على التفاصيل والإضافات اللي يختارها الزبون.',
  ].join('\n');
}

/**
 * The prices this audience is actually shown on the storefront.
 *
 * Mirrors buildShopFeed (controllers/catalogController.js) on BOTH axes, and must keep doing
 * so: the audience filter (`wholesaler_only` / `retail_only`) and the per-role price override
 * in product_price_roles. A rep-linked student pays wholesaler prices, so quoting them the
 * retail book would be a wrong number from the shop's own assistant — worse than no answer.
 *
 * Cached 5 minutes per role: it is identical for every anonymous visitor, and the shop's price
 * list does not change between two messages of one conversation.
 */
async function priceBook(role = 'retail') {
  const audienceFilter =
    role === 'wholesaler' ? 'AND p.retail_only = FALSE' : 'AND p.wholesaler_only = FALSE';

  return memoCache.wrap(`ai:pricebook:${role}`, 5 * 60 * 1000, async () => {
    const { rows } = await query(
      `SELECT p.type::text AS type,
              MIN(COALESCE(ppr.base_price, p.base_price))::bigint AS min_price,
              MAX(COALESCE(ppr.base_price, p.base_price))::bigint AS max_price
         FROM products p
         LEFT JOIN product_price_roles ppr ON ppr.product_id = p.id AND ppr.role = $1
        WHERE p.active = TRUE
          ${audienceFilter}
          -- Parents whose children are active are not orderable themselves; the child rows
          -- carry the real prices. Same exclusion the feed makes.
          AND NOT EXISTS (SELECT 1 FROM products c WHERE c.parent_id = p.id AND c.active = TRUE)
          AND COALESCE(ppr.base_price, p.base_price) > 0
        GROUP BY p.type`,
      [role]
    );

    // «طقم كامل» is a retail storefront entity with its own flat price, not a product row.
    const { rows: packages } =
      role === 'wholesaler'
        ? { rows: [] }
        : await query(
            `SELECT name_ar, price FROM packages
              WHERE active = TRUE AND role = 'retail' AND is_full_set = TRUE
              ORDER BY sort, created_at LIMIT 4`
          );

    return formatPriceBook(rows, packages);
  });
}

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
 * Everything the bot may say to this user.
 *
 * Returns `{ block, priceRole }` — the facts, plus which price book this person is actually
 * shown, because a rep-linked student pays wholesaler prices and quoting them the retail
 * number would be the shop's own assistant giving a wrong price.
 * Returns null for a signed-out visitor; they get the generic prompt and the retail book.
 */
async function forUser(userId) {
  if (!userId) return null;

  const { rows: profile } = await query(
    `SELECT u.name                AS user_name,
            s.id                  AS student_id,
            s.wholesaler_id,
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

  // Same rule as catalogController.priceRoleForUser: a student linked to a rep genuinely is a
  // wholesaler-priced customer. Derived from the profile row we already have, not re-queried.
  return { block: formatContext(p, orders), priceRole: p.wholesaler_id ? 'wholesaler' : 'retail' };
}

module.exports = { forUser, priceBook, STATUS_AR, formatContext, formatPriceBook, TYPE_AR };
