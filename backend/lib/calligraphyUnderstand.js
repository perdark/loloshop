// backend/lib/calligraphyUnderstand.js — read the WHOLE request, decide what gets generated.
//
// The successor to lib/calligraphySuggest.js, with one difference that changes everything around
// it: the output is not a suggestion a designer reads line by line, it is a SPEC the generation
// pipeline acts on. The owner's ask (2026-09-26): «اجي واولد 300 اسم بدون تعب مو اشوف اقتراح
// اقتراح». So the unit of trust moves from "a person confirmed this line" to two things below:
//
//   1. THE MODEL FILLS A FORM; CODE WRITES THE PROMPT. Nothing the student typed reaches the
//      image model. `ornament` is one of three words, `text` is checked against the student's
//      own words, and the image prompt is built by calligraphyPrompt.js from those fields only.
//
//   2. THE GUARD DECIDES WHAT RUNS UNATTENDED, NOT THE MODEL. The model reports its confidence,
//      but `guard()` independently demotes anything it cannot verify — above all a `text` that
//      contains a word the student never wrote (and that is not their account name when they
//      said «اسمي»). An invented word is the one failure a tired designer cannot see on a plate,
//      so it is refused mechanically rather than trusted to the model's honesty.
//
// Only `confidence: 'high'` after the guard is meant to generate without a person. Everything
// else goes to a SHORT exception list — the point is that it is short, not that it is empty.
//
// ⚠️ «اسمي» IS USUALLY NOT A REQUEST FOR THE ACCOUNT NAME. Measured on prod: of 36 lines
// containing it, most are dedications — «فعلتها لأجل جنة انجبتني وغالي ختم اسمي به». A rule
// "اسمي → account name" would stitch a stranger's registration name over a verse the student
// wrote. The model is handed the account name and told when it may use it; the guard then
// allows account-name words ONLY when the model says it used them.
//
// ⚠️ A LETTER IS WRITTEN AS THE LETTER. «حرف غ» → «غ», never «غين» (the «ميم» trap in
// calligraphySuggest.js: correct extraction, wrong embroidery). A merged monogram («دمج حرف م
// مع ح») is a design decision the generator cannot make reliably, so it is always low confidence.
const { completeText: complete } = require('./calligraphyProvider');
const { normalizeAr, isRealName, looksLikeInstruction } = require('./calligraphyText');

const CHUNK = 8;
const MAX_TEXT_CHARS = 120;
const MAX_MOTIF_CHARS = 24;

const KINDS = ['name', 'phrase', 'letter', 'photo_only', 'unclear'];
// Ornament is a dial, not a style menu, because that is how students ask for it («بدون زخرفة»
// · «بزخرفة قليلة» · «مزخرف» · «زخرفة كثيرة»). Owner 2026-09-26: قليل · متوسط · عالي, plus none.
// null = the shop default for that zone, i.e. what every plate rendered before the dial existed.
const ORNAMENTS = ['none', 'light', 'medium', 'rich'];

// Letter NAME → the glyph that is embroidered. Used by the guard to accept «غ» when the student
// wrote «حرف الغين», and never the other way round.
const LETTER_GLYPH = {
  الف: 'ا', باء: 'ب', تاء: 'ت', ثاء: 'ث', جيم: 'ج', حاء: 'ح', خاء: 'خ', دال: 'د', ذال: 'ذ',
  راء: 'ر', زاي: 'ز', زين: 'ز', سين: 'س', شين: 'ش', صاد: 'ص', ضاد: 'ض', طاء: 'ط', ظاء: 'ظ',
  عين: 'ع', غين: 'غ', فاء: 'ف', قاف: 'ق', كاف: 'ك', لام: 'ل', ميم: 'م', نون: 'ن', هاء: 'ه',
  واو: 'و', ياء: 'ي',
};

