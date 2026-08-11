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

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';

// Cost caps (owner decision 2026-08-10: "tight — cache + hard caps"). All overridable by env
// so the owner can loosen them without a deploy; the defaults are the safe end.
const CAPS = {
  // Per signed-in user per rolling 24h. A real student asks 3–5 questions; 30 is generous
  // and still bounds a scripted abuser to ~$0.0012/day.
  perUserPerDay: Number(process.env.AI_CHAT_USER_DAILY_MAX || 30),
  // Per anonymous visitor (session key) per rolling 24h. Lower — an anon caller is cheaper
  // to fake. Iraqi carriers CGNAT, so this is keyed on a client session id, NOT on IP:
  // keying on IP would let one cohort's shared egress address exhaust everyone's allowance
  // (the same trap documented for joinLimit in HANDOFF.md).
  perSessionPerDay: Number(process.env.AI_CHAT_ANON_DAILY_MAX || 10),
  // Whole-shop ceiling per rolling 24h, in USD. The backstop that makes every other cap
  // optional: even total failure of the per-user logic cannot bill more than this per day.
  globalUsdPerDay: Number(process.env.AI_CHAT_DAILY_USD_MAX || 1.0),
  // The slice of that ceiling ANONYMOUS traffic may consume. This is not a cost control —
  // globalUsdPerDay already bounds the bill. It is an AVAILABILITY control.
  //
  // Measured 2026-08-12: `sessionKey` is client-supplied, so the 10/day anon cap is bypassed
  // by generating a new one per request. The real bounds are the per-IP limiter (100/15min =
  // 9,600 req/day/IP ≈ $0.58) and this ceiling — so ~2 IPs could exhaust the day's budget for
  // pennies. Before this split, an exhausted budget refused EVERYONE, including signed-in
  // students, so a stranger could silently switch the assistant off for real customers daily.
  // With the split, anon flooding can only ever take its own slice.
  anonUsdPerDay: Number(process.env.AI_CHAT_ANON_DAILY_USD_MAX || 0.4),
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

function tagged(message, status, code) {
  const e = new Error(message);
  e.status = status;
  e.expose = true;
  e.code = code;
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
function evaluateCaps({ userToday, sessionToday, spendToday, anonSpendToday }, { userId, caps = CAPS } = {}) {
  if (Number(spendToday) >= caps.globalUsdPerDay) {
    // Deliberately vague to the user — the shop's daily AI budget is not their business.
    return tagged('المساعد مشغول حالياً، جرّب بعد شوية', 503, 'ERR_AI_BUDGET');
  }
  // Anonymous traffic is bounded by its own slice, so a flood of signed-out requests cannot
  // consume the budget a signed-in student depends on. Signed-in callers skip this entirely.
  if (!userId && Number(anonSpendToday || 0) >= caps.anonUsdPerDay) {
    return tagged('المساعد مشغول حالياً، سجّل دخولك حتى تكدر تسأل', 503, 'ERR_AI_ANON_BUDGET');
  }
  if (userId && Number(userToday) >= caps.perUserPerDay) {
    return tagged('وصلت للحد اليومي من الأسئلة، جرّب باچر', 429, 'ERR_AI_USER_LIMIT');
  }
  if (!userId && Number(sessionToday) >= caps.perSessionPerDay) {
    return tagged('وصلت للحد اليومي من الأسئلة، سجّل دخولك حتى تسأل أكثر', 429, 'ERR_AI_ANON_LIMIT');
  }
  return null;
}

/**
 * Claim one slot: check the caps and write the pending ledger row atomically.
 *
 * Returns { id } when the call may proceed, or { error } (tagged, ready to return) when a cap
 * is hit. The advisory lock serialises callers that share an allowance, so twenty parallel
 * requests from one student consume twenty slots, not one.
 */
async function reserve({ userId, sessionKey, surface, question }) {
  // One allowance per identity: a signed-in user is keyed on their id, an anonymous visitor on
  // their session key. Different callers hash to different locks and never block each other.
  const lockKey = userId ? `ai:u:${userId}` : `ai:s:${sessionKey || 'none'}`;

  return tx(async (client) => {
    // Transaction-scoped: released at COMMIT/ROLLBACK, so it cannot outlive this block, and
    // it is safe under PgBouncer transaction pooling (unlike a session-scoped lock).
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [lockKey]);

    // `model <> 'cache'` excludes answers served from the response cache. The caps exist to
    // bound SPEND, and a cache hit costs nothing — counting one against a student's 10/day
    // would make the cache actively worse for the person it is supposed to help. Pending rows
    // (model IS NULL, reserved but not yet settled) must still count, hence the COALESCE.
    const { rows } = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE user_id = $1 AND $1 IS NOT NULL
                            AND COALESCE(model, '') <> 'cache')          AS user_today,
         COUNT(*) FILTER (WHERE session_key = $2 AND $2 IS NOT NULL
                            AND user_id IS NULL
                            AND COALESCE(model, '') <> 'cache')          AS session_today,
         COALESCE(SUM(cost_usd), 0)                                      AS spend_today,
         COALESCE(SUM(cost_usd) FILTER (WHERE user_id IS NULL), 0)        AS anon_spend_today
       FROM ai_chat_messages
       WHERE created_at > NOW() - INTERVAL '24 hours'`,
      [userId || null, sessionKey || null]
    );
    const r = rows[0] || {};

    const capError = evaluateCaps(
      {
        userToday: r.user_today,
        sessionToday: r.session_today,
        spendToday: r.spend_today,
        anonSpendToday: r.anon_spend_today,
      },
      { userId }
    );
    if (capError) return { error: capError };

    // The row exists from here on. If the request dies before settle(), it stays with a NULL
    // answer and still counts — which is the intended behaviour, not a leak.
    const { rows: ins } = await client.query(
      `INSERT INTO ai_chat_messages (user_id, session_key, surface, question)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [userId || null, sessionKey || null, surface, String(question).slice(0, 2000)]
    );
    return { id: ins[0].id };
  });
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
 * Fire-and-forget: a logging failure must never fail an answer we already have in hand.
 */
async function logCached({ userId, sessionKey, surface, question, answer }) {
  try {
    await query(
      `INSERT INTO ai_chat_messages
         (user_id, session_key, surface, question, answer, model, cost_usd)
       VALUES ($1, $2, $3, $4, $5, 'cache', 0)`,
      [
        userId || null,
        sessionKey || null,
        surface,
        String(question).slice(0, 2000),
        String(answer).slice(0, 4000),
      ]
    );
  } catch (e) {
    console.error('aiChat cache-hit log FAILED (answer still served):', e.message);
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
  _internals: { evaluateCaps, estimateCostUsd, FALLBACK_PRICE_PER_MTOK, UNKNOWN_MODEL_PRICE },
};
