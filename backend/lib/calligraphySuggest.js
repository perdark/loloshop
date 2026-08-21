// backend/lib/calligraphySuggest.js — read what the student MEANT, propose it, generate nothing.
//
// THE PROBLEM, measured on prod 2026-08-21. 755 non-cancelled order lines hold text that is a
// message to the shop rather than a name — «خلي التطريز محمد مع حرف N» · «نفس الصورة Class of
// 2027 +المجهر» · «الاستاذة نبأ ضياء اوريد نفس الخط الموجود في الصورة». 645 of them (85%) point
// at a photo the student attached, 168 ask for a font or a style, 64 ask for a motif. 721 have
// no artwork at all and 272 of those are already sitting at التطريز.
//
// WHAT WAS TRIED AND REJECTED. A deterministic extractor (cut the sentence at the first
// instruction marker, keep the head) was run over all 755: only 77 (10%) produced something
// containing the student's actual name, 553 produced confident-looking garbage — «الحمدالله
// مثل», «شعار الشمس مثل», «نفس». Garbage that passes the name check is worse than nothing,
// because it is garbage a tired designer confirms. Defaulting to the student's registered name
// was rejected by the owner for a better reason: plenty of these are deliberately somebody
// else's name or a title — «المرشدة سرى سعد», «المحلل محمد حسن», «الدكتورة بان».
//
// SO: a language model reads the sentence and PROPOSES. Three hard rules:
//   1. It never generates and never spends image money. Output is a suggestion object.
//   2. It never writes the prompt. `style` is an id from the CLOSED list in
//      calligraphyStyles.js; anything else normalizes to null. `element` is one short motif
//      word. The student's sentence never reaches the image model.
//   3. A designer confirms every line. The workbench shows the suggestion next to the
//      student's own words and the photo; nothing is generated until a person presses.
//
// COST. This is TEXT, not an image: ~$0.00006 a line on the model the assistant already uses
// (measured ~$0.0001 per assistant message), against ~$0.10 for a calligraphy sheet. All 755
// existing lines cost about $0.08 once. Lines are batched so one call covers ten of them, and
// every call is ledgered into calligraphy_spend_log under kind='suggest', so it rides the same
// CALLIG_DAILY_USD_MAX ceiling as the image spend and can never run away unwatched.
const { complete } = require('./aiChat');
const { checkBudget, budgetError, logSpend } = require('./calligraphySpend');
const { STYLES, normalizeStyle } = require('./calligraphyStyles');
const { isRealName, normalizeAr } = require('./calligraphyText');

/** Lines per model call. Ten keeps the prompt small enough to stay accurate and cheap. */
const CHUNK = 10;
/** Hard cap per request — a designer reviews these by hand; this is an abuse bound. */
const MAX_LINES = 60;
/** One motif word, never a sentence. Anything longer is the model rambling. */
const MAX_ELEMENT_CHARS = 24;
/** A name that will be embroidered. Longer than this is the model copying the request back. */
const MAX_TEXT_CHARS = 120;

// ⚠️ THE «ميم» TRAP — owner's catch, 2026-08-21.
// «ميم مثل الصورة التي في الاسفل» came back as text «ميم», which is *correct extraction* and
// *wrong embroidery*: the student wants the LETTER م drawn like the one in their photo, and
// stitching the word م-ي-م onto a sash is nonsense nobody would catch until it is sewn. The
// lesson generalises — a request can be perfectly parsed and still not be a name — so the
// letter names are refused deterministically rather than trusted to the model's judgement.
// A student never wants the spelled-out name of a letter as their whole sash text; when they
// do want that letter, the reference IS the photo and a designer must decide.
const LETTER_NAMES = new Set([
  'الف', 'ألف', 'باء', 'تاء', 'ثاء', 'جيم', 'حاء', 'خاء', 'دال', 'ذال', 'راء', 'زاي', 'زين',
  'سين', 'شين', 'صاد', 'ضاد', 'طاء', 'ظاء', 'عين', 'غين', 'فاء', 'قاف', 'كاف', 'لام', 'ميم',
  'نون', 'هاء', 'واو', 'ياء', 'همزه', 'همزة', 'لام الف',
]);

/** True when the whole proposal is the NAME of a letter, or a single letter, rather than text
 *  somebody would wear. `normalizeAr` first so «ميم» and «مِيم» are the same word. */
