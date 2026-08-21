// backend/controllers/adminConsoleController.js — «لولو الإدارة», the owner's own console.
//
// Successor to adminAnalyticsChatController's `ask`, which stays mounted at
// /api/assistant/analytics so the compact widget on /admin keeps working unchanged. This adds
// the full page's three extra powers: a much wider metric catalogue, ACTIONS, and a suggestion
// feed the model never touches.
//
// ══ THIS IS NOT THE STOREFRONT ASSISTANT, AND THE SEPARATION IS DELIBERATE ══════════════════
// «لولو» the mascot (controllers/supportChatController.js) and this file share exactly one
// thing: the OpenRouter transport in lib/aiChat.js and the ledger table it writes. Everything
// that decides WHAT MAY BE SAID is separate, and in two places the two surfaces need OPPOSITE
// behaviour — so sharing the code would be the defect, not the saving:
//
//   · GUARD. The storefront's lib/answerGuard.js rejects any IQD figure not in the price book.
//     This surface's whole job is IQD figures. lib/adminAnswerGuard.js asserts the mirror-image
//     property instead — every number must be one WE computed.
//   · BUDGET. lib/aiChat.js gives this surface its own daily slice, so a flood of student
//     questions cannot switch off the owner's instrument and a chatty console cannot drain the
//     shop's marketing surface.
//   · IDENTITY. The storefront mints signed anonymous sessions. This one is authRequired +
//     requireRole('admin'); lib/anonSession.js is never imported here.
//   · CONTEXT. The price book, the shop guide and the customer's own order never load here.
//     The metric catalogue never loads there.
//
// ══ THE SECURITY MODEL, UNCHANGED FROM THE METRIC WIDGET ═══════════════════════════════════
// The model never writes SQL, never sees the database, and never authors a confirmation. It
// does exactly two things: pick one key from a closed list, and phrase numbers we computed.
// A bad model output can select the wrong metric or propose a rejected action. It cannot read
// or write anything this codebase did not already decide it could.

const ai = require('../lib/aiChat');
const metrics = require('../lib/adminMetrics');
const actions = require('../lib/adminActions');
const suggestions = require('../lib/adminSuggestions');
const presence = require('../lib/staffPresence');
const guard = require('../lib/adminAnswerGuard');

const SURFACE = 'admin_analytics';

// ── ROUTING ────────────────────────────────────────────────────────────────────────────────
// ONE call decides between three outcomes: a metric to look up, an action to propose, or
// neither. One call rather than two because a second round trip doubles the latency of every
// question to disambiguate a case the model gets right from the wording — «شكد ربحنا» and
// «مدد موعد ديالى أسبوع» are not close together.
const ROUTER_SYSTEM = `أنت موجّه لمساعد إدارة متجر لولو شوب. مهمتك اختيار وحدة من ثلاث حالات.

المقاييس المتاحة (للأسئلة):
${metrics.catalogForPrompt()}

الإجراءات المتاحة (للأوامر):
${actions.catalogForPrompt()}

أجب بـ JSON فقط:
{"kind": "metric", "key": "اسم_المقياس", "days": عدد, "limit": عدد}
أو
{"kind": "action", "action": "اسم_الإجراء", "params": {…}}
أو
{"kind": null}

قواعد:
- إذا المستخدم يسأل عن معلومة أو رقم → metric.
- إذا المستخدم يطلب تنفيذ شي (مدد، ثبّت، وافق، ارفض، أضف) → action.
- "days" عدد صحيح؛ إذا ما ذكر فترة استخدم 30. "هذا الشهر"=30، "هذا الأسبوع"=7، "هذي السنة"=365. "اليوم"=1.
- "limit" الافتراضي 5.
- بالإجراءات: انسخ الأسماء والأرقام من كلام المستخدم حرفياً. لا تخمّن اسم موظف أو ممثل ما ذكره.
- التواريخ بصيغة YYYY-MM-DD.
- إذا ما تعرف → {"kind": null}. لا تخترع مقياس ولا إجراء.
- JSON فقط، بدون شرح.`;

