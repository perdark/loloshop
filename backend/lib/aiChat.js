// backend/lib/aiChat.js — text-completion sibling of lib/openrouter.js (which is images only).
//
// Shares OPENROUTER_API_KEY with the calligraphy engine and adds ZERO npm packages, on purpose:
// CI runs `npm audit --omit=dev --audit-level=moderate` before deploying, so any new dependency
// carrying an advisory blocks the whole deploy. Node 20's global fetch is enough. Same reasoning
// as backend/lib/push.js — keep it that way.
//
// MODEL CHOICE — live-tested 2026-08-10 against four candidates on real Iraqi-Arabic support
// questions with real order context:
//   google/gemini-2.5-flash-lite  ✅ 605–848ms, $0.04/1,000 msgs, correct, refused what it
//                                    didn't know instead of inventing it. CHOSEN.
//   google/gemini-3.1-flash-lite  ✅ also clean, but 4× the cost and an 11s outlier.
//   openai/gpt-oss-120b           ❌ HALLUCINATED a delivery promise ("راح نوصلّه قبل آخر
//                                    موعد") out of the order deadline. Never use for support.
//   qwen/qwen3.7-flash            ❌ returned empty content + upstream 429.
// Re-run scratchpad ar-model-test.js before swapping AI_CHAT_MODEL — a cheap model that reads
// fluently can still invent delivery dates, and that is the failure that costs the shop money.
//
// ── THE CAP PROTOCOL: RESERVE → CALL → SETTLE ────────────────────────────────────────────
// The ledger row is written BEFORE the model call, not after. The obvious ordering (count,
// call, then log) leaves the whole model latency — ~700ms — between the check and the write,
// so N concurrent requests all read the same count and all pass. That is not a theoretical
// race: it is one `for` loop, and it defeats the per-user cap AND the daily USD ceiling.
//
// So `reserve()` counts and inserts inside ONE transaction holding a per-caller advisory lock,
// and `settle()` fills in the answer and the real cost afterwards. Two consequences worth
// knowing:
//   · a call that crashes mid-flight still leaves its row, so it still counts against the
//     caller — a retry storm cannot be free (this also removes the old failure mode where a
//     ledger write error silently made every cap under-count);
//   · the lock is held only for the count+insert, never across the network call.

const { query, tx } = require('./db');
const memoCache = require('./memoCache');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';

// Cost caps. Owner decision 2026-08-12, revising the 2026-08-10 "tight" stance against the
// measured price: 16 real conversations cost $0.00164, i.e. ~$0.0001 per message. The old
// $1/day ceiling was therefore ~9,700 messages/day for a shop with 1,141 registered students
// — never a budget, only an abuse backstop. What actually bit was the per-person counts, and
// those are the ones a real student feels. So the ceiling went up and the counts went up with
// it. All overridable by env so the owner can move them without a deploy.
const CAPS = {
  // ── NO PER-PERSON DAILY QUOTA. Owner decision 2026-08-12, and it makes the system safer,
  // not laxer. The old 30/day and 10/day counts were keyed on an identity the CLIENT chose,
  // so anyone willing to rotate it was never bounded — measured: 25 requests with 25 fresh
  // keys, all granted. A quota that only the honest obey is worse than none, because it
  // spends its whole budget of user goodwill on people who were never the threat. The
  // assistant is also the shop's main marketing surface now, and telling a curious customer
  // «وصلت للحد اليومي» is the single worst sentence it could say.
  //
  // What bounds abuse instead, in order: an identity the SERVER signs (lib/anonSession.js),
  // the burst throttle below, free repetition via the response cache, and the daily USD
  // ceiling that does not care who you are.

  // ── BURST THROTTLE — the quota's replacement. A quota asks "how much have you had today";
  // this asks "are you a person". Nobody types ten questions in a minute, so a real student
  // never meets it no matter how much they use the assistant, while a loop trips in seconds.
  // Cache hits are excluded (they never reach here), so asking the same thing repeatedly is
  // free and never throttled — flooding one string is pointless rather than expensive.
  burstPerMinute: Number(process.env.AI_CHAT_BURST_PER_MIN || 10),
  burstPer5Min: Number(process.env.AI_CHAT_BURST_PER_5MIN || 40),
  // Whole-shop ceiling per rolling 24h, in USD. The backstop that makes every other cap
  // optional: even total failure of the per-user logic cannot bill more than this per day.
  globalUsdPerDay: Number(process.env.AI_CHAT_DAILY_USD_MAX || 3.0),
  // Tell the owner LONG before the wall. At ~$0.0001/message, $1 in a day is ~10,000 messages
  // — roughly 30× a normal day, so crossing it means something is wrong (a script, a loop, a
  // model that repriced) and the owner has two thirds of the budget left to react in. Without
  // this the first signal is the assistant going dark. Set to 0 to switch the warning off.
  warnUsdPerDay: Number(process.env.AI_CHAT_DAILY_USD_WARN || 1.0),
  // The slice of that ceiling ANONYMOUS traffic may consume. This is not a cost control —
  // globalUsdPerDay already bounds the bill. It is an AVAILABILITY control.
  //
  // Before the split an exhausted budget refused EVERYONE, signed-in students included, so a
  // stranger could silently switch the assistant off for real customers daily. With it, anon
  // flooding can only ever take its own slice. Sized at 40% of the ceiling: at the per-IP
  // limiter's ceiling of 100 msgs/15min ≈ $0.041/hour, one IP now needs ~29 hours of sustained
  // flooding to drain it — it cannot take the guest assistant down within a day. Cached
  // answers are served before any of this (see supportChatController), so the shop's most
  // common questions keep answering even if it ever does run out.
  anonUsdPerDay: Number(process.env.AI_CHAT_ANON_DAILY_USD_MAX || 1.2),
  // Longest question we will forward. Input is the cheap half, but an unbounded prompt is
  // an unbounded bill — and no genuine support question is 2,000 characters.
  maxQuestionChars: Number(process.env.AI_CHAT_MAX_QUESTION_CHARS || 600),
  // Answers are 2–3 sentences by prompt; this is the hard stop if the model ignores that.
  maxOutputTokens: Number(process.env.AI_CHAT_MAX_OUTPUT_TOKENS || 300),
};