function isLetterReference(text) {
  const clean = normalizeAr(text).replace(/[^\u0621-\u064A\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return false;
  const stripped = clean.replace(/^حرف\s+/, '').trim();   // «حرف الميم» → «الميم»
  const bare = stripped.replace(/^ال/, '').trim();          // «الميم» → «ميم»
  if ([...bare.replace(/\s/g, '')].length <= 1) return true;
  return LETTER_NAMES.has(normalizeAr(bare)) || LETTER_NAMES.has(normalizeAr(stripped));
}

function styleMenu() {
  return Object.entries(STYLES)
    .map(([id, s]) => `- "${id}" — ${s.label} (${s.hint})`)
    .join('\n');
}

const SYSTEM = [
  'أنت مساعد لمصمّم في محل تطريز أوشحة تخرج. الطالب كتب نصاً في خانة «نص التطريز»، وأحياناً',
  'يكتب طلباً أو رسالة للمحل بدل الاسم. مهمتك أن تقرأ النص وتقترح ما الذي يجب تطريزه فعلاً.',
  '',
  'أعد JSON فقط بهذا الشكل: {"items":[{"id":"<id>","text":<string|null>,"element":<string|null>,"style":<string|null>,"note":<string>}]}',
  '',
  'قواعد صارمة:',
  '1) "text" = الاسم أو العبارة التي تُطرَّز، منقولة كما كتبها الطالب حرفياً بدون تصحيح إملائي',
  '   وبدون إضافة أو حذف كلمات. احذف فقط الكلام الموجّه للمحل (مثل «اريد» «نفس الصورة» «خلي»).',
  '2) إذا كان النص كله طلباً ولا يحتوي أي اسم أو عبارة صالحة للتطريز، اجعل "text": null',
  '   واشرح في "note" ما الذي يطلبه الطالب. لا تخترع اسماً أبداً، ولا تستعمل اسم حساب الطالب.',
  '2ب) إذا كان الطالب يشير إلى حرف أو شكل أو رسمة («ميم مثل الصورة» «حرف N» «شعار مثل الصورة»)',
  '   فهذا ليس نصاً يُطرَّز — اجعل "text": null واكتب في "note" ما يشير إليه. لا تكتب اسم الحرف',
  '   («ميم») كنص، لأنه سيُطرَّز كلمةً بثلاثة حروف بدل الحرف نفسه.',
  '3) "element" = كلمة واحدة فقط لرمز صغير يُرسم بجانب الاسم إن طلبه الطالب (مثل «مجهر» أو',
  '   «إكليل غار»)، وإلا null.',
  '4) "style" = معرّف واحد من هذه القائمة فقط، أو null إن لم يطلب الطالب شيئاً منها:',
  styleMenu(),
  '   إذا طلب الطالب «نفس الخط الموجود بالصورة» فهذا ليس ستايلاً من القائمة — اجعل "style": null',
  '   واذكر في "note" أنه يريد خطاً مثل الصورة المرفقة ليقرّر المصمّم.',
  '5) "note" جملة عربية قصيرة جداً للمصمّم (أقل من 12 كلمة).',
  '6) لا تكتب أي شيء خارج JSON.',
].join('\n');

/** One model call over ≤CHUNK lines. Returns { items, costUsd }. */
async function suggestChunk(lines) {
  const payload = lines.map((l) => ({
    id: l.id,
    text: String(l.text || '').slice(0, 400),
    zone: l.zone || null,
    has_photo: !!l.has_photo,
  }));
  const { text, costUsd } = await complete({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify({ items: payload }) },
    ],
    // ~25 tokens per line of JSON, plus slack. Bounded so a rambling model cannot cost more
    // than a line is worth.
    maxTokens: Math.min(120 * payload.length + 80, 1400),
    // ⚠️ The assistant's default output cap is 300 tokens (2–3 sentences). This answer is a
    // JSON object covering up to ten Arabic lines; under 300 it comes back truncated, parses
    // as nothing, and the designer sees "no suggestions" on a call we already paid for.
    maxOutputCap: 1400,
    temperature: 0.1,
    jsonMode: true,
  });

  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (!parsed) {
    // Log the head, not the whole answer: enough to tell truncation from a refusal, without
    // printing students' text into the server log.
    console.error('calligraphySuggest: unparseable model answer:', String(text).slice(0, 120));
  }
  const raw = Array.isArray(parsed && parsed.items) ? parsed.items : [];
  const byId = new Map(lines.map((l) => [String(l.id), l]));
  const items = [];
  for (const it of raw) {
    const id = String((it && it.id) || '');
    const src = byId.get(id);
    if (!src) continue; // a model-invented id belongs to nobody
    items.push(clean(it, src));
  }
  return { items, costUsd: Number(costUsd || 0) };
}