const SYSTEM = [
  'أنت تفهم طلبات تطريز الخط العربي في محل أوشحة تخرج. كل سطر فيه ما كتبه الطالب في خانة التطريز،',
  'واسم حسابه المسجّل، والمكان (أمام/خلف/قبعة)، وهل أرفق صورة. مهمتك أن تفهم الطلب كاملاً وتعبّئ',
  'استمارة. لا تكتب أي تعليمات لمولّد الصور — فقط الاستمارة.',
  '',
  'أعد JSON فقط: {"items":[{"id","kind","text","side_text","ornament","photo_style","motif","from_account","extras","confidence","why"}]}',
  'أعد عنصراً لكل id بالضبط، بنفس الـ id.',
  '',
  'الحقول:',
  '- kind: واحد من name | phrase | letter | photo_only | unclear',
  '    name = اسم أو لقب («الأستاذة زينب أحمد»). phrase = عبارة أو إهداء أو آية.',
  '    letter = الطالب يريد حرفاً أو حروفاً مفردة. photo_only = الصورة هي التصميم ولا يوجد نص يُكتب.',
  '    unclear = لا يمكن معرفة المطلوب، أو المطلوب ليس خطاً عربياً (حرف لاتيني، شعار، رسمة فقط).',
  '- text: ما يُكتب بالخط بالضبط، أو null.',
  '    • انقل كلمات الطالب حرفياً بإملائه هو — لا تصحّح، لا تضف، لا تحذف كلمة من الاسم أو العبارة.',
  '    • احذف فقط الكلام الموجّه للمحل: «اريد» «نفس الخط الي بالصورة» «مزخرف» «بزخرفة قليلة» «خلي» …',
  '    • اللقب أو المهنة جزء من الاسم ويبقى كما هو في بدايته: «الأستاذة» «الكيميائية» «التخديرية»',
  '      «الدكتور» «المهندسة» «فاحصة البصر» «تقني الاحيائي» — لا تحذفه أبداً.',
  '    • إذا كتب الطالب اسمه ومعه القسم أو الكلية أو الجامعة، فـ text = اللقب مع الاسم، والقسم/الكلية/',
  '      الجامعة تذهب في side_text لأنها تُطرَّز على الجهة الثانية من الوشاح.',
  '    • احذف سنة التخرج و«Class of 2027» و«لوكو/شعار» والرموز التعبيرية (♡ 🦋) — ضعها في extras،',
  '      والرمز الذي يعني رسمة (🦋 = فراشة) ضعه في motif.',
  '    • للحرف: اكتب الحرف نفسه وليس اسمه — «حرف الغين» → "غ"، «حرف (خ)» → "خ". حرفان → "م ح".',
  '- side_text: القسم أو الكلية أو الجامعة كما كتبها الطالب، أو null.',
  '- ornament: none | light | medium | rich | null.',
  '    «بدون زخرفة» «الخط عادي» «سادة» → none · «زخرفة قليلة/بسيطة/ناعمة» → light ·',
  '    «مزخرف» «مزغرف» «زخرفة متوسطة» «مع الحركات والتشكيل» → medium ·',
  '    «زخرفة كثيرة/عالية/قوية/فخمة» «مزخرف كلش» → rich. إذا لم يذكر الطالب الزخرفة → null.',
  '- photo_style: true فقط إذا كتب الطالب صراحةً أن الخط أو التصميم مثل الصورة («بنفس هذا الخط»',
  '    «مثل الصورة» «نفس الصورة»). وجود صورة مرفقة وحده لا يكفي — إذا لم يذكرها في نصه → false.',
  '- motif: كلمة واحدة لرسمة صغيرة طلبها بجانب الاسم («فراشة» «قلب»)، وإلا null.',
  '- from_account: true فقط إذا طلب الطالب صراحةً اسمه هو دون أن يكتبه («اسمي مزخرف» «اكتبوا اسمي»)،',
  '    وعندها text = اسم الحساب (الاسم الأول فقط ما لم يطلب الكامل). «ختم اسمي به» عبارة وليست طلباً.',
  '- extras: قائمة قصيرة بما طلبه وليس خطاً عربياً (سنة، شعار، حرف لاتيني، كركوشة، رمز)، أو [].',
  '- confidence: high إذا كان المطلوب واضحاً تماماً. low إذا:',
  '    • أي شيء مبهم، أو تشك في أي كلمة، أو دمج حروف، أو حرف لاتيني،',
  '    • أو يطلب ترتيباً خاصاً على الوشاح («فوق كلمة …» «تحت الاسم» «بداخلها» «مائل» «بالطول» «سطرين»)،',
  '    • أو يطلب رسمة/تصميماً لا يُكتب بالخط.',
  '- why: أقل من 10 كلمات بالعربي.',
  'لا تكتب شيئاً خارج JSON.',
].join('\n');

