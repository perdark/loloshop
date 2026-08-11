// backend/controllers/supportChatController.js — Arabic support chatbot («مساعد لولو»).
//
// One model call per message. The server assembles every fact the bot may state
// (lib/supportContext.js) and the model only phrases it; there is no tool loop and no
// model-generated SQL. See lib/aiChat.js for the model choice and the cost caps.

const ai = require('../lib/aiChat');
const supportContext = require('../lib/supportContext');

// Static half of the system prompt — identical on every request, so it is a plain module
// constant rather than rebuilt per call. Facts the shop is sure of live here; anything
// user-specific arrives in the context block appended below.
const SHOP_FACTS = `حقائق ثابتة عن المتجر:
- لولو شوب (@lolo_shop96 على إنستغرام) — أوشحة تخرج، روبات تخرج، قبعات تخرج، وشالات.
- الدفع نقدي فقط (كاش). ماكو دفع إلكتروني ولا بطاقات ولا تحويل.
- الطالب يصمم وشاحه بنفسه من الموقع، ويرفع شعار جامعته بنفسه.
- طلاب الجامعات يطلبون عن طريق ممثل جامعتهم؛ الممثل هو اللي يوافق على الطلب.
- عدنا محل حقيقي ببغداد، وموقعه مثبّت على خريطة كوكل بآخر الصفحة الرئيسية بالموقع تحت عنوان «موقعنا».
- «الوشاح» و«الشال» منتجان مختلفان بأسعار مختلفة — لا تخلط بينهما أبداً.
- ماكو توصيل ولا شحن نهائياً — لا لبغداد ولا لأي محافظة ثانية. الطلب يُستلم من المحل ببغداد (وهذا معنى حالة «جاهز للاستلام»). طالب الجامعة يسأل ممثل جامعته عن ترتيب الاستلام.`;

const RULES = `التعليمات:
1. تكلّم بالعربية فقط، بلهجة عراقية بسيطة ومهذبة. لا تستخدم الإنجليزية أبداً.
2. جاوب بجملتين أو ثلاث كحد أقصى. لا تستخدم قوائم ولا عناوين.
3. اعتمد فقط على "معلومات الزبون" و"حقائق ثابتة" و"قائمة الأسعار" أدناه. إذا المعلومة مو موجودة، قول بصراحة إنها مو متوفرة عندك ووجّه الزبون لممثل جامعته أو صفحة الإنستغرام.
4. الأسعار: استخدم أرقام "قائمة الأسعار" أدناه فقط، وقول دائماً إنها أسعار بداية («يبدأ من»). ممنوع تخترع سعر مو موجود بالقائمة، وممنوع تحسب مجموع أو خصم بنفسك. إذا المنتج مو بالقائمة، قول ما عندك سعره.
5. حالة الطلب: إذا حالات طلبات الزبون موجودة بـ"معلومات الزبون" أدناه، فهي معلومات مؤكدة عندك — اذكرها له بوضوح ولا تقول "ما أعرف". أما إذا ماكو طلبات بالمعلومات، فقول إنها مو متوفرة عندك. وبكل الأحوال ممنوع تخترع حالة أو موعد تسليم.
6. "آخر موعد لتقديم الطلبات" هو آخر يوم يكدر الطالب يطلب بيه — وهو مو موعد تسليم الطلب. لا تقول أبداً إن الطلب راح يوصل بهذا التاريخ ولا تعد الزبون بأي تاريخ تسليم.
7. لا تذكر أي معلومة عن زبون ثاني، ولا تتكلم عن أرباح المتجر أو تكاليفه.
8. إذا الزبون طلب تعديل طلبه أو إلغاءه، وجّهه لممثل جامعته — إنت ما تكدر تسوي أي تعديل.
9. التوصيل: المتجر ما يوصّل أبداً (قرار المالك). إذا سأل عن التوصيل أو الشحن، قول بوضوح إنه ماكو توصيل وإن الاستلام من المحل ببغداد، ووجّه طالب الجامعة لممثله حتى يرتّب معه الاستلام. ممنوع تخترع أجور توصيل أو استثناء لأي محافظة.`;

const NO_CONTEXT = `معلومات الزبون:
- الزائر مو مسجّل دخول، فما عندك أي معلومة عن طلباته.
- إذا سأل عن طلبه أو حالته، اطلب منه يسجّل دخول أول.`;

function buildMessages(contextBlock, priceBlock, history, question) {
  const system = [SHOP_FACTS, RULES, priceBlock, contextBlock || NO_CONTEXT]
    .filter(Boolean)
    .join('\n\n');
  // `history` comes from our own ledger (ai.recentTurns), never from the request body — see
  // the note at the ask() call site. Roles are ours, so they are used as-is.
  return [{ role: 'system', content: system }, ...history, { role: 'user', content: question }];
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
      return res.status(400).json({
        error: `السؤال طويل، خلّيه أقل من ${ai.CAPS.maxQuestionChars} حرف`,
        code: 'ERR_AI_QUESTION_TOO_LONG',
      });
    }

    // optionalAuth populates req.user when a token is present; anonymous visitors are allowed
    // (the storefront widget is public) but get a tighter cap and no personal context.
    const userId = req.user?.id || null;
    // Client-generated session id, NOT the IP: Iraqi carriers CGNAT, so an IP-keyed cap would
    // let one cohort's shared egress address exhaust the whole cohort's allowance — the same
    // trap already documented for joinLimit.
    const sessionKey = userId ? null : String(req.body?.sessionKey || '').slice(0, 64) || null;

    // Claims a slot AND writes the pending ledger row in one locked transaction, so parallel
    // requests from the same caller cannot all pass the cap check together. See lib/aiChat.js.
    const { id: logId, error: capError } = await ai.reserve({
      userId,
      sessionKey,
      surface: 'support',
      question,
    });
    if (capError) {
      return res.status(capError.status).json({ error: capError.message, code: capError.code });
    }

    // History is rebuilt from OUR ledger, not read from req.body. The client used to send its
    // own transcript back with its own role labels, so a caller could inject a fabricated
    // «assistant» turn ("وشاحك مجاني") and then ask the bot to confirm it — a screenshot of the
    // shop's assistant promising a free robe. The request body's `history` is now ignored.
    const [history, profile] = await Promise.all([
      ai.recentTurns({ userId, sessionKey, surface: 'support' }),
      supportContext.forUser(userId),
    ]);

    // «شكد سعر الروب؟» is the most common question the shop gets, and without this the bot
    // answered "I don't know" while the price sat on the page above it. The book is keyed on
    // the asker's own price role — a rep-linked student must not be quoted retail — and is
    // cached 5 minutes, so this is normally free.
    const priceBlock = await supportContext.priceBook(profile?.priceRole || 'retail');

    let result;
    try {
      result = await ai.complete({
        messages: buildMessages(profile?.block, priceBlock, history, question),
      });
    } catch (err) {
      // Record the failed attempt on its reserved row — a burst of upstream errors should be
      // visible in the ledger, not only in the PM2 log.
      await ai.settle(logId, { error: err.code || err.message });
      throw err;
    }

    await ai.settle(logId, { answer: result.text, result });

    return res.json({ answer: result.text });
  } catch (err) {
    return next(err);
  }
};