/**
 * Every field the model produced, forced back inside what the system accepts. This function is
 * the trust boundary: past it, a suggestion is indistinguishable from one a designer typed, so
 * nothing loose may cross.
 */
function clean(it, src) {
  const rawText = typeof it.text === 'string' ? it.text.trim() : '';
  // A suggestion has to be embroiderable on its own terms. `isRealName` is the same check the
  // generator applies, so a suggestion that would be refused at generation is dropped here
  // instead of being offered to the designer as if it were usable. `isLetterReference` is the
  // second gate — see the «ميم» trap above: correctly parsed is not the same as wearable.
  const usable = rawText && rawText.length <= MAX_TEXT_CHARS && isRealName(rawText);
  const letter = usable && isLetterReference(rawText);
  const text = usable && !letter ? rawText : null;
  const rawEl = typeof it.element === 'string' ? it.element.trim() : '';
  const element = rawEl && rawEl.length <= MAX_ELEMENT_CHARS ? rawEl : null;
  return {
    order_item_id: src.id,
    text,
    element,
    style: normalizeStyle(it.style),
    /**
     * What this line IS, which decides what the designer can do with it:
     *   name   — there is text to embroider; «استخدم» fills the field.
     *   letter — the student is pointing at a letter or shape, not writing a name. Never
     *            offered as text; the reference is the photo.
     *   photo  — «مثل الصورة»: the attached image IS the design. Nothing to generate, and the
     *            embroidery station already shows it (productionController's `artworkOf` =
     *            plate_image_url || customer_image_url), so the piece is not blank.
     *   unclear— no name, no photo. This one needs a human to ask the student.
     */
    kind: text ? 'name' : letter ? 'letter' : (src.has_photo ? 'photo' : 'unclear'),
    note: typeof it.note === 'string' ? it.note.trim().slice(0, 160) : '',
    // What the student actually wrote, echoed back so the workbench can show the two side by
    // side without a second round trip — and so a suggestion can never silently replace the
    // reference of record.
    original_text: src.text,
  };
}

/**
 * A suggestion that proposes exactly what the student already wrote, with no style and no
 * motif, is not a suggestion — it is a row of noise the designer has to read and dismiss
 * («غفران → غفران، الطالب يريد تطريز الاسم فقط»). Reported as a count instead: «N سطر سليم».
 * Compared through normalizeAr so a difference of أ/ا or ة/ه alone does not count as a change
 * either — the generator folds those anyway, so re-typing them changes no artwork.
 */
function isNoOp(item) {
  if (!item.text) return false;               // «no name here» is real information
  if (item.style || item.element) return false; // it is proposing something beyond the text
  const a = normalizeAr(item.text).replace(/\s+/g, ' ').trim();
  const b = normalizeAr(item.original_text).replace(/\s+/g, ' ').trim();
  return a === b;
}

/**
 * Suggest for a list of lines: `[{ id, text, zone, has_photo }]`.
 * Returns `{ items, cost_usd, unchanged }`. Throws a tagged 429 when the ceiling is spent.
 */
async function suggestLines(lines) {
  const list = (Array.isArray(lines) ? lines : []).filter((l) => l && l.id && String(l.text || '').trim()).slice(0, MAX_LINES);
  if (!list.length) return { items: [], cost_usd: 0 };

  // Same ceiling as the image spend, checked before anything is bought. Text is ~1,500× cheaper
  // per call, so this will realistically never be what trips it — which is exactly why it must
  // share the ledger rather than getting a private, unwatched budget.
  const budget = await checkBudget();
  if (!budget.allowed) {
    const be = budgetError(budget);
    const e = new Error(be.message);
    e.status = be.status; e.code = be.code; e.expose = true;
    throw e;
  }

  const items = [];
  let cost = 0;
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    // One failed chunk must not throw away the chunks that worked — the designer keeps what
    // came back and presses again for the rest.
    try {
      const out = await suggestChunk(chunk);
      items.push(...out.items);
      cost += out.costUsd;
    } catch (err) {
      console.error('calligraphySuggest chunk failed:', err.message);
    }
  }
  if (cost > 0) await logSpend('suggest', cost);
  const useful = items.filter((it) => !isNoOp(it));
  return {
    items: useful,
    unchanged: items.length - useful.length,
    cost_usd: Number(cost.toFixed(6)),
  };
}

module.exports = { suggestLines, _internals: { clean, isNoOp, isLetterReference, suggestChunk, SYSTEM, CHUNK, MAX_LINES } };