/** normalizeAr + only Arabic letters and spaces, so a comparison ignores marks and punctuation. */
function fold(value) {
  return normalizeAr(value)
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[^\u0621-\u064A\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Clitics that may legitimately differ between what the student typed and a clean rendering
// («والأستاذة» vs «الأستاذة»). Only used to MATCH a word, never to change the text.
function stems(word) {
  const out = new Set([word]);
  for (const p of ['وال', 'بال', 'فال', 'لل', 'ال', 'و', 'ب', 'ف', 'ل']) {
    if (word.length > p.length + 1 && word.startsWith(p)) out.add(word.slice(p.length));
  }
  return out;
}

/** Every word of `text` that is NOT found in `source` (after folding). Letters are checked as
 *  glyphs or as letter names. Returns [] when everything is accounted for. */
function inventedWords(text, source, { letters = false } = {}) {
  const src = fold(source);
  const srcWords = new Set();
  for (const w of src.split(' ')) for (const s of stems(w)) srcWords.add(s);
  const glyphs = new Set(src.replace(/\s/g, '').split(''));
  for (const w of src.split(' ')) {
    for (const s of stems(w)) if (LETTER_GLYPH[s]) glyphs.add(LETTER_GLYPH[s]);
  }
  const missing = [];
  for (const w of fold(text).split(' ').filter(Boolean)) {
    if (letters && [...w].length === 1) { if (!glyphs.has(w)) missing.push(w); continue; }
    const hit = [...stems(w)].some((s) => srcWords.has(s));
    if (!hit) missing.push(w);
  }
  return missing;
}

// Pictographs and hearts are never calligraphy. They are stripped from what gets WRITTEN — a
// student's 🦋 reaches the plate as `motif`, never as a glyph the model has to invent.
const PICTOGRAPH = /[\p{Extended_Pictographic}\u2661\u2665\u2764\uFE0F\u200D]/gu;

// «مثل الصورة» must be SAID for photo_style. Measured on the first run: the model set it on 51 of
// 75 lines that merely HAD a photo («زينة», «براء»), so the guard re-derives it from the words.
// Same idea for the ornament dial: it moves only when the student SAID something about it.
// Measured: the model set «rich» on «ٱلْكِيمِيَائِيُّ عَلِيٌّ هَيْثَمٌ» because the student typed
// the harakat, even after being told that is not a request.
const ORNAMENT_ASK = /زخرف|زغرف|زخارف|زغارف|عادي|بسيط|ناعم|حركات|تشكيل|ساده|سادة|نقش|فخم/;

const PHOTO_ASK = /صور|نفس\s*(ال)?(خط|تصميم|شكل|طريق|زخرف|عبار|رسم)|مثل\s*(هذا|هاذ|الخط|التصميم|التطريز)|بهذا\s*الخط|هذا\s*الخط|👇/;

// Words a student puts IN FRONT of the text that are about the order, not part of it
// («كتابة الادارية منار» · «نفس الدفعة التخديرية مريم»). Anything else found before the text's
// first word means the model cut the head off — measured: it dropped «الأستاذة»/«الكيميائية» on
// a dozen names the moment it was told to keep «the title and the name only».
const LEAD_INSTRUCTIONS = new Set([
  'كتابه', 'اكتب', 'اكتبوا', 'اريد', 'اوريد', 'نفس', 'الدفعه', 'دفعه', 'حرف', 'فقط',
  'بس', 'تطريز', 'خط', 'الخط', 'اسم', 'الاسم', 'اسمي', 'عبارة', 'عباره', 'العباره', 'مزخرف',
  'مزغرف', 'صوره', 'الصوره', 'مثل', 'هذا', 'هذه', 'معليك', 'امشي', 'ع', 'تكتب',
  // WHERE on the sash, not WHAT («من اليمين المترجمة تبارك…» · «من جهة يمنى …»). Measured on
  // a real rep's zone 2026-09-26: without these a correctly read name went to the exception list.
  'من', 'جهه', 'الجهه', 'يمين', 'اليمين', 'يمنه', 'اليمني', 'يسار', 'اليسار', 'يسره', 'اليسري',
  'جانب', 'الجانب', 'طرز', 'طرزوا', 'الاسم',
]);

function droppedLead(text, studentText) {
  const words = fold(studentText).split(' ').filter(Boolean);
  const first = fold(text).split(' ').filter(Boolean)[0];
  if (!first) return [];
  const at = words.findIndex((w) => [...stems(w)].some((s) => stems(first).has(s)));
  if (at <= 0) return [];
  return words.slice(0, at).filter((w) => !LEAD_INSTRUCTIONS.has(w) && ![...stems(w)].some((s) => LEAD_INSTRUCTIONS.has(s)));
}

/**
 * The trust boundary. Takes what the model said about one line and returns the spec the
 * pipeline may act on — with `confidence` demoted to 'low' and a reason whenever something
 * cannot be verified. Never promotes: a model 'low' stays low.
 */
function guard(raw, line) {
  const it = raw && typeof raw === 'object' ? raw : {};
  const kind = KINDS.includes(it.kind) ? it.kind : 'unclear';
  const tidy = (v) => (typeof v === 'string' ? v.replace(PICTOGRAPH, ' ').replace(/\s+/g, ' ').trim() : '');
  let text = tidy(it.text);
  // «حرف الغين» must stitch «غ». If the model hands back the letter's NAME, swap it for the
  // glyph here rather than trusting the prompt — this is the «ميم» trap, and it is invisible on
  // a plate until it is sewn.
  if (kind === 'letter' && text) {
    text = text.split(' ').map((w) => LETTER_GLYPH[fold(w).replace(/^ال/, '')] || w).join(' ');
  }
  if (!text || text.length > MAX_TEXT_CHARS || kind === 'photo_only' || kind === 'unclear') text = null;
  let sideText = tidy(it.side_text);
  if (!sideText || sideText.length > MAX_TEXT_CHARS) sideText = null;

  const fromAccount = it.from_account === true;
  const flags = [];
  let confidence = it.confidence === 'high' ? 'high' : 'low';

  const source = [line.text, fromAccount ? line.account_name : ''].join(' ');
  if (text) {
    const isLetter = kind === 'letter';
    const invented = inventedWords(text, source, { letters: isLetter });
    if (invented.length) flags.push(`كلمات غير موجودة بطلب الطالب: ${invented.join('، ')}`);
    if (!isLetter && !isRealName(text)) flags.push('النص ليس اسماً عربياً');
    if (looksLikeInstruction(text)) flags.push('النص ما زال يحتوي كلام موجّه للمحل');
    if (/[A-Za-z]/.test(text)) flags.push('حروف لاتينية — المولّد يكتب خطاً عربياً فقط');
    const lead = fromAccount ? [] : droppedLead(text, line.text);
    if (lead.length) flags.push(`انحذف من بداية الطلب: ${lead.join(' ')}`);
  }
  // The other side is dropped, not flagged, when it cannot be verified: the name is still right.
  if (sideText && (inventedWords(sideText, line.text).length || !isRealName(sideText))) sideText = null;
  if ((kind === 'name' || kind === 'phrase' || kind === 'letter') && !text) flags.push('ماكو نص يُكتب');
  if (kind === 'unclear') flags.push('طلب غير واضح');
  if (kind === 'photo_only') flags.push('الصورة هي التصميم');
  if (kind === 'letter' && text && fold(text).replace(/\s/g, '').length > 1) flags.push('دمج حروف — قرار تصميم');
  if (flags.length) confidence = 'low';

  const motifRaw = typeof it.motif === 'string' ? it.motif.trim() : '';
  return {
    id: line.id,
    kind,
    text,
    side_text: sideText,
    ornament: ORNAMENTS.includes(it.ornament) && ORNAMENT_ASK.test(String(line.text || '')) ? it.ornament : null,
    photo_style: it.photo_style === true && !!line.has_photo && PHOTO_ASK.test(String(line.text || '')),
    motif: motifRaw && motifRaw.length <= MAX_MOTIF_CHARS ? motifRaw : null,
    from_account: fromAccount,
    extras: Array.isArray(it.extras) ? it.extras.filter((x) => typeof x === 'string').slice(0, 5) : [],
    confidence,
    flags,
    why: typeof it.why === 'string' ? it.why.slice(0, 120) : '',
  };
}

/** One model call over ≤CHUNK lines. Lines: `{ id, text, account_name, zone, has_photo }`.
 *  Returns raw model answers keyed by line id (missing ids are simply absent). */
async function askModel(lines) {
  // Short positional ids, never the order_item UUID: on the first run the model dropped or
  // mangled whole items, and a 36-char id it must copy back verbatim is the cheapest way to lose one.
  const payload = lines.map((l, i) => ({
    id: String(i + 1),
    text: String(l.text || '').slice(0, 400),
    account_name: l.account_name || null,
    zone: l.zone || null,
    has_photo: !!l.has_photo,
  }));
  const { text, costUsd } = await complete({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify({ items: payload }) },
    ],
    maxTokens: Math.min(260 * payload.length + 150, 4000),
    maxOutputCap: 4000,
    temperature: 0,
    jsonMode: true,
  });
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  const raw = Array.isArray(parsed && parsed.items) ? parsed.items : [];
  const answers = new Map();
  for (const r of raw) {
    const idx = Number(r && r.id) - 1;
    if (Number.isInteger(idx) && lines[idx]) answers.set(String(lines[idx].id), r);
  }
  return { answers, costUsd: Number(costUsd || 0) };
}