// Fallback pricing, USD per million tokens, used ONLY when OpenRouter reports no cost.
// See estimateCostUsd for why storing a 0 there would be dangerous. These do not need to be
// exact — they are a floor under the spend ceiling, not an invoice.
const FALLBACK_PRICE_PER_MTOK = {
  'google/gemini-2.5-flash-lite': { in: 0.1, out: 0.4 },
  'google/gemini-3.1-flash-lite': { in: 0.4, out: 1.6 },
};
// An unrecognised model is assumed EXPENSIVE on purpose: over-estimating trips the daily
// ceiling early (annoying, recoverable), under-estimating disables it (a bill, not a bug).
const UNKNOWN_MODEL_PRICE = { in: 1.0, out: 3.0 };

function tagged(message, status, code, retryAfterSec) {
  const e = new Error(message);
  e.status = status;
  e.expose = true;
  e.code = code;
  // Only the throttle sets this. The UI uses it to say how long the wait is and to refuse to
  // offer a retry button that cannot possibly work yet.
  if (retryAfterSec) e.retryAfter = retryAfterSec;
  return e;
}

function configured() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/**
 * The spend we record for one call.
 *
 * OpenRouter reports real spend in `usage.cost`, and that is what we store. But if that field
 * is ever absent — a provider that does not report it, a response-shape change, a proxy that
 * strips it — `Number(undefined || 0)` is 0, every row records $0.00, SUM(cost_usd) stays 0
 * forever and the $1/day ceiling silently never fires again. That failure is invisible and
 * points at the bill, so a missing cost falls back to a token estimate instead of to zero.
 */
function estimateCostUsd({ reportedCost, model, promptTokens, completionTokens }) {
  const reported = Number(reportedCost || 0);
  if (reported > 0) return reported;
  if (!promptTokens && !completionTokens) return 0;

  const price = FALLBACK_PRICE_PER_MTOK[model] || UNKNOWN_MODEL_PRICE;
  return (
    (Number(promptTokens || 0) / 1e6) * price.in +
    (Number(completionTokens || 0) / 1e6) * price.out
  );
}

/**
 * Pure cap decision over an already-measured 24h usage window.
 * Split out from the SQL so the boundaries are testable without a database.
 * Returns a tagged error to throw/return, or null when the call is allowed.
 */
