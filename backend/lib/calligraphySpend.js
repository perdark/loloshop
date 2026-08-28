// backend/lib/calligraphySpend.js — the calligraphy generator's daily money bound.
//
// Until 2026-08-18 the feature had NO daily ceiling: REROLL_LIMIT bounds one plate, nothing
// bounded a day, and the prod audit found $40.53 spent in the first 17 days of August with
// nobody told. This mirrors the assistant's shape (lib/aiChat.js): a ledger row per paid
// image, a 24h rolling-sum ceiling checked BEFORE the money leaves, and one admin
// notification (→ phone push via the outbox) when the warn line is crossed.
//
// cost_usd on calligraphy_plates cannot serve as this ledger: a reroll adds money to a row
// created weeks earlier (so "today's plates" misses it), and the element endpoint stored its
// cost nowhere at all. calligraphy_spend_log (migration 082) records every paid image at the
// moment it is paid, whatever bought it.
//
// Env (read per call so a pm2 --update-env restart is enough):
//   CALLIG_DAILY_USD_MAX  — hard ceiling, default $10/day. Past it generation returns 429;
//                           batch plates stay PENDING so pg-boss simply retries after the
//                           window instead of failing work.
//   CALLIG_DAILY_USD_WARN — admin warning line, default $5/day.
const { query } = require('./db');

const DEFAULT_MAX_USD = 10;
const DEFAULT_WARN_USD = 5;

function caps() {
  const max = Number(process.env.CALLIG_DAILY_USD_MAX);
  const warn = Number(process.env.CALLIG_DAILY_USD_WARN);
  return {
    maxUsd: Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX_USD,
    warnUsd: Number.isFinite(warn) && warn > 0 ? warn : DEFAULT_WARN_USD,
  };
}

async function spentLast24h() {
  const { rows } = await query(
    `SELECT COALESCE(SUM(cost_usd), 0) AS spent
       FROM calligraphy_spend_log
      WHERE created_at > NOW() - INTERVAL '24 hours'`);
  return Number(rows[0].spent || 0);
}

/**
 * May the next paid image be bought? Returns { allowed, spent, maxUsd } and fires the admin
 * warning (not awaited — the caller is holding a designer or a worker slot).
 */
async function checkBudget() {
  const { maxUsd, warnUsd } = caps();
  const spent = await spentLast24h();
  maybeWarnSpend(spent, { warnUsd, maxUsd }).catch(() => {});
  return { allowed: spent < maxUsd, spent, maxUsd };
}

/** The tagged 429 every generation path returns when the ceiling is hit. */
function budgetError({ spent, maxUsd }) {
  return {
    status: 429,
    code: 'ERR_CALLIG_BUDGET',
    message: `تم بلوغ سقف الإنفاق اليومي لتوليد الخط (${maxUsd.toFixed(2)}$) — يُستأنف التوليد تلقائياً بعد انتهاء الفترة، أو ارفع CALLIG_DAILY_USD_MAX`,
  };
}

/** Record one paid image. Best-effort: a ledger failure must never fail the paid request. */
async function logSpend(kind, costUsd) {
  try {
    await query(`INSERT INTO calligraphy_spend_log (kind, cost_usd) VALUES ($1, $2)`,
      [kind, Number(costUsd || 0)]);
  } catch (e) {
    console.error('calligraphySpend logSpend failed (generation unaffected):', e.message);
  }
}

// In-process guard so a busy day does not run the dedupe query on every image.
let warnMemoUntil = 0;

async function maybeWarnSpend(spent, { warnUsd, maxUsd } = caps()) {
  if (!warnUsd || Number(spent || 0) < warnUsd) return;
  if (Date.now() < warnMemoUntil) return;
  try {
    // NOT EXISTS makes the once-per-24h rule survive a restart, which the memo cannot.
    const { rowCount } = await query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       SELECT u.id, 'calligraphy_budget_warning', $1, $2, '/admin/calligraphy'
         FROM users u
        WHERE u.role = 'admin' AND u.deleted_at IS NULL
          AND NOT EXISTS (
                SELECT 1 FROM notifications
                 WHERE type = 'calligraphy_budget_warning'
                   AND created_at > NOW() - INTERVAL '24 hours')`,
      [
        'تنبيه: كلفة توليد الخط',
        `صرف مولّد الخط ${Number(spent).toFixed(2)}$ خلال آخر 24 ساعة، والحد الأقصى ${maxUsd}$. `
          + 'راجع الاستهلاك — إعادة التوليد المتكررة والأوراق غير الممتلئة هي المُكلف عادة.',
      ]
    );
    if (rowCount > 0) console.warn(`calligraphy: DAILY SPEND WARNING — $${Number(spent).toFixed(4)} in 24h`);
    warnMemoUntil = Date.now() + 60 * 60 * 1000;
  } catch (e) {
    console.error('calligraphy spend warning failed:', e.message);
  }
}

// In-process guard, same shape as the spend warning's.
let creditMemoUntil = 0;

/**
 * OpenRouter answered 402 — the ACCOUNT is out of money, which is a different event from this
 * file's own ceiling and needs the opposite reaction. The ceiling is the shop choosing to stop
 * (raise it, or wait for the window); a 402 is generation being off until a human buys credit,
 * and nothing in the app can clear it.
 *
 * Added 2026-08-28: on that day generation died at 17:49, nine plates were marked failed, and
 * the owner found out by asking. The 402 was logged to a file on the server and reached nobody.
 * Dedupe is 6h, not the warning's 24h — this one is actionable and the shop is down until it
 * is acted on. Best-effort: never let telling the admin break the caller's own error path.
 */
async function notifyCreditExhausted() {
  if (Date.now() < creditMemoUntil) return;
  try {
    const { rowCount } = await query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       SELECT u.id, 'calligraphy_credit_exhausted', $1, $2, '/admin/calligraphy'
         FROM users u
        WHERE u.role = 'admin' AND u.deleted_at IS NULL
          AND NOT EXISTS (
                SELECT 1 FROM notifications
                 WHERE type = 'calligraphy_credit_exhausted'
                   AND created_at > NOW() - INTERVAL '6 hours')`,
      [
        'توقف توليد الخط: انتهى الرصيد',
        'رفض OpenRouter الطلب لانتهاء الرصيد، وتوليد الخط متوقف الآن. الأسماء المعلّقة محفوظة '
          + 'وتُولَّد تلقائياً بعد إضافة الرصيد — لا حاجة لإعادة إدخالها.',
      ]
    );
    if (rowCount > 0) console.error('calligraphy: OPENROUTER CREDIT EXHAUSTED — admins notified');
    creditMemoUntil = Date.now() + 30 * 60 * 1000;
  } catch (e) {
    console.error('calligraphy credit notification failed:', e.message);
  }
}

module.exports = {
  checkBudget, budgetError, logSpend, maybeWarnSpend, spentLast24h, notifyCreditExhausted,
};