// The phrasing step's constraints are load-bearing and each one is a real defect this shop has
// already seen. «كل رقم معلومة مستقلة» exists because the model wrote «٨٠ طلبًا بانتظار
// الموافقة، ومن بينها ١٢٣ طالبًا», inventing a containment relationship between two counts that
// are simply separate. lib/adminAnswerGuard.js now VERIFIES both of these rules rather than
// hoping — a prompt rule nothing checks is a wish.
const PHRASE_SYSTEM = `أنت مساعد إدارة لمتجر لولو شوب، تتكلم مع صاحب المتجر.
اكتب جواباً عربياً قصيراً (٣ جمل كحد أقصى) يلخّص الأرقام المعطاة لك. ابدأ بالرقم مباشرة بدون تحية.

قواعد صارمة:
- لا تضيف أي رقم مو موجود بالأرقام المعطاة، ولا تحسب نسب ولا مجاميع ولا معدلات جديدة.
- كل رقم معطى لك هو معلومة مستقلة بنفسها. ممنوع تربط بين رقمين بعلاقة ما مذكورة ("منها"، "من بينها"، "بنسبة").
- لا تخمّن أسباب ولا توقعات.
- تكدر تعلّق بجملة قصيرة على شنو يستاهل الانتباه، بشرط ما تذكر أي رقم جديد.`;