function evaluateCaps({ burstMinute, burstWindow, spendToday, anonSpendToday }, { userId, caps = CAPS } = {}) {
  if (Number(spendToday) >= caps.globalUsdPerDay) {
    // Deliberately vague to the user — the shop's daily AI budget is not their business.
    return tagged('المساعد مشغول حالياً، جرّب بعد شوية', 503, 'ERR_AI_BUDGET');
  }
  // Anonymous traffic is bounded by its own slice, so a flood of signed-out requests cannot
  // consume the budget a signed-in student depends on. Signed-in callers skip this entirely.
  if (!userId && Number(anonSpendToday || 0) >= caps.anonUsdPerDay) {
    return tagged('المساعد مشغول حالياً، سجّل دخولك حتى تكدر تسأل', 503, 'ERR_AI_ANON_BUDGET');
  }
  // Burst, both windows. The message is friendly and says the wait is SHORT on purpose: a
  // real person who somehow trips this is mid-conversation, and «جرّب باچر» would end it.
  if (Number(burstMinute) >= caps.burstPerMinute) {
    return tagged('شوية شوية 😅 انطيني دقيقة وارجع اسألني', 429, 'ERR_AI_TOO_FAST', 60);
  }
  if (Number(burstWindow) >= caps.burstPer5Min) {
    return tagged('أسئلتك سريعة كلش! استريح خمس دقائق وارجعلي', 429, 'ERR_AI_TOO_FAST', 300);
  }
  return null;
}

/**
 * Tell the owner the day's AI spend crossed the warning line, once per 24h.
 *
 * The wall is $3; this fires at $1, which at the measured ~$0.0001/message is ~10,000
 * messages — roughly thirty times a normal day. So it is not a "getting busy" notice, it is
 * "something is wrong and you still have two thirds of the budget to react in". Without it
 * the first thing the owner learns is that the assistant went dark.
 *
 * Writing a `notifications` row is the whole delivery mechanism: the push outbox drains
 * pending rows within its 15-minute freshness window (lib/pushOutbox.js), so this reaches the
 * owner's phone without this file knowing anything about FCM or APNs.
 *
 * Fire-and-forget, and never inside reserve()'s transaction: a warning that failed must not
 * roll back a student's answer, and it must not run under the advisory lock.
 */
