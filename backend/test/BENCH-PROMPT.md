# البرومبت — انسخه حرفياً لكل وكيل

> لا تغيّر ولا كلمة بين الوكيلين. لا تضيف توضيح. لا تجاوب على أسئلة أثناء التنفيذ.
> إذا تدخّلت، الجولة باطلة وتُعاد.

---

```
اقرأ backend/test/calligraphyRerollAudit.test.js — هو العقد. لا تعدّله ولا تعدّل أي اختبار
موجود؛ أي تعديل عليه يبطل الشغل.

نفّذ شيئين:

1) backend/lib/calligraphyRerollAudit.js
   يصدّر { textFeatures, analyze } بالضبط كما يصفهما الاختبار. دوال صرفة — ممنوع أي
   استيراد لقاعدة البيانات أو الشبكة أو نظام الملفات في هذا الملف.

2) backend/scripts/calligraphy-reroll-audit.js
   سكربت CLI يقرأ صفوف calligraphy_plates عبر lib/db، يمرّرها على analyze()، ويطبع
   تقريراً مقروءاً: النسبة العامة، ثم كل بُعد مرتّباً بالأثر مع n لكل شريحة، والشرائح
   ضعيفة العيّنة موسومة بوضوح.
   قراءة فقط: ممنوع INSERT / UPDATE / DELETE / ALTER في أي مسار كود يلمسه هذا السكربت.
   يدعم ‎--min-sample=N‎ و‎--json‎.

الهدف من التقرير: يجاوب «أي خصائص اللوحة تتنبأ بأن تحتاج إعادة توليد مدفوعة».

معيار النجاح الوحيد:
  cd backend && node --test test/calligraphyRerollAudit.test.js
  → 17 نجحت، 0 فشلت

اشتغل لحد ما يخضرّ. لا تسألني شيئاً.
```

---

## قبل ما تبدأ

```bash
cd ~/Desktop/active/loloshop
git add backend/test/calligraphyRerollAudit.test.js
git commit -m "test(calligraphy): عقد تدقيق إعادة التوليد — قبل التنفيذ"
git rev-parse HEAD        # سجّل هذا = الأساس
```

## الجولة أ — Claude Code

```bash
git checkout -b bench/claude-opus5
claude   # الصق البرومبت
```

## الجولة ب — Codex

```bash
git checkout <الأساس>
git checkout -b bench/codex-sol
codex    # الصق نفس البرومبت
```

⚠️ **ابدأ من `<الأساس>` مو من فرع Claude** — وإلا Codex يشوف الحل جاهز.

## سجّل هذي — كلها مقيسة

| | Claude | Codex |
|---|---|---|
| خضرّ من أول محاولة؟ | | |
| دقائق حتى 17/0 | | |
| مرات ضغطت ESC | | |
| `git diff --stat` أسطر | | |
| كتب INSERT/UPDATE بالسكربت؟ | | |
| عدّل الاختبار؟ (= رسوب فوري) | | |

بعد الجولتين:
```bash
git checkout bench/codex-sol -- backend/lib/calligraphyRerollAudit.js  # جرّب تبادل التنفيذ
node --test test/calligraphyRerollAudit.test.js
```
إذا تنفيذ كل واحد ينجح بنفس الاختبار، الفرق كان بالرحلة مو بالنتيجة — وهذا بحد ذاته جواب.

## ثم القياس الحقيقي

شغّل الفائز على الإنتاج واقرأ الرقم:
```bash
node scripts/calligraphy-reroll-audit.js --min-sample=10
```
هذا اللي يقلّك **ليش** الخط يحتاج إعادة توليد — وهو السؤال اللي بدأت منه.
