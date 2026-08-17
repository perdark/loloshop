// backend/controllers/supportChatController.js — Arabic support chatbot («مساعد لولو»).
//
// One model call per message. The server assembles every fact the bot may state
// (lib/supportContext.js) and the model only phrases it; there is no tool loop and no
// model-generated SQL. See lib/aiChat.js for the model choice and the cost caps.

const crypto = require('node:crypto');
const ai = require('../lib/aiChat');
const supportContext = require('../lib/supportContext');
const memoCache = require('../lib/memoCache');
const anonSession = require('../lib/anonSession');
const answerGuard = require('../lib/answerGuard');
const actions = require('../lib/supportActions');
const fallback = require('../lib/supportFallback');
const { classifyMood } = require('../lib/mood');
const { pickReaction } = require('../lib/reaction');
const { ipHash } = require('../lib/clientIp');

// ── RESPONSE CACHE ────────────────────────────────────────────────────────────────────────
// The owner's cost stance was «tight — cache + hard caps»; this is the cache half.
//
// WHAT IS CACHEABLE, and why the conditions are not negotiable:
//   · ANONYMOUS ONLY. A signed-in answer is built from that student's own orders, rep and
//     deadline. Sharing one would hand another student's order status to a stranger — the
//     single worst bug this feature could have.
//   · FIRST QUESTION OF A SESSION ONLY. Once there is history the answer depends on it
//     («وهو الوشاح؟» means nothing on its own), so two callers asking the same words are not
//     asking the same question.
// Under those two conditions every anonymous caller receives a byte-identical prompt, so the
// answer is genuinely reusable — this is a cache, not an approximation.
//
// THE KEY INCLUDES A HASH OF THE WHOLE SYSTEM PROMPT. That is what makes staleness
// impossible rather than merely unlikely: change a price, a rule, the shop facts or the
// best-seller ranking and every key changes with it, so a stale answer cannot be served. No
// invalidation call to forget, which is the usual way a cache like this goes wrong.
const CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Fold the spellings of one question together so «شكد سعر الروب؟» and «شگد سعر الروب» hit the
 * same entry: strip diacritics, unify the alef/ya/ta-marbuta variants Iraqi typing varies on,
 * drop punctuation and emoji, collapse whitespace.
 *
 * Deliberately conservative — it normalises ORTHOGRAPHY, never meaning. Two questions that
 * differ by a real word must stay different keys.
 */