/** A chunk, with ONE retry for any line the model skipped. A line still missing after that is
 *  not dropped: it comes back low-confidence, so it lands on the exception list instead of
 *  vanishing from a 300-name run. */
async function understandChunk(lines) {
  const first = await askModel(lines);
  let cost = first.costUsd;
  const answers = first.answers;
  const missing = lines.filter((l) => !answers.has(String(l.id)));
  if (missing.length) {
    try {
      const again = await askModel(missing);
      cost += again.costUsd;
      for (const [k, v] of again.answers) answers.set(k, v);
    } catch { /* the fallback below covers it */ }
  }
  const items = lines.map((l) => guard(answers.get(String(l.id)) || { kind: 'unclear', why: 'الموديل ما رجّع جواب' }, l));
  return { items, costUsd: cost };
}

async function understandLines(lines, { concurrency = 3 } = {}) {
  const chunks = [];
  for (let i = 0; i < lines.length; i += CHUNK) chunks.push(lines.slice(i, i + CHUNK));
  const results = new Array(chunks.length);
  let next = 0;
  let cost = 0;
  async function worker() {
    while (next < chunks.length) {
      const k = next++;
      try {
        const out = await understandChunk(chunks[k]);
        results[k] = out.items;
        cost += out.costUsd;
      } catch (err) {
        results[k] = chunks[k].map((l) => guard({ kind: 'unclear', why: `فشل الاتصال: ${err.message}` }, l));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
  return { items: results.flat(), cost_usd: Number(cost.toFixed(6)) };
}

module.exports = {
  understandLines,
  _internals: { guard, fold, inventedWords, droppedLead, understandChunk, PHOTO_ASK, ORNAMENT_ASK, SYSTEM, LETTER_GLYPH, KINDS, ORNAMENTS },
};