const WARN_MEMO_KEY = 'ai:spend-warned';
async function maybeWarnSpend(spendToday, caps = CAPS) {
  const spent = Number(spendToday || 0);
  if (!caps.warnUsdPerDay || spent < caps.warnUsdPerDay) return;
  // In-process guard first, so a busy day does not run the dedupe query on every message.
  if (memoCache.get(WARN_MEMO_KEY)) return;

  try {
    // NOT EXISTS makes the once-per-24h rule survive a restart, which the memo cache cannot.
    const { rowCount } = await query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       SELECT u.id, 'ai_budget_warning', $1, $2, '/admin'
         FROM users u
        WHERE u.role = 'admin' AND u.deleted_at IS NULL
          AND NOT EXISTS (
                SELECT 1 FROM notifications
                 WHERE type = 'ai_budget_warning'
                   AND created_at > NOW() - INTERVAL '24 hours')`,
      [
        'تنبيه: كلفة المساعد الذكي',
        `صرف المساعد ${spent.toFixed(2)}$ خلال آخر 24 ساعة، والحد الأقصى ${caps.globalUsdPerDay}$. `
          + 'راجع الاستهلاك — هذا أعلى بكثير من يوم طبيعي.',
      ]
    );
    if (rowCount > 0) console.warn(`aiChat: DAILY SPEND WARNING — $${spent.toFixed(4)} in 24h`);
    memoCache.set(WARN_MEMO_KEY, true, 60 * 60 * 1000);
  } catch (e) {
    console.error('aiChat spend warning failed:', e.message);
  }
}

/**
 * Claim one slot: check the caps and write the pending ledger row atomically.
 *
 * Returns { id } when the call may proceed, or { error } (tagged, ready to return) when a cap
 * is hit. The advisory lock serialises callers that share an allowance, so twenty parallel
 * requests from one student consume twenty slots, not one.
 */
async function reserve({ userId, sessionKey, surface, question, ipHash = null }) {
  // One allowance per identity: a signed-in user is keyed on their id, an anonymous visitor on
  // their session key. Different callers hash to different locks and never block each other.
  const lockKey = userId ? `ai:u:${userId}` : `ai:s:${sessionKey || 'none'}`;
  let spendToday = 0;

  const claim = await tx(async (client) => {
    // Transaction-scoped: released at COMMIT/ROLLBACK, so it cannot outlive this block, and
    // it is safe under PgBouncer transaction pooling (unlike a session-scoped lock).
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [lockKey]);

    // `model <> 'cache'` excludes answers served from the response cache. A cache hit costs
    // nothing, so counting one would make the cache actively worse for the person it exists to
    // help — and it is what makes REPEATING a question free rather than throttled, so flooding
    // one string is pointless instead of expensive. Pending rows (model IS NULL, reserved but
    // not yet settled) must still count, hence the COALESCE.
    //
    // One pass over the 24h window serves both jobs: the burst windows are FILTERs over the
    // same rows the spend totals come from, so the throttle costs no extra query and no extra
    // index. `mine` is repeated rather than joined because a signed-in caller is keyed on
    // their user id and an anonymous one on their signed session id — never both.
    const mine = `(($1::uuid IS NOT NULL AND user_id = $1)
                OR ($1::uuid IS NULL AND user_id IS NULL AND $2::text IS NOT NULL
                    AND session_key = $2))`;
    const { rows } = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE ${mine}
                            AND COALESCE(model, '') <> 'cache'
                            AND created_at > NOW() - INTERVAL '1 minute')   AS burst_minute,
         COUNT(*) FILTER (WHERE ${mine}
                            AND COALESCE(model, '') <> 'cache'
                            AND created_at > NOW() - INTERVAL '5 minutes')  AS burst_window,
         COALESCE(SUM(cost_usd), 0)                                         AS spend_today,
         COALESCE(SUM(cost_usd) FILTER (WHERE user_id IS NULL), 0)          AS anon_spend_today
       FROM ai_chat_messages
       WHERE created_at > NOW() - INTERVAL '24 hours'`,
      [userId || null, sessionKey || null]
    );
    const r = rows[0] || {};
    spendToday = Number(r.spend_today || 0);

    const capError = evaluateCaps(
      {
        burstMinute: r.burst_minute,
        burstWindow: r.burst_window,
        spendToday: r.spend_today,
        anonSpendToday: r.anon_spend_today,
      },
      { userId }
    );
    if (capError) return { error: capError };

    // The row exists from here on. If the request dies before settle(), it stays with a NULL
    // answer and still counts — which is the intended behaviour, not a leak.
    const { rows: ins } = await client.query(
      `INSERT INTO ai_chat_messages (user_id, session_key, surface, question, ip_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [userId || null, sessionKey || null, surface, String(question).slice(0, 2000), ipHash]
    );
    return { id: ins[0].id };
  });

  // After COMMIT, so a warning failure cannot roll back the reservation and no extra work
  // happens under the advisory lock. Not awaited — the student is waiting on an answer.
  maybeWarnSpend(spendToday).catch(() => {});
  return claim;
}

/**
 * Fill in a reserved row once the call has finished (or failed).
 * Best-effort: a settle failure must not fail the user's request. Unlike the old logCall it
 * cannot corrupt the caps — the row that bounds the caller was already written by reserve().
 */
async function settle(id, { answer, intent, result, error } = {}) {
  if (!id) return;
  try {
    await query(
      `UPDATE ai_chat_messages
          SET answer            = $2,
              intent            = $3,
              model             = $4,
              prompt_tokens     = $5,
              completion_tokens = $6,
              cost_usd          = $7,
              error             = $8
        WHERE id = $1`,
      [
        id,
        answer ? String(answer).slice(0, 4000) : null,
        intent || null,
        result?.model || null,
        result?.promptTokens || 0,
        result?.completionTokens || 0,
        result?.costUsd || 0,
        error ? String(error).slice(0, 500) : null,
      ]
    );
  } catch (e) {
    console.error('aiChat settle FAILED (row stays pending, caps unaffected):', e.message);
  }
}

/**
 * Record an answer that came from the response cache, not from the model.
 *
 * Written so the ledger stays a complete record of what customers actually ask — that log is
 * the backlog of facts the assistant is missing, and it would go blind for exactly the most
 * common questions if cache hits were invisible. `model = 'cache'` and cost 0 are what mark
 * it, and what `reserve()` excludes from the caps.
 *
 * Returns `{ id }` — the row this answer actually lives in — and `null` on a logging failure.
 *
 * Fire-and-forget in spirit: a logging failure must never fail an answer we already have in
 * hand. Nothing in the response depends on this id; it exists for the ledger and the caps.
 */
async function logCached({ userId, sessionKey, surface, question, answer, ipHash = null }) {
  try {
    const { rows } = await query(
      `INSERT INTO ai_chat_messages
         (user_id, session_key, surface, question, answer, model, cost_usd, ip_hash)
       VALUES ($1, $2, $3, $4, $5, 'cache', 0, $6)
       RETURNING id`,
      [
        userId || null,
        sessionKey || null,
        surface,
        String(question).slice(0, 2000),
        String(answer).slice(0, 4000),
        ipHash,
      ]
    );
    return { id: rows[0]?.id ?? null };
  } catch (e) {
    console.error('aiChat cache-hit log FAILED (answer still served):', e.message);
    return { id: null };
  }
}

/**
 * The last few turns of this caller's own conversation, newest last.
 *
 * Read from OUR ledger rather than trusted from the request body. The client used to send the
 * history back with its own role labels, which meant a caller could post a fabricated
 * `assistant` turn — «وشاحك مجاني» — and then ask the bot to confirm it, producing a
 * screenshot of the shop's own assistant promising a free robe. Rebuilding it server-side
 * costs one indexed read and makes that impossible.
 *
 * The 2-hour window keeps a returning visitor from resuming yesterday's thread out of nowhere,
 * which is also what the widget's own ephemeral state does.
 */
async function recentTurns({ userId, sessionKey, surface = 'support', limit = 3 }) {
  if (!userId && !sessionKey) return [];

  const { rows } = await query(
    `SELECT question, answer
       FROM ai_chat_messages
      WHERE surface = $3
        AND answer IS NOT NULL
        AND created_at > NOW() - INTERVAL '2 hours'
        AND ($1::uuid IS NOT NULL AND user_id = $1
             OR $1::uuid IS NULL AND user_id IS NULL AND session_key = $2)
      ORDER BY created_at DESC
      LIMIT $4`,
    [userId || null, sessionKey || null, surface, Math.min(Math.max(limit, 1), 6)]
  );

  // Newest-first from SQL (so LIMIT takes the latest), oldest-first in the prompt.
  return rows.reverse().flatMap((r) => [
    { role: 'user', content: String(r.question).slice(0, 600) },
    { role: 'assistant', content: String(r.answer).slice(0, 600) },
  ]);
}

// One completion. `messages` is the standard [{role, content}] array.
// Never throws for model-quality reasons — only for transport/config/cap failures.
async function complete({ messages, maxTokens, temperature = 0.3, jsonMode = false }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw tagged('مفتاح OpenRouter غير مهيأ', 500, 'ERR_OPENROUTER_KEY');

  const model = process.env.AI_CHAT_MODEL || DEFAULT_MODEL;
  const body = {
    model,
    messages,
    max_tokens: Math.min(maxTokens || CAPS.maxOutputTokens, CAPS.maxOutputTokens),
    temperature,
    usage: { include: true },
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  // A support widget that hangs is worse than one that says "try again" — the student is
  // waiting on a phone. The chosen model answers in well under a second.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.AI_CHAT_TIMEOUT_MS || 20000));

  let resp;
  try {
    resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.PUBLIC_URL || 'https://lolo-shop96.com',
        'X-Title': 'Lolo (LoloShop assistant)',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    console.error('aiChat network error:', err.name === 'AbortError' ? 'timeout' : err.message);
    throw tagged('تعذّر الاتصال بالمساعد', 502, 'ERR_AI_NET');
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    let detail = '';
    try { detail = JSON.stringify(await resp.json()); } catch { /* ignore */ }
    console.error('aiChat non-200:', resp.status, detail.slice(0, 400));
    throw tagged('المساعد مو متوفر حالياً', 502, 'ERR_AI_UPSTREAM');
  }

  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content;
  const usage = data?.usage || {};
  // A model can return 200 with empty content (qwen3.7-flash did exactly this in testing) —
  // treat that as a failure rather than showing the student an empty bubble.
  if (!text || !text.trim()) {
    console.error('aiChat empty content from', model);
    throw tagged('ما وصلني رد، جرّب مرة ثانية', 502, 'ERR_AI_EMPTY');
  }

  const promptTokens = Number(usage.prompt_tokens || 0);
  const completionTokens = Number(usage.completion_tokens || 0);
  const costUsd = estimateCostUsd({
    reportedCost: usage.cost,
    model,
    promptTokens,
    completionTokens,
  });
  if (!Number(usage.cost) && costUsd > 0) {
    console.error('aiChat: no usage.cost from OpenRouter — spend estimated from tokens for', model);
  }

  return { text: text.trim(), model, promptTokens, completionTokens, costUsd };
}

module.exports = {
  complete,
  reserve,
  settle,
  logCached,
  recentTurns,
  configured,
  CAPS,
  DEFAULT_MODEL,
  // Pure helpers, exported for test/aiChat.test.js — no database, no network.
  _internals: {
    evaluateCaps, estimateCostUsd, FALLBACK_PRICE_PER_MTOK, UNKNOWN_MODEL_PRICE, WARN_MEMO_KEY,
  },
};
