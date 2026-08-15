// backend/controllers/adminAnalyticsChatController.js — «اسأل عن أرقامك» for /admin.
//
// Two cheap calls, never any model-written SQL:
//   1. ROUTE  — map the Arabic question onto one key from the closed metric catalogue
//               (lib/adminMetrics.js), as JSON. Nothing else the model returns is used.
//   2. PHRASE — hand the model the numbers WE computed and let it write the Arabic sentence.
//
// Step 2 exists because the raw facts are already correct without it — if the phrasing call
// fails we return the facts verbatim rather than erroring. The assistant degrades to a plain
// table, which is a fine outcome for an admin screen.

const ai = require('../lib/aiChat');
const metrics = require('../lib/adminMetrics');

const ROUTER_SYSTEM = `أنت موجّه أسئلة لمتجر لولو شوب. مهمتك الوحيدة اختيار المقياس المناسب من القائمة.

المقاييس المتاحة:
${metrics.catalogForPrompt()}

أجب بـ JSON فقط بهذا الشكل:
{"key": "اسم_المقياس", "days": عدد_الأيام, "limit": عدد}

قواعد:
- "key" لازم يكون واحد من الأسماء أعلاه بالضبط، أو null إذا ما يوجد مقياس مناسب.
- "days" عدد صحيح؛ إذا السؤال ما ذكر فترة استخدم 30. "هذا الشهر" = 30، "هذا الأسبوع" = 7، "هذي السنة" = 365.
- "limit" عدد صحيح للأسئلة اللي تطلب قائمة؛ الافتراضي 5.
- لا تكتب أي شرح، JSON فقط.`;

// The "independent facts" rule is not boilerplate — without it the model wrote
// «80 طلبًا بانتظار الموافقة، ومن بينها 123 طالبًا», inventing a containment relationship
// between two counts that are simply separate. Numbers we computed correctly can still be
// made false by the sentence that joins them, so the phrasing step is constrained too.
const PHRASE_SYSTEM = `أنت مساعد تحليلات لمتجر لولو شوب، تتكلم مع صاحب المتجر.
اكتب جواباً عربياً قصيراً (جملتين كحد أقصى) يلخّص الأرقام المعطاة لك. ابدأ بالرقم مباشرة بدون تحية.

قواعد صارمة:
- لا تضيف أي رقم مو موجود بالأرقام المعطاة، ولا تحسب نسب أو مجاميع جديدة.
- كل رقم معطى لك هو معلومة مستقلة بنفسها. ممنوع تربط بين رقمين بعلاقة ما مذكورة (مثل "منها" أو "من بينها" أو "بنسبة").
- لا تخمّن أسباب ولا توقعات ولا نصائح.`;

function parseRoute(text) {
  try {
    // Tolerate a ```json fence even with response_format set — cheap models still emit them.
    const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

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

    const userId = req.user.id; // route is authRequired + requireRole('admin')

    // Reserve-then-settle: the ledger row is written before the model call so concurrent
    // requests cannot share one cap check. See lib/aiChat.js for the protocol.
    const { id: logId, error: capError } = await ai.reserve({
      userId,
      sessionKey: null,
      surface: 'admin_analytics',
      question,
    });
    if (capError) {
      return res.status(capError.status).json({ error: capError.message, code: capError.code });
    }

    // ── 1. Route ────────────────────────────────────────────────────────────────
    let routeResult;
    try {
      routeResult = await ai.complete({
        messages: [
          { role: 'system', content: ROUTER_SYSTEM },
          { role: 'user', content: question },
        ],
        maxTokens: 80,
        temperature: 0,
        jsonMode: true,
      });
    } catch (err) {
      await ai.settle(logId, { error: err.code || err.message });
      throw err;
    }

    const route = parseRoute(routeResult.text);
    const key = route?.key && metrics.METRICS[route.key] ? route.key : null;

    if (!key) {
      // Unanswerable questions are logged with intent NULL on purpose — that column is the
      // record of what the fixed metric set cannot do, i.e. the backlog for the next metric.
      await ai.settle(logId, { answer: null, intent: null, result: routeResult });
      return res.json({
        answer: 'ما أكدر أجاوب على هذا السؤال. أكدر أجاوب عن: المبيعات والأرباح، أفضل الممثلين، مراحل الإنتاج، الطلاب الجدد، المنتجات الأكثر مبيعاً، الطلبات المنتظرة موافقة، المواعيد، وكلفة المساعد.',
        intent: null,
        facts: [],
      });
    }

    // ── 2. Run OUR SQL ──────────────────────────────────────────────────────────
    const data = await metrics.run(key, { days: route.days, limit: route.limit });

    // ── 3. Phrase ───────────────────────────────────────────────────────────────
    const factsBlock = `${data.label}\n${data.facts.join('\n')}`;
    let answer;
    let phraseResult = null;
    try {
      phraseResult = await ai.complete({
        messages: [
          { role: 'system', content: PHRASE_SYSTEM },
          { role: 'user', content: `السؤال: ${question}\n\nالأرقام:\n${factsBlock}` },
        ],
        maxTokens: 200,
      });
      answer = phraseResult.text;
    } catch {
      // Numbers are already correct — degrade to them rather than failing the request.
      answer = factsBlock;
    }

    const combined = {
      model: (phraseResult || routeResult).model,
      promptTokens: routeResult.promptTokens + (phraseResult?.promptTokens || 0),
      completionTokens: routeResult.completionTokens + (phraseResult?.completionTokens || 0),
      costUsd: routeResult.costUsd + (phraseResult?.costUsd || 0),
    };
    await ai.settle(logId, { answer, intent: key, result: combined });

    // `facts` ships alongside the prose so the admin can check the assistant's arithmetic —
    // the numbers are computed by us, and showing them makes the phrasing auditable.
    return res.json({ answer, intent: key, label: data.label, facts: data.facts });
  } catch (err) {
    return next(err);
  }
};

// Pure, for test/aiChat.test.js.
exports._internals = { parseRoute };