function parseJson(text) {
  try {
    // Tolerate a ```json fence even with response_format set — cheap models still emit them.
    const cleaned = String(text || '')
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

const CANNOT_ANSWER =
  'ما أكدر أجاوب على هذا السؤال. أكدر أجاوب عن: الأرباح ودخل المحل، الممثلين، مراحل الإنتاج، ' +
  'الطلاب الجدد، المنتجات، حالة الموظفين وحضورهم وساعات عملهم، الورشة، الرواتب، كلفة المساعد ' +
  'ومولّد الخط، والزوار. وأكدر أنفّذ: تمديد موعد ممثل، تثبيت كلفة طلب، البت بطلبات الخروج المؤقت، ' +
  'مكافأة موظف، ووضع هدف إنتاج.';

/**
 * POST /api/assistant/admin/ask
 */
exports.ask = async (req, res, next) => {
  try {
    if (!ai.configured()) {
      return res.status(503).json({ error: 'المساعد مو مفعّل حالياً', code: 'ERR_AI_DISABLED' });
    }

    const question = String(req.body?.question || '').trim();
    if (!question) {
      return res.status(400).json({ error: 'اكتب سؤالك أول', code: 'ERR_AI_EMPTY_QUESTION' });
    }
    if (question.length > ai.CAPS.maxQuestionChars) {
      return res.status(400).json({ error: 'السؤال طويل', code: 'ERR_AI_QUESTION_TOO_LONG' });
    }

    const admin = req.user; // route is authRequired + requireRole('admin')

    // Reserve-then-settle: the ledger row is written before the model call so concurrent
    // requests cannot share one cap check. Protocol documented in lib/aiChat.js.
    const { id: logId, error: capError } = await ai.reserve({
      userId: admin.id,
      sessionKey: null,
      surface: SURFACE,
      question,
    });
    if (capError) {
      return res.status(capError.status).json({ error: capError.message, code: capError.code });
    }

    // ── 1. Route ─────────────────────────────────────────────────────────────────────────
    let routeResult;
    try {
      routeResult = await ai.complete({
        messages: [
          { role: 'system', content: ROUTER_SYSTEM },
          { role: 'user', content: question },
        ],
        maxTokens: 200,
        temperature: 0,
        jsonMode: true,
      });
    } catch (err) {
      await ai.settle(logId, { error: err.code || err.message });
      throw err;
    }

    const route = parseJson(routeResult.text) || {};

    // ── 2a. ACTION ───────────────────────────────────────────────────────────────────────
    // No phrasing call at all. The confirmation sentence is written by lib/adminActions.js and
    // shown VERBATIM: it is the thing the owner is agreeing to, so the model must not be
    // anywhere near its wording. Cheaper too — one model call instead of two.
    if (route.kind === 'action' && route.action) {
      const proposed = await actions.propose(route.action, route.params || {}, admin);
      if (!proposed.ok) {
        await ai.settle(logId, { answer: proposed.error, intent: `action_rejected:${route.action}`, result: routeResult });
        return res.json({ answer: proposed.error, intent: null, facts: [], proposal: null });
      }
      await ai.settle(logId, {
        answer: proposed.proposal.confirm,
        intent: `action:${route.action}`,
        result: routeResult,
      });
      return res.json({
        answer: proposed.proposal.confirm,
        intent: `action:${route.action}`,
        facts: [],
        proposal: proposed.proposal,
      });
    }

    // ── 2b. METRIC ───────────────────────────────────────────────────────────────────────
    const key = route.kind === 'metric' && route.key && metrics.METRICS[route.key] ? route.key : null;
    if (!key) {
      // Logged with intent NULL on purpose — that column is the record of what the fixed
      // catalogue cannot do, i.e. the backlog for the next metric or action.
      await ai.settle(logId, { answer: null, intent: null, result: routeResult });
      return res.json({ answer: CANNOT_ANSWER, intent: null, facts: [], proposal: null });
    }

    const data = await metrics.run(key, { days: route.days, limit: route.limit });
    const factsBlock = `${data.label}\n${data.facts.join('\n')}`;

    // ── 3. Phrase, then VERIFY ───────────────────────────────────────────────────────────
    let answer = factsBlock;
    let phraseResult = null;
    let guardReason = null;
    try {
      phraseResult = await ai.complete({
        messages: [
          { role: 'system', content: PHRASE_SYSTEM },
          { role: 'user', content: `السؤال: ${question}\n\nالأرقام:\n${factsBlock}` },
        ],
        maxTokens: 300,
      });
      const verdict = guard.inspect(phraseResult.text, factsBlock);
      if (verdict.ok) {
        answer = phraseResult.text;
      } else {
        // Degrade to the facts themselves. This loses NOTHING: the numbers were already
        // correct before the phrasing call, and the owner sees a plain list instead of a
        // sentence. Same fallback the phrasing call's own failure path takes.
        guardReason = `${verdict.reason}${verdict.detail ? `: ${verdict.detail}` : ''}`;
        console.warn(`admin console guard tripped — ${guardReason}`);
      }
    } catch {
      // Numbers already correct — degrade to them rather than failing the request.
    }

    const combined = {
      model: (phraseResult || routeResult).model,
      promptTokens: routeResult.promptTokens + (phraseResult?.promptTokens || 0),
      completionTokens: routeResult.completionTokens + (phraseResult?.completionTokens || 0),
      costUsd: routeResult.costUsd + (phraseResult?.costUsd || 0),
    };
    await ai.settle(logId, {
      answer,
      intent: key,
      result: combined,
      // The tripped reason goes in `error` so the ledger records WHY an answer degraded. A
      // guard that fires silently teaches nobody which prompt to fix.
      error: guardReason ? `GUARD_${guardReason}` : undefined,
    });

    // `facts` ships alongside the prose so the owner can check the assistant's arithmetic —
    // the numbers are computed by us, and showing them makes the phrasing auditable.
    return res.json({ answer, intent: key, label: data.label, facts: data.facts, proposal: null });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /api/assistant/admin/act — execute a proposal the admin confirmed.
 *
 * The signed token is the ENTIRE authorisation. Everything the model produced was already
 * validated and re-derived by lib/adminActions.js before signing; nothing in the request body
 * except the token influences what runs. That is what stops a client posting its own
 * {action, params} straight to this endpoint.
 */
exports.act = async (req, res, next) => {
  try {
    const admin = req.user;
    const verdict = actions.verifyProposal(req.body?.token, admin.id);
    if (!verdict.ok) {
      return res.status(400).json({ error: verdict.error, code: 'ERR_AI_ACTION_INVALID' });
    }

    const result = await actions.execute(verdict.action, verdict.params, admin);
    if (!result.ok) {
      return res.status(409).json({ error: result.message, code: 'ERR_AI_ACTION_FAILED' });
    }
    return res.json({ data: { message: result.message, action: verdict.action } });
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /api/assistant/admin/suggestions — «شنو المفروض أنتبه إله اليوم».
 * No model, no cost, no possibility of a hallucinated task. See lib/adminSuggestions.js.
 */
exports.suggestions = async (req, res, next) => {
  try {
    return res.json({ data: await suggestions.build() });
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /api/assistant/admin/history — this admin's recent turns, so the page is a conversation
 * rather than a series of forgotten questions.
 *
 * Scoped to `user_id = the caller` AND to this surface: an admin must never be able to read
 * the storefront's log of what customers asked from here. That is a different surface with a
 * different privacy posture, and it has its own (anonymous) identities.
 */
exports.history = async (req, res, next) => {
  try {
    const { query } = require('../lib/db');
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const { rows } = await query(
      `SELECT question, answer, intent, created_at
         FROM ai_chat_messages
        WHERE user_id = $1 AND surface = $2 AND answer IS NOT NULL
        ORDER BY created_at DESC
        LIMIT $3`,
      [req.user.id, SURFACE, limit]
    );
    // Oldest first: the page renders a thread, and a thread reads downward.
    return res.json({ data: rows.reverse() });
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /api/admin/staff-daily-report?date=YYYY-MM-DD
 * Defaults to today in shop-local time (Asia/Baghdad), never the server's UTC date.
 */
exports.staffDailyReport = async (req, res, next) => {
  try {
    return res.json({ data: await presence.dailyReport(req.query.date) });
  } catch (err) {
    return next(err);
  }
};

exports._internals = { parseJson, ROUTER_SYSTEM, PHRASE_SYSTEM };