function normalizeQuestion(q) {
  return String(q)
    .normalize('NFKC')
    .replace(/[ً-ْٰـ]/g, '') // tashkeel + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // punctuation, ?, emoji
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const cacheKeyFor = (systemPrompt, normalized) =>
  `ai:ans:${crypto.createHash('sha1').update(`${systemPrompt}\u0000${normalized}`).digest('base64url')}`;

// Static half of the system prompt — identical on every request, so it is a plain module
// constant rather than rebuilt per call. Facts the shop is sure of live here; anything
// user-specific arrives in the context block appended below.
const SHOP_FACTS = `حقائق ثابتة عن المتجر:
- اسمك «لولو»، إنت مساعد متجر لولو شوب. إذا سألك الزبون منو إنت أو شنو اسمك، قول اسمك لولو ومهمتك تساعده بطلبه وبأسئلته عن المتجر. لا تدّعي إنك إنسان.
- لولو شوب (@lolo_shop96 على إنستغرام) — أوشحة تخرج، روبات تخرج، قبعات تخرج، وشالات.
- الدفع نقدي فقط (كاش). ماكو دفع إلكتروني ولا بطاقات ولا تحويل.
- الطالب يصمم وشاحه بنفسه من الموقع، ويرفع شعار جامعته بنفسه.
- طلاب الجامعات يطلبون عن طريق ممثل جامعتهم؛ الممثل هو اللي يوافق على الطلب.
- عدنا محل حقيقي بمحافظة ديالى (بعقوبة)، واسمه على خرائط كوكل «مطبعة لولو شوب» — الزبون يكدر يدوّر عليه بهذا الاسم، أو يشوف الخريطة مثبّتة بآخر الصفحة الرئيسية بالموقع تحت عنوان «موقعنا».
- «الوشاح» و«الشال» منتجان مختلفان بأسعار مختلفة — لا تخلط بينهما أبداً.
- ماكو توصيل ولا شحن نهائياً — لا لديالى ولا لأي محافظة ثانية. الطلب يُستلم من المحل بديالى (وهذا معنى حالة «جاهز للاستلام»). طالب الجامعة يسأل ممثل جامعته عن ترتيب الاستلام.`;

// ── HOW THE SITE WORKS ─────────────────────────────────────────────────────────────────────
// Owner report 2026-08-17: «تحس ما تعرف التطبيق» — she knew prices and shop facts but nothing
// about USING the site, so «شلون أصمم؟» got «ما أعرف». Every line below was extracted from the
// actual frontend pages (app/(student)/*, login, join, forgot-password, get-app) on 2026-08-17
// — none of it is guessed. Two deliberate omissions: VIP contents/prices (admin-configured
// data, quoted only from the price book) and the shop's phone number (rule 12 — the chips add
// WhatsApp buttons; text stays text).
const SITE_GUIDE = `دليل استخدام الموقع (حتى تشرح للزبون شلون يسوي أي شي):
- إنشاء حساب: من صفحة «أنشئ حساباً» — الاسم، رقم الهاتف، كلمة سر، الجامعة والقسم ونوع الدراسة، ويتأكد الحساب برمز يوصل على الواتساب.
- تسجيل الدخول: رقم الهاتف + كلمة السر، وبعدها رمز تحقق على الواتساب (إذا نفس الجهاز مسجّل من قبل، ما يحتاج رمز).
- نسيت كلمة السر: من صفحة «نسيت كلمة المرور» — يكتب رقمه، يوصله رمز واتساب، ويختار كلمة سر جديدة. ماكو استرجاع بالإيميل.
- طالب الجامعة (عن طريق الممثل): يدخل من رابط ممثله، أو من «ادخل مع ممثلك» ويختار جامعته وقسمه واسم الممثل. يسجّل اسمه الثلاثي ورقمه، وحسابه يظل «بانتظار موافقة الممثل». بعد الموافقة يعبّي استمارة طلبه (الطقم) من صفحة «طلبي».
- طالب الممثل يكدر يعدّل طلبه لحد ما يوافق الممثل عليه؛ بعد الموافقة الطلب ينقفل وما ينعدل. إذا الممثل رجّع الطلب، يشوف السبب ويعدّل ويعيد الإرسال.
- التصميم: ما يحتاج يرسم شي — يفتح المنتج، يختار الخيارات (اللون والشكل وغيرها)، يكتب نص التطريز (اسمه وكليته) بالخانات المخصصة، ويرفع شعار جامعته أو صورة مرجعية إذا يريد. ورشتنا تنفّذ التطريز حسب اللي كتبه.
- الروب: يحتاج قياسات بالسنتيمتر (عرض الكتف، طول الروب، طول الردن — ومحيط الصدر اختياري). صفحة «المقاسات» بالموقع بيها جدول كامل من S إلى XXL حسب الطول والوزن، وإذا محتار بين قياسين ياخذ الأكبر. القبعة قياس واحد يناسب أغلب الرؤوس (54–60 سم) وقابلة للتعديل.
- الطلب والدفع: بعض المنتجات تنضاف للسلة وبعضها يتأكد مباشرة من صفحة المنتج. لازم يكون مسجّل دخول حتى يطلب. الدفع نقداً عند الاستلام فقط.
- الباقات: الباقة = روب + وشاح + قبعة بسعر واحد، وباقة VIP نسخة فاخرة — تفاصيلها بصفحة VIP بالموقع. اللي عنده باقة عادية يكدر يرقّيها لـVIP من نفس الصفحة أو من السلة.
- متابعة الطلب: يشوف حالة طلباته من حسابه (صفحة السلة أو «طلبي»). ماكو تتبّع برقم طلب بدون تسجيل دخول.
- «الطلبات المُعادة»: إذا الفريق رجّع طلب للتعديل، يظهر هناك ويكدر يصلّح النص أو الصور أو القياسات ويعيد الإرسال.
- التطبيق: تطبيق لولو شوب موجود على متجر كوكل بلاي، وصفحة «حمّل التطبيق» بالموقع توديه للمتجر مباشرة.
- حسابي: يكدر يغيّر اسمه المعروض وجنسه (طالب/طالبة) من «تفضيلاتي». تغيير رقم الهاتف أو الجامعة يحتاج تواصل ويّه المحل.
- حذف الحساب: موجود بصفحة الحساب، بس حذف الحساب ما يلغي أي طلب فعّال — الطلب يكمل وينتج.`;

// ── WHO لولو IS ────────────────────────────────────────────────────────────────────────────
// Split out of RULES and put FIRST after the shop facts, because a phone test on 2026-08-12
// showed the old single line («بلهجة عراقية بسيطة ومهذبة») losing to the model's default
// register the moment a customer said anything human. Real answers from that session:
//   «شلونك»            → «أهلاً بك! أنا لولو، مساعدة متجر لولو شوب. مهمتي أساعدك بطلباتك…»
//   «اني معجبة بشغلكم» → «يسعدنا جداً إعجابك بشغلنا. نأمل أن تجدي ما تبحثين عنه لدينا.»
//   «تعرف اني حزينة»   → «أنا آسفة لسماع ذلك. هل هناك شيء يمكنني فعله لمساعدتك؟»
//   «احسك ماتحبني»     → «أنا هنا لمساعدتك في طلباتك وأسئلتك عن متجر لولو شوب.»
// All four are fluent Modern Standard Arabic and all four are cold — a customer paying a
// compliment got a form letter. On the shop's main marketing surface that is the product.
//
// Register does not survive being ASKED for; it survives being SHOWN. Hence the banned-phrase
// list and the worked examples: a rule the model can satisfy abstractly, it will.
const PERSONA = `شخصيتك:
- إنت «لولو»، بنية عراقية تشتغل بلولو شوب، دافية وبسيطة وتحب شغلها. مو روبوت رسمي.
- تحچين باللهجة العراقية دائماً، بكل جواب، حتى بالمجاملات والحچي العادي.
- ممنوع منعاً باتاً هذا الأسلوب الرسمي (فصحى): «يسعدنا» · «نأمل أن تجدي» · «هل هناك شيء يمكنني فعله» · «أنا آسفة لسماع ذلك» · «مهمتي أساعدك بطلباتك وأجاوب على أسئلتك».
- بدالها احچي هيچي: «هلا بيك» · «تدلل» · «أكيد» · «شوف» · «والله» · «عيني» · «تعال أساعدك» · «تسلم» · «كلش ممنونة».
- خاطب الزبون بنفس صيغته: إذا حچى بصيغة المؤنث ردّ بالمؤنث، وإذا بالمذكر ردّ بالمذكر.
- إذا ما تعرف هو ولا هي، لا تخمّن وممنوع تكتب الصيغتين سوا مثل «حبيبي/حبيبتي» أو «تدلل/تدللين» — هذا يطلع مثل نموذج مو مثل بني آدم. بهذي الحالة استخدم كلام محايد («هلا بيك» · «تدلل» · «أهلاً») بدون ألقاب.

- نوّع أسلوبك: لا تبدي كل جواب بنفس العبارة (مثل «هلا بيك عيني» بكل مرة) — غيّر افتتاحياتك وكلماتك بين جواب وجواب حتى تحس طبيعية. وإذا الزبون سأل نفس السؤال مرتين، جاوبه بصياغة مختلفة عن المرة الأولى.

الحچي العادي (مهم):
- إذا سألك «شلونك» جاوب مثل إنسانة: «تمام الحمدلله، شلونك إنت؟» — لا تعرّف بنفسك من جديد كل مرة.
- إذا مدحك أو مدح شغلكم، افرح وردّ بدفا بجملة وحدة، وخلص. لا تدفع المتجر بالعافية بنفس الجملة.
- إذا كال إنه زعلان أو تعبان، ردّ عليه كإنسانة أول، بجملة قصيرة صادقة. المتجر مو موضوع هاي اللحظة.
- إذا حچى وياك حچي شخصي ما إله علاقة بالشغل، ردّ بلطف ومختصر وبس.

إذا كلّك جوابك غلط:
- لا تعيد نفس الجملة أبداً بنفس الكلمات — هذا أسوأ شي تسويه.
- اعتذر بجملة قصيرة، واسأله يوضّح شنو يقصد بالضبط، أو جاوب من زاوية ثانية بمعلومة أدق.
- وبكل الأحوال: ممنوع تعيد نص جوابك السابق حرفياً بأي رد.`;

const RULES = `التعليمات:
1. تكلّم بالعربية فقط، وباللهجة العراقية (مو فصحى). لا تستخدم الإنجليزية أبداً.
2. جاوب بجملتين أو ثلاث للأسئلة البسيطة (سعر، حالة طلب، موقع). إذا السؤال يحتاج شرح خطوات (شلون أصمم، شلون أطلب، شلون أسجّل) تكدر توصل لخمس جمل قصيرة، بس لا تطوّل أكثر. لا تستخدم قوائم ولا عناوين.
3. اعتمد فقط على "معلومات الزبون" و"حقائق ثابتة" و"دليل استخدام الموقع" و"قائمة الأسعار" أدناه. إذا سألك الزبون شلون يسوي شي بالموقع (يسجل، يصمم، يطلب، يغير كلمة السر…)، اشرح له الخطوات من "دليل استخدام الموقع". إذا المعلومة مو موجودة، قول بصراحة إنها مو متوفرة عندك ووجّه الزبون لممثل جامعته أو صفحة الإنستغرام.
4. الأسعار: استخدم أرقام "قائمة الأسعار" أدناه فقط، وقول دائماً إنها أسعار بداية («يبدأ من»). ممنوع تخترع سعر مو موجود بالقائمة، وممنوع تحسب مجموع أو خصم بنفسك. إذا المنتج مو بالقائمة، قول ما عندك سعره.
5. حالة الطلب: إذا حالات طلبات الزبون موجودة بـ"معلومات الزبون" أدناه، فهي معلومات مؤكدة عندك — اذكرها له بوضوح ولا تقول "ما أعرف". أما إذا ماكو طلبات بالمعلومات، فقول إنها مو متوفرة عندك. وبكل الأحوال ممنوع تخترع حالة أو موعد تسليم.
6. "آخر موعد لتقديم الطلبات" هو آخر يوم يكدر الطالب يطلب بيه — وهو مو موعد تسليم الطلب. لا تقول أبداً إن الطلب راح يوصل بهذا التاريخ ولا تعد الزبون بأي تاريخ تسليم.
7. لا تذكر أي معلومة عن زبون ثاني، ولا تتكلم عن أرباح المتجر أو تكاليفه.
8. إذا الزبون طلب تعديل طلبه أو إلغاءه، وجّهه لممثل جامعته — إنت ما تكدر تسوي أي تعديل.
9. التوصيل: المتجر ما يوصّل أبداً (قرار المالك). إذا سأل عن التوصيل أو الشحن، قول بوضوح إنه ماكو توصيل وإن الاستلام من المحل بديالى (بعقوبة)، ووجّه طالب الجامعة لممثله حتى يرتّب معه الاستلام. ممنوع تخترع أجور توصيل أو استثناء لأي محافظة.
10. الأكثر مبيعاً والتوصيات: إذا سأل شنو أكثر شي ينباع أو شنو تنصحه، اعتمد فقط على سطر «الأكثر مبيعاً» بالحقائق أعلاه إذا موجود. إذا مو موجود، قول ما عندك هالمعلومة. وبكل الأحوال ممنوع تخترع سبب أو تحليل ليش هذا المنتج يُباع أكثر، وممنوع تعطي رأي شخصي أو تدّعي إن الزباين يحبون شي معيّن.
11. أسلوبك: دافي وبسيط ومختصر، مثل موظف محترم يحب شغله. نادِ الزبون باسمه إذا اسمه موجود بمعلومات الزبون. تكدر تستخدم إيموجي واحد بالكثير وبس إذا الجو يناسب — ولا تستخدم إيموجي أبداً بجواب فيه سعر أو حالة طلب.
12. ممنوع تكتب أي رابط أو عنوان موقع أو تقول «اضغط هنا». الأزرار تنضاف تحت جوابك تلقائياً من النظام، فخلّي كلامك كلام بس.
13. أسماء المنتجات: لا تسمّي منتج أو توصي به إلا إذا كان موجود بالضبط بـ"قائمة القطع المتوفرة" أدناه إذا كانت موجودة. إذا الزبون سأل عن منتج مو موجود بالقائمة، قول إنه غير متوفر حالياً بدل ما تخترع اسمه أو سعره.
14. الجامعات والكليات: إذا سألك الزبون «تسوون لجامعة/كلية معينة؟» أو أي سؤال عن جامعته أو كليته، الجواب دائماً نعم بكل دفا — المتجر يخدم كل جامعات وكليات العراق بدون استثناء، والطالب يرفع شعار جامعته بنفسه. إذا اسم جامعته موجود بسطر «الجامعات اللي خدمناها» أدناه، اذكر له إنكم سويتوا قطع لطلبة من جامعته قبل. ممنوع نهائياً تجاوب على سؤال عن جامعة أو كلية بـ«ما أعرف» أو «مو متوفرة» — هذا ما وعد بتوصيل، بس يعني نصممها له.`;

const NO_CONTEXT = `معلومات الزبون:
- الزائر مو مسجّل دخول، فما عندك أي معلومة عن طلباته.
- إذا سأل عن طلبه أو حالته، اطلب منه يسجّل دخول أول.`;

// Split from buildMessages so the exact prompt can be hashed into the cache key before the
// call is made — see the CACHE block above.
function buildSystem(contextBlock, priceBlock, bestSellerBlock, productBlock, universityBlock) {
  return [
    SHOP_FACTS, SITE_GUIDE, PERSONA, RULES, priceBlock, productBlock, bestSellerBlock, universityBlock,
    contextBlock || NO_CONTEXT,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Collapse dual-gender hedges: «هلا بيك حبيبي/حبيبتي» → «هلا بيك».
 *
 * Arabic forces a gender choice on almost every address, and an anonymous visitor gives the
 * model nothing to choose from — so it hedges and writes both with a slash. PERSONA tells it
 * not to, and it mostly obeys, but "mostly" is visible: a slash-pair is the single clearest
 * tell that a form letter wrote the sentence, on the surface whose whole job is not reading
 * like one.
 *
 * ⚠️ This is deliberately NOT in lib/answerGuard.js, and the distinction is worth keeping. The
 * guard has a veto and never a pen — a guard that rewrites text becomes a second author with no
 * idea what it is saying. This changes no claim, only an artifact of a language that has no
 * neutral second person; and the alternative — blocking the answer — would replace a perfectly
 * good reply with «ask a human» over a punctuation mark.
 *
 * Explicit pairs, not a general `X/Y` rule, so «شال/وشاح» or a date is never touched.
 */
const GENDER_HEDGE_RE = new RegExp(
  [
    'حبيبي\\s*/\\s*حبيبتي', 'حبيبتي\\s*/\\s*حبيبي',
    'عزيزي\\s*/\\s*عزيزتي', 'عزيزتي\\s*/\\s*عزيزي',
    'تدلل\\s*/\\s*تدللين', 'تدللين\\s*/\\s*تدلل',
    'بيك\\s*/\\s*بيچ', 'بيچ\\s*/\\s*بيك',
    'إنت\\s*/\\s*إنتي', 'انت\\s*/\\s*انتي',
  ].join('|'),
  'g'
);

function stripGenderHedge(text) {
  return String(text)
    .replace(GENDER_HEDGE_RE, '')
    // The removal leaves «هلا بيك ، شلونك» — tidy the orphaned space before punctuation and
    // the double space where the word used to be.
    .replace(/\s+([،,.!؟?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function buildMessages(system, history, question) {
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
    // (the storefront widget is public) and get no personal context.
    const userId = req.user?.id || null;

    // The anonymous identity is OURS, not the caller's. A client-chosen id was both a free way
    // past the throttle and — because recentTurns keys anonymous history on it — a way to wear
    // somebody else's conversation. anonSession.verify returns null for a forged, expired or
    // absent token, and the response then carries a fresh one so the visitor self-heals
    // silently instead of meeting an error. See lib/anonSession.js.
    //
    // ⚠️ A caller who never presents a token gets a freshly minted one each time, which has no
    // prior rows — so they are effectively outside the burst throttle. That is deliberate and
    // it is not the hole it looks like. The per-IP limiter in routes/assistant.js already bounds
    // them to 100 requests per 15 minutes, tighter than the throttle's own 10/minute, so
    // rotating identities buys an attacker nothing. Throttling tokenless callers by IP instead
    // would be actively worse: Iraqi carriers CGNAT, so a cohort arriving together on one
    // shared address would throttle each other — the exact trap documented for joinLimit. The
    // burst throttle's real job is catching a runaway client, and a runaway client is one
    // browser, which always presents its token.
    let sessionKey = null;
    let freshSessionToken = null;
    if (!userId) {
      const presented = req.body?.sessionToken;
      sessionKey = anonSession.verify(presented);
      if (!sessionKey) {
        try {
          freshSessionToken = anonSession.mint();
          sessionKey = anonSession.verify(freshSessionToken);
        } catch (e) {
          // JWT_SECRET missing. Answer anyway with no identity: they lose conversation memory
          // and the throttle falls back to the per-IP limiter, which is better than a 500 on
          // the shop's main marketing surface.
          console.error('anon session unavailable:', e.message);
        }
      }
    }
    // Attribution for the ledger. Hashed, never the address itself — see lib/clientIp.js.
    const callerHash = ipHash(req);

    // History is rebuilt from OUR ledger, not read from req.body. The client used to send its
    // own transcript back with its own role labels, so a caller could inject a fabricated
    // «assistant» turn ("وشاحك مجاني") and then ask the bot to confirm it — a screenshot of the
    // shop's assistant promising a free robe. The request body's `history` is now ignored.
    //
    // These run BEFORE the cap check on purpose: a cache hit costs nothing, so it must not
    // consume anyone's allowance. All three reads are indexed or memo-cached (~1ms).
    const [history, profile] = await Promise.all([
      ai.recentTurns({ userId, sessionKey, surface: 'support' }),
      supportContext.forUser(userId),
    ]);

    // «شكد سعر الروب؟» is the most common question the shop gets, and without this the bot
    // answered "I don't know" while the price sat on the page above it. The book is keyed on
    // the asker's own price role — a rep-linked student must not be quoted retail — and is
    // cached 5 minutes, so this is normally free. productDigest and universitiesDigest are the
    // other two owner complaints this branch fixes: naming real products, and never saying
    // «ما أعرف» to «تسوون لجامعتي؟» — both cached (5 min / 30 min) for the same reason.
    const priceRole = profile?.priceRole || 'retail';
    const [priceBlock, bestSellerBlock, productBlock, universityBlock] = await Promise.all([
      supportContext.priceBook(priceRole),
      supportContext.bestSellers(priceRole),
      supportContext.productDigest(priceRole),
      supportContext.universitiesDigest(),
    ]);

    const system = buildSystem(profile?.block, priceBlock, bestSellerBlock, productBlock, universityBlock);

    // Anonymous + no history only — see the CACHE block at the top of this file for why both
    // conditions are load-bearing.
    const normalized = !userId && history.length === 0 ? normalizeQuestion(question) : '';
    const cacheKey = normalized ? cacheKeyFor(system, normalized) : null;

    const signedIn = Boolean(userId);
    // Everything an answer needs beyond its own text: the chips under it, the mascot's face,
    // mood and reaction, and a fresh session token when the caller arrived without a valid one.
    const dress = (answer, { guardTripped = false } = {}) => ({
      answer,
      actions: actions.buildActions({ question, answer, profile, guardTripped, signedIn }),
      emotion: actions.pickEmotion({ question, answer, guardTripped }),
      mood: classifyMood(question, answer),
      reaction: pickReaction(question, { guardTripped }),
      ...(freshSessionToken ? { sessionToken: freshSessionToken } : {}),
    });

    if (cacheKey) {
      const hit = memoCache.get(cacheKey);
      // `hit.lastSession === sessionKey` means THIS caller is the one who last received this
      // exact text — serving it again hands the same person the same bytes twice in a row,
      // which is the single most visible «it's a bot» tell (owner report 2026-08-17: «repeats»).
      // Strangers never compare answers, so the cache stays shared across sessions; only the
      // re-asker falls through to a fresh generation, which then replaces the cached text.
      if (hit && hit.lastSession !== sessionKey) {
        hit.lastSession = sessionKey;
        // Logged so the ledger stays a complete record of what customers ask, but marked
        // `model = 'cache'` so it costs nothing and is invisible to the throttle. This is also
        // what makes repetition free rather than throttled — and what keeps the assistant
        // answering the shop's most common questions when the budget is gone (see below).
        await ai.logCached({
          userId, sessionKey, surface: 'support', question, answer: hit.text, ipHash: callerHash,
        });
        return res.json(dress(hit.text));
      }
    }

    // Claims a slot AND writes the pending ledger row in one locked transaction, so parallel
    // requests from the same caller cannot all pass the check together. See lib/aiChat.js.
    const { id: logId, error: capError } = await ai.reserve({
      userId,
      sessionKey,
      surface: 'support',
      question,
      ipHash: callerHash,
    });
    if (capError) {
      // NEVER DARK, first attempt: an exhausted budget must not turn the shop's main marketing
      // surface into an error. The most-asked questions are answerable from data we already
      // hold — the price book in `priceBlock`, and facts the owner has fixed — so answer them
      // for free rather than apologising. A throttled caller is skipped deliberately: they are
      // being asked to slow down, and answering would defeat the throttle.
      if (!capError.retryAfter) {
        const canned = fallback.answerFor({ question, priceBlock });
        if (canned) {
          await ai.logCached({
            userId, sessionKey, surface: 'support', question, answer: canned.text,
            ipHash: callerHash,
          });
          return res.json(dress(canned.text));
        }
      }

      const body = { error: capError.message, code: capError.code };
      // The throttle is a short wait, not a wall, and the UI needs to know which so it can say
      // «ارجع بعد دقيقة» instead of offering a retry button that cannot possibly work yet.
      if (capError.retryAfter) {
        res.set('Retry-After', String(capError.retryAfter));
        body.retryAfterSec = capError.retryAfter;
      } else {
        // Nothing canned fits, so at least hand over a way to reach a person.
        body.actions = [actions.shopContact()];
      }
      return res.status(capError.status).json(body);
    }

    let result;
    try {
      // temperature 0.7, not the 0.3 default: at 0.3 the model regenerates the same sentence
      // byte-for-byte for a repeated question (measured 2026-08-17), which defeats the cache's
      // same-session regenerate and reads as canned. Facts can't drift with it — every number
      // comes from the prompt and answerGuard vetoes anything that isn't there.
      result = await ai.complete({ messages: buildMessages(system, history, question), temperature: 0.7 });
    } catch (err) {
      // NEVER DARK, second attempt — and the likelier one. The model is a third-party API
      // reached over an Iraqi network, so it will time out or 502 sometimes; that is a far
      // more probable outage than an exhausted ceiling. The shop's most common questions do
      // not actually need it, so serve the data answer and leave the incident in the ledger —
      // on the SAME row the reservation already claimed, so `answer` records what the customer
      // actually saw, not just the failure.
      const canned = fallback.answerFor({ question, priceBlock });
      await ai.settle(logId, { answer: canned?.text || null, error: err.code || err.message });
      if (canned) {
        console.error(`aiChat unreachable (${err.code || err.message}) — served fallback:${canned.id}`);
        return res.json(dress(canned.text));
      }

      // Nothing canned fits this question, so the outage is visible — but «المساعد مو متوفر»
      // with nothing to tap is a dead end on the shop's marketing surface. Escalating is
      // always possible and always correct, so the error carries the way to reach a person
      // rather than being re-thrown into the generic handler.
      const status = err.status || 502;
      return res.status(status).json({
        error: err.expose ? err.message : 'المساعد مو متوفر حالياً',
        code: err.code || 'ERR_AI_UPSTREAM',
        actions: [actions.shopContact()],
      });
    }

    // ── THE GUARD ─────────────────────────────────────────────────────────────────────────
    // Checked against `system` — the exact string the model was given — so the rule is "every
    // price you stated was one we handed you", with no second list of allowed figures to drift
    // out of date. This is also the whole answer to prompt injection: whatever the model was
    // talked into believing, a wrong sentence does not leave the building. See lib/answerGuard.
    // Cosmetic normalisation FIRST, so the guard inspects the exact bytes the customer reads —
    // a guard that checks a different string than the one served is not a guard.
    result.text = stripGenderHedge(result.text);

    const verdict = answerGuard.inspect(result.text, system);
    if (!verdict.ok) {
      console.error(`answerGuard BLOCKED [${verdict.reason}] ${verdict.detail} — Q: ${question}`);
      // The blocked text is stored, not discarded: the ledger is the only record of what the
      // model actually tried to say, and it is what a prompt fix gets written from.
      await ai.settle(logId, {
        answer: result.text,
        result,
        error: `GUARD_${verdict.reason}: ${verdict.detail}`.slice(0, 500),
      });
      // Never cached — a blocked answer is exactly the one that must not be served again.
      return res.json(dress(answerGuard.SAFE_ANSWER, { guardTripped: true }));
    }

    await ai.settle(logId, { answer: result.text, result });
    // `lastSession` starts as the caller who generated it, so their own immediate re-ask
    // regenerates instead of echoing — see the cache-hit branch above.
    if (cacheKey) memoCache.set(cacheKey, { text: result.text, lastSession: sessionKey }, CACHE_TTL_MS);

    return res.json(dress(result.text));
  } catch (err) {
    return next(err);
  }
};

// Pure, for test/aiChat.test.js.
exports._internals = { normalizeQuestion, cacheKeyFor, CACHE_TTL_MS, stripGenderHedge };
