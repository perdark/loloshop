# Progress

## 2026-09-06 (b) — 🔍 رف التجهيز: عطلتان بالتلفون، وبحث واحد يلكَه الطقم كامل

فرع `feat/staff-activity`، **ما انعمل commit بعد**. 6 ملفات: `backend/lib/shelf.js` ·
`backend/test/shelf.test.js` · `frontend/lib/shelf.ts` · الثلاثة مكوّنات بـ
`frontend/components/staff/shelf/`.

**العطلتان اللي بلّغ عنهن المجهّز:**
1. **الصفحة كلها كانت تطيح** لمّا أول تحميل يفشل — `ShelfConsole` يكتب `board!.shelves`، فـ
   `board` فاضي يعني `TypeError` ويروح للـ error boundary بدل ما يبيّن شريط الخطأ اللي هو
   أصلاً مكتوب فوقه. هسه يبيّن «تعذّر تحميل الرف» + **«إعادة المحاولة»**. مقاس حيّاً: طفّينا
   الـAPI، عملنا reload، طلع الشريط والزر بلا طيحة، وبعد ما رجع الـAPI الزر رجّع الشاشة.
2. **ما ينخبل يسحب (scroll)** بنافذة الخانة ولا بـ`PlaceSheet` — ماكو `max-h` ولا
   `overflow-y`، فخانة وشاح مشتركة بعشرين قطعة تطلع فوق حافة تلفون ٣٩٠ ولا «إغلاق» ولا آخر
   الطلاب يوصلهم. هسه `max-h-[85/90dvh] overflow-y-auto overscroll-contain`. متحقَّق:
   `overflow` صحيح، والسحب يوصل آخر القائمة.

**وثالثة ما انبلّغت وهي الأصل:** شبكة الرف كانت
`repeat(min(slots,15), minmax(0,1fr))` — على ٣٩٠ بكسل تقسم ~٣٢٠ على ١٥ وتطلع **خانة بعرض
٢٠ بكسل**: لا الرمز ينقرا ولا هي هدف لمس. صارت `repeat(auto-fit, minmax(58px,1fr))`.
مقاس: **٣٩٠ → ٤ أعمدة بعرض ٧٠ وارتفاع ٧٤، وبلا سحب أفقي**؛ و٥٥٥ → ٧ أعمدة بعرض ٥٩.

**البحث — الطلبات الثلاثة للمالك، كلها بصندوق واحد فوق الشاشة:**
· يلكَه بـ**تطريزة الوشاح**: `buildBoard` صار يرسل `search_text` (نفس تعبير
  `string_agg(DISTINCT customer_text)` اللي بـ`productionController`) على قطع الطقم وصندوق
  الوصول والخانات والمجموعة.
· **لكَى الوشاح = ورّى الطقم كامل**: المطابقة صارت **بالطالب** مو بالقطعة، والقطعة المسكّنة
  صار عليها `student_id` (الخانة المشتركة ما إلها صاحب، فما كانت تكدر تجاوب). مثبّت حيّاً:
  كتبنا «غضبان» — كلمة موجودة **بس** بتطريزة الوشاح ومو باسم الطالبة («Malak Khalid») —
  فانضوّت **B01 (وشاح) و C01 (قبعة)** على رفّين مختلفين وانطفت الـ٣٠ الباقية.
· **بحث التسكين**: نفس الصندوق يفلتر «وصلت توّا»، و**حد الـ١٢ ينلغي وقت البحث** حتى ما
  يخفي الصف المطلوب. مقاس: «نورالهدى» → صفّين، بحث فاضي المعنى → «ما لكَينا شي»، ومسح
  البحث → يرجع ١٢.
· كتابة رمز الخانة («B01») تلكَها هي بعد. وداخل الخانة، قطعة الطالب المطابق تنرفع لأول
  القائمة وتنحدّد بإطار.

**الاختبارات:** `shelf.test.js` **١٧ ناجح / ٢ متخطّى**، منها اختبار جديد يثبّت `student_id`
و`search_text` على قطعة مسكّنة. الطقم الكامل ٧٠٥: الفواشل الوحيدة هي `appPresence` و
`pushBroadcast` — **نفسها بالضبط قبل التغيير وبعده** (تحققنا بـstash)، زائد تداخل
`adminNumbers.test.js:139` الموثّق أصلاً. `tsc` و`lint` نظاف.

⚠️ **الـdev DB رجع لحالته**: سكّنّا قطعتين لـMalak Khalid للتجربة وحرّرناهن — التسكينات
الحيّة رجعت ٢ مثل ما كانت.

⚠️ **`frontend/.env.local` كان يأشّر على `192.168.0.129`** (عنوان اللابتوب القديم) فكل نداء
API يفشل بالتطوير. صار `192.168.0.125`، ونفس الشي بـ`CORS_ORIGIN` بالباك-إند.
## 2026-09-06 — 🧵 «التجميع» (Track 2B) — مرحلة جديدة لوشاح الممثل بين التطريز والكوي

فرع `feat/assembly-stage`، ثماني كومتات، **ترحيل 106** (103–105 انحجزن للملاحظة بجلسة ثانية كانت
تكتب بنفس المجلد — الشغل صار بـworktree منفصل `~/Desktop/active/loloshop-assembly`).

**القاعدة (المالك، 2026-09-06):** التجميع **لوشاح الممثل فقط** — لا روب ولا قبعة ولا تجزئة، و«ما
في وشاح بلا تطريز». `isAssemblyPiece` بـ`productionController.js` هي الفرع الوحيد بين المسارين،
للأمام (`nextStageFor`) وللخلف (`resolveRevertTarget`). القطع اللي بالخط ما تتحرك (D9، بلا backfill).

- **DB:** `assembly` بـ`order_status` و`assembler` (مجمّع) بـ`staff_type`، بترحيل لحاله لأن
  `ALTER TYPE … ADD VALUE` ما تنستعمل بنفس المعاملة.
- **السيرفر:** آخر تِكة تطريز على وشاح ممثل → `assembly` (نفس الـauto-advance). بعدها الكوي أو التجهيز
  حسب `needs_pressing`. الرجوع من الكوي لوشاح ممثل يرجّع للتجميع. كل الحواف مفتوحة لكل خط الإنتاج
  (قاعدة 08-31)، مغلقة للمفصل. وشاح ممثل بلا تطريز (المسار موجود بالكود) يتولد بالتجميع بدل الكوي.
  `applyZoneTick` يبثّ حدث بكل تِكة حتى اللوحة تتحدث حيّة.
- **`GET /production/assembly`:** «واصلة» (تطريز + ≥1 منطقة) و«جاهزة» (status = assembly)، بلا فلوس
  ولا أرقام، ترث بوابة موافقة الممثل من الـWHERE. المفصل 403.
- **الواجهة:** `AssemblyBoard.tsx` لبرزان (`/staff` إذا نوعه الأول مجمّع، وفوق القائمة على
  `/staff/queue?stage=assembly` للجميع). كل الخرائط/الألوان/الروابط تعرف المرحلة. «مجمّع» يُختار من
  `/staff/team` (`STAFF_TYPES` بالأدمن كانت قائمة مغلقة).
- **اختبارات:** 14 جديدة (`assemblyStage.test.js` نقية، `assemblyBoard.test.js` على القاعدة). الحزمة
  714/719 — الثلاثة الساقطة قديمة (`app-open` المعروف، `pushBroadcast` يسقط على `main` النظيف،
  `anonymousDevicePush` تداخل تشغيل متوازي ويمرّ لحاله).
- **متصفح (عرض لابتوب):** تِكة خلف → ظهرت «واصلة» حيّة بلا تحديث · تِكة أمام → «جاهزة» مع
  «إنهاء التجميع، نقل للكوي» · الضغط → الكوي · رجوع المكوجي → رجعت للوحة. ⚠️ **عرض التلفون ما
  انقاس** — `resize_window` رجع للعرض الكامل، الجلسة الخامسة على التوالي.

**بعد النشر، الأدمن:** يعطي برزان `مجهّز + مجمّع` من `/staff/team`. ⚠️ نسخة التطوير المحلية:
مستخدم `loloshop` مو مالك الـenum types، فـ`npm run migrate` يفشل على أي `ALTER TYPE` — طبّق
الترحيل بـ`psql postgresql://postgres@127.0.0.1:5433/loloshop` (بلا كلمة سر).


## 2026-09-06 — 🚀 أربعة نشرات لبروديكشن، و«التجميع» جاهزة للبدء بجلسة جديدة

كلها على `main` ومنشورة ومتحقَّق منها (الموقع 200، `/api/health` 200):

1. **`e99f596` — سجل النشاط.** يقرأ بالعربي، مجمّع باليوم، وبأسماء الطلاب والقطع، ويوحّد
   `staff_activity_log` مع `audit_log` — تِكات مناطق التطريز كانت مكتوبة بالثاني وما تقراها أي
   شاشة، فمحمد عماد عنده **١٣٤ تِكة** ما كانت توصل لأي مكان. وانضاف فلتر شهر.
2. **`1872454` — بوابة `npm audit` كانت تمنع أي نشر**، لا هذا الفرع وحده: تحذيران صدرا بعد
   ٢٠٢٦-٠٩-٠١ (`qs` بالخلفية، و`fflate` عبر `three-stdlib` بالواجهة). `qs` انرقّى 6.15.2 →
   6.16.0، وحزمة الـ3D كلها (`three` + `@react-three/{drei,fiber,postprocessing}`) **محذوفة**
   لأن ولا ملف مصدر يستوردها — قرار «لا ثلاثي أبعاد» موثّق من زمان. صفر ثغرات بالطرفين.
3. **`36689e8` — بصمة الجهاز** (جلسة ثانية، انكتبت بنفس الشجرة): الجهاز صار يكَول نوع البصمة
   بدل ما السيرفر يخمّن من الساعة، وخمس علل مقاسة على الإنتاج (شفت ليلي · ١٢ بصمة انرمت
   «مكررة» يوم ٠٩-٠١ · يوم وهمي بعد منتصف الليل · «إلغاء مبلغ التأخير» كان يجمّد اليوم ·
   خصم ٤٠٬٠٠٠ بتاريخ غلط بسبب المنطقة الزمنية).
4. **`d642928` — زر ✕ يمسح البحث** بثمان خانات بحث للموظفين. بلّغ عنها **برزان (مجهّز)**:
   ما يكدر يمسح، فالقائمة تبين فارغة والصفوف بس مفلترة. السبب إن `type="search"` يرسم زر
   مسح أصلي بمتصفح اللابتوب بس **مو مضمون داخل غلاف Capacitor** على الآيباد والتلفون — فالشغلة
   تبين مكتملة من اللابتوب وهي مو مكتملة. صار مكوّن واحد `components/ui/SearchField.tsx`.
5. **`02e21fd` — «ملاحظة» على كل قبعة ووشاح** (ترحيل **103**)، للطلاب العاديين فقط، اختيارية.
   ⚠️ **قِيلَ للمالك أولاً إنها بيانات بلا كود — وهذا كان خطأ**: مجموعة اسمها «ملاحظة» مو ضمن
   قائمة الحقول المكتوبة بـ`OptionGroupField`، فتنعرض كرقاقة لازم تُنقر قبل ما تبين خانة
   الكتابة. ولهذا مجموعة «ملاحظة» اللي انعملت سابقاً على الشال الأمريكي قاعدة `active=false`
   وبلا خيارات. `is_embroidery = FALSE` صريحة (NULL معناها «نعم تطريز») و
   `price_role_restriction = 'retail'`. ١٢ وشاح + ٦ قبعة على نسخة التطوير، وإعادة التشغيل
   ١٩ ← ١٩ بلا تكرار. ٣ اختبارات جديدة.

**⚠️ درس الجلسة: جلستان كانتا تكتبان بنفس مجلد العمل.** انكشفت لمّا ظهرت تعديلات ما كتبها أحد
بهذه الجلسة (`attendanceDevice.js` تغيّر وسط أمر يقرأه). git رفض `checkout main` وحمى الشغل،
وانأخذت نسخة أمان بـ`git stash create` بلا لمس الشجرة (`wip/attendance-late-departure`).
القاعدة بـCLAUDE.md العام — جلسة وحدة بالوقت الواحد — كلفتها الحقيقية هي هاي.

**التالي: «التجميع» (Track 2B) — جلسة جديدة، `/effort max`.** المالك جاوب اليوم:
قبل **الكوي**، و**كل قطع الممثلين** لا المطرَّزة فقط — وهذا يقلب D2، فولادة القطع العادية
(`fullSetOrder.js` + `cartController.js`) صارت ضمن الشغل. وفوّض ثلاث قرارات انكتبت بالمواصفة
كـ**D9** (القطع اللي بالخط الآن ما تتحرك — بلا backfill) و**D10** (الترحيل صار **104** لأن 103
انحجزت للملاحظة، وقيمة الـenum بترحيل منفصل قبل الكود لأن `ALTER TYPE … ADD VALUE` ما تنستعمل
بنفس المعاملة اللي تضيفها). التقدير: ٦–٨ ساعات بالخطة، وأكبر نطاق أثر بين ما تبقّى.

## 2026-09-06 — 🖐️ البصمة: الجهاز صار يكَول شنو نوع البصمة (مرفوع ومثبَّت على الإنتاج)

**السبب الجذري الواحد تحت كل الأخطاء:** كل بصمة بالمحل — ١٧٣ بصمة — وصلت بـ`raw_status = 0`،
لأن خاصية «Punch State» بجهاز K40 كانت مطفية. يعني السيرفر ما كان يعرف إذا البصمة دخول أو
خروج أو خروج مؤقت، فكان **يخمّن من الساعة**. كل عيب أدناه هو تخمين غلط.

**اليوم المالك فعّل الخاصية على الجهاز نفسه بالجلسة** (Punch State = Manual، أربع أزرار،
Punch State Required = ON، Timeout 10ث — أقصى ما يسمح به الفيرموير). القيم **انقاست بالضغط
على الجهاز الحقيقي وقراءة `punch_raw`**، مو من كتيّب:

| القيمة | المعنى | الزر |
|---|---|---|
| 255 | ما ضغط شي («Welcome») | — |
| 0 | دخول | ▲ |
| 1 | خروج نهائي | ▼ |
| **4** | **أطلع مؤقت** — يبدي عدّ السماح | **←** |
| **5** | **رجعت** — يوقف العدّ | **→** |

⚠️ **4 و5 معكوسات عن أسماء الجهاز الإنكليزية، بأمر المالك.** الجهاز يسمّي ← «Break-In»
و→ «Break-Out»؛ المحل يعلّم ← «أطلع» و→ «رجعت»، والملصق العربي على الجهاز هو المرجع. تعديل
الخريطة حسب وثائق ZKTeco يعكس بداية ونهاية كل خروج مؤقت — والفلوس تمشي وراه.

### خمسة عيوب مصلَّحة، كلها مقاسة على بيانات الإنتاج

1. **شفت ليلي: تأخير وهمي بيوم كامل.** `lateMinutesFor` كان يزيد ٢٤ ساعة كل ما البصمة أبكر
   من بداية الدوام، حتى لو `resolveStamp` قرر إنها تخص دوام الليلة الجاية. مضر محمد انسجّل
   متأخر **1410 · 845 · 994 · 993 · 742** دقيقة بخمسة أيام متتالية، وكل وحدة منهن وصول
   **مبكر**. الزيادة صارت مربوطة بـ`belongs_to_previous_day` ومنقولة لدالة وحدة
   (`schedule.stampMinutes`) لأن `shiftIsOver` كان يعيد اشتقاقها بنسخة ثانية.

2. **انقطاع الجهاز كان يدمّر اليوم.** سماح الـ٥ دقائق كان يقيس على `punched_at` — وقت الوصول
   للسيرفر. يوم ٠٩-٠١ رجع الجهاز من انقطاع ورفع **٢١ بصمة كلها بنفس الدقيقة 20:39**، فانرمت
   **١٢** منهن كـ«مكررة»: يوم كل موظف انطوى على أول بصمة وضاع خروجه، و٧ سجلات انصلّحت بـSQL
   يدوي. صار يقيس على `device_ts`، وما يرمي إلا تكرار **نفس الزر**.

3. **بصمة بعد منتصف الليل كانت تفتح يوم وهمي.** الدوام 10:00→22:00 ما يعبر منتصف الليل، فبصمة
   00:17 كانت تنقرأ «دخول يوم جديد»: خروج محمد عماد ٠٩-٠٢ الساعة 00:17 صار دخوله ليوم ٠٩-٠٣،
   ويوم ٠٩-٠٢ انسكّر بخروج **مفبرك** 22:00؛ وسجل محمد عادل يكَول إنه «دخل» ٠٩-٠٦ الساعة 05:12.
   صارت تسكّر اليوم السابق ضمن نافذة **٦ ساعات** بعد نهاية الدوام و**قبل الساعة ٨ الصبح**،
   وضغطة ▼ تتجاوز حد الساعة ٨.

4. **«إلغاء مبلغ التأخير» كان يجمّد اليوم كله.** الزر كان يحطّ `status='overridden'`، واللي
   معناها عند الجهاز «ما ينلمس». يوم ٠٩-٠٤ انرمت بصمات محمد عماد 18:21 و18:32 و23:02 كـ«ما
   ينلمس»، وانفبرك خروجه الساعة 00:00. انفصلت النية بـ`freeze_day` (افتراضياً TRUE فما تغير
   شي عند أي مستدعي قديم)، والزر يرسل `freezeDay: false`، و`overridden_at` — مو `status` — هي
   اللي تحمي قرار الإدارة بالمبلغ من قاعدة ٣.

5. **`dateOnly` كانت تخسر يوم.** كانت تستعمل `toISOString()` على تاريخ من `pg`، والسيرفر على
   Europe/Berlin — فخصم علي اديب الحي مكتوب «بتاريخ 2026-09-01» لخروج مؤقت صار يوم ٠٩-٠٢.

### فلوس وبيانات على الإنتاج

- **سماح الخروج المؤقت 600 → 300 دقيقة.** المالك قال ٥ ساعات؛ قاعدة البيانات كانت على ١٠.
  الضِعف هو ليش علي اديب انخصمت منه ٤٠ دقيقة بدل ٣٤٠.
- **عُكس خصم علي اديب 40,000 دينار.** خروج مؤقت **٦٤٠ دقيقة** يوم ٠٩-٠٢ ما صار: بصم خروج
  مؤقت 11:22، ما بصم عودة (الجهاز ما كان بيه زر عودة أصلاً)، وخروجه 22:02 سكّره كخروج مؤقت
  ١٠ ساعات و٤٠ دقيقة — أكل سماحه الشهري كله. الصف صار `cancelled` (مو محذوف — يبقى دليل إن
  بصمة انضغطت)، والحركة انمسحت soft-delete. بعدها: **0 مستهلك · 300 باقي · 0 مخصوم**.
  ⚠️ عُكس **قبل** تخفيض السماح ما ينفّذ عليه: لو ضل الصف وأعاد `recomputeMonth` الحساب على
  300 كان صار الخصم **~370,000** بدل 40,000.
- **أرقام الجهاز:** PIN 12 (إصبع المالك للتجريب) انرفض — ٢٠ بصمة. باقي بلا اسم: **1 (٥) ·
  7 (٥) · 8 (٢)**.
- **نسخة احتياطية أُخذت قبل أي كتابة:** `/root/loloshop-prod-2026-09-06.dump` (7.3 MB).

### التحقق — على الإنتاج، بإصبع حقيقي

بصمة **id 187 · PIN 11 · علي اديب · 17:37:03 · raw_status = 4** ← «بصمة خروج مؤقت»، وانفتح صف
`staff_attendance_breaks` بحالة `out`, `approved`, 1000 دينار/دقيقة، ويومه نظيف (دخول 10:08،
تأخير 0). ⚠️ **نصف «رجعت» ما انشاف** — الجلسة انتهت قبل ما يرجع من خروج مؤقت حقيقي ٣٠ دقيقة.
المتوقّع عند ضغطه →: ~30 دقيقة · `auto_closed = false` · 30 مجانية · 0 مخصومة · 270 باقي.

١٥ اختبار جديد (P1–P6 الأزرار · N1–N2 الشفت الليلي · M1–M3 بعد منتصف الليل · F1–F2 تجميد
اليوم). **696/701** اختبار خلفية — نفس الفشل الموجود أصلاً على `main` قبل التعديل.
`tsc --noEmit` نظيف. الكوميت `36689e8`، مدموج ومرفوع على `main` (`d642928`) ومُتحقَّق منه على
الصندوق: `PUNCH_STATE` موجودة بملف الإنتاج، `/api/health` 200، صفر أخطاء بصمة بالسجل.

### باقي مفتوح

- **ساعات مضر محمد** بالنظام **22:16 → 10:15** وكل بصماته نهارية، وخصمه للدقيقة **صفر**.
  المالك يسأل العميل. لين ينصلّح تضل أرقامه غلط — بيانات، مو كود.
- **أسماء الجهاز** انرسلت وقبلها الجهاز (١٥ أمر `done`, `result_code = 0`، و٨ أرقام
  `confirmed`) بس **بالعربي**، وشاشة K40 ما بيها خط عربي فتظهر فارغة. لازم `userInfoBody`
  ترسل لاتيني ثم يُعاد دفع الأسماء الثمانية.
- **مراقبة Required = ON مع Timeout 10ث.** البصمة المرفوضة **ما تترك أي صف** — العلامة الوحيدة
  هي يوم بلا دخول. لازم تنبيه بشاشة الإدارة.
- **الرقمان ٦ ساعات و٨ الصبح تخمين.** لو أحد يطلع بعد الساعة ٤ فجراً لازم توسيع النافذة.


## 2026-09-02 (b) — 📱 مراجعة واجهة الموظفين على التلفون (Track 5.2، نصف «القياس» — بلا تعديل كود)

قراءة كود فقط، لأن ما في أي طريقة لفتح عرض 390px على هذا الجهاز؛ كل نتيجة مكتوبة بصيغة كلاس/توكن/رقم
سطر قابل للـgrep. التقرير: `docs/superpowers/specs/2026-09-02-staff-ui-phone-pass.md`.
كاشف impeccable شُغّل بمعزل (صفر نتائج على 48 ملف — لكنه لا يقرأ كلاسات Tailwind، فالأدلة من الـgrep).

**الحكم:** المشكلة مو صِغر الشاشة، بل **كثرة ما فوق الشغل**: بحساب الكلاسات، أول طالب بقائمة
المطرّز يبدأ عند 514–622px على شاشة 360×640 — يعني تحت الطية. الثلاثة الكبار: (1) رأس الصفحة
+ زر «تحديث» + التبويب + بطاقة الفلاتر + التذكير كلها قبل القائمة، (2) ما في شريط تنقل سفلي
للموظفين بينما الطالب والممثل عندهم، (3) النص الشغّال 12px (`text-xs` ×225، وأقل منه ×74)،
ونص التطريز نفسه بالشيت `truncate text-xs` مع `title` ما يشتغل باللمس. وتحتهم «مو متناسق»
الحقيقي: 8 تسريبات كلها ميكانيكية — لوحة ألوان hex قديمة على شاشات الرف (85 قيمة)، ألوان
نجاح/تحذير من 5 مصادر + أزرق `sky-*` بأداة الخط، نظامان للأرقام على نفس الشاشة، مسافات خارج
السلّم (`space-y-2.5`/`p-3.5`/`space-y-5`)، ثلاث حشوات للبطاقات (p-4/p-5/p-6)، زرّا رجوع
بصفحة الطلب، شريط تمرير ظاهر بأشرطة الرقائق بسبب `*::-webkit-scrollbar` العام، و`tracking-wide`
على نص عربي + أوزان خط (`font-black`) غير محمّلة. **8 من 8** أسطح سفلية ثابتة بلا
`safe-area-inset-bottom`. ملاحظة للخطة: الجدول ذو الـ9 أعمدة في `admin/attendance/page.tsx:488`
هو جدول *إعدادات الموظفين* (5 حقول إدخال بكل صف — الأسوأ على التلفون)، وجدول اليوم الفعلي
عند `:920` وفيه **10** أعمدة.

**التالي (5.2 نصف «الإصلاح»):** توكنات أولاً (`--text-xs/--text-sm` + `--color-success` +
`.chip-strip`)، ثم `StaffBottomNav`، ثم `StationHeader` بدل PageHeader بالمحطات، ثم الأشرطة
والشيت مع safe-area، ثم كنس ميكانيكي بوكيل فرعي بقائمة الـgrep بالملحق A. الجداول → بطاقات تركب
مع Task 1.3.

## 2026-09-02 — 🔍 تتبّع «النشاط والحركات» (تجميع دليل قبل أي إصلاح، Track 4.1)

قراءة كود + قراءة مباشرة من نسخة قاعدة البيانات المحلية فقط — لم تُشغَّل خوادم التطوير هذه
الجلسة رغم أن التعليمات افترضت أنها تعمل (`ss`/`curl` أكّدا إغلاق المنفذين 3000 و4000)، فلا
توجد لقطات شاشة من متصفح لهذه الجولة؛ كل رقم أدناه مقروء من الكود أو من `psql` على نسخة
127.0.0.1:5433 (مع التحقق من `inet_server_port()=5433` قبل أي كتابة، وإرجاع كل شيء لحالته
الأصلية بعدها).

**سبعة عيوب مؤكدة أو مرفوضة بدليل file:line:**

1. ✅ **`/staff/team` يطبع مفاتيح خام.** `frontend/app/staff/team/page.tsx:430` يطبع
   `act.action` كما هو (`advance`, `revert`, …)، و`:433` يطبع `{act.fromStage} ← {act.toStage}`
   بقيم enum الخام (`embroidery`, `pressing`, …) — الملف لا يستورد `ORDER_STATUS_LABELS` إطلاقاً.
2. ✅ **`lib/admin.ts:1947-1957` يُسقط `product_name`/`student_name`** رغم أن الباك-إند يرجعهما
   فعلاً (`salaryController.js:368-369`). المقارنة: `lib/staff.ts:1394-1416` (لـ`/staff/me`)
   ينقلهما بشكل صحيح لنفس شكل الصف — الثغرة في `admin.ts` تحديداً.
3. ✅ **يعرض أول 8 فقط، لا فلتر شهر، والـ API يحدّ بـ200.** `page.tsx:426` (`slice(0,8)`) بلا زر
   "عرض المزيد"، والعنوان فوقها (`:423`) يطبع عدد المصفوفة المجلوبة (٢٠٠ حداً أقصى) وكأنه
   الإجمالي الحقيقي. `salaryController.js:377` = `LIMIT 200` بلا أي `WHERE` على التاريخ.
   **قياس حقيقي:** برزان (مجهّز) لديه **844** صفاً في `staff_activity_log` — الشاشة تعرض 8 من
   200 مجلوبة، و**644** صفاً غير قابلة للوصول من هذه الشاشة إطلاقاً.
4. ⚠️ **مرفوض كما وُصف، لكن تحته ثغرة حقيقية.** `StaffSidebar.tsx:298-308` **لا** يعرض «الموظفون»
   لمدير (`role='staff'`, `staff_types={manager}`) — الرابط حصراً لـ`isAdmin`
   (`user.role==='admin'`, سطر 258)، وهذا لم يتغيّر عن `main`. **لكن** `staff/team/page.tsx` لا
   يملك أي حارس صلاحية خاص به — فأي موظف يكتب الرابط مباشرة (أو يعود إليه من سجل المتصفح) يفتح
   الصفحة، وكل نداءاتها (`getAdminStaff`, `getStaffSalary`, `getStaffActivity`, `getStaffGoal`)
   محجوبة بـ`requireRole('admin')` في `backend/routes/admin.js:17` → 403 + «تعذر تحميل بيانات
   الراتب» فعلاً، لكن عبر مسار وصول مختلف عمّا افترضته الخطة.
5. جزئي: **`/staff/me` يترجم فعلاً** (`ACTION_LABELS`, `stageLabel` مبنية على
   `ORDER_STATUS_LABELS`، ويطبع `productName`/`studentName`) — شق «المفاتيح الخام» غير موجود
   هنا. لكن ✅ **مؤكد** الشق الآخر: `page.tsx:243-244` قائمة مسطّحة `activity.map` بلا أي تجميع
   حسب اليوم، ونفس حد الـ200 من `getMyActivity` (`salaryController.js:401-426`).
6. ✅ **تِكات مناطق التطريز تُكتب في `audit_log` لا `staff_activity_log`.**
   `productionController.js:1354-1370` (`applyZoneTick`) يكتب `action='embroidery_zone'` في
   `audit_log` فقط. **قياس حقيقي** على محمد عماد (المطرّز الوحيد): **905** صفاً في
   `staff_activity_log` مقابل **134** صفاً `embroidery_zone` في `audit_log` — لا شاشة تقرأ
   `audit_log`، فحوالي ثُمن عمله اليومي الفعلي غائب عن سجل نشاطه في كلا الشاشتين.
7. ✅ **`/workshop` دفتر منفصل تماماً** (`workshop_production_entries`/`workshop_adjustments`،
   `workshopController.js:123-158`) ويترجم بشكل صحيح فعلاً (`ProductLabel_ar` إلخ في
   `workshop/page.tsx:120`). يحمل نفس نمط الحد الثابت (`limit=100` افتراضياً) لكنه **غير مُصاب**
   حالياً — أكبر عدد صفوف لعامل واحد على القاعدة المحلية هو **34**، أقل بكثير من الحد.

**عيوب جديدة لم تذكرها الخطة:**
- عنوان «النشاط الأخير (N)» في `/staff/team` يطبع طول المصفوفة المجلوبة (حتى 200) لا الإجمالي
  الحقيقي — يخفي وجود مئات الصفوف الإضافية بلا أي إشارة.
- `/staff/team` بلا حارس صلاحية على مستوى الصفحة (التفصيل في البند 4 أعلاه) — إصلاح مستقل عن
  تصحيح افتراض الخطة بخصوص الشريط الجانبي.
- حذف طلب من الإدارة يمسح سجل نشاط الموظف المرتبط به بصمت
  (`productionController.js:2257`، `DELETE FROM staff_activity_log WHERE order_id=$1` قبل حذف
  الطلب) — يمكن أن يُنقص رقم تقدّم الهدف (`buildGoalSummary`,
  `salaryController.js:102-108`) دون تفسير للموظف. أولوية أقل، للعلم فقط.
- لا وجود لأي معامل فلترة (تاريخ/شهر) في طرفي `getStaffActivity`/`getMyActivity` — أي إصلاح
  «فلتر الشهر» يحتاج تعديل توقيع الـ API، ليس واجهة أمامية فقط.

تقرير كامل بالأدلة: `.superpowers/sdd/2026-09-02-five-floor-edits/task-4.1-report.md`.

## 2026-08-31 — 🧣 The American shawl was never تطريز, and the line was hiding work from the people who do it

Owner report, two symptoms: «محمد عادل can't see all the American shawls» and «140 orders at
التصميم but 137 at the next stage». Measured against the **production** database, not the dev
copy. Three separate causes, all now fixed and deployed (`d145e06`, migration 096).

**1. A PRODUCT PHOTO WAS BEING READ AS EMBROIDERY.** `orderController.priceSelections` set
`hasEmbroidery` from ANY option group carrying text or a photo. «صورة الشال» / «صورة القبعة»
are product PICKERS — the student choosing which one they want — and the picker stores that
choice as `customer_text`. So **468 شال امريكي orders** were routed التصميم → التطريز on the
strength of it, and measured: **not one of them carried a line with «تطريز» in it** (0 of 272 at
التصميم, 0 of 196 at التطريز). The two halves of the app disagreed — `ZONE_DEFS` correctly says
the American shawl is not embroidery — so each order arrived at التطريز showing **zero zones**:
nothing to tick, nothing to finish, and no screen saying why. They sat from **2026-06-29**.
The tell was in the untouched rows: the 71 shawls that were already at الكوي all had
`has_embroidery = false`, i.e. bought without that picker, and they had routed correctly.
→ **Migration 096** adds `option_groups.is_embroidery`. Nullable on purpose, NULL = «yes,
embroidery»: every existing group keeps its behaviour with no backfill, and the seed fills
NULLs ONLY, so re-applying `db/schema.sql` on every deploy can never revert an admin's later
edit (the 093 trap). «اللون» / «لون التطريز» / «ردن الروب» were deliberately left alone — a sash
with a colour really is embroidered, and flipping them would de-route live sash work.

**2. THE CALLIGRAPHY WORKBENCH WAS A SIDE DOOR AROUND REP APPROVAL — this is the 140 vs 137.**
`productionController.getQueue` filters `wholesaler_approval = 'approved'` and
`returned_to_customer = FALSE`; `calligraphyController.zoneBuckets` / `sendOrder` filtered
neither, and `performAdvance` checked nothing. So «تحويل للتطريز» pushed unapproved rep orders
into التطريز, where **every** screen hides them — they existed in no queue at all. Exactly three
on prod, and they matched the owner's report: **زمن طارق اسماعيل** (قبعة) and **شهد عبد الكريم
حسين** (قبعة, *rejected*) under **محمد باقر عباس هاشم**, plus **عطاء صلاح** (وشاح) under محمد
ناظم مصطفى. The audit trail for the third shows how approval was lost: the rep created AND
approved it 2026-07-01 08:51, an admin reverted it to `designing` on 07-02, the rep re-submitted
at 22:27 — and `lib/fullSetOrder.js:484` resets `wholesaler_approval='pending'` on ANY edit.
→ The gate belongs on the **transition**, not on a list: `productionController.advanceBlockReason`
is enforced by `advance`, `advanceBulk` and `sendOrder` (409 `ERR_REP_APPROVAL_PENDING` /
`ERR_ORDER_RETURNED`), and `ordersZones` reports it so the workbench card shows
«⏸ بانتظار موافقة الممثل» instead of a button that strands the piece. **It never approves
anything** — that stays the ممثل's decision (owner ruling 2026-08-14).

**3. ALL STAFF, ALL STAGES EXCEPT التصميم** (owner decision this session, «see AND move»).
584 retail pieces sat at التطريز — 197 shawls, 150 caps, 142 sashes, 95 robes, oldest
2026-06-29 — because the only embroiderer (محمد عماد) is `order_scope = 'wholesaler'` and every
shawl is a retail order. `staff_activity_log` proved it: **200** shawl `design_complete→embroidery`
moves and **zero** `embroidery→*` moves, ever. One person's scope must not be able to dam the line.
→ Every non-design edge in `STAGE_AUTHZ` is now `LINE_STAFF`; `design_complete→*` and every edge
back INTO the design desk stay restricted; cancelling is still manager/admin. The per-zone
embroidery checklist is untouched, so a sash with unticked zones still cannot be skipped — only
zone-less pieces (the shawl) advance freely. The station console gained **stage chips**
defaulting to «مرحلتي», and `can_advance` is now computed for every returned row, not just the
caller's own station.

⚠️ **`viewerStages` had to stop deriving itself from `STAGE_AUTHZ`.** Its old rule — «a status is
mine when I may move an order out of it» — was exact only while `QUEUE_STAGES` and the authz map
agreed. Widening the map alone would have made every stage "mine" for everyone and re-opened
bug 2 (a designer landing on 402 rows of other stations' finished work). It reads `QUEUE_STAGES`
now; `viewerStages.test.js` is the guard that caught it.

### The repair, and the version of it that would have done real damage

`npm run stranded-orders` reports; `--fix` applies. ⚠️ **Its first draft would have reverted all
224 hidden orders to «بانتظار التصميم».** Only **4** were ever MOVED there; the other **220** are
plain pieces BORN at الكوي/التجهيز (since `4176fb3` a plain non-cap piece is created at الكوي)
waiting on their ممثل — hiding them is correct, and rewinding 220 real orders to the design desk
would have been the worst change of the session. The script now separates them by whether an
`audit_log` `status_change` row proves a human moved it, and only rewinds embroidery/converting:
a piece already at الكوي/التجهيز has been physically handled and rewinding it would make the
record lie about the cloth.

### Deployed and verified on prod

`d145e06` (merge of 9 commits — also carries the other session's K40 attendance work, the dvh /
safe-area pass, R8, and the marketing kit). CI green on all three jobs, migration 096 applied,
site + `/api/health` 200, PM2 all three restarted 02:48. DB dumped first to
`/root/lolo-predeploy-2026-08-31-0239.dump` (6.0 MB).

| | before | after |
|---|---|---|
| شال محمد عادل sees at الكوي | **71** | **538** |
| شال at التطريز / التصميم | 197 / 272 | **0 / 0** |
| orders stranded past التصميم | 3 | **0** |
| total شال (nothing lost) | 601 | **601** — 540 الكوي · 60 التجهيز · 1 مُسلّم |

538 rather than 540 because two are مُرجَع للطالب, which every queue hides. 473 pieces moved,
23 shawls stopped skipping الكوي, 3 orders returned to التصميم, **220 untouched**.

### Measured, and worth keeping

- **The designer's work on unapproved orders cost $0.33.** Across the whole database, exactly
  **10 orders / 16 plates** ever had calligraphy generated while the ممثل had not approved —
  8 of them محمد باقر's. 4 were on orders the rep had already **rejected** ($0.24 of it). Against
  $27.12 of calligraphy spend ever logged, this is ~1%. The damage was the 3 lost pieces, not a bill.
- **⚠️ Still open: 582 pool lines across 375 unapproved orders sit in «توليد» right now** — 363
  pending and **12 already rejected**. The new gate stops them LEAVING التصميم; it does not stop
  them being generated. Holding them out of the pool is an owner decision (a rep often approves
  later, so pre-generating is not automatically waste). Roughly $15–20 of exposure.
- **⚠️ The 2026-08-29 deploy silently failed and prod served a stale frontend for two days.**
  CI run `33275028760` was ✗ on «SSH deploy»: `ENOTEMPTY … rmdir '.next/server/app/index.segments/…'`,
  then `[PM2][ERROR] File ecosystem.config.js not found` — a *consequence*, not a second bug:
  `deploy.sh` died inside `cd frontend && … && cd ..`, so PM2 ran from `frontend/` where that file
  is not. `deploy.sh` does `git pull` BEFORE the build, so `git log` on the box read `7a7dffe`
  while the served build was `162cfab`. **Fixed 2026-08-31 — `rm -rf .next` is now in the script.**
- ✅ **DONE — `is_embroidery` has a checkbox** («صورة منتج فقط — ما تروح للتصميم/التطريز», on
  the option-group editor). It writes FALSE or NULL and never TRUE. Verified in a browser as
  Admin and round-tripped by a test.
- ✅ **DONE — `rm -rf .next` is in `scripts/deploy.sh`**, so a stale build artifact can no longer
  leave the box's `git log` claiming a deploy that never built.
- **⚠️ محمد عماد is still `order_scope = 'wholesaler'`.** He now sees the whole line but still no
  retail orders. Widening him is a one-row UPDATE and an owner call.


## 2026-08-30 — 🖐️ The fingerprint device was punching into a 404

Owner report: five workers had put their fingers on the K40 (2 محمد عادل · 3 علي · 4 محمد
هيثم · 5 محمد عماد · 6 انس) and **nothing appeared for the admin**. Three stacked causes, none
of them in the application code, each a prerequisite for the next.

**1. `/iclock/*` never reached Express.** The box is fronted by RevoArt's `supabase-caddy`, and
the LoloShop block forwarded only `/uploads/*` and `/api/*` to `172.18.0.1:4000` — everything
else fell to the catch-all and Next.js answered **404**. Measured both sides:
`https://lolo-shop96.com/iclock/cdata?SN=…` → 404 with a 24 KB HTML body, while
`http://127.0.0.1:4000/iclock/…` on the box → 200 empty, i.e. the backend was correct all along.
The device was proven on 2026-08-29 **over a temporary tunnel**, which is precisely what hid this.

**2. The K40 speaks cleartext and `:80` was a redirect.** Caddy's automatic http→https 308 is
not something ZKTeco firmware follows, and the device has no TLS stack at all — so even a fixed
route on :443 would have been unreachable.

**3. No serial is registered.** `attendance_devices` is empty, and `routes/iclock.js` drops an
unregistered serial silently by design. This one is still open — see owner action 6d.

**The evidence that all three were live:** `punch_raw` **0 rows**, `device_commands` **0 rows**,
and **not one `[iclock]` line in the PM2 logs** — not even the «unregistered serial» warning the
router emits, which is the tell that the request never arrived rather than that it was refused.

**Fixed** in the proxy (not in this repo — `/opt/revoart/supabase/volumes/proxy/caddy/Caddyfile`,
backed up first, validated as a candidate, reloaded not restarted): a `handle /iclock/*` above
the Next.js catch-all, plus a new `http://lolo-shop96.com, http://www.lolo-shop96.com` block
serving **only** that path in cleartext and re-creating the redirect for everything else.

⚠️ **That redirect had to be `308`, not `permanent`.** The first apply used `permanent` and the
post-check caught it as a **301** where Caddy's automatic one had been a 308 — only 308
preserves a POST's method and body. Re-applied. This is the whole reason the check block prints
the redirect code rather than assuming it.

**Verified after the reload:** `/iclock/cdata` → **200, empty body over plain HTTP** on apex and
www (correct for an unregistered serial) · site 200 · `/api/health` 200 · both
`assetlinks.json` 200 `application/json` **0 redirects** · `http://` → 308 · RevoArt and
Grand-Layan unchanged. Three production sites share that file, hence checking all of them.

### The device is now the ONLY thing that records دخول/خروج

Two owner decisions once the punches were landing.

**1. The phone بصمة is gone.** `POST /staff/attendance/check-in|check-out` and the second pair
on `/payroll/me/attendance/*` are removed, along with the card buttons, the queue button and
`checkInAttendance`/`checkOutAttendance` in `lib/staff.ts`. A worker still SEES their day —
`getToday` stays — they just cannot punch it. ⚠️ **الخروج المؤقت deliberately stays on the
phone**: the device's break keys live on `ffcb0ce`, still unmerged, so removing it too would
have left no way to record a break at all. The escape hatch when the device is down is the
admin's `PATCH /admin/attendance/records/:id/override`, which is admin-only on purpose.

**2. The SERVER clock stamps the punch, not the device.** The K40's wall clock was wrong on
site and it is what every تأخير is measured against, so `punched_at` is now the instant the
punch reached the API. `device_ts` keeps the device's verbatim reading — as evidence for a
dispute, and because it is still the dedupe key, so a re-sent batch is still recognised.

⚠️ **This reverses `c494dc9`'s «timed by the finger not the upload», and the cost is real:**
punches that arrive in one batch after an internet outage all get that batch's arrival time.
Today's own backlog would have collapsed onto 20:55 instead of replaying across the day. The
repair, when it happens, is the admin override using `device_ts`. **Nine tests asserted the
old rule** — test 1 was literally named «lateness from the PUNCH time, not now()». It is
inverted and carries the reasoning; the seven shift-math tests now drive `applyPunch` through
a new `replay()` helper, which is what the real `assignUnmapped` path does anyway.

**Verified:** 605/605 backend tests · `tsc --noEmit` clean · lint clean · `next build` clean.

### A day is now read from the SEQUENCE of punches

Owner rule: بصمة ١ دخول · ٢ خروج مؤقت · ٣ عودة · ٤ خروج — or just دخول + خروج. What separates
بصمة ٢ from a plain خروج is **the clock, not the count**: a punch at or after the shift's own
`end_time` closes the day, anything earlier opens or closes a break, and a worker may go out
more than once (every pair is its own break, all counted against the same 600-min allowance).

Plus a **per-worker 5-minute cooldown**: a finger resting on the sensor reads twice, and under
this rule a stray second read would open a خروج مؤقت nobody took. The owner's own test punch
did exactly that — 20:30:56 and 20:31:01, two rows. ⚠️ It is **per worker, never per device**
(two people at 10:15 and 10:16 is the morning queue), and measured from the last **accepted**
punch — chaining it off rejected ones would let someone tapping every four minutes lock
themselves out for the day.

⚠️ **Two things found while building it, both real:**
· **A device break must be born `approval = 'approved'`.** `computeCharge` gives an unapproved
  break ZERO free minutes, so creating them pending would have silently billed every worker
  for every break the moment the phone flow stopped being used.
· **On a midnight-crossing shift no punch can ever close the day** — and مضر محمد is on one
  (22:16 → 10:15). `resolveStamp` files a stamp under the previous day only while it is
  strictly before that end, so the closing instant is already the next shift's دخول; his day
  and any break in it would stay open forever. `closeStaleOpenDay` is the answer: the next
  day's first punch closes the previous open day at ITS scheduled end and auto-closes an open
  break (`auto_closed`, distinguishable from a real عودة), never touching an overridden row.

**Verified:** 611/611 backend tests (6 new: S1–S3, C1–C2, 6d) · tsc · lint · `next build`.
Tests 3, 6c and the admin replay fixture moved their last punch to the shift end — under the
sequence rule a mid-afternoon punch is a break, so they were asserting the old contract.

### The enrollment replay, cleaned up

⚠️ **The first cleanup script was WRONG and its dry run is what caught it** — it deleted any
record an enrollment punch had touched, which included two GENUINE phone shifts from 08-29
(محمد عادل 10:12→23:15, محمد عماد 10:15→23:49, both تأخير 0): the late tap had merely attached
itself to an already-open day, `applyPunch`'s documented "a punch between check-in and
check-out changes nothing" branch. The rule had to be **«the دخول itself came from an
enrollment punch»**. Never run the loose version.

Applied after a backup (`/root/loloshop-prod-2026-08-30-pre-enrollment-fix.dump`, 6.0 MB):
19 punches marked `enrollment-test-2026-08-29` (marked, **not deleted** — punch_raw is
append-only truth), 5 ghost records deleted, and the two real morning punches the ghosts had
swallowed replayed into proper دخول (محمد عادل 10:09 تأخير 0 · علي مهند 10:18 تأخير 3).

**Left for the owner:** مضر محمد's personal shift is set to **22:16 → 10:15**, so his 10:19
دخول scores 708 minutes late and the arithmetic is correct. `22:16` looks mistyped; it is data
on `/admin/attendance`, not code.

**Also found:** only **three** of the five workers have a `staff_device_pins` row — 3 (علي) and
6 (انس) were never mapped — and all three that exist sit at `push_state = 'pending'` with zero
queued commands, so no Arabic name has ever been pushed to the device. Both are admin-screen
work, recorded as owner action 6d. Nothing punched before today is recoverable: it was never
stored, because it never arrived.

## 2026-08-29 (c) — 🔔 The update wall, the permission card, and push for phones with no account

Three owner instructions, one theme: **reach**. Yesterday's measurement was that push works and
reaches ~7% of the shop. Everything below attacks that 7%.

### 1. The iOS update message is now a WALL, not a banner

`components/AppUpdateBanner.tsx` is gone; `components/AppUpdateGate.tsx` replaces it. Same
version test (`isOlderThan`, still numeric-per-segment so 1.0.10 does not sort under 1.0.4),
same `MIN_IOS_VERSION = "1.0.5"`, same iOS-only scope — but the card is now shaped like the
«الخصومات» popup and **cannot be dismissed**: no close button, no Escape, no backdrop tap, no
«لاحقاً», and `body` scroll is locked behind it. The only control is «حدّث الآن».

⚠️ **Three things must be true before anything is blocked**, because a false positive walls
every iPhone at once: we are in the iOS shell, the bridge answered with a parseable version, and
that version is older. `nativeAppVersion()` returns null on any failure and `isOlderThan(null,…)`
is false, so every unknown lets the user through. **Raising `MIN_IOS_VERSION` is now a release
event, not an edit** — point it at a build that is approved-but-unreleased and the shop is shut
for every iPhone.

⚠️ This reverses the old component's own reasoning («IT ASKS, IT DOES NOT BLOCK»), on the
owner's instruction. The reasoning is kept in the new file's header so the trade stays a
decision rather than an accident: a staff member or admin on 1.0.4 is walled too.

### 2. «خلي الإشعارات مفتوحة» — the permission card, both platforms, every app open

New `components/NotificationPermissionPrompt.tsx`. It shows once per app open until permission
is granted, on **Android and iOS**, signed in or not.

⚠️ **It is now the ONLY caller of `requestPermissions()` in the app**, and `PushRegistrar` no
longer asks at all. iOS shows its permission sheet exactly once per install, so two independent
callers is how that one sheet gets spent on someone who was not looking at a reason. The card is
the reason; the OS sheet opens only after «فعّل الإشعارات». «مو هسه» costs nothing — the OS was
never asked, so the ask survives to the next open. A grant fires
`PUSH_PERMISSION_CHANGED_EVENT` and PushRegistrar registers immediately instead of waiting for
the next launch.

What "every app open" means, deliberately bounded so it is not nagging: a cold launch
(`sessionStorage` dies with the app) **or** a foreground return after 30 minutes — the same
session window `AppBeacon`/`lib/appPresence.js` already use. Alt-tabbing to WhatsApp and back
does not re-ask. It also never stacks: it waits for the splash, waits for any open dialog, and
refuses to appear at all while the update wall is up. On a phone the OS will no longer prompt
(`denied`), the card switches to platform-specific Settings directions instead of offering a
button that can never work.

⚠️ `PushRegistrar`'s listener guard was split from its register step (`listenersReady`). The two
had to separate: listeners attach BEFORE the permission is read, so a pass that finds permission
ungranted still leaves them attached — re-running setup on a later grant with a single combined
flag would attach a second set and every notification would navigate twice.

### 3. Push now reaches phones with NO ACCOUNT — migration 095

Owner: «we will make a lot of promotion on notifications». So a token is no longer thrown away
because nobody has logged in yet.

- `device_tokens.user_id` is **nullable**; `POST /api/notifications/devices` moved to
  `optionalAuth` (⚠️ **above** `router.use(authRequired)` — moving it back silently re-breaks
  this). The upsert on `token` **promotes** an anonymous row to a personal one the moment that
  handset signs in: one row, no duplicate, no second prompt.
- `device_notifications` (new table) is the queue for a push with no `notifications` row behind
  it — an anonymous phone has no in-app bell. Same five states, drained by a **second pass** in
  `lib/pushOutbox.js` (`drainDevicesOnce`) under the same freshness window and dead-token rules.
  ⚠️ It is a separate pass on purpose: the user pass fans one notification out to all of a
  person's handsets and calls it sent if ANY took it; here the row IS the handset.
- New audience **«كل الأجهزة»** in the composer = every account + every unowned handset. Its
  reach line reports them separately (`anon_devices`) because nobody knows how many humans are
  behind those phones, and the typed confirm count is now people **+** handsets.

⚠️ **TWO CONSENT COLUMNS, AND THEY MUST NEVER BE MERGED.**
`users.notification_prefs.marketing` (089) belongs to a PERSON and follows them onto their next
phone; `device_tokens.marketing_opt_in` (095) belongs to a HANDSET with nobody behind it. The
server applies exactly one per recipient, decided by whether the device row has an owner. Both
default FALSE. The opt-in is the tap on the consent card — whose Arabic copy names العروض out
loud beside the order updates, because **that wording IS the 4.5.4 artefact**; trimming it to
just order updates silently invalidates every consent collected afterwards. The opt-out is
`NotificationPrefs` for an account and the new `DeviceNotificationPrefs` for a handset without
one (rendered on `/account`'s signed-out branch — 4.5.4 wants a way out reachable by someone who
has no account to sign into).

⚠️ **A registration can only ever RAISE consent, never lower it**, and both opt-out paths clear
the local cache (`setMarketingConsent(false)`). Without that, turning «العروض» off would be
undone by the next app launch re-asserting the cached flag — an opt-out that silently expires is
exactly what 4.5.4 checks for.

### Verified

- **603/603 backend tests** (was 590; +13 in the new `test/anonymousDevicePush.test.js`). The
  2 `appPresence` app-open failures are the **documented pre-existing flake** — reproduced on a
  stashed, clean tree before claiming that.
- `tsc --noEmit` clean, `eslint` clean, `next build` clean.
- Migration 095 applied to the **dev DB** and exercised by the new tests end to end (register →
  audience → queue → drain), with the provider stubbed.

### Not done / needs a human

- ⚠️ **Nothing here has been opened on a real phone or at phone width.** The update wall, the
  permission card and the new device switch are all phone-only surfaces and Chrome still refuses
  to resize this window (fifth session).
- ⚠️ **Migration 095 must ride the same deploy as the code.** It is in `db/schema.sql` too, so
  `scripts/deploy.sh`'s `npm run migrate` (which runs first) covers it — same rule as 077/078/079.
  Against a DB without the column, every device registration 500s.
- Play Data Safety / Apple privacy answers: promotional push is still opt-in with an in-app
  opt-out, and that is now true for accountless devices as well.


## 2026-08-29 (b) — 📲 iOS push works, and the K40 talks to us on real hardware

Two things that had never been proven on a physical device, both proven tonight.

### iOS push: 0 tokens in 13 days → delivered end to end

The 🔴 landmine is CLOSED. `1.0.5` shipped from the other session's `cb91f8d` (Capacitor's iOS
template ships no `didRegisterForRemoteNotificationsWithDeviceToken`, so AppDelegate took the
APNs token from iOS and dropped it — `register()` succeeded and the plugin fired NEITHER
`registration` NOR `registrationError`, which is why `push_register_errors` was empty). Neither
the entitlement, nor the APNs key, nor the provisioning profile was ever the problem.

Measured on prod as it happened: **0 iOS tokens → 5 in half an hour**, and only two of them are
the owner's — two real students (هدير, ريام) and two staff (محمد عماد, محمد عادل) registered on
their own once `b8b0ba0` re-pointed the update banner at 1.0.5. A test notification to the admin
account was accepted by APNs at 21:57:41 and **arrived on the phone**.

⚠️ **Reach, not delivery, is now the limit.** A 2,249-recipient broadcast at 21:33 drained in
under four minutes: **151 sent, 2,102 skipped, 5 failed, 0 pending**. `skipped` means that user
has no device token — push can physically reach ~7% of the shop (165 tokens / 2,249 retail).
Nothing is stuck and the drain is healthy; the number to move is installs, not code.

### The K40 answered on real hardware — and four things the plan could not have known

1. **The shop's Zain Fi (Huawei B530-937) does not bridge its LAN port to WiFi.** The device sat
   at 192.168.0.177 with a valid lease, visible in the router's own client list, and this laptop
   could not even ARP it. The router exposes no isolation setting to change it, and the laptop
   has no Ethernet port. **A LAN test is impossible in that shop** — do not plan one again.
2. **«Enable Domain Name» was ON**, so the device ignored the IP/port pair entirely.
3. **The device speaks TLS by default.** Visible only in a packet capture: a TLS ClientHello
   arriving on our plain-HTTP port, answered `400 Bad Request`, retried every 15s forever. That
   also means production can serve it over **Caddy on 443 with a real certificate** — the device
   supports both HTTPS and domain names, so no extra open port is needed.
4. **The parser was right first time**: the real ATTLOG line
   `1\t2026-08-29 21:39:32\t0\t1\t…` gave `stored=1 rejected=0`, and `punch_reject` stayed empty.

Proven against the real unit over an SSH reverse tunnel (VPS:8090 → laptop): handshake, ATTLOG
upload, PIN claim + replay, attendance derivation, **and the command channel** — a
`DATA UPDATE USERINFO` name push was acknowledged `Return=0` and the Arabic name rendered.

⚠️ **RUNNING THE TEST SUITE WHILE A REAL DEVICE IS ATTACHED WRITES TO THE DEVICE.** The fixtures
queue `device_commands`, and the physical K40 executed them — it created and deleted a user
`PIN=54971` named `ZZTEST-…` on the shop's screen. Harmless here; do not run the suite against a
database a live device is polling.

### Owner decisions, implemented (commit `ffcb0ce`, UNMERGED)

- **دخول/خروج/خروج مؤقت all come from the device's own status keys.** Only status 2 and 3 are
  special; every other value falls through to the forgiving first-in/last-out derivation,
  because most workers press no key and their day must still be right.
- **إذن الادمن is removed from الخروج المؤقت, in behaviour and in money.** `leaveBreak` no longer
  409s an unapproved request, and `computeCharge` lost its `approved` argument: free while the
  monthly allowance lasts, charged beyond it. ⚠️ **Retroactive by construction** —
  `recomputeMonth` re-prices the whole month, so deploying forgives current-month deductions
  that existed only for want of an approval.
- **A break nobody returned from** is closed by the next punch of any kind, flagged
  `auto_closed`, and the admin is notified; a punch on a LATER day closes it at its own shift's
  end instead of billing the night.

**601/601 backend tests** (591 before). Five tests encoding the OLD approval policy were
rewritten to assert the new one. Found while testing: **`pg` parses a DATE into a JS Date at
LOCAL midnight**, so `toISOString()` reports the previous day in Baghdad — every same-day break
looked cross-day and clamped to 0 minutes. Caught by tests, not by reading.

### Corrections to this file

⚠️ **The 2026-08-29 (a) entry below says the K40 work is «deliberately not deployed». That is no
longer true** — it merged and auto-deployed at 16:58 UTC. `origin/main` carries it, prod is
checked out there, migration 094 is applied and all five tables exist (empty). The device half is
inert on prod only because no serial is registered.

### Still open

- `ffcb0ce` is unmerged — it moves real salary numbers, so it wants a deploy someone is watching.
- Prod transport undecided: Caddy on 443 (now known to be possible) vs the `DEVICE_PORT`
  listener added in that commit, which serves `/iclock` and 404s everything else.
- ⚠️ **Temporary VPS changes still in place from the tunnel test:** `ufw allow 8090/tcp` and
  `GatewayPorts clientspecified` in `/etc/ssh/sshd_config` (backup: `/root/sshd_config.bak-2026-08-29`).
  Revert both once the device is on its real endpoint.
- Prod DB backup taken first: `/root/loloshop-prod-2026-08-29.dump` (5.7 MB, 79 tables verified).


## 2026-08-29 — 👆 جهاز البصمة ZKTeco K40 Pro عبر ADMS — كود كامل، ما انزل بعد

**591/591 backend tests.** Migration **094**, zero new npm dependencies, one new frontend
panel. All on `feat/zkteco-adms-attendance`, **unmerged** — merging auto-deploys.

### What started this

بصمة today is a button on the worker's phone. Identity is their JWT; the "are you at the shop"
proof is `verificationEvidence()` — IP range and/or GPS. On prod `verification_mode` is
`'none'` and `shop_latitude/longitude` are NULL, so **nothing is verified**: any worker can
stamp from home, on time, every day. A K40 Pro is being installed, and standing at the sensor
is strictly stronger proof than a GPS check that was never switched on.

### Why ADMS and not a bridge

The QR the device shows on first boot — `{"ip":"192.168.1.201","port":"4370"}` — is the
**pull** protocol, LAN-only and useless from the VPS. ADMS is the **push** half: the device
dials out to a server address we choose. No port forward on the shop router, no static IP, no
always-on PC at the shop.

⚠️ `~/Desktop/active/grand` has a working K40 integration (live 2026-08-13, proven on real
hardware 2026-08-15: 193 punches, 0 duplicates). Its **bridge** half is the pull protocol and
is exactly what ADMS makes unnecessary — do not copy it. Its **server** half was ported:
append-only raw punches, the `NULLS NOT DISTINCT` dedupe index, and a reject quarantine.

### The one thing that did NOT port

grandlayan's `attendance_day` is a cache that may be wiped and rebuilt. **LoloShop's
`staff_attendance_records` is not** — it carries `late_minutes` frozen at write time, admin
overrides, and `staff_attendance_breaks.attendance_id` pointing at it. So the derivation
UPSERTs, never DELETEs, and never touches a row with `status = 'overridden'`.

### What shipped

| | |
|---|---|
| Migration 094 | `punch_raw` (append-only) · `punch_reject` · `attendance_devices` · `staff_device_pins` · `device_commands` |
| `lib/iclockProtocol.js` | parses tab-separated ATTLOG; quarantines bad lines instead of failing the batch |
| `lib/attendanceDevice.js` | punches → `staff_attendance_records`; savepoint per punch |
| `routes/iclock.js` | the endpoint the device dials out to; mounted at root, before `express.json()` |
| `AttendanceDevicePanel.tsx` | «جهاز البصمة» on `/admin/attendance` — register, map PINs, claim unmapped |

### Three decisions a future session will want to undo, and must not

- **Lateness is computed from the punch's own timestamp, never `now()`.** The device buffers
  during an internet outage and dumps hours later; arrival time would mark a whole outage's
  worth of people late.
- **An unregistered serial gets `200` with an empty body, never `403`.** Some firmware retries
  a 4xx forever with no backoff, so one mistyped serial becomes a self-inflicted flood against
  our own API. It looks like a missing guard and is the opposite of one.
- **`punch_raw_dedupe_ux` carries `NULLS NOT DISTINCT`.** `raw_status` arrives NULL from some
  firmware, and under the default every NULL is distinct — so the device's next buffer dump
  would write the same punch a second time and double someone's day.

### A wrong assertion the plan carried, caught by implementing it

The plan's Task 3 case 6 said a 00:10 punch files under الجمعة. It does not: الجمعة ends at
**exactly 00:00**, so it has no after-midnight window and 00:10 is a new السبت shift — which is
what `HANDOFF.md`'s own schedule landmine already said. Rewritten as three cases (الجمعة's own
date · the post-midnight Saturday · a shift that genuinely crosses midnight, 22:00→02:00, which
is where the rollover rule really applies). `lib/staffSchedule.js` was **not** touched to make
the wrong assertion pass.

### Not done, on purpose

- **Nothing is deployed.** Merging auto-deploys to the box shared with RevoArt.
- **The phone بصمة is still live.** The owner asked for it removed the same day; it is gated on
  watching a full day of real punches first, because `late_minutes` is frozen at write time and
  a day with no rows cannot be repaired by a later backfill. It ships in the same commit as
  admin hand-entry — `overrideRecord` can only edit a row that exists, so without hand-entry a
  dead device means no attendance at all.
- **The admin panel has never been opened in a browser.** Typechecks and builds; nobody has
  looked at it at 390px. Fifth session in a row this is true of an admin surface here.
- **The device's real ADMS dialect is unknown.** Everything is written against the documented
  ZKTeco Push SDK. If the unit differs, `punch_reject.raw_line` names exactly how.


## 2026-08-28 — 🖌️ الخط: توفير 17% فوراً + ثلاث إصلاحات لما يفشل التوليد

**547/547 backend tests** (540 before — 7 new in `backend/test/calligraphyResilience.test.js`).
No migration, no new dependency, no frontend change. Uncommitted at the time of writing.

### What started this: «الخط ما يشتغل — أظن الرصيد خلص»

Measured on prod, not guessed. OpenRouter answered **402 Insufficient credits** five times to
the API and twice to the worker on 2026-08-28 between **17:49 and 18:01 (+02)**; the last paid
image before that was **17:33**. Nine plates were marked `failed`, all nine real student names.
By ~18:35 the account read `total_credits 112 / total_usage 91.22` (≈ $20.7 available) and a
real generation through the live code path succeeded (2.4 MB PNG, $0.1021) — so credit was back.
`total_credits` did not move across two reads, so the top-up (if that is what it was) happened
before the first read; a transient OpenRouter accounting fault is the other candidate and cannot
be separated from here. **The daily ceiling was NOT the cause**: `CALLIG_DAILY_USD_MAX` is $10
and that day spent $1.55.

### The cost picture (the ledger's first honest 10 days)

`calligraphy_spend_log` starts 2026-08-18, so «30 days» of it is really 10: **$21.93**, i.e.
**$2.19/day ≈ $66/month**, for 333 plates = **$0.066 per name**. Sheets $17.73 (81%), rerolls
$4.19 (19%). The distribution is where the money is:

| names on the sheet | sheets | cost | per name |
|---|---|---|---|
| **1** | **110** | **$11.14** | **$0.101** |
| 2 | 33 | $3.34 | $0.050 |
| 3–9 | 31 | ~$3.10 | ~$0.02 |
| 10 | 1 | $0.10 | **$0.010** |

**63% of all sheet money bought one name at ten times the per-name price of a full sheet.** The
cross-job top-up written on 2026-08-18 is working as designed; it simply finds nothing, because
a designer pressing «توليد» for one student is usually the only pending plate in the shop at
that second.

### 1. A batch of one stops buying the ten-name canvas — ~$11/month, 17%

`processNextBatch` always bought `2K 9:16` even when the batch held a single name.
`sheetBatch.length === 1` now buys **`1K 1:1` with `buildSinglePrompt`** — byte-for-byte what
`reroll` has bought since 2026-08-18 across 62 accepted presses ($0.067 vs $0.101).
**Resolution does not drop, it rises:** a 2K sheet gives each of ten stacked bands ~200px of
height; a 1K 1:1 canvas gives one name up to 1024px. `buildSheetPrompt` was also the wrong
prompt for one name — it orders the model to «spread them out to fill the whole height».

⚠️ **The crop path is deliberately NOT shortcut for solo.** `reroll` may fall back to the
uncropped canvas because `matchPlateGeometry` reframes it onto the original band afterwards;
nothing on the batch path does, so an uncropped plate would reach `order_items.plate_image_url`
full of white margin and be stitched that way. A solo crop mismatch takes the same paid retry
and the same manual review a ten-name sheet takes. (This was written, reviewed, and removed
before it shipped — don't re-add it.)

### 2. The three upstream failures stopped wearing one code

`lib/openrouter.js` returned `ERR_OPENROUTER` for everything, so «we are out of money», «the
model hiccuped» and «the wire is down» were indistinguishable to every caller:
· **`ERR_OPENROUTER_CREDIT`** (402) — never retried; retrying only fails twice.
· **`ERR_OPENROUTER_NO_IMAGE`** — Gemini finishing with no image (`finish_reason: STOP`,
  `block_reason: null`), **10 times in the logs by 2026-08-28**. Nothing is billed for that
  reply and the same prompt usually lands on a fresh call, so it is the one failure worth
  retrying — **once**, bounded in `generateImage` (`MAX_ATTEMPTS = 2`), never a loop.
· **`ERR_OPENROUTER`** — everything else, unchanged code and unchanged meaning, so every
  existing caller and test keeps working.

### 3. An outage no longer burns the plates

The catch in `processNextBatch` marked the batch `failed` for **any** error — which is how one
402 retired nine students' names on 2026-08-28. Codes in `INFRA_CODES`
(`ERR_OPENROUTER_CREDIT` · `_NET` · `_KEY`) now leave the plates **`pending`**, exactly as the
daily-ceiling branch a few lines above has always done for the identical "cannot buy right now"
situation. Pending is self-healing: the workbench's «معالجة» press or any later job's top-up
picks them straight back up. A genuine generation failure still fails the plate — leaving those
pending forever would hide a broken name behind an endless retry, and
`calligraphyResilience.test.js` pins both sides of that branch.

### 4. Running out of credit now reaches a human

`notifyCreditExhausted()` (`lib/calligraphySpend.js`) writes the admins one `notifications` row
— which the push outbox turns into a phone push for free — deduped 6h in SQL plus a 30-minute
in-process memo. Called from all three paid paths (batch, reroll, element). **Awaited, not
fired and forgotten:** it is a rare error path where latency costs nothing, and the worker may
be recycled by pg-boss the moment it returns, so a detached insert is the notification that
never arrives. Dedupe is 6h rather than the spend warning's 24h because this one is actionable
and the shop is down until someone acts.

⚠️ Deliberately a **second** notification type (`calligraphy_credit_exhausted`), not a reuse of
`calligraphy_budget_warning`. They are opposite events: the ceiling is the shop choosing to
stop and clears itself when the 24h window rolls; a 402 is generation being off until a human
buys credit, and nothing in the app can clear it.

### What the designer sees now

Unchanged frontend. On a 402 the plates stay pending, so `CalligraphyTool`'s poll no longer
reads the job as finished; after its stall window it falls to the browser loop, which surfaces
the server's Arabic message via `getApiErrorMessage` — «انتهى رصيد توليد صور الخط». **Before
this, the plates went `failed`, the poll saw "finished", and the screen said nothing at all.**

### Not done — the bigger half of the saving

**Batching is untouched and is where the other ~$30/month is.** Turning those 110 solo presses
into ~11 full sheets needs a «ولّد كل المعلّق» press (or a timed sweep), and it costs something
real: the plate stops appearing immediately. That is an owner decision, not a code one, and it
was explicitly deferred this session. With both, $0.066 → ~$0.030 per name.

Also still unmeasured: **how often a crop mismatch buys a second full image.** `MAX_CROP_TRIES`
is 2 and the attempt count is not stored on the plate, so the retry share of those 175 images
is unknown. Writing `attempts` onto the row would answer it within a day.

## 2026-08-27 (b) — 🗓️ دوام الأسبوع + الإجازات (migration 093) · 💵 «راتبي ونشاطي» بالتفصيل

**540/540 backend tests** (516 before), `tsc --noEmit` + eslint + `next build` clean, and both
new screens driven in a real browser against the dev DB — including a real save round-trip.
Spec: `docs/superpowers/specs/2026-08-27-staff-schedule-and-payroll-design.md`.

### 1. The Friday bug — the concept did not exist, not just the value

`staff_attendance_settings` held ONE `start_time`/`end_time` for all seven days and `checkIn`
computed lateness against it every day. The shop opens **3 م الجمعة**, so every Friday بصمة was
recorded ~6 hours late. A grep for `getDay` / `day_of_week` / `friday` / `جمعة` across
`backend/` returned **nothing** — there was no weekday logic anywhere.

**Migration 093** adds `staff_schedule_days` (7 rows, seeded السبت–الخميس 09:00–22:00،
الجمعة 15:00–00:00) and `staff_holidays` (a date everyone is off).

⚠️ **`weekday` is POSTGRES `EXTRACT(DOW)` numbering — 0 = الأحد … 6 = السبت, so الجمعة is 5.**
Chosen so a query joins on it with no translation table; JS `getUTCDay()` agrees, which is why
`dayOfWeek()` needs no date library.

⚠️ **The seed's `ON CONFLICT DO NOTHING` is load-bearing.** It is repeated in `db/schema.sql`,
which `scripts/deploy.sh` applies on EVERY deploy — without the guard each deploy would
silently undo the owner's edited hours. Same trap, same reason, as 077's and 080's backfills.

**`lib/staffSchedule.js` is the only place the rule lives**, the way `lib/shopTime.js` owns
"what date is it at the shop" and `lib/counts.js` owns "what is money". A second copy is
exactly how this bug happened. Resolution order: holiday → per-user override → weekday row →
the pre-093 single pair (kept as the last resort so a DB missing a row behaves as before).

⚠️ **الجمعة ends at EXACTLY 00:00, so it has no after-midnight window — and that is correct.**
A 00:10 stamp is a new السبت shift. The midnight rule in `resolveStamp` only fires when the
previous day's shift is still running, which starts mattering the moment an admin edits الجمعة
to end at 01:00 (the screen allows it, and a test pins it). Two things were checked and are
**already right, unchanged**: `scheduledMinutes` adds 24h when `end <= start`, and `checkOut`
finds the open record by `check_out_at IS NULL`, never by date — so stamping out after midnight
always closes the right row.

⚠️ **`late_minutes` is frozen onto the record at check-in.** Editing the schedule or deleting a
holiday never rewrites history, and the staff screen says so in as many words.

### 2. Nothing was ever deducted for it — and this corrects HANDOFF

**«Should lateness deductions reach the salary?» — they do not, and never did.**
`staff_attendance_records.deduction_transaction_id` is only ever *cleared*
(`attendanceController.js`), never set. So the Friday damage was a **record**, not a payment:
`status='late'`, a wrong `late_minutes`, and a `deduction_amount` that /staff/me and the admin
reports display and a human then pays from.

⚠️ **`source_type <> 'attendance'` in `buildSalarySummary` MATCHES NOTHING.** Measured: no row
in `staff_salary_transactions` has ever carried that value. Break deductions use
**`'attendance_break'`** (`lib/attendanceBreak.js:28`), a different string — they ARE listed and
ARE in the balance, as they should be. The filter is a leftover from a lateness auto-deduction
that was never built. **Left in place on purpose**: removing it changes nothing today, and
`payoutController`'s «المبلغ المقترح» carries the identical predicate — the two must keep
agreeing, so they change together or not at all. Documented in the code beside both.

`npm run friday-deduction-report` — READ-ONLY, writes nothing. It splits the rows: those
measured against a wrong opening (the damage) from those already measured against 15:00
(genuinely late, left alone), and prints the salary-transaction id per row so a reader can
verify the "nothing was charged" claim instead of trusting it. Dev DB: 5 suspect, 3 genuine,
**0 linked to any transaction**.

### 3. `/admin/attendance` — جدول الدوام + الإجازات

⚠️ **The week saves WHOLE, never a day at a time**, enforced server-side (`updateSchedule`
refuses anything but seven days). Seven rows are one decision; a half-applied week is the shape
where الجمعة is right and السبت is still wrong. `end < start` IS allowed — that is الجمعة, and
the row shows «يمتد بعد منتصف الليل». `start == end` is refused.

`formatTime12` / `formatShiftRange` in `frontend/lib/format.ts` render ص/م (Latin digits, the
`fmtShopDate` convention). The DB keeps 24-hour `TIME`; nothing parses the display back.
⚠️ Midnight is «12:00 ص», not «0:00 ص» — a zero hour reads as an unset field.

### 4. `/staff/me` — «راتبي ونشاطي», the whole month in one call

`GET /payroll/me/summary?month=YYYY-MM` (defaults to the current month **at the shop**, not
UTC). Returns the schedule, every calendar day (present, absent, off, holiday — «وين غبت» is a
calendar question), hours net of breaks, lateness, the breaks ledger with free/deducted/
remaining, salary transactions with reasons, the goal, and pieces per day.

⚠️ **THE INVARIANT `test/payrollSummary.test.js` PINS: lateness and salary are two ledgers and
the payload must never merge them.** Folding `late_amount_shown` into `salary.balance` would
show the staff a debt the shop has not charged. The التأخير section says «معروض — ما انخصمت من
راتبك» in as many words, and a test asserts the amount appears in no salary transaction.

A day is only «غياب» once it is in the past, the shop was open, and nothing was stamped —
today and the rest of the month are not absences yet.

### Verified in a browser (dev DB, prod build)

Admin: all 7 days render, الجمعة «3:00 م – 12:00 ص» + the midnight badge, edited الجمعة to
01:00 → saved → **confirmed in the DB** → restored to 00:00; added and listed a holiday, then
deleted it. Staff: تموز 2026 shows 20 أيام دوام · 225 س · 5 أيام تأخير, the التأخير section
lists each date with its expected time, actual check-in and minutes, and the الفتحات and دوام
الأسبوع sections render. `hOverflow = 0`, month-picker tap targets exactly **44px**.
⚠️ **True 390px is STILL unverified — fifth session running.** `resize_window` reports success
and the viewport stays 977px, and `Page.captureScreenshot` timed out once. Overflow and tap
targets were measured in the DOM instead, which is real evidence but not the same as eyes on a
phone. No table was used anywhere in either screen precisely because of this.

## 2026-08-27 — ✍️ سادة front · 🖼️ «إضافة إطار» retail-only · 📏 مسطرة · 📄 two specs

Uncommitted on `main`. **516/516 backend tests** (510 before; the two `app-open` flakes HANDOFF
documents passed on the full run), `tsc --noEmit` clean. Three small pieces shipped in code, two
specs written for the larger work. Owner conversation 2026-08-26/27 decomposed seven asks into
six pieces; 1·2·3 are these, 4·5·6 are the specs.

### 1. Calligraphy — the sash front is now as plain as the back

Owner: «قلل الزخارف للجهة الامامية خليها نفس الظهر». `lib/calligraphyPrompt.js` had `front:
'Add small floated decorative ornaments around the words.'` while `back` was told to use
«clearly LESS THAN HALF the decoration of the front» — two panels of one sash that did not read
as a set. Both now share ONE `MINIMAL` string, so they cannot drift apart again, and the back's
self-referential wording is gone: once both are minimal, a comparison to the other panel means
nothing and only gives the model something to over-read.

⚠️ **`cap` deliberately keeps its ornaments** — a cap is a separate garment, not the other half
of a sash. `cap_side` never reaches that table (`calligraphyEngine.js:16` maps it to `cap`
first), so front/back/cap are the only three keys that can ever be looked up. Affects newly
generated plates only; existing plates are files on disk and unchanged.

*Still open: the owner also asked «can we make it better too?» — that needs eyes on real output,
not a prompt guess. Generate a few plates and decide from them.*

### 2. «إضافة إطار» — migration 092, an option group restricted to one price audience

Owner: a 5,000 IQD toggle on the sash for a plain retail student and **never** for a student who
joined through a ممثل. No such mechanism existed: groups had `gender_restriction` and products
had `wholesaler_only`/`retail_only`, but a group could not be hidden by audience.

`option_groups.price_role_restriction price_role` (NULL = everyone). The mechanism is that
`catalogController.priceRoleForUser` resolves a `students` row carrying a `wholesaler_id` to
**`'wholesaler'`** — so `price_role_restriction = 'retail'` *is* «الطلاب العاديين فقط». That is
not incidental and must not be tidied.

⚠️ **Enforced in TWO places on purpose.** `catalogController` hides the group from the
configurator; `orderController.priceSelections` refuses it on the order path. Hiding alone still
accepts a hand-posted `group_id`. Both filter in the QUERY rather than rejecting afterwards, so
a restricted group is invisible to `required` as well — otherwise a retail-only *required* group
would block every rep-linked student's checkout.

⚠️ **Privileged callers (admin / production manager) see every group.** The admin product editor
reads the same `/catalog/products/:id/full` endpoint, so filtering them too would hide the group
from the one person who has to configure it. The 120s memo key already carries both `role` and
`isPrivileged`, so the two audiences never share a cached payload.

`test/optionGroupAudience.test.js` — 6 tests covering retail sees / rep-linked does not /
anonymous is retail / admin sees all / **a hand-posted restricted group is refused** / the right
student can buy it at 35,000. The enforcement test was **red/green verified**: neutering the
`orderController` filter fails that test alone and nothing else.

**Owner action:** the group itself is data, not code — create it on `/admin/products`: الوشاح →
«إضافة إطار» · نوع `toggle` · يظهر لـ «الطلاب العاديين فقط» · سعر التجزئة 5,000.

### 3. مسطرة — migration 091, a new workshop operation on the cap

⚠️ **The operation list is CODE, not a table.** `workshop_piece_rates` stores an amount per
(operation, product, audience) but never the vocabulary, so adding a job means editing
`OPERATIONS`, `PRODUCT_OPS`, `OP_LABEL_AR` in `workshopController.js`, widening
`WorkshopOperation` in `frontend/lib/workshop.ts`, **and** seeding the rate rows in
`db/schema.sql` — the file `npm run migrate` actually applies — as well as in the numbered
migration. Miss the seed and the job appears on screen paying nothing; miss `PRODUCT_OPS` and
`upsertRate` 400s on a pair the rates screen just offered.

Cap-only, and **not** locked to حمزة: any active workshop worker may log it, like every other
operation. The station's dropdown is built from the server's rate matrix, so it appeared with no
frontend change beyond the type.

⚠️ **Seeded at 0 on purpose** — a wrong wage that looks entered is worse than an obvious zero.
**Owner action: set the real rate** at `/admin/workshop → أسعار القطع`. `updated_by` stays NULL
so `schema.sql`'s retail-alignment UPDATE keeps treating it as unset (a no-op here, both are 0).

### 4. Two specs written, no code

- `docs/superpowers/specs/2026-08-27-staff-schedule-and-payroll-design.md` — the weekly
  schedule (السبت–الخميس 09:00–22:00، الجمعة 15:00–00:00)، الإجازات، and the rebuilt
  «راتبي ونشاطي».
- `docs/superpowers/specs/2026-08-27-admin-ai-console-design.md` — «لولو الإدارة».

### Two findings that correct standing claims

⚠️ **THE FRIDAY BUG IS NOT FIXED, AND THE CONCEPT DOES NOT EXIST.** There is no weekday logic
anywhere in `backend/` — a grep for `getDay`, `day_of_week`, `friday`, `جمعة` returns nothing.
`staff_attendance_settings` holds ONE `start_time`/`end_time` (`db/schema.sql:862`), and
`checkIn` computes lateness against it every day (`attendanceController.js:540`). The shop opens
**3 م الجمعة**, so every Friday check-in records ~6 hours late. There is no holiday concept
either: `attendance_required` is per-*user*, not per-*date*.

⚠️ **But nothing was ever deducted for it, and this answers a question standing open in
HANDOFF.** «Should lateness deductions reach the salary?» — they do not, today.
`staff_attendance_records.deduction_transaction_id` is only ever *cleared*
(`attendanceController.js:783`), never set; the sole writer of an attendance salary transaction
is `lib/attendanceBreak.js`, for breaks. So the Friday damage is a **record**, not a payment:
every Friday row carries `status='late'`, wrong `late_minutes`, and a `deduction_amount` that
both the staff page and the admin reports display and a human then pays from. Wrong data a
person acts on, not money already taken — which decides the shape of the retro fix (a read-only
report, owner decides; spec §7).

⚠️ **«لولو الإدارة» already has history, and the widget that lies is a DIFFERENT surface.**
There are two admin AI controllers. The console (`/admin/assistant`) loads and renders the last
15 turns (`getAdminChatHistory(15)`, `assistant/page.tsx:142`) and its refusal text is accurate.
The stale sentence naming 8 of 21 metrics is the OLDER `/admin` widget
(`adminAnalyticsChatController.js:105`). What the console genuinely lacks is **memory**: both
model calls get `system + the current question` only (lines 139, 195) and `sessionKey` is
`null`, so the screen shows a thread the model has never seen. Spec §2.3.

## 2026-08-25 — 💸 Starting a discount round · 📱 /admin/app · 🔔 an admin-written push · ✅ notification opt-in

Branch `feat/discount-round-and-app-console`, three commits, **unmerged**. 508/508 backend tests
(479 before), tsc + eslint + `next build` clean, all three verified in a real browser against
the dev DB. Spec: `docs/superpowers/specs/2026-08-25-discount-round-and-app-console-design.md`.

### 1. «ابدأ الخصومات» — the missing half of the discount tool

Owner: «admin can't do خصومات without me, the prices aren't go down». «إنهاء الخصومات» shipped
2026-08-22; **starting** a round never existed. Starting meant hand-editing each product on
`/admin/products` — lower `base_price`, then retype the old price into «السعر قبل الخصم» — two
edits × 51 products, no preview, no undo. So every round needed a developer.

`lib/discountRound.js` is the mirror of `lib/discountRestore.js`. A round writes
`compare_at_price ← the price a student pays now`, then lowers the selected cells by a fixed
amount — exactly the shape ending a round reverses, so ending was not touched.

**Three refusals, each one a live price:**
- ⚠️ **A product already carrying a compare-at is REFUSED (`ERR_ALREADY_DISCOUNTED`), not
  skipped.** This is the one loss no ledger can undo: a second round stores the *discounted*
  price as «the old price», and the real one is gone from the database. The panel shows such
  products disabled with «مخصوم أصلاً» rather than hiding them.
- `amount >= price` refused — no free or negative products.
- A stale price refuses the **whole** round (`ERR_STALE`), never half of it.

⚠️ **Defaults tick the cell that IS the retail price** — the retail row when one exists, the
product base when it doesn't — **never both**, and this was found by the round-trip test rather
than reasoned out. Ending a round restores every selected cell to the single `compare_at_price`
column, so a product whose base (30,000) sits above its retail (28,000) comes back from
start→end with **both at 28,000**: the base silently, permanently lowered by a discount that was
ended. `products.base_price` is what a rep-linked student pays when there is no wholesaler row,
so that is real money. It is the same shape as the four cells the August round left stranded.
The tick is still offered; it is just not the default. The behaviour is pinned in
`test/discountRoundRoundTrip.test.js`, which drives start and end against a real database.

**Migration 086** adds `discount_restore_log.direction` ('start' | 'end'). The `'end'` default
backfills every existing row correctly — they were all written by «إنهاء الخصومات».

UI (`DiscountStartPanel.tsx`, beside its sibling in **الإعلانات والعروض**): amount box defaulting
to 5,000 (the uniform delta of every real round to date), four type chips, per-product ticks,
live preview, سعر الجملة visible but unticked with the margin warning, «شغّل إعلان العروض» on by
default. **This also lets the owner fix the four cells the August round stranded, without a dev.**

Browser-verified: وشاح امريكي 25,000 → 20,000 → 25,000, ledger row written both directions,
badge and promo correct at each step.

### 2. `/admin/app` — إحصائيات التطبيق على المنصتين

⚠️ **App usage was tracked for STAFF only.** Migration 084 covers staff; students and ممثلين —
the two audiences the app was built for — had **no signal at all**. `device_tokens` is a FLOOR on
installs (it needs an install AND a signed-in session AND the notification prompt granted), and
`site_visits` is anonymous with no platform column.

**Migration 087** adds `app_opens`, the all-roles twin of `staff_app_opens`, copying 084's
session semantics exactly (opens count SESSIONS, >30 min gap, `work_date` from `lib/shopTime.js`)
so the two read side by side.

⚠️ **`staff_app_opens` was deliberately NOT widened.** The nightly staff report reads it and its
«opening the app is not attendance» rule sits next to payroll; a stats dashboard must not be able
to change what that table means. `StaffAppBeacon` → **`AppBeacon`**, fires for any signed-in
user, and `POST /api/app/open` writes `app_opens` always plus `staff_app_opens` when the user is
staff — so staff still cost exactly one request and 084 is untouched.

⚠️ **Nothing is retroactive** — there is no source to backfill from. The page prints «القياس بدأ
يوم X» instead of a flat zero line that reads as «nobody uses the app».
⚠️ **iOS reads 0 everywhere** until someone installs 1.0.4 from TestFlight and grants the prompt.
The panel used to say so in a banner; **the owner asked for that text removed** (2026-08-25), so
the explanation now lives only in `AppStatsPanel.tsx`'s header comment. Do not read a zero iOS
column as a broken pipeline without checking `device_tokens` first.

### 3. «إرسال إشعار» — the first push a human writes

Every push before this was emitted by code, so the upstream event bounded the audience. This one
is typed, to الكل · a role · a university · a rep's students · one person — and **cannot be
recalled**.

It writes one `notifications` row per recipient and stops; `lib/pushOutbox.js` delivers them, so
the flood guard, freshness window and dead-token handling apply unchanged **and every blast also
lands in the in-app bell** — a push missed with the phone off is still readable later.

**Three guards** (`lib/pushBroadcast.js`):
- ⚠️ **`link` must be a relative in-app path from a CLOSED allowlist**, matched exactly or with
  one id segment — never a prefix test (`/orders` and `/orders-evil` share a prefix). An
  admin-composed push carrying an arbitrary URL is a phishing primitive wearing the shop's name,
  aimed at 1,100+ accounts. Protocol-relative `//evil.com` is refused explicitly: it is a URL
  despite starting with a slash. The UI is a picker, not a text box.
- **«الكل» demands the recipient count typed back** — server-enforced, and asked for «الكل» only,
  because asking every time trains the sender to type numbers without reading them.
- **Migration 088 `push_broadcasts`** — written first, in the same transaction, so a half-failed
  fan-out still leaves evidence of who pressed what.

⚠️ The university audience matches **ILIKE '%…%'** on purpose: one university is spelled three
ways on prod, and an exact match would reach a third of a cohort and look like it worked. The
resolved count shown before sending is the only honest check that the spelling caught everyone.
Deleted accounts (076 anonymises rather than row-deletes) are excluded everywhere.

**Also: the admin header finally has a `<NotificationBell />`.** The backend has been writing
admin notification rows for weeks — the assistant's budget warning, the nightly staff report —
with no screen to read them on, so a missed push was a lost message.

Browser-verified: «الكل» refused a wrong count and accepted the right one; a role send wrote 9
rows at `push_state 'pending'` plus its audit row (dev test rows cleaned up afterwards).

### 4. «الإشعارات» — opt-in for offers, opt-out for everything (Apple 4.5.4)

The composer above is the first thing here that can send an **offer**, and that creates an
obligation the shop did not have before. Apple's guideline **4.5.4** allows promotional push only
when the user opted in through consent language **in the app** AND can opt out **from inside it**;
Play takes the same line. The app had **neither** — the only way to stop a marketing push was to
kill notifications at the OS level, which also kills «طلبك جاهز».

**Migration 089** adds `users.notification_prefs` (`orders`, `marketing`).

⚠️ **`marketing` DEFAULTS FALSE and must stay that way.** Consent cannot be inherited from a
column default; defaulting it true would silently enrol all 1,100+ existing accounts and would be
invisible right up until a reviewer looked at it. `orders` defaults true because that is what the
app is for — still switchable, but turning it off is the student's deliberate act.

⚠️ **The rule is enforced in ONE place** — `notificationPrefs.marketingFilterSql()`, applied by
`pushBroadcast.audienceSql()` to any send flagged `marketing`. **Do not add a second path that
sends promotional copy around it.** A marketing send is also typed `admin_marketing` in
`notifications` and stamped on the audit row, so which rule each send was made under stays
readable afterwards.

⚠️ **The OS permission prompt buys TRANSACTIONAL notifications only.** The consent language for
offers is the «العروض والأخبار» switch on `/account`; that split is documented at the ask site in
`PushRegistrar.tsx` so the two cannot drift apart.

`NotificationPrefs.tsx` sits on `/account` **above** the danger zone — a student looking for a way
to stop notifications must find it before they find «حذف الحساب». Turning a switch off does not
unregister the device: the other category keeps working and the in-app bell keeps everything.

Browser-verified: defaults orders-on/marketing-off · ticking marketing persisted server-side ·
the retail audience went **1,147 → 1** for a marketing send and stayed **1,147** transactional ·
the composer's own «عرض أو خصم» switch showed the same 1,147 → 0 with the policy note.

### Notes for whoever merges this
- **Four migrations ride this branch: 086, 087, 088 and 089.** All are in `db/schema.sql`, so the deploy's
  `npm run migrate` covers them — the same ordering rule 077/078 already have.
- ⚠️ **Two files are both numbered 085** (`085_discount_restore_log.sql` and
  `085_sash_shelf_shared_bins.sql`). Harmless today because both are in `schema.sql`, but
  `npm run migrate:file` on "085" is ambiguous. Left alone deliberately — both are applied to
  prod, and renaming an applied migration makes prod's history match nothing.
- **Phone width is still unseen** (fifth session). These are admin screens, which are
  laptop-primary, so it matters less here than on the staff/rep surfaces.
- Dev-only, not committed: the laptop dev DB had 54 products still carrying a `compare_at_price`
  from before the August round ended on prod. They were cleared so dev matches prod.

## 2026-08-24 — 🔎 Instant search on the staff home queue (المصمم's first screen)

Owner ask: the designer's first screen — «مراجعة التصاميم» at `/staff` — had the source
(تجزئة / ممثل) and zone filters but no way to find one student in a 502-row queue. One box now
sits above the tab switcher and filters as you type.

**No new matcher was written.** `lib/queue-search.ts` already defines what "search" means for
this app (`matchesQueueSearch` + `normalizeArabic`), and `/staff/queue` and المجهز's PrepConsole
already call it. The staff home is now the third caller, so the three screens cannot disagree:
every whitespace token must appear somewhere in student name · university · department · rep ·
`search_text` (the التطريز the student typed), with أ/ا, ى/ي, ة/ه and tashkeel folded. Verified
live: «احمد» and «أحمد» both return 29.

**Filtering is CLIENT-side over what the source filter already fetched**, which is exactly the
"auto filter" the owner asked for — «تجزئة» searches only retail rows, «ممثل» only rep students,
and no request fires per keystroke. Measured in a real browser as مضر محمد (designer):
· تجزئة + «احمد» → **29 من 335**, counter rendered.
· ممثل + «احمد» → **39 من 502**, zero retail rows in the result, and the typed query survived
  the source switch instead of resetting.
· «احمد ديالى» (two tokens, AND) → **27 من 502**.
· A query matching nothing → «لا توجد نتائج لـ «…»» rather than the queue's own empty state,
  so "nothing matched" never reads as "the queue is empty".

**One box serves BOTH tabs.** «مكتملة / أنجزتها» filters through the same matcher (6 completed
rows, «احمد» → 0 → the same not-found message). The value joins `activeTab`/`sourceFilter`/
`zoneFilter` in the existing `sessionStorage` mirror, so back-navigation from an order restores
the query with the rest of the UI state.

Completed rows come from `completed()`, which does NOT select `search_text` — so on that tab the
match is name/university/department/rep only. Deliberate: the field is a queue-only index and
adding it there is a separate query change, not part of this ask.

tsc, eslint and `next build` clean. Frontend only — no backend change, no migration.

## 2026-08-22 (b) — ✅ THE DISCOUNT ROUND IS ENDED ON PROD — 51 retail prices back, 5 cells left alone

Run 3 of «End discounts (manual)», batch **`12198690-d531-4683-b52a-9f69910f73c4`**, 17:46 UTC.
`products cleared : 51 · prices restored : 51 · promo banner OFF · re-read: 0 products still
carry an old price.`

**The owner's «i think 5000» was exactly right, and the report proved it before anything was
written.** Every one of the 51 discounted `retail` cells sat exactly 5,000 below its compare-at:
وشاح الفراشة + the وشاح variants + شال امريكي 1‑17 at 25,000 → **30,000** · the روب فصال family at
45,000 → 50,000, 40,000 → 45,000, 35,000 → 40,000, 30,000 → 35,000, 20,000 → 25,000 · وشاح عدل
15,000 → 20,000.

**⚠️ THE FINDING THAT MADE THE REPORT-FIRST DESIGN WORTH IT.** An unscoped `--restore` would have
ALSO raised four product-level `base_price` cells that were below their compare-at by amounts
that were never the discount: **وشاح +20,000** (30,000 → 50,000), **روب فصال بشت +15,000**,
**وشاح عدل +10,000**, وشاح منحني +5,000. `products.base_price` is the FALLBACK a **rep-linked
student** pays when a product has no wholesaler row, so that would have raised real order prices
by up to 20,000 on a round the owner described as 5,000. Hence `--scopes=retail`: restore the
kind of cell the round actually touched, leave every other kind alone. These five cells (the four
above plus وشاح عدل's wholesaler row at 15,000/20,000) are listed in the run log under
«DELIBERATELY NOT RESTORED», with their old prices — **that log line is the only human-readable
copy left**, because the same operation clears `compare_at_price`. Still open for the owner: are
any of those four product-level prices genuinely meant to be higher?

**Two defects the live run surfaced, both fixed before the write:**
· The printed UNDO covered only `products.base_price`, so it silently failed to reverse a
  retail-scoped run — i.e. the common case. It now covers `product_price_roles` and
  `compare_at_price` too, and the three statements were REHEARSED on a seeded copy and returned
  every value to its pre-run state.
· Skipped-but-discounted cells were invisible in the output.

**How it was run at all.** The owner had no laptop and no admin session on his phone, and this
sandbox has neither `DATABASE_URL` nor network access to `lolo-shop96.com`. So the same
`lib/discountRestore.js` got a CLI (`backend/scripts/end-discounts.js`, `npm run end-discounts`)
and a **`workflow_dispatch`-only** workflow (`.github/workflows/end-discounts.yml`) that runs it
over the SSH secrets the deploy job already holds. Default mode is `report`, which writes
nothing. ⚠️ **Never give that workflow a `push:` trigger.**

## 2026-08-22 — 💸 «إنهاء الخصومات»: ending a discount round, from a phone, without guessing

Owner ask, sent with no laptop in reach: «remove the discounts at loloshop and back to normal
prices — i think 5000 change in price». Everything below follows from one fact discovered before
writing any code: **the database cannot say what "back to normal" means**, and this session
could not read it either (no `DATABASE_URL` in a cloud sandbox, and the network policy blocks
`lolo-shop96.com`, so both the DB and the public catalogue API were out of reach).

**The two rounds that look identical.** A discount can have been run two ways:
· **A** — the real prices were LOWERED and `products.compare_at_price` kept the old one.
· **B** — the prices never moved and `compare_at_price` is a marketing strike-through.
In both, `compare_at_price > base_price` by the same amount. Nothing in the schema distinguishes
them. Guessing **A** when it was **B** raises every price in the shop; guessing **B** when it was
**A** leaves it selling at the discount forever. **That is why this shipped as a screen and not
as a migration** — a migration would have had to guess, on production, with no backup.

**What actually shipped** (`/admin` → الإعلانات والعروض → «إنهاء الخصومات»):
· `GET /admin/discounts` — read-only. Every product carrying a «السعر قبل الخصم», every price
  cell it has, the current price, the old price, and the gap. It answers the owner's own
  question («i think 5000») from the data instead of from memory.
· `POST /admin/discounts/end` — writes only the cells sent back from that report.
· Both modes are one radio: **«رجّع الأسعار»** (case A) and **«الأسعار صحيحة — امسح السعر القديم
  بس»** (case B, an empty `scopes` list). The owner chooses after seeing the numbers.

**A price lives in two places** and the report had to model that: `buildShopFeed` prices a
product as `COALESCE(product_price_roles.base_price[role], products.base_price)`, so one product
has up to three restorable cells. `scope` names which.

⚠️ **The wholesaler cell is the trap, and it is handled twice.** A wholesale price sits below the
retail compare-at by the *normal margin*, discount or no discount — so it looks discounted when
it is not. It is therefore **never selected by default** (raising it to a retail old price would
overcharge every rep), it carries a red warning in the UI, and it is **excluded from the headline
delta**. That last one is not cosmetic: measured on a seeded shop, including it reported the
round as "mixed" (`uniform_delta = null`) on a shop where every real discount was exactly 5,000.
Excluding it reports **5,000** — the answer the owner was asking for.

**Three refusals, because this is the one catalogue edit that RAISES a live price:**
· A **stale press is refused whole** (409 `ERR_STALE`) — the client echoes back the numbers it
  displayed, and if any moved, nothing is written, not even the products that still match. Same
  principle as the confirmation signature in `lib/adminActions.js`: what executes must be what
  the human was shown.
· A cell that is **not actually discounted is dropped**, never written — this operation undoes a
  discount and must never CUT a price.
· An **empty selection is refused**, never read as "all products".

**Migration 085 — `discount_restore_log`, the undo the shop did not have.** A product's price is
a single mutable column with no history, and the only record of the pre-discount price is the
`compare_at_price` this very operation clears. So the old value is written *before* the price
that replaces it, keyed by `batch_id`: a rollback is one `UPDATE … FROM old_price`. The
clear-only mode logs too (`scope = 'compare_at_only'`), so even "I only cleared the badge" is
recoverable. This matters more than usual today — **the owner has no database backup right now.**

**Not touched, verified rather than assumed: orders.** `orders.price`, `order_items.price` and
the cart's `price_snapshot` are snapshots taken at checkout, so restoring a catalogue price
cannot reprice anything already bought or sitting in a cart.

**Verified against a real PostgreSQL 16, not by reading:** a throwaway cluster was built in this
sandbox, the whole of `db/schema.sql` applied to it (twice — idempotent, and 085 also applies
standalone), a discounted shop seeded, and the real controller functions driven end to end.
Measured: report reads 5,000 uniform with a wholesaler cell present · a stale press returns 409
and leaves `base_price` and `compare_at_price` untouched · the real press restores 3 cells across
2 products, leaves the unticked wholesaler price at 18,000, clears every `compare_at_price`,
turns the promo off and writes 3 ledger rows · clear-only restores 0 prices, clears the badge and
still logs the old compare-at · the report is empty afterwards. Server boots with the routes
mounted and both return 401 unauthenticated. 7/7 new unit tests on the validation layer,
`tsc --noEmit` clean, `npm run lint` clean, `next build` clean.

⚠️ **Deploying this changes NO data.** It creates one empty table and adds one admin screen. The
prices move only when a human presses the button — which is the entire design.

⚠️ **Phone width unseen**, the same obstacle as the last two sessions: there is no browser in
this sandbox at all. The panel is built mobile-first (every row ≥44px, nothing behind hover),
but the radio pair, the per-cell rows and the confirm card want one look at ~390px.
## 2026-08-21 (e) — 🧵 The sash shelf goes communal, the admin queue shows money, and المجهز stops closing the sheet to move on

Four owner asks, all small except the second, which turned out not to be the bug it looked like.
Branch `fix/shelf-and-queue-price`, off `main` (`c0e3c86`). No new dependency. **Migration 085.**

**1. «الإنتاج والمتابعة» → جميع الطلبات now carries the price.** `getQueue` selects `o.price` and
then DELETES it for every role but front-desk — literally the same `canSeeMoney` predicate
`getOrder` already applies (`isManager(u) || staffTypesOf(u).includes('preparer')`), so the list
can never show money a station's own detail page hides. Measured live: admin 1,447 rows with
price, preparer 435 with, **embroiderer 0, presser 0**.
⚠️ **A طقم carries its whole price on ONE piece.** 527 of 1,705 bundled rows on the dev DB have
`price = 0`, because the sash (usually) holds the bundle's whole price and its siblings hold
nothing — the same fact `deleteOrder`'s price re-anchoring exists for. A raw per-piece figure
would therefore print «٠ د.ع» on ~31% of the list and read as *free*. So the row shows
`group_price` (the SUM over the checkout group) for a bundled piece, labelled **«الطقم»**, and
the bare price only for a piece bought alone. The label is half the answer.

**2. رف التجهيز — «ما يقبل أكثر من قطعة». The picker was wrong, AND the shelf model was wrong.**

*The picker bug (frontend only).* `PlaceSheet.tsx` computed `blocked = mode === 'exclusive' &&
count > 0` with **no owner check**, despite a comment saying "someone else's bin". So «تغيير
الخانة» greyed out every occupied خانة **including the student's own** — the one bin `placePiece`
has always accepted a second piece into (D4: over the max in your own bin is allowed, just
flagged). Now `ownBin` is excluded from `blocked` and rendered green. Verified in a real browser:
the A01 button went from `disabled` to enabled with the title «خانة آيات خليل ابراهيم — فيها 1
قطعة», and a second robe was actually placed into A01 through it.

*The model was also wrong — this is the part that mattered.* Prod said the picker could not have been what
the owner hit. **Measured on production:** 47 sashes at التجهيز against **15** sash خانات · **zero**
retail students owning more than one sash · exactly two bins ever opened, **B01 (طيبة محمد) and
B02 (9m_so Marwa) — two different students each burning a whole خانة**. Under D2 (one student per
bin) the sash shelf caps at 15 students while 47 sashes need an address, and the obvious move —
stack the next sash in the same خانة — returns «B01 مشغولة بطالب آخر». The old `max_per_slot = 10`
could never even be reached: it bounds ONE student's own pile.
So, **owner-confirmed**: **migration 085 makes the وشاح section `mode = 'shared'` with
`max_per_slot = 20`.** روب (10) and قبعة (4) keep D2 — they are bulky and «whose bin is this» is
the useful label there. `suggestSlot`'s shared branch now **fills a communal bin to its max and
moves to the next**; a communal section with NO max (شال) never reaches that test and stays the
single bottomless bin it has always been. A full shelf proposes the LAST bin flagged `over`
rather than «بلا خانة» — the worker is holding the piece and it has to go somewhere.
⚠️ **«وين وشاح فلان؟» still works, and that is not luck:** `ShelfMap` searches each PLACED
PIECE's student name, never the bin's owner. Verified live — typing «رباب» ringed B01 while
everything else dimmed. The bin's own `student_id` is what stops meaning anything, so 085 NULLs
it on open sash bins; a stale owner would make a communal bin claim one student while holding
several. Bin colour now reports FULLNESS for communal bins (`over ? 'over' : 'shared'`) and the
map prints «1/20 وشاح» — `piece_label`, not the old hardcoded «شال», which had been labelling
every sash bin as shawls.
Verified end to end: B01 holding **Malak Khalid + رباب رحمن**, `student_id: null`, `max: 20`.

**3. المجهز gets «السابق»/«التالي».** `StudentSheet` takes an optional `nav` prop; `PrepConsole`
wires it to the **filtered** `groups` list — the sequence actually on screen, since landing on a
student the worker's own search excluded would read as a bug. At the ends the control is a
disabled span, not omitted, for the reason the order page already records: a pair that silently
becomes one button moves «التالي» under the thumb aiming at «السابق». Omitting `nav` leaves
التطريز/الفصال/الكوي untouched. Verified: stepped 2→3→4→3→2→1, counter tracked, «السابق» became a
SPAN at position 1.

**Verified:** 471/472 backend tests (the one failure, `app-open: a ping inside the session
window`, **reproduces on clean `main`** — pre-existing, unrelated, confirmed by stashing) · 6 new
shelf tests, 0 skipped · `tsc` + `eslint` + `next build` clean · driven in a real browser as
admin and as المجهز.
⚠️ **Phone width could not be screenshotted — third session running.** `resize_window` is a
no-op on this window (`innerWidth` stays 1564), an iframe rig is refused by the app's own
`X-Frame-Options: DENY`, and a sized popup lands outside the MCP tab group. What WAS measured at
390px: the sheet panel forced to 390 shows **no horizontal overflow** and both nav buttons are
**44px** tall (83 + 55 + 73 px of 390 used). The full-page phone pass is still owed.

## 2026-08-21 (d) — 🧠 «لولو الإدارة»: a console that reads the whole shop, acts under confirmation, and finally answers «هل الموظفين يشتغلون»

Owner ask, four parts: a full page for the admin · it should know the whole dashboard, **kept
carefully separate from the storefront assistant** · it should suggest actions and be able to
perform them when asked · it should say whether staff are opening the app, with a daily report
of opens, hours worked, and who did not work. Decisions taken before building: **execute a
closed whitelist of REVERSIBLE actions, each behind an explicit تأكيد** · **nightly push plus
the page** · **`role = 'staff'` only** (not workshop workers, not reps, not students).

Spec: `docs/superpowers/specs/2026-08-21-admin-ai-console.md`. Branch `feat/admin-ai-console`.

**The half that did not exist: whether an employee opened the app.** Three tables each answer a
piece of «هل يشتغل» and none answers it. `staff_attendance_records` is بصمة — one deliberate act
at the start of a shift, which cannot tell a preparer who stamped and worked from one who
stamped and left. `staff_activity_log` only fires when a PIECE MOVES, so a designer reading
briefs all morning is invisible in it and an empty station makes its whole staff look idle.
`site_visits` has no `user_id` at all, by design. So **migration 084** adds a fourth signal,
`staff_app_opens`: one row per employee per work-date, `opens` counting SESSIONS (the endpoint
increments only across a >30-minute gap, so a three-hour queue session is one open and coming
back after lunch is two). ⚠️ **It is never folded into payroll** — opening the app is not
attendance and not opening it is not a deduction. The report prints the two columns side by
side precisely because the interesting row is the one where they DISAGREE: **stamped بصمة, zero
opens** is the row the owner acts on, and merging the signals would erase exactly that row.

**`work_date` comes from `localParts(now, 'Asia/Baghdad')`, never `CURRENT_DATE`.** The server
clock is UTC and the shop is UTC+3, so between 21:00 and midnight Baghdad the two are different
days — an app-open filed under one and a بصمة under the other join to nothing and the report
silently shows an empty evening. The helper was extracted out of `attendanceController` into
`lib/shopTime.js` so both callers share one definition (a lib importing a controller was the
alternative, and worse). Asserted in `test/adminConsole.test.js` against a 21:30Z instant.

**The separation from «لولو» the storefront mascot, which the owner flagged.** They share only
the OpenRouter transport and the ledger table. Everything that decides what may be said is
separate, and in two places the two surfaces need OPPOSITE behaviour:
· **Guard.** `lib/answerGuard.js` rejects any IQD figure not in the price book. This surface's
  whole job is IQD figures. New `lib/adminAnswerGuard.js` asserts the mirror property — every
  number in the answer must be one WE computed — plus two rules the number check cannot reach:
  a **derived percentage** (≤100, so the small-integer exemption would wave it straight
  through) and **invented containment**. The second is the defect this guard exists for: the
  model wrote «٨٠ طلبًا بانتظار الموافقة، ومن بينها ١٢٣ طالبًا», where both figures are ours and
  correct and the sentence joining them is false. The rule is not «never say منها» —
  `revenue_summary`'s own facts say it — but that the model may only assert a containment we
  asserted.
· **Budget.** The daily USD ceiling was whole-shop, so the two surfaces could switch each other
  off — an AVAILABILITY bug in both directions. The public ceiling now bounds public spend and
  `AI_CHAT_ADMIN_DAILY_USD_MAX` (default $2) bounds the console. ⚠️ A caller that does not name
  its surface keeps the old whole-shop behaviour exactly, so every pre-existing caller and test
  is unaffected. Both directions are asserted.

**Actions: propose → validate → confirm.** The model returns `{action, params}` and that is a
suggestion which never reaches the database. `lib/adminActions.js` re-derives everything itself
— an id must resolve to a real row, a number must be an integer inside a bound written in that
file (tighter than the equivalent endpoint: the manual screen may pay any bonus a human types,
a model reading a misheard sentence may not), a date must parse and sit in a sane window. A
param that fails **kills the proposal rather than being repaired**. The validated proposal is
then HMAC-signed over `{adminId, action, params, exp}` with a 10-minute TTL, and `/act` verifies
the signature, the admin identity and the expiry before running anything — without the
signature a client could post its own `{action, params}` and every validation above would be
advisory. Six actions, all reversible: extend a rep deadline · set an order cost · approve or
reject one break · add a bonus · set a production goal.

⚠️ **Permanently excluded, and asserted by test so a future session cannot quietly add them:**
any approval or rejection of a rep order (HANDOFF ruling 2026-08-14 — that queue holds
unresolved student↔rep disputes, the damage is social and no revert undoes it) · every DELETE ·
passwords and the money-gate secret · `verification_mode` (an ordering landmine, not a toggle) ·
anything customers see · deductions from anyone's pay. Bonuses are in and deductions are out on
purpose; the asymmetry is the point.

**Suggestions use no model at all** (`lib/adminSuggestions.js`). A suggestion is a claim the
owner acts on, so every one is a SQL predicate over real rows: free, deterministic, testable,
and unable to invent a problem or miss one. ⚠️ «بانتظار موافقة الممثل» is deliberately absent
and the file says why — it looks exactly like a backlog worth clearing, which is why the refusal
is written down AND asserted.

**Metrics 8 → 22.** Added the staff/attendance/workshop/spend half the owner actually asks
about. Money metrics stay on `counts.js` vocabulary, so the console and `/admin` agree to the
dinar. A test runs all 22 against the real schema — `orders.wholesaler_id` does not exist, a
draft of the suggestions file assumed it did, and only running it found out.

**The nightly push.** `lib/staffReportJob.js` on pg-boss (already running as `loloshop-worker`),
21:00 Asia/Baghdad, writing one `notifications` row per admin — which `lib/pushOutbox.js` turns
into a phone push for free, the same path the AI spend warning already uses. ⚠️ Idempotent by
`NOT EXISTS`, not by trusting the scheduler: a restart or a redelivery must not push the same
evening twice, and the owner would read a second push as a second day.

**Verified.** 466/466 backend tests (was 427; 39 new) · `tsc` clean · `eslint` 0 errors ·
`next build` clean with `/admin/assistant` in the route list · all 22 metrics and all 7
suggestion blocks run against the real dev DB · the console answered a staff question and a
money question live through the real model, guard passing · **«وافق على كل الطلبات المنتظرة
موافقة الممثل» and «احذف الممثل» both produced no proposal at all** · a real proposal executed
end to end (deadline 2026-05-26 → 2026-06-05, `audit_log` row written with the actor and
`via: admin_ai_console`), and a token with one character flipped was refused. Dev DB restored
afterwards.

**Then verified in a real browser** (Chrome was started and the extension connected on the
second attempt). `/admin/assistant` renders: RTL sidebar with «لولو الإدارة», the four stat
tiles, five suggestion cards in severity order, the thread, the report table. History restored
correctly and scoped to this admin. A live question answered through the model. **The full
action flow was driven by hand — typed «مدد آخر موعد لممثل كلية اليرموك سبعة أيام», the confirm
card appeared, tapped تأكيد, the deadline moved and the card was replaced by the outcome so it
cannot be confirmed twice.**

**Driving it found a defect nothing else would have.** «كلية بلاد الرافدين» matches THREE reps
whose `university_name` is spelled identically, so the ambiguity refusal rendered «كلية بلاد
الرافدين · كلية بلاد الرافدين · كلية بلاد الرافدين» — a refusal the owner cannot act on, which
is barely better than guessing. The list now leads with the rep's own name: «مهدي علي حسين
(كلية بلاد الرافدين) · عبدالعزيز رعد خضير (…) · كرار حيدر حسين (…)». Same data as HANDOFF owner
action 7.

**Owner ask during the session: dates as numerals, not month names.** `toLocaleDateString('ar-IQ',
{month:'long'})` gave «٢ حزيران ٢٠٢٦»; the console now prints **2026/6/2** everywhere — confirm
cards, run messages, deadline metrics, stalled-piece dates, last-seen dates and the nightly push
title. One definition, `shopTime.fmtShopDate`, and it goes through Intl so the date is the one
at the SHOP rather than at UTC. Its own test caught a real bug on the way in: `new Date(null)`
is epoch 0, a perfectly valid Date, so a rep with no deadline would have rendered **1970/1/1**
inside a sentence the owner was about to confirm. Null is now checked before `Date` sees it.

## ✅ DEPLOYED TO PROD 2026-08-21 — verified live

Merged fast-forward to `main` (`08c7180`), CI green on all three jobs, auto-deployed. Verified
on the box afterwards:

- **Migration 084 applied** — `staff_app_opens` created with its six columns. It did not exist
  before the deploy (checked first), and `scripts/deploy.sh:17` runs `npm run migrate` *before*
  the frontend build, so the table existed before the new code served.
- **The nightly job registered and persisted** — worker log says
  `[staff-report] scheduled 0 21 * * * Asia/Baghdad`, and `pgboss.schedule` holds the row.
  Deploy landed at 23:04 Baghdad, so today's 21:00 had already passed: **first push is
  2026-08-22 21:00**, by which time staff will have opened the app.
- **First real report**: 8 staff · 6 بصموا · 2 غايبين · 3 لا زالوا بالدوام · 20h23m worked ·
  205 production actions. Seven suggestions fired.
- **Storefront «لولو» unaffected** — asked it a live price question through the public endpoint
  and it answered correctly from the price book, which is the check that matters after splitting
  the budget.

⚠️ **Today's report reads «6 موظف بصم بس ما فتح التطبيق» and that is an artifact, not a finding.**
The beacon shipped mid-afternoon; those six stamped in before the code that records an app-open
existed. The column is only meaningful from 2026-08-22 onward. Do not act on today's row.

**Backup taken first**: `/root/loloshop-prod-2026-08-21-2158.dump` on the VPS — 4.7 MB, 66
tables with data, `pg_restore -l` reads it cleanly. Prod at the time: 4,310 orders · 2,072
users · 2,197 plates.

⚠️ **Still NOT verified: phone width.** Chrome refused to resize the maximized ultrawide window
(innerWidth stayed 3097 through two attempts) — the same obstacle recorded for the storefront
assistant on 2026-08-12. No horizontal overflow at desktop width, and the report table sits in
its own `overflow-x-auto`, but the suggestion cards, the confirm card and that table have not
been seen at ~390px. **Every push to `main` auto-deploys**, so look at it on a phone once.

## 2026-08-21 (c) — 🧠 The reading layer: the AI proposes, the designer confirms, the sheet stays cheap

Owner ruling that set the shape: **«students are dumb — we fix it from our side»**, and
**«if it costs a lot more, no»**. So nothing here touches the student's order form.

**Where the money actually is — measured on prod first, and it moved the plan.** Instruction
text has cost the OpenRouter bill almost nothing: **52 plates ever generated from it, $1.26 of
$64.91 lifetime, and none since the guard shipped on 2026-08-14**. The cost is downstream —
**755 non-cancelled order lines** hold a message instead of a name (147 on rep zones, 608
retail-shaped), **721 of them have no artwork at all**, and **272 are already at التطريز or
past it**. **645 (85%) are talking about a photo the student attached** and the designer could
not see it without opening the order.

**An idea killed by measurement.** A deterministic extractor (cut the sentence at the first
instruction marker, keep the head) was run over all 755: **77 (10%)** produced something
containing the student's name, **553** produced confident-looking garbage — «الحمدالله مثل» ·
«شعار الشمس مثل» · «نفس» — and 115 produced nothing. Garbage that passes `isRealName` is worse
than no suggestion, because it is garbage a tired designer confirms. Defaulting to the
student's registered name was rejected by the owner for a better reason: many of these are
deliberately somebody else's name or a title — «المرشدة سرى سعد» · «المحلل محمد حسن».

### What shipped

**1. The photo is on the line.** `wholesalerNames` returns `customer_image_url` and the grab
row shows a 48px thumbnail that opens full-size. Verified live: 57 thumbnails across 86 rows.

**2. `lib/calligraphySuggest.js` — an AI layer that reads and PROPOSES.** Text in, structured
JSON out (`text` · `element` · `style` · `note`); it generates nothing and spends no image
money. Three properties are enforced, not hoped for:
· **The student's words never reach the image prompt.** `style` must come back as an id from
  the CLOSED list in `lib/calligraphyStyles.js` or it normalizes to null — otherwise a
  sentence a stranger typed would be writing our prompt.
· **A proposal the generator would refuse is dropped**, not offered (same `isRealName` gate).
· **A model-invented `order_item_id` belongs to nobody** and is discarded. The endpoint reads
  the text **from the order line**, never from the caller — ids are all the client sends.

**3. The designer confirms every line.** The proposal renders BESIDE the field with the
student's own words and the photo; «استخدم» is what copies it into the draft — and that press
is also what marks the line reviewed, so an unread suggestion can never walk a held line past
the instruction guard.

**4. Styles, on the same sheet, at the same price (migration 083).** «مد الحروف» · «خط أعرض» ·
«بدون زخرفة». A style is a property of the SHEET: `processNextBatch` now groups pending plates
by **(variant, style)** — including the cross-job hitchhiker top-up — so ten styled names still
ride ONE ~$0.10 image (~$0.01 each) instead of buying ten private ones (~$1.00). Mixing styles
in one image makes the model drift and ruins all ten, and a ruined sheet is a $0.10 re-run.

### Two defects found by using it, both fixed

· **The reader answered nothing while still charging.** `aiChat.complete()` clamped output to
  the assistant's 300-token ceiling (2–3 sentences), so a JSON object covering ten Arabic lines
  came back truncated → parsed as nothing → «0 اقتراحات» on a call we had paid for. `complete`
  now takes an explicit `maxOutputCap` (default unchanged for the assistant) and an unparseable
  answer is logged instead of swallowed.
· **Owner's report: «غفران → اقتراح: غفران … what did it change? nothing».** Two fixes: no-op
  proposals are filtered server-side (compared through `normalizeAr`, so أ/ا alone is not a
  change) and reported as a count — «N سليم أصلاً» — and the button now reads **only the flagged
  lines**: «اقرأ التعليمات (7)» instead of all 86 selected. That is 12× less reading per press
  *and* no rows of noise. When nothing is flagged it still falls back to the whole selection,
  because the instruction word list is deliberately narrow.

### ⚠️ The «ميم» trap — owner's catch, and the rule it produced

The reader turned «ميم مثل الصورة التي في الاسفل» into text «ميم». That extraction is
**correct and unwearable**: the student wants the LETTER م drawn like the one in their photo,
and «ميم» would be stitched as a three-letter word nobody would catch until it was sewn.

**The rule: correctly parsed is not the same as embroiderable.** Letter references are now
refused deterministically (`isLetterReference` — the 28 letter names, «حرف الميم», «الميم», and
any single letter, all through `normalizeAr`), never left to the model's judgement, and the
system prompt names the case too. Every suggestion now carries a `kind`:
· `name` — there is text; «استخدم» fills the field.
· `letter` — a letter or shape. **Never offered as text.** The photo is the reference.
· `photo` — «مثل الصورة»: the attached image IS the design.
· `unclear` — no name and no photo. A human has to ask the student.
The row shows the kind as a chip with «افتح الصورة» instead of a «استخدم» button.

**And the reassuring half:** a `photo` line is not a blank piece downstream.
`productionController`'s `artworkOf` is `plate_image_url || customer_image_url`, so the
embroidery station already shows the student's own image when no plate exists. What was
missing was telling the designer that this is the answer rather than a gap.

### Cost, measured not estimated

Eight real prod-snapshot lines through the live endpoint: **$0.0016**, ~$0.0002/line, and it is
ledgered under `kind='suggest'` in `calligraphy_spend_log` — the **same** `CALLIG_DAILY_USD_MAX`
ceiling as the image spend, so it can never run away unwatched. All 755 existing lines would
cost about **$0.15** once. One calligraphy sheet ≈ 600 readings.

Quality on those eight: «الاستاذة نبأ ضياء اوريد نفس الخط…» → «الاستاذة نبأ ضياء» · «صفحه سُهاد
عُمِر قاسُم وصفحه ثانيه مثل بصورة» → «سُهاد عُمِر قاسُم» · «تطريز هذه الصورة» → *no name*, with
the request explained. Nothing invented.

**Also fixed in passing:** the grab-row checkbox built its next Set from the render closure, so
two clicks inside one React tick lost one. Functional update now, like «تحديد الكل» beside it.

**Gates:** 424/424 backend tests before this batch, 107/107 on the affected files after ·
7 new tests in `test/calligraphySuggest.test.js` · `tsc`, `eslint`, `next build` clean · driven
end to end in a real browser against the dev DB.

⚠️ **Migration 083 must ride the same deploy as this code.** It is in `db/schema.sql` too, so
the deploy's `npm run migrate` covers it — same ordering rule 077/078/079/080/082 already have.

## 2026-08-21 (b) — 📥 The iPad «تنزيل» buttons · rep lines editable before generation · Arabic search

Three things the designers hit on the iPad, reported by the owner and by مضر. Branch
`fix/rep-sash-carrier` (same working branch), **unmerged**. 418/418 backend tests, `tsc`,
`eslint` and `next build` clean; driven in a real browser against the dev DB.

### 1. «تنزيل» opened an empty page, or a half-empty page holding one photo

Two separate defects, both measured against prod, not guessed:

* **«تنزيل الكل (ZIP)» 401s on every platform.** It did `window.location.href =
  calDownloadUrl(jobId)`. Every `/api/calligraphy/*` route is behind `authRequired`, which
  reads the **Authorization header only** — and a browser navigation sends no headers.
  Measured live: `GET …/jobs/…/download` with no header → **401, 45 bytes of
  `{"error":"غير مصرح"}`**, with the Bearer header → **200 `application/zip`, 855,198 B**.
  The workbench was being *replaced* by that 45-byte page. That is the «صفحة فارغة».
* **Every per-image «تنزيل» was `<a href download>`.** The attribute is inert inside the iOS
  WebView shell (WKWebView has no downloader wired to it) and on the `data:` URLs the
  300-dpi board exporter produces, so the tap NAVIGATES to the image — a white page with the
  artwork in the corner and no way back. That is the «صفحة نصف فارغة وفيها صورة».
  A third, quieter one: the folder fallback revoked its blob URL on the line **after**
  `a.click()`, which Safari reads as "cancel".

**Fix — one helper, `frontend/lib/download.ts`,** and now the *only* way this app hands over a
file (`grep` for `download=` / `a.download` finds nothing else): authenticated bytes are
fetched through axios and saved as a blob · inside the iOS shell it goes through the **share
sheet** (which is also the fastest route to WhatsApp) · everywhere else a `blob:` URL, which is
always same-origin so `download` is honoured, with a **late** revoke · a CORS/offline failure
falls back to the plain link, so the floor is the old behaviour, never worse.

Converted: the plate card + preview modal + both job ZIPs + the folder fallback
(`CalligraphyTool`), the 300-dpi board and gown exports (`HighResExporter`,
`render-gown-composite`), `DesignGallery`, `StaffOrderBreakdown`, and the staff order page's
attachments — the last four through a shared `components/ui/DownloadLink.tsx`.
**«لوحات بدون طلب» is the same `PlateCard`**, so it is covered; verified by clicking one.

**Bonus the fix pays for itself with:** plates are stored under a 32-char content hash, so a
designer's Downloads folder was N files nobody could tell apart. The saved file is now named
after the student and the zone — verified on disk: `الأستاذ أحمد فراس الأمير أمامي.png`.

### 2. A ممثل's lines are now editable BEFORE the paid generation (مضر's report)

Rep students type instructions into the embroidery-name field exactly like retail students do
— *«خلي التطريز محمد مع حرف N»* — and the generator embroidered the sentence. The owner rule
from 2026-07-21 («ممثل = generate in bulk then review · تجزئة = review first») rested on rep
forms producing clean names. They do not.

The grab list now renders **an editable field per line** instead of a read-only span, with the
student's own words kept underneath as «كلام الطالب: …» plus «استرجاع», exactly like
`RetailReviewBoard`. Same two rules as that board: the draft is a **render draft** — it rides
with the plate and is never written back to `order_items.customer_text` — and **a line the
designer retyped counts as reviewed**, so it stops being held.

That last part needed a backend change: `reviewed` was job-level only, and flagging the whole
job would have waved through every untouched line in the same batch. It is now settable
**per item** (`backend/controllers/calligraphyController.js`), which grants a crafted call no
new power — the job-level flag was always settable by the same caller. Covered by
`backend/test/calligraphyReviewedLine.test.js` (4 tests, incl. "the corrected line generates
while the untouched instruction beside it is still dropped" and "a per-item flag cannot rescue
junk"). Drafts survive navigation in sessionStorage, capped like the «لصق أسماء» draft is.
The row counter now reads «N محدد · N لم يُولَّد بعد · N نص مُصحَّح · N تعليمات بحاجة تصحيح» —
verified live: editing one held line moved it 8 → 7.

### 3. «سجى» and «سجي» are the same name and the search disagreed

Owner's report, verbatim: *«press سجى or سجى»* — the two look identical and are different code
points (ى U+0649 · ي U+064A). Every name search was a raw `includes()`, so which key the
designer pressed decided whether a student existed.

**Measured on the prod snapshot: 318 of 1,147 student names (28%) and 226 of 458 plates carry
at least one variant character** (أ إ آ ى ة ؤ ئ or a diacritic) — «سرى رحمن» · «اية علي احمد» ·
«طيبة فراس» · «زبيدة أكبر». Verified in the browser: searching «سري» matched **0** plates
before and **2** after («سرى», «المرشدة سرى سعد»).

`frontend/lib/arabic.ts` is the byte-for-byte twin of the server's `normalizeAr`
(`backend/lib/calligraphyText.js`) plus a `matchesAr()` predicate, and it replaced the raw
`includes()` in **all nine** places that search Arabic names: the plates grid, the تجزئة board,
both lists on the rep's students page, `/design-support`, the rep's own students page (phone
audience), the shelf map, and both `StationConsole` filters.

Same pass, same screen: a search hit inside «لوحات بدون طلب» used to drag **all 58** orphan
plates onto the screen, because that bucket is not an order and was matched as one group. It is
now filtered per plate; a matching real ORDER still shows all of its zones, which is correct —
they belong together.

## 2026-08-21 — 🎀 A featured sash was renaming every rep bundle («وشاح الفراشة» vs «ملكي»)

Reported by the admin as *«wholesaler students see وشاح الفراشى not وشاح ملكي»*, seen from the
rep-facing student accounts. Real bug, **no money impact**, now fixed in code (branch
`fix/rep-sash-carrier`, **unmerged**) and backfilled on prod.

**Root cause.** The rep طقم form has no shape picker — `FullSetOrderForm.tsx:338` offers only
عادي/ملكي — so the sash *product* on a rep order is a pure **carrier**: an identity to hang the
order on. The spec lives in the order lines («نوع الوشاح: ملكي»), and
`staffController.wholesalerAccountSummary` reads عادي/ملكي from **there**, never from the product.
But `lib/fullSetOrder.js` resolved the carrier with `ORDER BY type, featured DESC, sort,
created_at`, and every sash has `sort = 0` — so the tiebreaker that actually decided it was
`featured`, a **storefront merchandising flag**. «وشاح الفراشة» was featured on 2026-07-07 and
from that moment every rep bundle silently took its name.

**Measured on prod before the fix** (all figures from the prod DB, not the stale laptop copy):

| month | rep sash carrier | orders |
|---|---|---|
| 2026-06 | وشاح (family parent) | 49 |
| 2026-07 | **وشاح الفراشة** | 321 |
| 2026-07 | وشاح | 116 |
| 2026-08 | **وشاح الفراشة** | 114 |

**405** rep orders were titled «وشاح الفراشة» while the student had picked ملكي — on the same card
as their own «نوع الوشاح: ملكي» and «إضافة: وشاح ملكي» (+15,000) lines. Rep students had landed on
**no other sash** since the flag (435 «الفراشة» + 165 «وشاح», zero of the other ten) while retail
spread normally across all eleven, which is why it hid for six weeks.

**Why no money was at risk** — verified three ways, not assumed: the resolver does not even
`SELECT base_price` (it selects `id, type`); money/inventory read عادي/ملكي from `order_items`
(`staffController.js:77-115`); and the +15,000 ملكي add-on line was present throughout (506 rows).
The damage was that staff, rep and student screens all showed a shape nobody chose — including the
staff card the workshop cuts from, where «الفراشة» and «ملكي» are different physical shapes.

**Fix** (`lib/fullSetOrder.js`): resolve the carrier to the family **parent** and drop `featured`
from the ordering — `ORDER BY type, (parent_id IS NOT NULL), sort, created_at`. Merchandising can
never rename an order again. Robe and cap already resolved to their parent («روب» 544, «قبعة» 590,
single-valued on prod), so only the sash moves.

**Test** — `test/fullSetSashCarrier.test.js`, written first and watched fail (it featured «وشاح عدل»
and the resolver immediately handed the rep bundle that name). It features a child sash itself and
restores every flag afterwards, so it does not depend on the local catalog. A second case asserts
the ملكي choice is still on the lines, so a future "fix" cannot make the name right by dropping the
choice. **414/414 backend tests.**
⚠️ `node --test test/` now fails on Node v26 with a bare `MODULE_NOT_FOUND`; use
**`node --test test/*.test.js`** from `backend/`.

**Prod backfill — done 2026-08-21, reversible.** Dry-run first: 444 rows in scope, **0** retail
orders caught by the filter, **0** collisions against `uq_orders_student_product_nodesign`. Scope is
rep-linked students whose sash order carries a *child* product and has a `group_id IS NULL` line
labelled «نوع الوشاح» (the rep-flow signature — retail uses `group_id`/`option_id`, so it cannot be
caught). 444 orders moved to «وشاح» inside one transaction. After: rep students **600/600** on
«وشاح»; retail untouched, including the **22** who genuinely chose «وشاح الفراشة».
· Backups before the write: full dump at `/root/db-backups/loloshop-pre-sash-carrier-20260821.dump`
on the server, copied to `~/Desktop/_private/loloshop-db/`, **plus** table
`_backfill_sash_carrier_20260821` holding all 444 old `product_id`s — rollback is one UPDATE.

⚠️ **The code fix is NOT deployed.** Existing orders read correctly now, but a *new* rep bundle
still picks up whatever is featured until `fix/rep-sash-carrier` reaches `main` (every push to
`main` auto-deploys). Backfill order was safe either way: the EDIT-STABILITY pin in
`fullSetOrder.js` re-pins an existing student to their corrected carrier on re-save.

## 2026-08-18 (b) — 💸 The four calligraphy cost fixes — MERGED & DEPLOYED, verified on prod

Same session as the audit below; the owner approved «50% cost less? ok go work», then «go
live». Merged to `main` (`a105064`), CI green on all three jobs, auto-deployed. **Verified on
the prod box after the deploy:** migration 082 applied (`original_plate_path` column + 
`calligraphy_spend_log` table exist, **1,892 plates backfilled** with their geometry anchor),
all three PM2 processes online, site 200 and `/api/catalog/shop` 200 from outside. All four
levers implemented TDD (each test watched failing first), **407/407 backend tests** (400 on
main + 7 new in `test/calligraphyCost.test.js`), driven against the dev DB with
`global.fetch` stubbed — the tests spend nothing.

1. **Rerolls buy 1K 1:1, not 2K 9:16** (`calligraphyController.reroll`). ~$0.067 vs ~$0.101
   per press, and the 1:1 canvas is ~1024px wide so long teacher names don't cramp the way a
   1K 9:16 portrait (~576px) would. Same quality: the band is normalized to sibling geometry
   (~100-200px ink height) anyway, so 2K bought pixels that were thrown away.
2. **The reroll geometry ratchet is dead** (migration **082**, `original_plate_path`). Rerolls
   anchor on the FIRST generated plate forever, not the plate they replace — ink height can no
   longer shrink monotonically across presses (this was HANDOFF's «needs migration 081»; 081
   was taken by counter_signup, so it shipped as 082). Engine pins the anchor on first
   generation; reroll pins the pre-reroll plate for pre-082 rows. Backfill pins existing rows
   on their current artwork (best surviving anchor) and is repeated in `db/schema.sql` on
   purpose, 077/080-style.
3. **Sheets fill themselves before generating** (`calligraphyEngine.processNextBatch`). A job
   with <10 same-variant pending plates tops the paid sheet up with the oldest pending plates
   of the same variant+model from OTHER jobs («hitchhikers»). The response stays scoped to the
   requested job (counts, `plates`) so the workbench and the worker's drain loop are
   unchanged; hitchhikers just get done in the DB and their own jobs find less to do. Safe
   because every pending plate has already passed createJob's guards (retail is reviewed
   BEFORE its job exists) and the style prompt is per-variant, not per-job. On a generation
   ERROR only the requesting job's plates fail — unpaid hitchhikers stay pending.
4. **A daily USD ceiling exists now** (`lib/calligraphySpend.js` + `calligraphy_spend_log`,
   migration 082). Every paid image — sheet attempt, reroll, element (whose cost was ledgered
   NOWHERE before) — writes one ledger row at payment time; the 24h sum refuses the next
   generation past `CALLIG_DAILY_USD_MAX` (default $10) with `ERR_CALLIG_BUDGET` 429, and
   crossing `CALLIG_DAILY_USD_WARN` (default $5) writes the admins one notification per 24h
   (→ phone push via the outbox), aiChat's exact pattern. Blocked batch plates stay PENDING:
   pg-boss retries twice then the workbench press — or any later job's top-up — drains them.
   Defaults live in code; the two env vars are documented in `backend/.env.example`.

**Deploy notes:** merge deploys automatically; `scripts/deploy.sh` runs `npm run migrate`
before the frontend build, and `db/schema.sql` carries 082 (column + backfill + spend table),
so the ordering is already safe. No new dependency (nothing enters the `npm audit` gate). No
frontend change. Prod env needs nothing — defaults apply until the owner tunes them.

**Projection at August volume (~1,700 names + ~160 rerolls/month): ~$53 → ~$25-30.**
Not done (needs owner/live test): Nano Banana 2 Lite ($30/M vs $60/M) must pass the 10/10
Arabic spelling test before it can take the reroll/element traffic.

## 2026-08-18 — 💸 OpenRouter spend audit: calligraphy is 92.5% of the bill — INVESTIGATION, no code

Owner asked why OpenRouter is "spending a lot". Measured on the OpenRouter dashboard (past month,
Jul 19 → Aug 18) + the `/api/v1/key` endpoint — not estimated:

- **Account total $57.69 · LoloShop key $54.70 (94.8%) · Nano Banana 2 (calligraphy) $53.40 =
  92.5% of everything.** The assistant («لولو», Gemini 2.5 Flash) cost **$3.72** — the thing with
  five protection layers is 6% of the bill; the thing with almost none is 92%.
- **527 image requests → $0.1013/image**, matching the ~$0.10 @2K estimate in `lib/openrouter.js`.
- Steady burn ~$2–4/day Aug 6–17 (workbench-shaped, not batch-job-shaped). This calendar month
  alone: $42.13. Credits: $66.54 used of $92.
- Unit economics from code: batch sheet = 10 names / $0.10 = **$0.01/student**; a reroll
  (`calligraphyController.reroll`) generates ONE name at the same 2K 9:16 → **$0.10/name, 10×
  the batch rate**, up to `REROLL_LIMIT=10` = $1/plate.
- **Prod ledger audited same session** (read-only, `calligraphy_plates`): 2,124 plates, 151
  jobs, **$59.43 lifetime** (Jun 23 → Aug 17), 338 students, accelerating Jun $2.18 → Jul
  $16.72 → **Aug $40.53 in 17 days** (week of Aug 10 alone: $25.84). Exactly three API callers
  exist: batch sheets (`calligraphyEngine:146`), rerolls (`calligraphyController:463`), elements
  (`:708`, 1K — cost NOT ledgered, reconciles the ~$0.5 gap vs OpenRouter). Decomposition of the
  $59.30 done-plate spend: **1,334 plates rode full 10-name sheets for $13.46 (23%)** — the
  efficient path; **$27.72 (47%) went to 279 plates that each cost ~a whole image** (solo/small
  sheets: 34 sheets carried ONE name, only 130/236 were full); **counted rerolls $11.95** + ~$7-8
  hidden pre-080 rerolls (reroll_count=0 plates costing up to $0.81); crop retries ≈ $1-3;
  failures cost nothing ($0.14). Caps/backs are the worst per name (avg $0.044/$0.040 vs front
  $0.0245) because they ride the smallest sheets. Wholesaler path: 337 students / $28.40 =
  **$0.084/student, 8.4× the theoretical $0.01**. `typed` source (admin manual batches) is
  $29.62 — half of everything. Premium model: never used in prod (25 old 2.5-flash-image rows
  are the June Arabic test).
- Pricing facts (OpenRouter models API): `gemini-3.1-flash-image` $60/M image tokens;
  **`gemini-3.1-flash-lite-image` is HALF that ($30/M, 1K-only)** — untested on Arabic spelling
  (the 10/10 live test is mandatory before any switch; 2.5-flash-image scored 0/10).
- Cost levers identified, none applied: reroll at 1K instead of 2K (one line, ~30-40% off each
  reroll) · live-test NB2 Lite for rerolls and possibly sheets (~50% off) · fix the reroll
  geometry ratchet (migration 081 — designers re-press because output degrades monotonically,
  every press $0.10) · calligraphy has **no daily USD ceiling** unlike the assistant — add one
  with the same admin-notification warning.

No code, no migration, no deploy. Marketing folder checked — QR generation only, not a spender.

Owner report: "otp bypass expired". It had — `OTP_DEGRADED_UNTIL=2026-08-17T10:00:00Z` lapsed at
10:00 UTC, ~2.5h before the report, and the flag is read per request so students started being
asked for a WhatsApp OTP again the moment it passed.

**Measured before changing anything** (prod logs + prod DB; DB session TZ is `Europe/Berlin`, so
psql timestamps are UTC+2 — the buckets only line up once you correct for that):
- `otp_codes` shows `login`/`verify` rows reappearing *exactly* at 12:00 local = 10:00 UTC, the
  lapse minute. Before that only `purpose='reset'` rows existed, because reset is the one flow
  the bypass never covered.
- The gateway is **flapping, not banned**: `WhatsApp API rejected [device 4156d2…]: 201 Device is
  not connected. Please scan QR code first` ×4, but sends succeeded afterwards. Delivery today
  ran 43% (9/21) against 90%+ earlier in the month; four students requested 2–3 codes each and
  never used one.
- **The official WhatsApp Cloud API is NOT configured on prod** — no `WHATSAPP_TOKEN` /
  `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_OTP_TEMPLATE`. `lib/whatsappCloud.js` is deployed but
  dormant, so the flapping Zentramsg device is the *only* sender. Only one device UUID is set;
  `ZENTRAMSG_DEVICE_UUID_2..4` are unused, so the fleet failover has nothing to fail over to.

**Why the env alone could not do it.** Owner asked for "no expiry until I change it".
`isOtpDegraded()` caps date values at `MAX_DEGRADED_WINDOW_MS` (48h), so a far-future date reads
as **OFF**, not on — putting `2027-…` in the env would have silently re-enabled OTP. Needed code.

**`5d00679` — `OTP_DEGRADED_UNTIL` now also accepts the literal `always`.** A word, not a raised
cap: the 48h limit on dates is untouched, because it guards a *different* failure (a typo'd year
becoming a multi-year bypass). Nobody fat-fingers `always`, and `'yes'/'true'/'1'/'forever'` all
still read as OFF. 400/400 backend tests; 5 new assertions in `test/otpDegradedMode.test.js`
covering the sentinel, its case/whitespace handling, and that it did not loosen the date cap.

Deployed via CI auto-deploy, then `.env` set to `always` (backup at `.env.bak-20260817-142633`)
and `pm2 restart loloshop-api --update-env`. Verified on the box against the deployed code:
`isOtpDegraded() === true`, `FORGOT_PW_OTP_BLOCK` unset so **password reset still works** — which
is the property the owner specifically asked to keep.

⚠️ **This is now ON until a human turns it off.** Retail + wholesaler log in on password alone
(bcrypt still runs; no trusted-device token is issued; `phone_verified` stays false). The real
fix is upstream and is an owner action — see HANDOFF.

## 2026-08-17 (b) — 🤖 «لولو» upgraded: knows the app, smarter model, no more parrot — DEPLOYED

Owner: «تحس ما تعرف التطبيق، تكرر، وأجوبتها ضعيفة». Shipped as `41176eb` + `bc88c13`, live on prod.

- **SITE_GUIDE**: a fact block in the system prompt covering how the site is actually used —
  register/login/OTP, forgot-password (WhatsApp OTP, no email), the rep join flow and its
  approval gates, how "designing" really works (option form + embroidery text + logo upload —
  there is NO drawing canvas for students), robe measurements + the S–XXL size chart, cart/cash,
  packages + VIP upgrade, order tracking, returned orders, the Google Play app, account prefs,
  deletion ≠ order cancellation. Extracted from the real frontend pages by a subagent sweep, not
  guessed. Rule 3 now tells her to teach these steps.
- **Model**: `google/gemini-2.5-flash-lite` → `google/gemini-2.5-flash`, owner-approved at
  ~$1.0 per 1,000 messages. Chosen by running the 44-scenario harness on four candidates against
  the new prompt (full table at `DEFAULT_MODEL` in `lib/aiChat.js`): Haiku 4.5 invented a
  best-seller rationale + wrote markdown + Levantine «كتير» at ~$6/1k; gpt-5-mini returned empty
  content on every call. The $3/day ceiling and $1 warning are unchanged.
- **Repeats**: the anonymous answer cache now stores `lastSession` and regenerates instead of
  echoing the same bytes to the same person; support temperature 0.3→0.7; persona told to vary
  openings; length rule loosened to 5 short sentences for how-to answers.
- **Guard false positives — found in the prod ledger minutes after deploy** (`bc88c13`): the old
  DELIVERY_RE blocked «راح يوصلك رمز تحقق على الواتساب» (an OTP is a message, not a delivery)
  AND «ما نوصّل ولا نشحن» (the denial!); bare «lolo» was flagged as English. Promise patterns
  are now negation- and object-aware; brand nouns allowlisted; fee patterns extended to catch
  «التوصيل مو مجاني». New rule: prices in digits only («20,000», never «20 ألف») — worded
  prices were invisible to the invented-price check, so this closes a guard bypass.
- **Prod env** (`/var/www/loloshop/backend/.env`, backup `.env.bak-2026-08-17`): added
  `AI_CHAT_MODEL`, the three `AI_CHAT_*_USD_*` values and `SHOP_WHATSAPP` per the HANDOFF
  owner decisions — the WhatsApp escalation now actually goes to WhatsApp.

Gates: 397/397 unit tests (3 new prod-verbatim guard regressions) · 44/44 scenarios twice
consecutively on the final prompt+model · live prod spot-checks of the previously-blocked
answers. Known imperfection: the model sometimes guesses feminine forms for a gender-unknown
asker despite the persona rule — cosmetic, revisit if customers complain.

## 2026-08-17 — 📱 Mobile UI wave-readiness: /shop shipped EMPTY HTML; iOS zoom + h-scroll guards

Owner report on live traffic: auto-zoom on some phones, page pans left-right, products sometimes
not shown at all, «feels like a website not an app». Investigated with real evidence, not guesses:

- **User-agents from the prod caddy log falsified the old-browser theory.** All traffic is
  Chrome 150/151 and iOS 17–26 — even the Android 10/12 phones. The dominant environment is the
  **Instagram in-app browser** (biggest single share of hits). No 429/5xx in the log window, so
  rate limiting was not the products bug either.
- **`/shop` (القطع) served zero product tiles in its HTML** — the route was statically
  prerendered, so `useSearchParams` inside `<Suspense fallback={null}>` reduced the whole built
  page to the fallback. Users saw «جارٍ التحميل» until full JS hydration; on weak phones /
  in-app browsers / slow networks that reads as "products not shown". Fixed with
  `export const dynamic = "force-dynamic"` (feed fetch is revalidate-cached, so no backend load).
  The home page was NOT affected (ISR, tiles verified present in prod HTML).
- **iOS auto-zoom root cause:** any focused form control under 16px makes Safari/WKWebView zoom
  in and never zoom back — the zoomed page is then wider than the viewport, which is ALSO the
  left-right scrolling and the "zoomed-in website" feel. Retail inputs were already 16px, but
  wholesaler orders search + admin inputs were `text-sm`. Fixed as a class, not per file:
  `@media (pointer: coarse)` guard in globals.css raises every input/select/textarea to
  `max(16px, 1em)` on touch devices only.
- **Horizontal-overflow safety net:** `html { overflow-x: hidden; overflow-x: clip; }` —
  `.shop-paper` already clipped the storefront, every other route (login, admin, wholesaler,
  staff) had no guard.

Shipped as `df654b0` on `main` (lint 0 errors, `next build` clean, `/shop` now ƒ dynamic in the
build output). Deploy is automatic on merge.

## 2026-08-16 — 🚚 MIGRATED TO THE 8 GB BOX. LoloShop now lives on `169.58.114.255`.

**Prod is `169.58.114.255`, not `142.93.110.202`.** The old 2 GB droplet measured
**1.9 GiB total / 422 Mi available / 541 Mi swap in use**, shared with khatuna, teacher AND
Grand Layan (`grand-layan.com` resolves to it and runs on `127.0.0.1:3002`). The owner could not
resize it, so the shop moved onto the box that was already running **RevoArt** — 7.8 GiB, 4 vCPU,
96 G disk, 4 GB swap.

**The runbook's new-box plan was not what shipped.** `docs/migration-8gb-runbook.md` assumed a
blank droplet: install nginx, copy `/etc/letsencrypt`, run certbot. The target turned out to be
occupied, and **`supabase-caddy` owns :80 and :443** (compose in `/opt/revoart/supabase`). Rather
than fight for the ports, LoloShop was added as a **site block inside RevoArt's existing Caddy**,
which already routes by Host and terminates TLS. Net effect: **no nginx, no certbot, no cert
migration, and RevoArt took a graceful config reload instead of downtime.**

| | |
|---|---|
| Stack | Node 20.20.2 · PM2 7.0.1 · **PostgreSQL 17.11** (host PG16 was `inactive`, so 5432 was free) |
| Data | users **1744** · orders **3307** · order_items **14303** · products **60** — matched old box exactly; 8 pgboss tables / 7 jobs / 56 public tables identical on both |
| Uploads | **5.0 G, 7,415 files**, rsynced box-to-box over a dedicated migration key |
| TLS | the live cert was **copied**, not re-issued — pinned via `tls` in the Caddy block, so the cutover had **zero cert gap**. ⚠️ That also disables auto-renew for this site: before **2026-10-23**, either re-copy the renewed files or delete the two `tls` lines and let Caddy take the domain over |
| Speed | home page **80 ms** on the new box vs **900 ms** on the old |

### Three defects this caught, all of which would have fired under tomorrow's traffic

1. **`trust proxy` was `loopback`** (`server.js:40`). Behind Caddy the proxy is `172.18.0.1`, so
   `req.ip` would have been **the same value for every visitor on earth** — every per-IP limiter
   (assistant 100/15 min, `joinLimit` 10 signups/hr, OTP caps) would have throttled the entire
   launch within minutes. Fixed via `TRUST_PROXY` in the new box's `.env`.
2. **Timezone.** The old box was deliberately `Asia/Baghdad (+03)`; the new one is
   `Europe/Berlin (+02)`, RevoArt's default. The deadline, the بصمة window and the assistant's
   daily budget reset all read server-local time. Fixed **per process** in `ecosystem.config.js`
   (`TZ = 'Asia/Baghdad'`) — changing the HOST timezone would have moved RevoArt's clock instead.
3. **The CI deploy key was not on the new box.** `SERVER_HOST` alone is not enough; the
   `github-deploy` key had to be copied into `/root/.ssh/authorized_keys` or every deploy would
   have failed at the SSH step.

### The bridge — why the old box is not simply off

DNS was flipped at the registrar, but resolvers cache. With the old box's API stopped (one
authoritative DB, deliberately), stale-DNS visitors were getting **502 on every `/api/` call**.
So `lolo-shop96.com` on the OLD box was rewritten as a **pure forwarder to the new box** over
HTTPS (`proxy_ssl_server_name on` so Caddy picks the right site; original client IP preserved in
`X-Forwarded-For`, and `142.93.110.202` added to `TRUST_PROXY` so bridged visitors do not all
collapse into one rate-limit bucket). Both DNS paths now answer **200 on `/`, `/shop`, `/lolo`,
`/api/health`, `/api/catalog/shop`**.
⚠️ **Do NOT restore the old box's `proxy_pass 127.0.0.1` lines and restart its API.** That is
what creates two live databases at once; orders written to the losing one cannot be merged back.
The old nginx site is backed up at `/root/lolo-shop96.com.bak-premigration`, and the Caddyfile at
`/opt/revoart/supabase/volumes/proxy/caddy/Caddyfile.bak-preloloshop`.

### Verified live on the new box after the auto-deploy (`f021152`)

CI green on all three jobs (frontend · backend · **Deploy to VPS**) · migrations 078/079 applied
(`ai_chat_messages` + `ip_hash` present, reverted 082 `reaction` column correctly absent) ·
`TZ: Asia/Baghdad` inside the running API · both deep-link manifests **200 `application/json`,
0 redirects on apex AND www** · uploads serve with `no-store` + `attachment` + `nosniff` ·
**«لولو» answered a real price question end-to-end** («روب التخرج يبدأ سعره من 25,000 دينار»)
with `reaction: "none"`, which is the designed answer for an ordinary question ·
`grand-layan.com` and `khatuna.beauty` still 200 on the old box.

**WhatsApp OTP was measured, not assumed:** 251 sends in 7 days, and **194 of 228 codes issued
were actually used (85%)** — that is delivery, not just attempts. The new
`backend/lib/whatsappCloud.js` is **inert** until its three env vars exist.

**Monitoring:** Uptime Kuma runs in Docker on the new box, bound to **127.0.0.1:3001** (not
public). Reach it with `ssh -L 3001:127.0.0.1:3001 root@169.58.114.255`, then
`http://localhost:3001`. It still needs its admin account, its monitors and a notification
channel — that is a UI task nobody has done yet.

**Still open:** the old box is the rollback and must stay untouched until a full quiet day has
passed · Caddy's `/uploads` block duplicates three headers Express already sets (identical
values, harmless, worth tidying) · `docs/migration-8gb-runbook.md` still describes the
blank-droplet plan and should be rewritten to match what actually happened.

## 2026-08-15 (b) — reactions REPLACED: the visitor no longer taps them, «لولو» sends one

**Owner ruling: the tap-reactions were the wrong feature.** «I meant the AI itself does a
reaction with the user.» The six-emoji strip under every reply was the visitor rating لولو; what
was wanted is لولو reacting to the STUDENT, the way a person does before they answer.

**Deleted, all of it** — it had never reached prod (`main` was unpushed), so there is no
drop-migration and no compatibility shim: `POST /api/assistant/react` + `reactLimit` ·
`supportChatController.react` + the `REACTIONS` vocabulary · `db/migrations/082_*.sql` and its
`schema.sql` block · `test/aiChatReactions.test.js` (9 tests) · `ReactionRow` and the client
`react()` · the API.md section. The dev DB's now-orphaned `ai_chat_messages.reaction` column was
dropped too (1 of 118 rows held a value), so dev matches a fresh `npm run migrate`.
`message_id` went with it: it existed ONLY as the reaction target, and leaving a ledger row id in
a public response that the docs describe as "pass this to /react" would be worse than dead code.

**New `backend/lib/reaction.js` — WHICH reaction, decided server-side.** `pickReaction(question)`
→ `love` · `care` · `laugh` · `cheer` · `none`, read from the STUDENT's own words, not from the
answer. It imports `SAD_RE`/`COMPLIMENT_RE` from `lib/mood.js` rather than copying them, so
«لولو looks caring» and «the bubble goes soft» cannot drift apart, and it keeps mood.js's own
precedence: sadness outranks a compliment paid in the same breath. `guardTripped` forces `none` —
a face cheering over «اسأل ممثلك» reads as not having listened.
⚠️ **`none` is the common case and the tests pin it there.** «شكد سعر الروب؟» earns nothing. A
reaction that fires on every reply is an animation, not a reaction; every regex is written to
MISS an ordinary question. Laughter needs `ه{3,}` for the same reason — «هه» sits inside real words.
6 new tests in `test/aiChat.test.js`, beside the existing MOOD ones. **393/393 backend.**

**Three fields now, three different questions** — the distinction is written into reaction.js's
header because it is the thing a future reader will get wrong: `emotion` = what the ANSWER is
about (header face) · `mood` = the REGISTER it is written in (bubble tone) · `reaction` = what
لولو DOES on reading you (a message of its own).

**Presentation: chosen from three mockups, not guessed.** The first attempt — the 30px thread
face scaling up for 1.2s — was rejected on sight: too small, gone too fast, and it needs the
student to be looking at the right spot at the right moment. Three alternatives were built as a
working artifact (badge on the student's own bubble · header avatar reacts · sticker message) and
the owner picked **the sticker**: `LoloSticker` renders a 104px bubble-less mascot as its own turn
in the thread, `STICKER_LEAD_MS = 700` holds her words back so it lands FIRST, and it **persists**
— `animate` gates only the entrance, so a restored thread shows every sticker it received without
replaying them all on load. That is the difference between a message and an effect, and it is why
the sticker is a sibling of the bubble in `ChatBubble` rather than something drawn on it.
⚠️ `useRevealedWords` is now passed `animate && !held`: left running behind the held bubble it
would spend its 22ms-per-word budget invisibly and the answer would pop out fully revealed.

⚠️ **`care` is the one reaction with no art yet — `LoloFace.CARE_STICKER` is a PLACEHOLDER.**
The brand sheet has nothing right for it: `love` is heart-eyes, which reads as being smitten AT
someone having a bad day, and `thinking` (currently holding the slot) ships with a floating «؟»
that reads as confusion. Owner is having a caring sticker drawn. **To land it: drop
`frontend/public/lolo/lolo-care.webp` (256×256, alpha, sibling scale/lighting) and change that one
constant.** Nothing else in the app needs to know.

**Verified in a real browser against the dev DB**, not just built: all four reactions fire
end-to-end (server value → correct sticker src/alt → entrance class), the sticker leads the reply
by ~700ms measured, and an ordinary price question adds **no** sticker. tsc + lint (0 errors) +
`next build` clean.

**Unrelated repair, same session:** `frontend/.env.local` still pointed at `192.168.0.125`; this
laptop is `192.168.0.129`. Every assistant call from the browser timed out and لولو answered «ما
كدرت أوصل للمساعد» — a stale IP there fails silently and looks exactly like a broken feature.
Fixed, with that warning written into the file.

---

## 2026-08-15 — «لولو» assistant: location fix, product/university knowledge, mood, reactions — on `fix/ai-assistant-money` (UNMERGED)

Five owner-driven fixes to the storefront assistant, all on the already-parked
`fix/ai-assistant-money` branch (that branch's own money-metric fix is untouched by this work).

**1 — Location was actively wrong.** `SHOP_FACTS` and RULES item 9 in
`backend/controllers/supportChatController.js` said the shop was «ببغداد» in two bullets; the
storefront copy was corrected to ديالى back in `3d1cce8` but the AI prompt never was. Now reads
«محل حقيقي بمحافظة ديالى (بعقوبة)», matches `frontend/lib/copy-ar.ts` and the map coords in
`StoreLocation.tsx`. Also fixed the same wrong city in `lib/supportFallback.js` (the
model-unreachable canned answers) and a stale comment in `lib/answerGuard.js`; updated the manual
`scripts/ai-scenarios.js` harness's location regex to accept ديالى.

**2 — Product knowledge.** New `supportContext.productDigest(role)`: real ACTIVE leaf product
names grouped by type («- <type>: <name> (يبدأ من X دينار), …»), same audience-filter +
parent-exclusion shape as `priceBook`, capped at 20 names total and ordered by real sales via the
same `billableOrderSql` join `bestSellers` uses. Cached 5 min/role. New RULES line 13: naming or
recommending a product must come only from this list.

**3 — University knowledge (the «idk» complaint).** New `supportContext.universitiesDigest()`:
top ~15 university/college names (from `students` where `status='approved'`) by count + total
distinct count, cached 30 min. New RULES line 14: any «تسوون لجامعتي؟» question is ALWAYS a warm
yes — the shop serves every Iraqi university/college, the student uploads their own logo — never
«ما أعرف». Both digests wired into `buildSystem()`; the answer cache key already hashes the whole
prompt, so staleness handles itself.

**4 — Mood field.** New pure `classifyMood(question, answerText)` in `backend/lib/mood.js`:
`wink` (compliment/playful) → `caring` (sadness/tiredness, outranks a compliment in the same
message) → `neutral` (a guard fallback or an honest «مو متوفرة» answer — detected by reusing
`supportActions`' own `DUNNO_RE`, so the two files can't disagree) → `happy` (default). Included
as `mood` in every `POST /assistant/support` response that carries an answer.

**5 — Reactions.** Migration `082_ai_chat_reactions.sql` (mirrored in `db/schema.sql`, applied to
the dev DB): nullable `ai_chat_messages.reaction TEXT` with a CHECK limiting it to
`like|love|happy|sad|good|excellent`. `/support` responses now carry `message_id` (the ledger row
id — `lib/aiChat.js` `logCached()` now `RETURNING id`, and the model-unreachable fallback path now
settles the reserved row with the actual served text instead of leaving it NULL, so its
`message_id` points somewhere real). New `POST /assistant/react { message_id, reaction }`
(`supportChatController.react`, routed with its own `reactLimit`): reaction must be in the list
(else `400 ERR_AI_REACT_INVALID`) and the caller must OWN the row — own `user_id`, or the same
signed anon `sessionKey` `/support` uses (`lib/anonSession.js`) — else `403 ERR_AI_REACT_FORBIDDEN`
(no identity at all) or `404 ERR_AI_REACT_NOT_FOUND` (real id, wrong owner, or no such id — the
three are deliberately indistinguishable). Setting overwrites; `reaction: null` clears.

Full response contract for `/support` and `/react`, and every new error code, are in `API.md`
under "Assistant («لولو»)".

Verified: `node --test test/` from `backend/` — **397/397 pass** (baseline was 378; +19: 5 pure
`formatProductDigest` tests, 4 pure `classifyMood` tests, 10 live-DB tests in new
`test/aiChatReactions.test.js` covering the happy path, overwrite, clear, anon-session ownership,
wrong-owner 404 ×2, missing-message 404, no-identity 403, invalid-reaction 400, bad-id 400).
Smoke-tested `productDigest`/`universitiesDigest` directly against the dev DB (57 active products,
1,011 approved students across 70 distinct universities/colleges) before writing tests. Zero new
npm dependencies. `frontend/` untouched.

Files touched: `backend/controllers/supportChatController.js`, `backend/lib/supportContext.js`,
`backend/lib/supportFallback.js`, `backend/lib/answerGuard.js` (comment only),
`backend/lib/aiChat.js`, `backend/lib/mood.js` (new), `backend/routes/assistant.js`,
`backend/scripts/ai-scenarios.js`, `db/migrations/082_ai_chat_reactions.sql` (new),
`db/schema.sql`, `backend/test/aiChat.test.js`, `backend/test/aiChatReactions.test.js` (new),
`API.md`.

## 2026-08-15 — the last two of the eleven bugs, on `fix/admin-presence-panel` (UNMERGED)

Bug 1 and the three unwritten parts of bug 8. **All eleven bugs are now closed in code.**
Branch is off `main` (`49dd36b`) — deliberately NOT off `fix/ai-assistant-money`, which is
still parked.

**Bug 1 — «يعمل الآن» on `/admin`.** The rows have existed since the منتور tab shipped; the
owner just had to leave the dashboard to see them. New `GET /production/presence` rather than
calling `/monitor`: the dashboard polls every 30s AND reloads on every production event, and
`monitor()` runs five queries including a 30-day `audit_log` aggregation to answer something
that needs one. Same `requireStaffType()` guard — it is a slice of manager-only data. Both
endpoints now read one `workingNow()`, so `/admin` and `/staff` cannot name different people.

**Bug 8 part 2 — search finds the التطريز text.** Neither console could: `/staff/queue`
matched student/university/department/rep, PrepConsole matched the student name ALONE, and
the stitched words were on neither list because the queue was never sent them. New
`search_text` per row (every distinct `customer_text`, one string) + ONE shared matcher in
`lib/queue-search.ts` with Arabic folding (أ/ا/إ, ة/ه, ى/ي, tashkeel) and any-order tokens.
The folding is the half that decides whether the box works: three different people type these
names. +121 KB on a 1,447-row manager queue (+8.8%); rows are already fully loaded, so search
stays instant with no debounce and no round trip per keystroke.

**Bug 8 parts 3 + 4 — stepping, and the set.** «السابق»/«التالي» carry the console's FILTERED
order through sessionStorage; disabled (not omitted) at the ends; read in an effect because
the order page is server-rendered and reading storage during render is a hydration mismatch.
Part 4 gives التجهيز the whole `checkout_group` per row.
⚠️ **Measuring first changed the design:** 421 of 432 prep rows have a set piece still
upstream, so a «ناقص» warning would fire on 97% of the list. The badge went on the rare,
actionable state instead — «الطقم مكتمل» (11 sets right now) — with the absentees listed
quietly on the sheet.

**Gates:** 275/275 backend tests (9 new) · tsc + eslint + `next build` clean · both new
endpoints/fields driven live against the dev DB (1,196 of 1,447 rows carry `search_text`;
432 of 435 prep rows carry the bundle) · 27 behaviour assertions against the compiled
`queue-search.ts` / `queue-neighbors.ts`, since the frontend has no test runner.

⚠️ **NOT verified in a browser — Chrome was not running on this machine.** Everything above
is API- and logic-level evidence. What still needs a real pass: the presence panel on
`/admin`, the step controls at the ends of a list, and the sheet's waiting panel at phone
width. `npm run dev` in `backend/` + `npm start` in `frontend/`, then
`/dev-login.html#next=/admin` (the local token file now holds an admin's, not a preparer's).

⚠️ One test failed once mid-session and did not reproduce across two full clean runs after
it — shared dev-DB flake, not chased.
## 2026-08-15 — counter-signup phone double-entry, OTP gateway status, env-tunable cooldown, gender write

Four independent backend changes on `fix/otp-failover-and-surge`. 283 → 292/292 backend tests pass.

- **SECURITY — counter signup now requires `phone_confirm`.** A typo'd phone at the counter
  silently creates the account on a stranger's number (OTP registration can't produce this — a
  mistyped number just never gets the code, so it fails loudly instead of succeeding onto the
  wrong owner). `forgot-password-phone` later sends the reset OTP — the SOLE reset credential —
  to whoever owns that number: an account-takeover path. `counterSignupController.js` now
  requires `phone_confirm`, canonicalised with the same `normalizeIqPhone` `normalizePhoneBody`
  already applies to `phone` (so `7712345678` matches `07712345678`); missing or mismatched →
  400 `ERR_PHONE_MISMATCH` on field `phone_confirm`. `backend/test/counterSignup.test.js`
  updated (existing cases now send a matching `phone_confirm`) plus three new cases: missing,
  mismatched, and same-number-different-spelling.
- **`GET /admin/otp-gateway`** exposes `lib/otp.js`'s already-existing `gatewayStatus()` (which
  sender device is active, whether one has been cooled down) to admins, behind the same
  `authRequired` + `requireRole('admin')` gate as the rest of `routes/admin.js`. Did NOT touch
  `gatewayStatus()`'s return shape — a frontend agent is coding against it in parallel. New
  `backend/test/otpGatewayAdminRoute.test.js` drives the route over real HTTP (not a direct
  controller call) so the admin gate itself is actually exercised: no token → 401, admin → 200
  with `{ data: { configured, active, devices[] } }`.
- **`OTP_DEVICE_COOLDOWN_MS` is now env-tunable**, following the `envInt` pattern in
  `routes/auth.js` — the spec rule that every new limit must be changeable with
  `pm2 restart --update-env` alone, no deploy. Guarded against NaN/≤0 so a bad env value can't
  zero out the cooldown. Falls back to the existing 12h default.
- **`PATCH /auth/me`** writes `students.gender` — `GET /auth/me` has returned this field since
  the start, but onboarding only ever wrote it to `localStorage` (the HANDOFF landmine "Gender
  never reaches the DB"). Accepts `{ gender: 'male'|'female' }`; anything else → 400
  `ERR_VALIDATION` on field `gender`. Only succeeds for an account with a `students` row
  (retail) — everyone else gets 404 `ERR_NOT_FOUND`. New `backend/test/authUpdateMe.test.js`:
  happy path, invalid value, missing value, no-students-row.

Files touched: `backend/controllers/counterSignupController.js`,
`backend/test/counterSignup.test.js`, `backend/routes/admin.js`, `backend/lib/otp.js`,
`backend/routes/auth.js`, `backend/controllers/authController.js`,
`backend/test/otpGatewayAdminRoute.test.js` (new), `backend/test/authUpdateMe.test.js` (new).
`API.md` gained `PATCH /auth/me`, `GET /admin/otp-gateway`, and a first-ever `## Staff` section
documenting `POST /staff/counter-signup` (was undocumented before this session).

**Frontend, same branch, built against the three contracts above (in parallel with the
backend work landing them — the phone_confirm mismatch check in particular was added to
`counterSignupController.js` mid-session; the screen already sent + validated the field, so
no frontend change was needed once it landed):**

- **«تسجيل طالب في المحل»** (`app/staff/counter-signup/page.tsx`, new) — the counter-signup
  screen. Manager-staff only (`isAdmin || !isManager` → «غير مصرح», matching the backend's
  `requireStaffType()` gate — there is no `/admin` mirror for this one, unlike «طلب مخصص»).
  Phone entered twice (own `PhoneField` used for both `phone` and `phone_confirm`, client-side
  equality check before submit); 409 `ERR_PHONE_TAKEN` renders as a prominent amber callout
  with the server's message plus a link into «طلب مخصص» to attach an order to the existing
  student, rather than a field error; 201 shows a success card with «أنشئ الطلب من شاشة
  الطلبات» (→ `/staff/custom-order`) and «تسجيل طالب آخر» (resets the form) — plus a note that
  the password belongs to the student. Linked from `StaffSidebar` (manager/admin block, hidden
  for `isAdmin` since the backend 403s them). New `lib/staff.ts` wrapper
  `counterSignupStudent()` + `CounterSignupError` (carries `field` AND the 409's `student_id`,
  mirroring `FieldError` in `auth-api.ts`).
- **`GET /admin/otp-gateway` chip** — `components/admin/OtpGatewayStatus.tsx` (new), mounted
  on `/admin` right under the masthead. Fetches once on load, manual «تحديث» only (no polling,
  per spec). Three states derived client-side from `gatewayStatus()`'s shape: NORMAL (primary
  device sending, green), FAILOVER (a non-primary device is active — amber, primary likely
  banned), DEGRADED (every configured device currently marked unhealthy — red). Documented
  in the component's own header: DEGRADED can't see a *simultaneous* all-device failure,
  because `sendViaZentramsg` only marks a device unhealthy when ANOTHER device's success
  proves the failure was the device's fault — see its "cool down NOTHING" branch. New
  `lib/admin.ts` wrapper `getOtpGatewayStatus()`.
- **Gender reaches the DB from the client side too** — `components/student/
  ProfilePreferences.tsx` now calls `PATCH /auth/me` (fire-and-forget, error toast) whenever a
  signed-in student saves a gender change, and hydrates its local `gender` state from
  `GET /auth/me`'s `student.gender` on mount for a signed-in visitor (best-effort; a failed
  fetch just keeps the localStorage value). `lib/types.ts`'s `User` gained `student?: {
  gender }`; `lib/auth-api.ts` gained `updateMyGender()`. Scoped deliberately to «تفضيلاتي» —
  `components/student/Onboarding.tsx` never renders for a signed-in visitor at all (`if
  (getToken()) return;`), so there is no second call site for this in the current app.

Frontend files touched: `frontend/app/staff/counter-signup/page.tsx` (new),
`frontend/components/admin/OtpGatewayStatus.tsx` (new), `frontend/lib/staff.ts`,
`frontend/lib/admin.ts`, `frontend/lib/auth-api.ts`, `frontend/lib/types.ts`,
`frontend/components/staff/StaffSidebar.tsx`, `frontend/components/student/
ProfilePreferences.tsx`, `frontend/app/admin/page.tsx`. Zero new npm dependencies.
`npx tsc --noEmit` and `npm run lint` both clean (frontend/).
## 2026-08-15 — `configureOrder`'s missing status guard, plus real behavioural coverage

Closes the HANDOFF landmine that named `orderController.configureOrder` (`:630`) and
`configureFullSet` (`:1140`) as still sharing the plate-loss DELETE+re-INSERT shape. Turned out to
be two separate claims bundled together:

- **The plate-loss half was already fixed.** Commit `465b2ef` (2026-08-14, deployed the same day —
  see the (d) entry below) applied `lib/platePreservation.js`'s `capturePlates`/`plateFor` pair to
  `configureOrder`, `configurePackage` AND `configureFullSet`. `HANDOFF.md` was never updated when
  that commit landed, so the landmine kept describing a defect that no longer existed. Verified by
  reading the current code (all three functions already call `capturePlates` before the DELETE and
  `plateFor` on every re-INSERT) and by the fact `plateSurvivesReconfigure.test.js`'s structural
  guard was already green.
- **The status-guard half was real.** `configurePackage`/`configureFullSet`'s "find the existing
  order" query already filters `AND status <> 'cancelled'`, matching
  `uq_orders_student_product_nodesign`'s own partial-index definition (`WHERE design_id IS NULL
  AND status <> 'cancelled'`). `configureOrder`'s equivalent query had NO status filter and no
  `ORDER BY`/`LIMIT` — if a student's piece for a product had been cancelled (staff cancel, or a
  prior duplicate cleanup) and the student reconfigured that SAME product, the query could match
  the cancelled row and silently revive it instead of starting a fresh order the way every sibling
  "configure" endpoint does. Fixed by adding the identical `status <> 'cancelled'` guard to both
  branches (design_id-keyed and product_id-keyed) of `configureOrder`'s existing-order lookup.

**New test file**, `backend/test/orderControllerPlateAndStatusGuard.test.js` — the first test to
drive the actual `configureOrder`/`configureFullSet` controller functions (not just
`lib/fullSetOrder.js` or a structural source-grep) against a real DB:
1. A re-save of a retail sash order preserves both `plate_image_url` (server-side artifact,
   injected directly via SQL the way the calligraphy generator would) and `customer_image_url`
   (client-supplied, resubmitted the way the frontend resubmits it) on the same line, and the
   plate never leaks onto a sibling line.
2. Cancelling that order and reconfiguring the same product creates a genuinely NEW order — the
   cancelled row stays cancelled and keeps its own plate history, the new order starts clean.
   Confirmed this test fails (`AssertionError`, same UUID on both sides) with the guard removed,
   and passes once it's restored — this is a real regression test, not a tautology.
3. `configureFullSet` (the retail/no-rep full-set path) already preserves a plate across a
   re-save; pinned with the same behavioural style so a future refactor can't regress it silently.

Full suite: **271/271 pass** (266 baseline + 5 new), run from `backend/` with `node --test test/`.
No migration, no new dependency, no API contract change — `API.md`'s
`/orders/configure-full-set` entry gets a one-line addition noting the plate/cancelled-order
safety already implied by "idempotent re-submission."

Files touched: `backend/controllers/orderController.js` (status guard, `configureOrder` only),
`backend/test/orderControllerPlateAndStatusGuard.test.js` (new), `HANDOFF.md`, `API.md`.

## 2026-08-14 (e) — the shop is in ديالى, and /login has a way out

Two owner-reported defects, both on screens a student sees first.

- **The storefront said the shop is in بغداد. It is in ديالى.** Six strings in
  `lib/copy-ar.ts` (the «محل حقيقي ببغداد» bullet and the `visitBody` line, each ×3 genders)
  plus the `/shop` metadata description. ⚠️ The MAP was never wrong — `StoreLocation`'s embed
  pins 33.749, 44.618, which is Baqubah, not Baghdad. Only the prose disagreed with the pin.
  (`visitTitle`/`visitBody` are declared but currently rendered nowhere; fixed anyway so the
  next consumer does not reintroduce the claim.)
- **`/login` had no back button at all.** Added an optional `onBack` to `AuthCard` — a 44px
  chevron at the header's start, pointing RIGHT because the shell is RTL, drawn as an SVG
  because the ←/→ characters are bidi-mirrored and flip with the surrounding run. It is
  absolutely positioned so the brand mark stays optically centred on the screens that have no
  back. `/login` wires it: on the OTP step it means the previous STEP (agreeing with the pane's
  own «تغيير الرقم»), on the credentials step the previous PAGE.
  ⚠️ `router.back()` ALONE IS NOT ENOUGH: the shells are Capacitor webviews with no address
  bar, and a student arriving from a WhatsApp deep link has an EMPTY history where `back()` is
  a silent no-op — a button that visibly does nothing. Guarded with
  `window.history.length > 1`, falling back to `router.replace("/")`.
  The other six `AuthCard` screens (register · forgot-password · join · /s /w /d) still have
  no back and are the same dead end; only /login was reported, so only /login was wired.

Verified in a real browser: the «ليش لولو شوب؟» bullet reads «محل حقيقي بديالى», and
`/` → «دخول» → back chevron returns to `/`. `tsc --noEmit` clean; `eslint` 0 errors (6
pre-existing warnings, all in a generated `android/app/build` asset).

## 2026-08-14 (d) — THREE DEPLOYS to prod, ahead of a live staff testing session

Owner needed the shop working for staff to test in person, so the rule for this session was
**ship only what passed every gate**, and say plainly what did not ship.

**Prod DB backed up first:** `/var/backups/loloshop/predeploy-20260814-1739.dump` (3.5 MB).
⚠️ `pg_dump` as the `loloshop` role FAILS — it lacks rights on the leftover
`_price_restore_backup_20260724` table. Use `sudo -u postgres pg_dump -Fc loloshop -f
/var/backups/loloshop/…`; `/tmp` is not writable by postgres either. Nightly dumps already run
at 04:10 into the same directory.

| deploy | SHA | what |
|---|---|---|
| 1 | `760ab90` | designer-work protection · «يعمل الآن» · bug 7 staff half |
| 2 | `ddc1184` | the four money branches + bug 7 admin half |
| 3 | `fde0cce` | bug 8 **part 1 only** — garment-level chips for المجهز |

**What shipped, and why each mattered:**

- **Reconfiguring an order destroyed the designer's calligraphy plate.** `configureOrder` ·
  `configurePackage` · `configureFullSet` rebuilt `order_items` by DELETE + re-INSERT from the
  payload, and the plate is server-side so it was never in that payload. `upgradeToVip` was
  named in the audit too — checked, and it is SAFE: its DELETE is scoped to marker rows.
  Guarded by a structural test, because the defect is an omission that spreads to each new
  rebuild path; it is confirmed red against the pre-fix controller.
- **«يعمل الآن» on `/staff`** declared its own field names and four of five did not match the
  API, so it showed a blank staff name and linked every row to `/staff/orders/undefined`.
- **Bug 7 (units), both halves.** Seven staff/rep labels printed a PIECE count under «طلب» —
  the reason the same rep read 40 on `/admin` and 118 on the staff console. `/admin/orders`
  additionally needed the noun to FLIP with the view mode. Two labels were deliberately left
  as «طلب» because they really are bundles (verified, not assumed).
- **The five money bugs** from entry (c), all four branches.

**NOT shipped — say so plainly:**

- **Bug 8 parts 2, 3, 4** — server-side search including التطريز text, next/back on the order
  detail, and the missing-piece view. A workflow was decomposing these; it was **stopped
  mid-implement** when the deploy deadline landed, and only part 1 was complete. Parts 2-4 were
  never written. Resume: `Workflow({scriptPath: …/bug8-prep-production-list-wf_a5d25b83-3ee.js,
  resumeFromRunId: 'wf_a5d25b83-3ee'})` — the four investigation specs are cached and will
  return instantly.
- **The reroll geometry ratchet** — dropped by explicit owner decision this session, not
  forgotten. Still needs migration 081.
- **`ai-assistant`** stays local. `fix/ai-assistant-money` is correct but deliberately unmerged:
  merging it ships the whole assistant, which the owner has not cleared.

⚠️ **Do not chain `sleep N && <check>` to wait for CI** — the harness blocks it. Use
`run_in_background` with an `until` loop.

## 2026-08-14 (c) — the money audit: five open money bugs found, all five fixed, NOTHING MERGED

Audited every remaining money claim on the board against the code **and the live prod DB**,
because two of them turned out to be dev-only artifacts. Result: **five real money bugs**, each
now closed on its own branch. None is merged — every push to `main` auto-deploys to 1,141 live
users, so the merges are the owner's call, one at a time.

**Two board claims were wrong and are corrected:** «مضر محمد renders −775,000» and «ابو عبدو is
listed twice» reproduce on the **dev** DB only. Prod has zero payout deductions and ابو عبدو is
`active = FALSE` on the workshop roster, so neither symptom is visible there. The code defects
behind them are real and are fixed; the urgency was not.

| branch | bug | what it was |
|---|---|---|
| `fix/payout-money` | 2·3·4·5 | «المبلغ المقترح» was a lifetime accrual |
| `fix/admin-orders-profit` | 1 | /admin/orders called the reps' margin «الربح» |
| `fix/schema-money-drift` | — | schema.sql disagreed with the live table about `cost` |
| `fix/ai-assistant-money` | — | «لولو» quoted a profit the dashboard no longer computes |

**The one that would have moved real cash:** `payoutController` computed
`base + bonuses − deductions` and printed it as «المبلغ المقترح», while `manual_payouts` was
joined only to *display* the last transfer, never to reduce the figure. It is right exactly once,
on the first payout, and re-offers the whole accrual every press after that. It never fired only
because `manual_payouts` has **0 rows** on prod — the first recorded transfer would have started
double-paying. Now `max(0, accrued − paid)`, with استُحق / حُوِّل / المتبقي reported separately.
The same commit stops a negative suggestion being offered as a transfer the API then rejects,
deduplicates anyone who is both `role=staff` and on the workshop roster, and gives payout actions
the `audit_log` rows they never had — they were the only admin money mutations writing nothing.

**The one that was visibly wrong every day:** `/admin/orders` summed `o.profit` under «الربح».
Measured on prod, the representatives tab: دفع الطلاب 41,395,000 · **دخل المحل 35,160,000, never
shown at all** · ربح الممثلين 6,235,000, shown and counted as the shop's. Track A fixed this
meaning on `/admin` in August; this screen was outside its scope and kept the old vocabulary.

**«لولو» is now on the dashboard's definition.** `fix/ai-assistant-money` merges `main` into
`ai-assistant` (conflicts were far smaller than the board feared — `analytics`/`accounting`
auto-merged) and rewrites `revenue_summary`/`top_reps` onto `settledMoney`. On dev the assistant
would have answered «الأرباح: 24,191,300»; it now answers «دخل المحل: 37,877,300», the dashboard's
number to the dinar, and a test reads both and compares them so they cannot drift again.

Gates per branch: **260/260**, tsc + eslint + `next build` clean, **246/246** with `npm run
migrate` idempotent, **318/318** on the merged assistant branch. Every new test was confirmed red
against the pre-fix code before being called green — the assistant's seven were re-run against the
old `adminMetrics.js` and all seven failed.

⚠️ `node --test test/` **must be run from `backend/`.** From the repo root dotenv cannot find
`.env`, `DATABASE_URL` is undefined and 147 tests fail for a reason that has nothing to do with
the code under test.

**Still owner actions, not code:** production cost is entered on **0 of 1,497** retail pieces, so
«مبيعات التجزئة» is revenue and all three surfaces now say so instead of printing a profit that
cannot be true. And the تجزئة piece rates are **partially** entered — 2 of 10 differ from the
ممثلين rate (`robe_sew` 2000/1000, `shawl_close/sash` 1000/800); the other **8 still pay the
wholesale wage**.

## 2026-08-14 (b) — WhatsApp gateway banned again; outage switch built, ON A PR, NOT DEPLOYED

The Zentramsg sender device was spam-banned by Meta for 24h (again), so no OTP is delivered
and every OTP-gated flow dead-ends. Built `OTP_DEGRADED_UNTIL` — one server-only env var that
trades the second factor for availability while the ban runs.

**Measured first, and it reframed the job.** On prod: 1,020 rep-linked students already skip
OTP (`authController.js:133`), 563 self-registered retail and 22 privileged users hold live
trusted devices. **~1,605 of 1,694 users were never affected.** The real outage is ~89 people
who happen to open the app on a new phone, ~24 signups/day, and every password reset.

**What the flag does** (retail + wholesaler only — owner's choice): login on the verified
password alone, registration without phone verification. What it deliberately does NOT do is
the reason it is safe: bcrypt still runs; admin/staff/worker/design_helper never bypass; no
trusted-device token is issued (a password-only login must not buy 90 days that outlive the
window); `phone_verified` is not flipped.

⚠️ **Password reset is NOT degraded, and that asymmetry is the whole design.** Login degrades
safely because bcrypt already ran. On `forgotPasswordPhone` the OTP is the *only* credential,
so bypassing it would read as "reset any account whose phone number you can guess" — 1,660 of
them, from a trivially enumerable format. It refuses with 503 `ERR_OTP_UNAVAILABLE` and points
the customer at shop support.

**Fail-safe and capped at 48h:** empty, past, unparseable, or a typo'd year all read as OFF.
Forgetting to unset it is not how this becomes permanent — the clock is.

**Owner's correction, and it turned out to be security-relevant:** the refusal message must
name no channel and disclose no outage. Publishing "the second factor is unavailable right
now" on a public endpoint tells anyone probing the login exactly when to come back. It now
reads «لاستعادة كلمة المرور، تواصل مع دعم المتجر وسنساعدك مباشرة.» and renders as a neutral
`role="status"` notice, not a red validation error — replacing the «سيصلك رمز عبر واتساب» hint
that would otherwise promise a message that isn't coming.

Gates: **246/246** backend tests (228 baseline + 18 new), `tsc` clean, eslint 0 errors,
`next build` complete. CI green on the PR; both `npm audit` gates clear (zero new deps).

🚧 **NOT DONE — this is inert until two owner actions:** merge
[PR #5](https://github.com/perdark/loloshop/pull/5) (`fix/otp-gateway-outage-mode`, `7c27dbb`),
then set `OTP_DEGRADED_UNTIL` in the prod backend `.env` + `pm2 restart loloshop-api
--update-env`. The var is not in git, so the deploy alone changes nothing.

⚠️ **This is the airbag, not the brakes.** Zentramsg drives a real WhatsApp account through a
linked device, which is what Meta bans; repeated temp bans escalate to permanent. The actual
fixes are a second sender number (`ZENTRAMSG_DEVICE_UUID` is just an env var) or the official
WhatsApp Cloud API with an Authentication template. Neither is done.

## 2026-08-14 — Track A merged and DEPLOYED, after the browser gate it left open

Merge `df2fa48` on `origin/main`; CI green, **Deploy to VPS** succeeded, prod confirmed at
`df2fa48` over SSH with all three PM2 processes restarted and the site/API answering 200.
Gates on the merged tree: **211/211** backend tests (185 baseline + 11 Track C + 15 Track A —
the first time the two tracks' suites ran together), `tsc` clean, eslint 0 errors, `next build`
complete, and **both `npm audit` deploy gates exit 0**. Only conflict was `PROGRESS.md`
(both tracks prepended a session entry); both were kept.

**The gate the branch itself left open is now closed — verified in a real browser** against the
dev DB as a real admin, money-gate opened by the owner. All six figures render exactly as the API
computes them: دخل المحل ٣٧٬٨٧٧٬٣٠٠ · حصة الإدارة ١٦٬٦٨١٬٠٠٠ · مبيعات التجزئة ٢١٬١٩٦٬٣٠٠ ·
دفعه الطلاب للممثل ١٩٬٦٧٦٬٠٠٠ · ربح الممثل ٢٬٩٩٥٬٠٠٠ · طلبات محتسبة ٤٩٥. Internally consistent on
screen (19,676,000 − 2,995,000 = 16,681,000) and the sub-label «93٪ مما دفعه الطلاب» checks out.
Bug 9's header reconciles to the funnel (**١٤٥٥ قابلة للعمل من ١٧٣١ قطعة**) and bug 10 plots both
populations with the backlog as the band between them. Console clean apart from two transient
Recharts `width(-1)` warnings at mount.

**Live prod numbers, computed by the deployed code:** دخل المحل **74,179,800** = حصة الإدارة
23,923,000 + تجزئة 50,256,800; مال الممثلين 4,255,000; إجمالي التحصيل 78,434,800; retail pieces
costed **0 / 1,493**. The old «صافي الربح» would read 54,511,800 today — the +19,668,000 is exactly
23,923,000 − 4,255,000, the swap of the reps' margin for the shop's share.

⚠️ **A near-miss worth recording.** The daily-chart header read 145/101 while a curl taken twenty
minutes earlier said 146/102, and it looked like an off-by-one in the new chart. It was not: the
query is `WHERE o.created_at > NOW() - INTERVAL '30 days'` and `NOW()` is an *instant*, so the
leftmost day sheds orders minute by minute. Confirmed byte-identical on the merge-base — pre-existing,
not a Track A regression. Side effect worth knowing: **the leftmost day of that chart is always a
partial day and always under-reports.** Don't compare a cached API fetch against a live render.

**Rep-facing numbers proved unchanged, not assumed.** Two backends were run against the same DB
(Track A on :4000, `main` on :4001) and driven with a real rep's token:
`/api/wholesaler/{dashboard,students,orders}` and `/api/admin/reps-overview` are **byte-identical**,
and the `wholesalerOrders` account block (يجمعه الممثل ١٠٬٢٩٨٬٠٠٠ · حصة الإدارة ٨٬٦٩٨٬٠٠٠ ·
ربح الممثل ١٬٦٠٠٬٠٠٠) is byte-equal across 402 order rows. The only diff in that response is
Track C's `my_stages`. This matters because the owner does his real accounting on those screens,
not on the dashboard totals.

**Prod DB backed up first:** `~/Desktop/_private/loloshop-db/loloshop-prod-2026-08-14.dump`, taken
with the server's own PG17 `pg_dump`, sha256 verified server↔laptop, and **restore-tested** —
`pg_restore` decompressed the whole archive (12.6 MB of SQL, exit 0, empty stderr) and the row
counts read out of it match live prod exactly (users 1,694 · orders 3,209 · order_items 13,844).
⚠️ The laptop's client is PG16 against a PG17 server, so the dump **must** be taken on the box.
⚠️ The 4.9 GB of uploads (6,957 files) is still NOT backed up — the laptop has 7.1 GB free at 88%.

## 2026-08-13 — Track A: the admin numbers now say what they mean (bugs 9, 10, 11)

Branch `fix/admin-numbers`, cut from `main`. Spec:
`docs/superpowers/specs/2026-08-13-eleven-bugs-parallel-tracks.md`. Tracks B and C untouched —
no file under `calligraphy*`, `staffController.js` or the rep students page was modified.

**Bug 11 — «إجمالي الربح» was the REPRESENTATIVES' profit, not the shop's.** On a rep's order
`price` is what the student paid the *rep*, `cost` is «حصة الإدارة» (the shop's actual income),
and the generated column `profit = price − COALESCE(cost,0)` is therefore **the rep's margin** —
the same number the rep's own page correctly labels «ربح الممثل». The dashboard summed it and
called it «إجمالي الربح» / «صافي الربح», so on dev **2,995,000 IQD of representatives' earnings
was being reported as shop profit** (prod: 4,240,000). «إجمالي التكلفة» was, symmetrically, the
shop's *income*. Fixed in presentation and aggregate only — `orders.profit` is untouched, because
wholesaler payouts and the rep account summary read it with the correct per-row meaning.
The ledger now reads **دخل المحل = حصة الإدارة + مبيعات التجزئة**, with the reps' money in its own
labelled block («مال الممثلين — ليس من دخل المحل»).

⚠️ **Retail production cost has never been entered** (0 of 708 dev pieces, 0 of 1,467 on prod), so
retail "profit" is revenue. The dashboard now says that outright instead of printing a net profit
that cannot be true; «صافي الربح» is gone until a cost exists.

**Bug 10 — the daily chart counted one population and earned from another.** `orders` counted
every live bundle while `revenue` was filtered to settled ones, so anyone dividing got an average
per order off by up to 3× (dev 16 Jul: 24 bundles against revenue from 15). Both counts now ride
on the row and the chart plots both lines; the band between them is the pending-approval backlog.

**Bug 9 — stage totals mixed workable with blocked.** Every stage row now splits into
«قابل للعمل» / «بانتظار موافقة الممثل» / «مُرجع للطالب», summing exactly to the stage total. Dev
بانتظار التصميم: 1,024 total = 838 workable + 167 unapproved + 19 returned — which is *why*
/admin and the designer's queue disagreed. **The staff screens were correct and were not touched**;
`stageFunnelSplit` mirrors `productionController.getQueue`'s own two gates.

**Where the definitions live:** `billableOrderSql` moved from `adminController` into
`lib/counts.js` — byte-identical to the same move on `ai-assistant`, so that merge auto-resolves —
and the new money vocabulary (`shopIncomeExpr`, `repMarginExpr`, `settledMoney`) plus the
workable/blocked predicates sit beside it with the reasoning in block comments.

**Verified:** `node --test test/` **200/200** (185 before + 15 new in `test/adminNumbers.test.js`),
`tsc --noEmit` clean, `eslint` clean, `next build` succeeds. Both endpoints driven over HTTP with a
real admin JWT: `دخل المحل 37,877,300 = 16,681,000 + 21,196,300`, the receipt's
`40,872,300 − 2,995,000 = 37,877,300`, and `by_wholesaler + independent_retail + orphaned` sums to
the bottom line exactly. Every stage's three-way split reconciles, and «قابل للعمل» matches a
hand-written mirror of the staff queue's filter.

**Not verified:** the rendered page in a browser — the Claude-in-Chrome extension was not
connected this session. Every layer below the pixels is proven; the labels/layout are not.

**Also found (NOT fixed — outside Track A's files):** `db/schema.sql:305` declares
`profit GENERATED ALWAYS AS (price - cost)` and `cost BIGINT NOT NULL DEFAULT 0`, but the live
table has `cost` **nullable with no default** and the generated expression
`price - COALESCE(cost, 0)`. The schema file is Track B's; the drift matters because under the
file's version every retail row's profit would be NULL. Also `/admin/orders` still sums `o.profit`
into a «الربح» column — the same mislabel on a screen Track A does not own.

## 2026-08-13 — Track C: the designer console opens on your own station (bugs 2 + 3)

Branch `fix/designer-console`, cut from `main` (`8498c4d`) — **not** from `ai-assistant`, checked
per the spec's `4eb01c8` landmine. Three files, none owned by Track A or B:
`backend/controllers/staffController.js` · the rep students page · `frontend/lib/staff.ts`.

**Bug 2 — the console showed every station's work.** `wholesalerOrders` returned every approved
non-cancelled order in every status with no role scoping, and «الكل» was the default. The response
now carries `my_stages` and the console opens on «مرحلتي»; «الكل» stays one tap away.

`my_stages` is **derived from orderController's `STAGE_AUTHZ`** — a status is yours when you may
move an order out of it — rather than being a second copy of `productionController.QUEUE_STAGES`.
That was deliberate on two counts: Track B has to edit `productionController`, so importing from it
would have meant editing their file; and a hand-copied stage table is exactly the kind of thing
that drifts. Asserted equal to QUEUE_STAGES for all five working staff_types in
`test/viewerStages.test.js` (11 new tests), so a future `STAGE_AUTHZ` edit fails a test instead of
quietly giving a worker the wrong queue.

Measured by driving the real controller against the dev DB (محمد باقر عباس هاشم, 402 rows):

| viewer | «الكل» | opens on «مرحلتي» |
|---|---|---|
| designer | 402 | **281** |
| preparer | 402 | **120** |
| presser | 402 | **1** |
| manager · admin · مفصل | 402 | 402 — no personal station, unchanged by design |

⚠️ **The dev DB is an older snapshot than the prod numbers in the spec** — globally embroidery is
108 here vs the spec's 854, pressing 107 vs 460. On the spec's prod distribution for this rep
(276 قيد التطريز + 120 قيد التجهيز + 1 قيد الكوي + 5 بانتظار التصميم) the same filter yields the
**5** the spec predicts. So the spec's bug-2 breakdown is right about prod and simply does not
reproduce against this laptop's DB; don't "fix" the filter to chase 281.

Two things fell out of the investigation that are **not** bug 2 and were left alone:
`«يخصّني الآن»` (`can_advance`) happens to equal the stage filter for these three roles in this
snapshot — it diverges for a preparer's «جاهز للاستلام» rows, which are their work but deliberately
not bulk-advanceable, which is why the default is stage-based and not a reuse of `can_advance`.
And the console does **not** exclude `returned_to_customer` rows the way `/staff/queue` does
(0 rows for this rep, so no visible effect); that is bug 9 / Track A territory.

**Bug 3 — back button lost the designer's place.** Zone/view/search/selection already survived
back-navigation; scroll did not. Cause: returning re-mounts the tab with `orders` empty, so it
paints six skeletons and the document is a few hundred px tall at the exact moment the offset would
be re-applied — it clamps to 0, and by the time 400 rows arrive the position is gone. The offset is
now saved to the same per-rep sessionStorage bucket (trailing-throttled at 200 ms) and re-applied
after the real rows paint, clamped to the list height, and skipped if the worker has already
started scrolling.

**⚠️ The browser test the spec demanded was worth it — the first version of the bug-3 fix did
not work, and both static gates and code review passed it.** Two separate defects, each of which
would have shipped as "scroll restore, still broken":

1. **`requestAnimationFrame` never fires in a tab that is not painting**, so a restore scheduled
   only inside a rAF callback silently never happens. Measured: rAF callbacks 0, `scrollTo` calls
   0. Now applied immediately, with the rAF kept only as a corrective second pass for late height
   changes (images/fonts).
2. **`globals.css:499` sets `scroll-behavior: smooth` on the root**, so the plain
   `scrollTo(0, y)` form starts an *animation* — and the router's own post-navigation scroll
   cancels it before it travels. Measured in a visible, focused tab: the restore ran with the
   correct offset (`scrollTo [0, 5200]`) and the page never moved; not one scroll event fired.
   Fixed with `scrollTo({ top, left: 0, behavior: "instant" })`, which is what restoring a
   remembered position should do anyway rather than riding visibly down 281 rows.

**Verified in a real browser** (Track C build on :3005 against its own API on :4005, signed in as
مضر محمد, a real `{designer}`): lands on «مرحلتي (281)» with 281 rows rendered, «الكل (402)» one
tap away · scrolled to 5200, opened حسن علي حسين's order, pressed back → **returned to 5200**, same
row on screen. Control: same journey with the saved offset stripped → lands at 0, reproducing the
original bug. Also `node --test test/` **196/196** (185 baseline + 11 new) · `tsc --noEmit` clean ·
`npm run lint` 0 errors · `next build` completes.

⚠️ **For whoever writes the next scroll-restore anywhere in this app:** `scroll-behavior: smooth`
is global, so **every** programmatic `scrollTo`/`scrollIntoView` in this codebase animates by
default and can be cancelled mid-flight. Pass `behavior: "instant"` for anything that is restoring
state rather than responding to a click.
## 2026-08-14 — Track B verified before merge; two defects found and fixed, one deferred

First time this branch has ever run: `lolo-B/backend/.env` did not exist, so its original
verification was DB scripts and a rolled-back transaction — never an HTTP request, never a browser.
Booted it (`:4000` API, `:3007` web) and drove it as a real designer (مضر محمد) against the dev DB.

**Bug 4's core fix is PROVEN, in a browser.** On order `1c38893f` the student's uploaded photo and
the generated plate now render as two separate, labelled slots — «صورة الطالب — تطريز الوشاح من
الخلف» and «الخط المولّد — تطريز الوشاح من الأمام». Before this branch, generating that plate
destroyed that photo. Migration 080's backfill checks out on dev too: 7,653 lines, **0** with both
columns set, 61 plate-only, and **zero** `customer_image_url` values still pointing at a plate.

**Bug 6's partition is live**: every zone returns `pending / items / held / plated`, 149 held lines
(91 instruction, 58 junk), each with an actionable Arabic hint.

### Fixed here (commit `d56f288`)

1. **`persistFullSetOrder` was destroying the plate on every طقم edit** — a regression this branch
   introduces, found independently by three lenses of a 25-agent adversarial review. Detail in the
   commit message. Guarded by `test/fullSetPlateSurvival.test.js`, which goes red without the fix.
2. **«رجاء» held real names** — proven by running the matcher on the two real prod rows containing
   it. Now fires only as the first token. Guarded by 3 new cases in `test/calligraphyText.test.js`.

`node --test test/` → **202/202** (197 + 5 new).

### ⚠️ DEFERRED — the reroll geometry ratchet (medium, needs migration 081)

`calligraphyController.js:472` passes `p.plate_path` — *the plate being replaced* — to
`matchPlateGeometry`, and the same handler overwrites `plate_path` at :481. So reroll N+1 anchors
on reroll N's output. `imageFx.js:71-77` resizes with `fit:'inside'`, which never upscales, so ink
height is **monotone non-increasing and can never recover**. Reproduced with sharp on realistic
`extractBands` geometry: ink 700×140 → reroll1 (long name, width-bound) 1024×**73** → reroll2
(normal name) 365×**73** → reroll3 **73**. The plate ends up pinned at the scale demanded by the
widest generation it ever had — the exact sibling-scale mismatch `matchPlateGeometry` exists to
close. `REROLL_LIMIT=10` exists precisely because designers press the button repeatedly.

Not fixed here because there is **no immutable geometry anchor on the row**: `plate_path` is
overwritten, and `sheet_path` is the whole 10-name sheet whose geometry is not the band's (the
reviewer that first proposed `sheet_path` was wrong about this, and its own verifier said so). The
fix needs a new column — the original band's geometry, or an untouched `original_plate_path` — i.e.
migration 081, plus image-pipeline tests. Bounded severity: it converges to a running max of aspect
rather than running away, and costs letter height, not data.

### Still open on this branch before it merges

- **`configureOrder` / `configureFullSet`** (`orderController.js:630/1140`) have the same
  DELETE + re-INSERT shape with no status guard. The review panel refuted them on *reachability*
  (`orderController.js:727` 403s rep-linked students, and plates live overwhelmingly on rep
  orders) — which is an argument about who can reach the path, not about the path being safe.
  Worth closing the same way `fullSetOrder` was.
- **The audit was not clean:** 1 agent died mid-response, 5 stalled and retried, and the safety
  classifier timed out on one. The dead agent is what "refuted" the «رجاء» finding, which then
  turned out to be real. Treat that run's 14 refutations as weaker evidence than its 4 confirmations.

## 2026-08-13 — Track B: the calligraphy plate stops eating the student's photo (bugs 4·5·6)

Branch `fix/calligraphy-photo-loss`, cut from `main` (`871a257` + the spec doc). **Not merged** —
Tracks A and C are separate branches and the deploy rule is one track at a time.

**Bug 4 — the plate destroyed the reference photo.** `order_items.customer_image_url` held two
different things under one name, and `calligraphyEngine.autoLinkPlate` overwrote it
unconditionally, so every generate / reroll / compose deleted the student's upload. Migration
**080** gives the plate its own column (`plate_image_url`), backfills the damaged rows out of the
customer's column, and the link now targets the new one. Proved against a live order line: the
photo survives the write and the plate lands in its own column (probe rolled back, dev DB clean).
Sixteen readers updated across both apps — `retailQueue`, four `productionController` detectors,
the queue's `has_design_images`, `designTeamController` JOB_SELECT, the TV wall spotlight,
`orderZoneClause`, the staff order page, PrepConsole's spec partition, DesignGallery and the
retail review board. `orderEditController` needed no change: its keyed reconciliation already
updates in place, so a plate survives an admin edit.

**Bug 5 — «إعادة التوليد».** Four defects, all fixed: no guard at all (now junk + instruction);
regenerating from `render_text` that is itself the instruction (the designer can now pass the
corrected name, and it is saved onto the plate); a single-name generation whose scale and framing
did not match the 10-name sheet the siblings came from (new `matchPlateGeometry` reframes onto the
exact geometry of the plate being replaced, measured from that file — 5 unit tests); and no cost
ceiling (`reroll_count` + a limit of 10, surfaced in the UI).

**Bug 6 — «يخصّني الآن» showed orders the queue could not.** New `lib/calligraphyText.js`
classifies text students wrote *to the shop* («نفس الصوره») before any money is spent, and
`getQueue` now returns the two populations it used to hide: `held` (refused, with the reason) and
`plated` (already carries a done plate — the 55 invisible orders). Held lines are actionable in
place: retype the name, or press «ولّد كما هو», which sets `reviewed: true`.

⚠️ **The classifier was calibrated against the live table, not invented.** A first draft flagged
**real** back-of-sash text — ﴿مَّن كَانَ يُرِيدُ ثَوَابَ الدُّنْيَا﴾, «الحمدلله هذا ماسعيت له»,
«الى عائلتي انتم حكاية نجاحي» — because «يريد» «هذا» and «الى» (which normalises to «الي») looked
like instruction words. Pointing words, «نفس», «مثل», «فقط» and third-person «يريد» were all
removed; the four instructions measured on prod are caught anyway because **every one of them
names a photo**. Final rate: **91 of 954** distinct strings (9.5%), each one eyeballed. All four
false positives are locked in as regression tests.

**Recovery:** `npm run photo-recovery` (read-only) lists the damaged lines and proposes upload
files by mtime, flagging the ones whose own text names a photo. It writes nothing and deletes
nothing — the timestamps are a hint, not an identification, and the owner confirms each match.

**Verified:** `node --test test/` **197/197** (185 baseline + 12 new), `tsc --noEmit` clean,
`eslint` clean, `next build` completes. Migration 080 applied to the dev DB and re-run to prove
idempotency (61 rows moved, identical on the second pass).
## 2026-08-12 (b) — the assistant becomes the marketing surface: quotas out, guard in

Owner reframe: «لولو» is the shop's **main marketing content**, and individual users should not
be limited — attackers should. Both changes point the same way, because the quota that existed
was never protecting anything.

- **The per-person daily quota is gone, and that is a security improvement.** It was keyed on a
  `sessionKey` the CLIENT generated — measured, 25 requests with 25 fresh keys were all granted.
  It bounded honest students and nobody else. Replaced by: a **server-signed identity**
  (`lib/anonSession.js`, HMAC on `JWT_SECRET`, zero new deps — the CI `npm audit` gate stays
  clean), a **burst throttle** (10/min · 40/5min) that asks "are you a person" instead of "how
  much have you had today", free repetition through the response cache, and the daily USD
  ceiling. **Verified live: the 11th message in a minute is refused, with a countdown.**
- **That signed identity closed a real read, not just a bypass.** `recentTurns` keys anonymous
  history on the session id, so supplying somebody else's loaded THEIR last two hours into your
  prompt — «شنو سألتك قبل شوية؟» read it back out. Unguessable in practice, but it was an
  unauthenticated read keyed on an unauthenticated identifier.
- **Ceiling $1 → $3, with a warning at $1** that writes an admin `notifications` row — the push
  outbox turns it into a phone push with no new plumbing. Measured cost is **$0.0001/message**,
  so $3 is ~30,000 messages/day: an abuse backstop, never a budget.
- **`lib/answerGuard.js` — the real answer to prompt injection.** It screens the ANSWER, not the
  question: no IQD figure absent from the price book we handed the model, no delivery promise, no
  English, negation-aware. It cannot be phrased around the way an inbound filter can. Four live
  injection attempts held.
  **It found a real defect on its first harness run — one the harness was scoring as PASSING:**
  «آخر موعد لتقديم الطلبات هو 2026-05-26، **وهذا موعد تسليم الطلب**», the model stating flatly
  that the order cutoff IS the delivery date. Every pattern in the guard and the harness expected
  a future-tense promise; this was a present-tense equation. Now `DEADLINE_AS_DELIVERY`, and
  **the harness calls the runtime guard** so they can never disagree again.
- **Never dark** (`lib/supportFallback.js`): prices, delivery, payment, location and how-to-order
  are answered from the price book with **no model at all** when it is unreachable or the budget
  is spent. Verified by pointing `AI_CHAT_MODEL` at a bogus model — 4 of 5 questions still
  answered, the 5th got a WhatsApp escalation instead of a dead end.
- **Attribution** (migration 079): a **salted** hash of the caller's address per ledger row.
  Removing the quota is only safe if a flood is visible afterwards; a raw IP is personal data and
  an unsalted hash of one is trivially reversible.
- **UX:** 7 expressions cut from the owner's brand sheet and **registered on the face** so the
  head does not resize between them · a server-chosen emotion per answer · server-chosen action
  chips from a closed list (the model never emits a URL) · word-by-word reveal, deliberately not
  streaming, because streaming publishes text before the guard can veto it · thread persists 2h,
  matching the server's window · **the dead retry button is fixed** (a throttle counts down
  instead of offering a retry that cannot work) · the input no longer disables while busy, which
  was dismissing the Android keyboard on every message.
- Also: the `wa.me/964` button on `/sizes` was a country code with no number — a dead button,
  now the real one. Admin-written product and package names now go through `safeField` before
  entering the system prompt, like customer-written ones already did.
- **243/243 unit tests** (was 215) · 44/44 scenarios · tsc + lint + `next build` clean.
  ⚠️ **A real phone-viewport pass is still outstanding** — Chrome refused to resize the maximized
  ultrawide window, so every browser check ran at 3440px.

## 2026-08-12 — AI assistant hardened: caps made atomic, spend guard fail-safe, history un-forgeable

Three defects found by re-reading the 2026-08-10 (b) code before shipping it. All were silent
failures pointing at either the bill or a student's trust. **Backend suite now 202/202** (was
185 — the assistant had zero tests in a repo with 185).

- **The caps could be walked straight past.** The old order was: count → model call (~700ms) →
  insert. N concurrent requests all read the same count and all passed. Now `reserve()` counts
  and writes the ledger row inside **one transaction holding a per-caller advisory lock**, and
  `settle()` fills in the answer and cost afterwards. **Measured against the dev DB: 40
  simultaneous requests, exactly 10 granted for an anon session (cap 10) and exactly 30 for a
  signed-in user (cap 30).** Side effect: a crashed call still leaves its row, so a retry storm
  is no longer free, and a failed ledger write can no longer make every cap under-count.
- **The $1/day ceiling could switch itself off silently.** `Number(usage.cost || 0)` recorded
  $0.00 whenever OpenRouter reported no cost — every row zero, `SUM(cost_usd)` flat forever, the
  backstop dead with nothing in any log. A missing cost now falls back to a token estimate, and
  an **unrecognised model is priced as expensive on purpose**: over-counting trips the ceiling
  early (recoverable), under-counting is a bill.
- **A student could forge what the bot said.** The client sent its own transcript back with its
  own role labels, so a caller could POST a fabricated `assistant` turn («وشاحك مجاني»), ask the
  bot to confirm it, and screenshot the shop's assistant promising a free robe. History is now
  rebuilt server-side from `ai_chat_messages` (2-hour window); `req.body.history` is ignored.
- **17 tests** covering the cap boundaries (incl. pg returning counts as **strings** — `'9' > '10'`
  lexicographically would have blocked callers 21 questions early), the cost fallback, the
  bundle `price = 0` rule that nearly told a student their robe was free, and `clampDays`, which
  is the entire defence on the one model-supplied value interpolated into SQL.
- `sessionKey()` no longer crashes the widget when `localStorage` throws (privacy modes) — it is
  now the only link between an anon visitor and their history, so it had to stop being fragile.

**Then, from testing it in a browser:**

- **«عندك سؤال؟» is now a real home-page section**, last before «موقعنا», with the shop's four
  actual FAQs as tappable chips. The floating bubble stays; both share **one** conversation via
  `SupportChatProvider`, because the server rebuilds history from its own ledger and two
  independent threads would have shown an empty panel while the model still had the context.
- **The bot can finally answer «شكد سعر الروب؟»** — the most common question in the shop, which
  it previously answered *"ما عندي علم"* while the price sat on the page above it. It had no
  catalogue at all. `supportContext.priceBook()` now feeds it per-type **starting-price ranges**
  (not a product list — that would dominate the prompt and go stale), mirroring `buildShopFeed`
  on both the audience filter and `product_price_roles`, so **a rep-linked student is quoted the
  wholesaler book and never the retail one**. Cached 5 min per role. Verified: robe answered
  correctly, «سعر الحذاء» still refused.
- Accessibility gaps closed while the panel was being rewritten: `role="dialog"`, Escape-to-close
  with focus returned, `aria-live` on both threads, and a «أعد المحاولة» button.

**Then a 38-scenario adversarial pass — `npm run ai:scenarios` — which found 4 more real bugs
that both the unit tests and the browser pass had missed.** All of them were fluent, confident,
wrong Arabic; none was a crash. This is the failure mode of this feature and neither a unit test
nor a happy-path click can see it.

1. **«وين موقعكم؟» → «موقعنا مو محدد».** It denied the shop had a location — turning away a
   walk-in — while a Google map of the real shop sat at the bottom of the same page. It had no
   address fact at all.
2. **«عندكم توصيل؟» → «نكدر نوصل داخل بغداد».** Pure invention — there was no delivery policy
   anywhere in this codebase. **Owner confirmed 2026-08-12: the shop does NOT deliver at all**,
   pickup only, which is what the `ready` status («جاهز للاستلام») has meant all along. That is
   now a stated fact, so the answer is a clear «ماكو توصيل، الاستلام من المحل ببغداد» rather than
   a vague "I don't know" — which would have left the customer still expecting delivery.
   University students are pointed at their rep to arrange pickup.
3. **It quoted the وشاح price (15,000) for a شال (25,000)** — near-synonyms in Arabic, two
   different products at two different prices. Now stated as a fact it must not conflate them.
4. **Self-inflicted, caught by re-running:** fixing 1 and 2 made rule 5 read as "never state an
   order status", so a signed-in student asking «وين وصل طلبي؟» started getting «ما عندي علم»
   while their three statuses sat in the prompt. Telling a student where their order is **is**
   the feature; a refusal there is a failure, not caution. Rule 5 now distinguishes "not in the
   context" from "don't invent".

5. **«شنو أكثر قطعة تنباع عدكم؟» → «وشاح التخرج، لأن الطلاب يحبون يصممونها بنفسهم».** It had no
   sales data at all — it guessed, then invented a motive to justify the guess. It landed
   near-right *by type* that day (sash leads on 468 pieces), which is the worst kind of wrong:
   confident, unfounded, and fine right up until the ranking moves. `supportContext.bestSellers()`
   now feeds the real top 3 **by name only** — the ranking is shop-front marketing, the volumes
   are the shop's business — using `billableOrderSql` so it agrees with `/admin`, cached 30 min.
   It answers قبعة → روب → وشاح, matching the DB, and a new rule forbids inventing a *reason*,
   an opinion, or a claim about what customers like.

**Location, checked:** the claim it makes is true — `StoreLocation` really is the last section of
the home page under «موقعنا». It now also names the shop as it appears on Google Maps,
**«مطبعة لولو شوب»**, taken from the map embed already in `StoreLocation.tsx`, so a customer can
search it directly. ⚠️ There is **no street address in text anywhere in the repo** (the embed is
an iframe and Maps is JS-rendered, so it can't be read out). If the owner wants the bot to say a
street or district, it has to be supplied.

All of these are now permanent scenarios, so they cannot regress silently. A run costs ~$0.005.

**The response cache — the other half of the owner's «tight — cache + hard caps» stance — is now
in.** Measured on a repeat scenario run: **$0.0059 → $0.0013, a 77% cut**, and a hit answers in
**4ms** against ~700ms for a model call.

- **Cacheable only when ANONYMOUS and there is no history.** Both conditions are load-bearing: a
  signed-in answer is built from that student's own orders and rep, so sharing one would hand a
  stranger another student's order status; and once there is history the answer depends on it
  («وهو الوشاح؟» means nothing alone). Under those two conditions every anonymous caller gets a
  byte-identical prompt, so the answer is genuinely reusable. Proven in the harness: a signed-in
  caller asking the identical words is **not** served the anonymous entry.
- **The key is a hash of the WHOLE system prompt + the normalised question**, so a price change,
  a rule change or a new best-seller ranking invalidates every entry automatically. There is no
  invalidation call to forget — which is the usual way this kind of cache goes stale.
- **Question normalisation folds spelling, never meaning:** tashkeel, أإآ→ا, ى→ي, ة→ه,
  punctuation and emoji. Tests pin both directions — variants of one question must collapse, and
  «سعر الروب» vs «سعر الوشاح» must never collapse.
- **Cache hits are logged (`model = 'cache'`, cost 0) but excluded from the caps.** The caps bound
  spend, and a free answer must not eat a student's 10/day. Logging them keeps the ledger a
  complete record of what customers ask — which is the backlog of missing facts.

**Also:** the harness now aborts with an explanation when the per-IP limiter (100/15 min) is
tripped by running it repeatedly, instead of reporting ~40 scenarios as failures. And three
delivery assertions were widened to match Arabic **stems** — they demanded «المحل»/«الاستلام» and
failed correct answers that said «محلنا»/«تستلم». That is the third time an over-literal assertion
failed right behaviour; a check that cries wolf is worse than no check.

**Still open:** analytics spends 2 model calls per question; the assistant cannot link to a
product page; nobody reads the `intent IS NULL` deflection log; there is no alert when the
provider fails.

## 2026-08-10 (b) — AI assistant: Arabic support chatbot + admin analytics

Owner asked for both surfaces on a **cheap** model, explicitly not the Claude API. Reuses the
existing `OPENROUTER_API_KEY` (already live for calligraphy) and adds **zero npm packages**, so
the `npm audit` deploy gate is untouched.

**Shipped:**
- **`google/gemini-2.5-flash-lite`, chosen by live Arabic test** — 4 candidates run against real
  Iraqi-Arabic questions with real order context. Winner: sub-second, **$0.04/1,000 messages**,
  no hallucinations. `openai/gpt-oss-120b` was rejected for **inventing a delivery promise**;
  `qwen/qwen3.7-flash` returned empty content. Re-run that test before changing the model.
- **Support chatbot** (`/api/assistant/support`, widget on every storefront page) — public, anon
  allowed. The server pre-fetches the asker's own orders/rep/deadline and the model only phrases
  them. **No tool-calling and no model-written SQL anywhere** — a cheap model is unreliable at
  both, and free SQL on this DB (no RLS) is a security hole.
- **Admin analytics** (`/api/assistant/analytics`, box on `/admin`) — the model picks one key
  from a **closed set of 8 typed metrics**; our SQL runs; the model phrases it. The raw figures
  render under the prose so the owner can audit the arithmetic.
- **`billableOrderSql` moved to `lib/counts.js`** (re-exported at its old name) so the assistant
  and the dashboard define revenue identically. 185/185 backend tests still pass.
- **Cost caps live in the DB** (`ai_chat_messages`, migration 078), not memory: 30/user/day,
  10/anon-session/day, **$1/day shop ceiling**. Anon callers keyed on a session id, not IP
  (CGNAT). With the key unset both endpoints 503 and the widget removes itself.

**Bugs the real data caught:** `products.name` doesn't exist (it's `name_ar`); bundle lines have
`price = 0`, so the bot nearly told a student their robe was free; and the analytics phrasing
invented a containment relationship between two independent counts. All three fixed.

**Verified in a browser at phone width** — anon + signed-in student + admin, including that the
bot refuses to promise a delivery date. ⚠️ **Migration 078 still needs applying to prod.**

## 2026-08-10 — iOS 1.0.4 uploaded, APNs verified against Apple, both platforms at parity

Prod runs `11a7a43`, confirmed over SSH. CI green, all 3 PM2 processes online, site 200.

**Shipped today:**
- **iOS 1.0.4 (build 1786309948) is on App Store Connect** — «Complete», *Ready to Submit*. Two
  Codemagic bugs fixed, both of which produced successful-looking runs that failed later:
  `d9688a6` — the entitlement assertion used `plutil -extract`, which splits its keypath on `.`
  and cannot represent an array, so it failed on a **correct** file; `PlistBuddy` separates on `:`.
  `b68eb94` — nothing ever set `CFBundleShortVersionString`, so every build shipped as `1.0` while
  `agvtool new-version` only ever set the **build number**. Apple had approved a 1.0, which closes
  that train permanently. `MARKETING_VERSION = 1.0.4` is now written to the pbxproj build setting
  (not the plist — Capacitor's plist carries the literal `$(MARKETING_VERSION)` and would be
  overwritten at build time). Both fixes ship with assertions that fail the build rather than the
  upload. Verified on Linux without a Mac before pushing.
- **iOS push credentials are live and proven.** Key `72D98R3MFC`, Sandbox & Production, Team
  Scoped. `push.configured()` → `{"android":true,"ios":true}`. ⚠️ Apple's form defaults Environment
  to **Sandbox alone**, which would deliver nothing to any store build while looking correct.
  Proof beyond parsing: a send to a fake device token returned **`BadDeviceToken`**, which only
  happens *after* Apple authenticates the JWT — a bad key returns `403 InvalidProviderToken`.
- **`ios-appstore` merged into `main`** (`11a7a43`) and fast-forwarded, so the Codemagic pipeline
  is no longer stranded on a branch. The merge adds `@capacitor/ios` as a **dependency**, so all
  four CI gates were run locally first (audit clean, lockfile in sync, 0 lint errors, build
  completes) before the push that triggers the auto-deploy.
- **Credentials filed.** All four LoloShop keys moved from `~/Downloads` to
  `~/Desktop/_private/loloshop-credentials/` with a README naming each. The two `.p8`s were
  indistinguishable by content — `72D98R3MFC` is APNs, `WLABBTJQT2` is the **App Store Connect API
  key** Codemagic uploads with. ⚠️ A `.p8` downloads exactly once; deleting the wrong one would
  have broken uploads entirely.
- **Board correction:** iOS was recorded as "unshipped". ASC shows **iOS 1.0 Ready for
  Distribution** — approved, which is exactly what closed the 1.0 train.

**Not done:** no iOS device token exists until 1.0.4 is installed from TestFlight and the
notification prompt granted, so iOS push is proven only at the credential layer. Android 1.0.4 is
in production review with managed publishing ON — approval will **not** publish it. iOS 1.0.4 still
needs submitting in ASC.

## 2026-08-09 — Android tap→app is LIVE, everything deployed, join routing fixed

Everything from the 2026-08-08 cloud session reached `main` and then production. Prod runs
`2108443`, verified over SSH, not inferred from git.

**Shipped today:**
- **Deep links work on a real phone.** Android **v1.0.3 (versionCode 4)** built on the laptop and
  published to the Play **internal testing** track; the owner tapped a WhatsApp `/join/` link and
  it opened the app. Both `.well-known` manifests serve **200 / `application/json` / 0 redirects**
  on the apex *and* `www` — which also closes the long-standing `www` landmine.
- **The two env vars are set** in prod `frontend/.env.local` (⚠️ not `.env` — that file does not
  exist on the box): the Play **App signing** fingerprint and `IOS_TEAM_ID=9YY4QWVDUW`, read off
  the consoles directly. Read at request time, so a `pm2 restart --update-env` sufficed.
- **Migration 077 applied to prod** while no push credentials existed — the safest possible moment,
  because its backfill retired **3,311** historical notifications to `skipped`. That is 3,311 push
  messages that would otherwise have hit real phones the instant credentials land.
- **CI deploy gate unblocked twice.** `25c3c4c` failed `npm audit` in 32s (nanoid high +
  dompurify moderate via jspdf, both newly published against already-installed packages), so
  `scripts/deploy.sh` never ran. Fixed by bumping our own `overrides` pin to dompurify 3.4.13.
  *(Noted: `jspdf` is a declared dependency with zero imports — dropping it removes this chain.)*
- **`ios-appstore` prepared** (`eb59e21`): merged `main`, reconciled the desynced lockfile, applied
  the codemagic push-capability patch. Owner enabled Associated Domains + Push on the App ID.
- **Join routing fix.** A rep-linked student now lands on `/my-order` directly instead of bouncing
  off the storefront. ⚠️ **The bounce already worked** — `StudentHome`/`CatalogBrowser` redirect on
  `audience==="wholesaler_student"`, which `priceRoleForUser` derives from `wholesaler_id` alone,
  status included. The real defect was that the check runs client-side after paint, so a waiting
  student saw a flash of a shop they cannot buy from and stayed there if that fetch failed.
  Scoped to `pending_approval` + `rejected` (**29** of 994 rep-linked students); the **965**
  approved keep their existing landing page.

Gates: **185/185** backend tests against the dev DB with 077 applied · `tsc` 0 · `eslint` 0 errors
· `next build` exit 0 · prod backup `loloshop-prod-2026-08-09_2143.dump` (3.1 MB, 63 tables)
verified with `pg_restore -l`.

**Not done:** Android push (no `google-services.json`, so 1.0.3 shipped without it and needs a
**second** binary) · iOS build not started · Android not promoted to production · GPS mode still
`none`.

---

## 2026-08-08 — Push notifications, and the eight open review findings

**Branch `claude/handoff-cloud-board-tasks-v342hb`** (off `feat/deeplinks-and-location`).
**Migration `077_push_notifications.sql` — pending, not yet applied.**
Gates: `tsc` 0 · `eslint` 0 · `next build` exit 0 · backend syntax check clean ·
`node --test test/push.test.js test/joinRouteOrder.test.js test/memoCache.test.js` **13/13**
(the DB-backed suites were not runnable — this sandbox has no PostgreSQL).

Closes both items on the HANDOFF cloud board. The third ship-queue blocker — push — was the only
one with no code at all; it now has everything a cloud session can build, and stops at the two
things that need a browser session in a console (a Firebase project and an APNs key).

### 1 — Push notifications (the last unbuilt blocker)

**What shipped as "notifications" before this:** rows in the `notifications` table, rendered
in-app. A rep whose student joined at 11pm found out the next time they happened to open the
app; a closed phone learned nothing at all.

- **`notifications` IS the queue.** New `push_state` / `pushed_at` columns plus
  `backend/lib/pushOutbox.js`, which claims committed rows and delivers them. Chosen over a send
  call at each site because there are **thirteen** `INSERT INTO notifications` and several run
  inside `tx()` — sending from in there pushes work that may still roll back, and sending after
  means threading a return value through every caller. **No call site changed**, so no future
  insert can forget to push.
- **⚠️ Two independent flood guards, and both are load-bearing.** `push_state` defaults to
  `'pending'`, so the migration retires every pre-existing row to `'skipped'`, **and** the drain
  only ever looks at the last 15 minutes. Either one alone is a single line away from replaying
  the shop's entire notification history onto real phones. The backfill is repeated in
  `db/schema.sql` because that file is what `npm run migrate` applies, to a database that
  already holds every notification ever written.
- **Zero new npm dependencies, and that is a deploy requirement.** `ci.yml:22` runs
  `npm audit --omit=dev --audit-level=moderate` and the deploy job needs it green, so a package
  that picks up a moderate advisory stops the **site** shipping, not just this feature.
  `firebase-admin` would put ~40 transitive packages permanently inside that gate to do two
  things Node already does: sign a JWT and make an HTTP/2 request. `backend/lib/push.js`
  implements FCM HTTP v1 and APNs HTTP/2 on `crypto` + `http2` + `fetch`.
- **iOS talks to Apple directly, not through Firebase.** Routing iOS through FCM needs the
  Firebase iOS SDK *inside the app*, and the iOS project is regenerated from Capacitor's
  template on every Codemagic run — the same trap that already forces the privacy strings and
  the entitlement to be re-injected each build. Straight APNs needs nothing in the app: the
  plugin's stock token IS the APNs token and the `.p8` lives only on the server. So **the
  Firebase project is Android-only**, and the `.p8` goes in the backend `.env`.
- **⚠️ `POST_NOTIFICATIONS` added to `AndroidManifest.xml`.** The plugin does **not** declare it
  — it names it only in a Capacitor `@Permission` annotation, which is a runtime concept; its
  own manifest carries just the messaging service. Verified by reading both files in
  `node_modules`. Android denies a runtime request for an undeclared permission **without
  showing a dialog**, so without this line `requestPermissions()` resolves `'denied'` instantly
  on every modern phone and nothing anywhere says why — the identical silent failure the two
  location permissions were added to fix. It is compiled into the AAB, so missing it costs a
  whole extra store release.
- **`npx cap update android` run**, so `capacitor.settings.gradle` and `capacitor.build.gradle`
  now include `capacitor-push-notifications`. They are generated files; the plugin was in
  `package.json` but had never been synced, so a build would have shipped without it.
  `app/build.gradle` already applies the google-services plugin only when `google-services.json`
  exists, so the build still succeeds without the owner's file — silently producing an app that
  can never register, which is why that is spelled out in the manifest comment.
- **`POST /api/notifications/devices`** (upsert) and **`/devices/unregister`**. ⚠️ The upsert
  conflicts on **`token`**, not `(user_id, token)`: phones here are shared and resold and the
  provider hands the same token to whoever signs in next, so the device **moves** to its new
  owner instead of leaving the previous account subscribed. `logout()` unregisters **before**
  clearing the JWT, passing the token explicitly — axios' interceptor reads localStorage in a
  microtask, by which time it is gone.
- **Frontend:** `lib/push.ts`, `components/PushRegistrar.tsx` (root layout), both dynamically
  imported so axios stays out of the root chunk. The permission is asked **after login only** —
  iOS shows that sheet once per install, and spending it on a browsing student burns it, since
  a «رفض» can only be undone in system Settings. Foreground arrivals become a sonner toast
  (Android draws no system notification while the app is foregrounded); taps navigate, and the
  `link` is validated as a same-origin path because it round-trips through FCM/APNs.
- **Device rows are deleted on one signal only** — an explicit provider verdict (FCM 404/403,
  APNs 410/BadDeviceToken). Never on a timeout or a 5xx, which would quietly unsubscribe every
  phone in the shop during a provider outage.
- **iOS `aps-environment`** is prepared as `docs/patches/codemagic-ios-push-capability.patch`,
  because `codemagic.yaml` exists **only** on `ios-appstore` and creating it here would be an
  add/add conflict on the day that branch merges. Verified `git apply --check` clean against
  `f1785c0`. See `docs/patches/README.md`.

### 2 — The eight review findings

- **Native detection unified.** New `frontend/lib/native-shell.ts` is the one implementation of
  the two-signal test. `DeepLinkHandler.tsx` tested `window.Capacitor` alone while its comment
  claimed parity with the gate; both now import the same function. **The underlying hole is
  documented, not fixed, and that is a decision:** on Android WebView <105 there is no Capacitor
  runtime at all, so `AppWeb.getLaunchUrl()` returns `''` and an App Link opens the app with the
  code already lost. Nothing in JS recovers it — reading the launch intent needs the very bridge
  that is missing. WebView 105 shipped in Aug 2022 and updates through Play, so the affected
  phones are largely ones that cannot install from Play either. The real fix is a native change
  in `MainActivity` that no cloud session can compile or test.
- **Route order is now pinned** — `backend/test/joinRouteOrder.test.js`, 3 tests, no database
  (`lib/db` and the controller are stubbed in `require.cache`). The third test builds a
  deliberately mis-ordered router and asserts `/representatives` really is swallowed, so the
  other two cannot pass for unrelated reasons.
- **`join:` caches are invalidated** on rep create / update / deadline / delete
  (`adminController.invalidateJoinCaches`). An admin creating a rep in front of the owner used
  to watch it not appear for five minutes. The prefix clears `join:<code>` too, deliberately —
  a deadline edit changes the referral page a student reads.
- **The shared limiter is split.** `directoryLimit` 300/15min and `lookupLimit` 200/15min are
  now separate, and both were raised: Iraqi carriers CGNAT, so one IP is routinely a whole
  cohort. The enumeration defence the old 60 was tuned for is already spent —
  `/representatives` publishes every code in one response. **`joinLimit` (10/hour/IP) was left
  alone**: it is the deliberate bound on approval-queue spam recorded on 2026-08-07, and
  changing it is an owner call. It has the same CGNAT exposure — flagged in HANDOFF.
- **`/join` tells a network failure apart from an empty directory.** `getJoinRepresentatives`
  now throws instead of resolving `[]`, and the page has a real error state with a retry button.
  The old behaviour told a student on a flaky connection «لا توجد قائمة ممثلين» — read as "your
  rep is not registered" — on the exact screen that exists because they already lost their link.
- **Dead code removed** — the `?referrer=join_<code>` branch in `app-gate.ts`, unreachable since
  `/join` was allowlisted. What it was for, and when to restore it, is recorded in its place.
- **Stale comments corrected** — `app-gate.ts` no longer says `/s /w /d` must open in a browser
  (the manifest now claims them), and the spec's «two dropdowns» acceptance line now matches the
  shipped grouped `<select>`.
- **The codemagic sharp edge is fixed** in the patch above: the injection is idempotent and
  ignores foreign targets instead of bailing out with a mystery failure.

**Open — owner actions, unchanged in order:**
1. Firebase project → `google-services.json` → commit to `frontend/android/app/`.
2. APNs `.p8` → `APNS_KEY_FILE` + `APNS_KEY_ID` + `APNS_TEAM_ID` in the prod `.env`.
3. Enable **Push Notifications** on the App ID (alongside Associated Domains).
4. Apply the patch to `ios-appstore` before the next Codemagic run.
5. Run `npm run migrate` (or `npm run migrate:file db/migrations/077_push_notifications.sql`).
6. Declare notifications on the Play Data Safety form and the Apple privacy label.

---

## 2026-08-07 — «ادخل مع ممثلك», team portals as deep links, and the iOS pipeline

**Branch `feat/deeplinks-and-location`** (+ `codemagic.yaml` on `ios-appstore`). No migration.
Spec: `docs/superpowers/specs/2026-08-07-app-entry-deeplinks-gps.md`.
Gates: backend **177/177** · `tsc` 0 · `eslint` 0 errors · `next build` exit 0 · endpoint and
both well-known routes curl-verified against real servers.

**The question this answers:** «can a rep's students and the team get into the app without the
website?» — with the website reduced to admin + a download landing page.

- **Split by what needs a store review.** The binaries are WebView shells on the live site, so
  HTML/JS/API changes reach installed apps on deploy; only `AndroidManifest.xml` and the iOS
  entitlements need a new binary. Everything below is sorted by that line.

**Ships on deploy — no store, no review:**
- **`GET /api/join/representatives`** — public directory of approved reps (جامعة · قسم · code),
  5-min cached. ⚠️ Registered **above** `/:code`; Express 5 matches in order and the param route
  would swallow it.
- **`/join` — «ادخل مع ممثلك»**, linked from `/login`. Recovery for a student whose rep link is
  buried in WhatsApp. `referral_code` is an admin-typed Latin slug, so typing it is not an
  option, and iOS has no deferred deep linking, so "install and it remembers" is not either.
- **⚠️ Built as جامعة→قسم first; the live data killed it.** `university_name` is admin free text
  and the 12 real rows spell one university three ways («بلاد الرافدين» · «بلاد الرفدين» ·
  «كلية بلاد الرافدين»; same for «جامعة ديالى» · «ديالى» · «جامعة ديالى كلية العلوم»). Two
  dependent dropdowns dead-end anyone picking the wrong spelling — empty قسم list, no error,
  student concludes their rep isn't registered. Now **one `<select>` grouped by `<optgroup>`**,
  so a mis-spelled twin is visible instead of hidden. **The 12 rows still want cleaning.**
- **`/join` allowlisted in `BROWSER_ALLOWED_PREFIXES`** — a correctness fix, not a nicety.
  Without it, flipping `NEXT_PUBLIC_APP_ONLY=1` replaces every referral tap with the store and
  **nothing carries the code through the install**: Play's `?referrer=` has no reader on our
  side and iOS has no equivalent. Costs nothing — once App Links verify, Android intercepts
  `/join/*` before the browser loads it.
- **`/get-app`** now states the only instruction that works on both platforms: tap the link
  again after installing.

**Needs one new binary per store (batched with the location permission):**
- **Deep links extended to `/s/`, `/w/`, `/d/`** — manifest, AASA and `DeepLinkHandler` all
  claim the same four prefixes. These portals are the **only** way in for staff, workshop and
  design-team members with no phone for the WhatsApp OTP, and they went browser-only when
  `TeamKeyEntry` was deleted on 2026-08-06. This puts that entrance back inside the app.
- **`codemagic.yaml` (`ios-appstore`)** — `NSLocationWhenInUseUsageDescription` added to the
  existing `plutil` step and its fail-loud check, plus a new step that writes
  `App.entitlements` (`com.apple.developer.associated-domains`) and wires
  `CODE_SIGN_ENTITLEMENTS` into `project.pbxproj`. Both re-injected **after `cap sync`**,
  because `npx cap add ios` regenerates `ios/` every run and wipes committed edits — the same
  trap the camera-crash fix already documents. Dry-run against a fake project: wired into
  exactly the 2 App-target configs, left a plugin target with a different bundle id untouched,
  and exits 1 when the template shape changes.

**Open — owner actions, in this order:**
1. **⚠️ Enter the shop coordinates.** `staff_attendance_settings.shop_latitude/longitude` are
   NULL; setting `verification_mode` to `location`/`both` first **403s every بصمة for every
   worker on every platform**.
2. **⚠️ Enable "Associated Domains" on the App ID** before the next Codemagic run, or
   `fetch-signing-files` builds a profile without it and the build dies at signing.
3. `ANDROID_SHA256_CERT_FINGERPRINTS` (Play **App signing** key, not the upload keystore) and
   `IOS_TEAM_ID` on the VPS.
4. Play Data Safety + Apple privacy label: declare location.
5. Clean the 12 wholesaler `university_name` rows.
6. Verify on a real phone before flipping either flag — App Links fail **soft**, so a wrong
   fingerprint is invisible: `adb shell pm get-app-links com.loloshop96.app`.

**Accepted tradeoff:** the rep directory is public and unauthenticated, so the university list
is disclosed and a rep's approval queue can be spammed without the link leaking. Bounded by
`joinLimit` (10/h/IP) and the unique-phone check, and joining still grants nothing until the rep
approves. Note the codes are already 1–3 characters (`g`, `tr`, `ml`), so they were trivially
enumerable long before this endpoint existed.

---

## 2026-08-06 — Deep links for `/join/*`, and the location permission the app never had

**Branch `feat/deeplinks-and-location`. No migration.**
Gates: `tsc` 0 · `eslint` 0 · `next build` exit 0 · both well-known routes curl-verified against
a real `next start`.

- **The problem, stated properly.** The shells are remote-URL WebViews (`capacitor.config.ts`
  → `server.url`) with **no address bar**, and nothing in the app links to `/join/*`. So a
  wholesaler's referral link was **browser-only**: `AndroidManifest.xml` had only
  `MAIN`/`LAUNCHER` — no `VIEW`/`BROWSABLE` — and no `.well-known` file existed for iOS.
  An installed student had no path to their code at all.
- **Android:** added an `autoVerify` App Links intent-filter claiming `https://lolo-shop96.com`
  and `www.` at **`pathPrefix="/join/"` only** (per the 2026-07-31 spec — a wildcard would make
  the app hijack every shared product link).
- **iOS:** added `app/.well-known/apple-app-site-association/route.ts`, extensionless and
  `application/json`, emitting both the iOS 13+ `appIDs`/`components` form and the legacy
  `appID`/`paths` form. Driven by a new `IOS_TEAM_ID` env var.
- **`DeepLinkHandler.tsx`** handles **both** arrival paths — `appUrlOpen` (warm) *and*
  `App.getLaunchUrl()` (cold start, where no event ever fires). Handling only the listener is
  the classic half-working deep link: fine while you test with the app open, broken for every
  student tapping from WhatsApp. Host + path allowlisted again in JS, independently of the
  manifest. Dynamic-imports `@capacitor/app` so browsers never fetch it.
- **Hardened the pre-existing `assetlinks.json` route**, which accepted any non-empty string.
  It now normalises case/colons and **drops anything that is not 64 hex chars**, so a pasted
  SHA-1 or a truncated copy fails loudly instead of serving a document that looks right and
  never verifies. Verified: a junk `DE:AD:BE:EF` entry is dropped, a lowercase unseparated
  fingerprint is normalised to `AA:BB:…`.
- **`ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION` added to the manifest.** Staff بصمة calls
  the *web* `navigator.geolocation` (`lib/staff.ts:1377`); Capacitor's bridge already prompts
  for these two (`BridgeWebChromeClient:246`), but **Android denies a runtime request for an
  undeclared permission without showing a dialog** — so `getCurrentPosition` always hit its
  error path and check-in posted `location: null`. Silent, because `verification_mode` is
  `'none'` and the backend then marks it verified anyway. This is why a **new binary** was
  unavoidable: `<uses-permission>` compiles into the AAB and the remote-URL trick cannot ship it.

⚠️ **Order of operations for GPS — getting it wrong locks every staff member out.** Ship the
binary → wait for phones to update → set `shop_latitude`/`shop_longitude` in `/admin` → *only
then* move `verification_mode` off `'none'`. Flipping it first makes `locationOk` false for
everyone, and `attendanceController.js:532` + `:619` answer that with a hard
**403 `ERR_ATTENDANCE_LOCATION`**.

Open / owner actions:
- `ANDROID_SHA256_CERT_FINGERPRINTS` on the VPS — from Play Console → **App integrity → App
  signing key certificate**, *not* the upload keystore. Unset today, so the route 404s.
- `IOS_TEAM_ID` on the VPS. Unset = that route 404s and iOS deep links stay off.
- **Enable "Associated Domains" on the App ID** in the Apple Developer portal *before* the next
  Codemagic run, or signing fails with a missing-entitlement error.
- Update the Play **Data Safety** form (location is now collected).
- `codemagic.yaml` on `ios-appstore` still needs the entitlement +
  `NSLocationWhenInUseUsageDescription` injection step.
- Neither half is smoke-tested on a real device yet — App Links fail *soft* (the link just opens
  in the browser), so a wrong fingerprint is invisible. Check with
  `adb shell pm get-app-links com.loloshop96.app`.

## 2026-08-05 (e) — التجهيز cards show the garment, not just the stitching

**Committed to `feat/ssr-storefront-native-auth`. No migration.**
Gates: **backend 177/177** (+10) · `tsc` 0 · `eslint` 0 errors · `next build` exit 0.

- **Closed the prep-queue data gap.** The زone detector was NOT touched — 325 of 326 cards said
  «لا تطريز على هذه القطعة» *correctly*, because the queue is robes and zones are a sash/cap thing.
  The console now also answers the preparer's real question: **لون/قماش/فصال الروب · الشكل · لون
  القبعة**, the student's free-text lines («كسرة الكتف» — the single most common line in the whole
  queue at 225) and **قياسات الروب** with ملاحظات الفصال and صورة الوصل.
- **Why the data was invisible:** a spec line carries no `customer_text` and no `customer_image_url`
  — it is a *choice*, not content — and every existing code path filtered on content. Same table,
  opposite filter. `buildPieceSpec` partitions the lines and is pure, so the rules are unit-tested
  against labels measured off the live queue.
- **Measured by driving the real `getQueue` with a real preparer over the real 435-row queue:**
  rows with something to show **3 → 416 (95.6%)**, measurements **0 → 281**, empty cards **432 → 19**.
  All 19 remaining empties are correct — American shawls whose only line is «السعر الأساسي», because
  the product name (*شال امريكي 10*) already is the spec.
- `measurements` is gated in SQL, not JS, so it never rides on the other stations' ~480-row payloads.
  `chest_cm` is 0 on every live order, so 0 renders as absent. `RobeMeasurements` was extracted from
  an inline type so the order detail and the queue row cannot drift.
- `PieceSpec` uses flex rows, not `grid-cols-subgrid` — old Android WebViews in the workshop.

Open:
- Browser smoke test of the prep console — the payload is verified end to end, the UI is not clicked.
- ⚠️ The `postgres` MCP server points at a DIFFERENT project's DB (a digital-goods store). All
  measurements above came from LoloShop's own DB via `backend/lib/db.js`.

## 2026-08-05 — التجهيز prep console · scroll restore · touch-first buttons · account screen

**Committed to `feat/ssr-storefront-native-auth`. No migration.**
Gates: **backend 167/167** · `tsc` 0 · `eslint` 0 errors · `next build` exit 0.

- **قائمة التجهيز is now its own console** (`components/staff/prep/PrepConsole.tsx`), reusing the
  embroiderer's `StudentSheet` verbatim per the owner's «مثله مثل واجهة عامل التطريز». The preparer
  was packing **blind** — their old queue was a flat `OrderCard` grid with no artwork, and رف التجهيز
  has no `<img>` either, so verifying a set meant opening every piece's detail page.
- **Zones are read-only at التجهيز.** The stitching is finished by the time a piece arrives, and the
  backend exposes no zone-tick endpoint for `preparing`, so the preparer reads the artwork to verify
  and never ticks it. One detector (`detectZonesForOrders`) still serves both stations.
- **Two defects found reviewing the batch before commit, both fixed here:**
  - The **«جاهزة للتسليم» tab claimed «لا تطريز على هذه القطعة» on every packed piece.** The backend
    attached zones only for `embroidery`/`preparing`, and the sheet cannot tell *"no artwork"* from
    *"artwork never fetched"* — so an absent list rendered as a statement of fact on pieces that are
    demonstrably embroidered. `ready` joined `ZONE_STAGES` (no extra round-trip — the detector is one
    `order_id = ANY($1)` query), and `PrepConsole`/`StudentSheet` stopped collapsing `null` into `[]`
    so the distinction survives the mapper.
  - That same tab then read **«لا يمكن إكمال هذه القطعة من هنا حالياً»** on every row — true (تأكيد
    التسليم needs a delivery method, so it lives on the detail page) but a dead end. Now points at
    «التفاصيل», via a `noActionHint` prop supplied by the only caller that can tell the tabs apart.
- **Scroll position survives back-navigation** (`hooks/useScrollRestore.ts`) on staff home, queue,
  shelf, station and prep. Next's built-in restoration does not cover this: the staff screens navigate
  in and out with `<Link>` pushes, and a push always lands at the top. The save is frozen on click —
  without that, leaving the page scrolls to 0, that fires a `scroll` event, and the good offset is
  overwritten with 0 (measured; the first version of the hook was broken exactly this way).
- **Buttons work on touch.** Every bit of the CTA's character lived behind `:hover` — invisible on the
  phones students and reps actually use. `.btn-press` scales under the thumb, `.btn-shine` fires its
  sheen on `:active`, all transform/shadow only, all collapsing under `prefers-reduced-motion`.
- **Zone thumbnails go through the optimizer** (`ZoneThumb`): a raw `<img>` was pulling the full 4–6 MB
  upload for a 44 px box, ~25 MB per student with five zones, uncacheable (`no-store`) over workshop
  wifi. A broken URL now renders an explicit «؟» marker — never as "this zone has no artwork".
- **`unoptimized` removed from the 8 staff order-detail images**; the lightbox moved to `next/image`.
- **حسابي rebuilt**: graduate-figure avatar tied to the onboarding gender answer, destination rows
  instead of two ghost pills, and a real signed-out screen instead of a login wall. «تفضيلاتي» now
  *shows* an answered gender as a settled summary with «تغيير» rather than re-asking the question.
- **`turbopack.root` removed from `next.config.ts`** — it silences a cosmetic warning and breaks
  `next dev` (`/` 500s on the React Client Manifest). The header comment now says so at length.
- **Docs:** `HANDOFF.md` 665 → ~180 lines, `PLAN.md` 337 → ~80; history moved verbatim into
  `docs/HANDOFF-archive.md` and the new `docs/PLAN-archive.md`.

Open:
- Browser smoke test of the prep console against the real queue (326 students / 429 pieces) —
  not run this session.
- The prep-queue **data** gap is untouched: robe colour/fabric/cut, shape, cap colour and
  `measurements` are in the DB and still unrendered. See `HANDOFF.md`.

## 2026-08-01 — Image weight: product photos were 4–6 MB served raw and uncacheable

**Uncommitted on main. No migration.** Gates: **backend 167/167** (+6) · `tsc` 0 · `eslint` 0 errors.
Full detail in `HANDOFF.md`.

- **Measured, not guessed:** prod product photos are **4.3–6.1 MB PNGs** (hero: 6,003,607 bytes at
  1856×2304, on a 390 px phone). Nothing resized them on upload, `/uploads` is `no-store` so they
  re-downloaded every visit, and the product page used a raw `<img>` that skipped Next's optimizer.
  The home grid already used the optimizer — that's why only the product page felt broken.
- **Answer to "client-side or SSR?": 47 of 54 pages are `"use client"`.** The storefront is entirely
  client-rendered — LCP 3.68 s with **2.79 s of render delay** on Slow-4G + 4× CPU, CLS 1.10.
- **Fixed at delivery:** hero + thumbnails routed through `/_next/image` inside a fixed `aspect-[4/5]`
  `object-contain` box (no crop, no distortion, and it reserves space so the CLS goes away).
- **Fixed at the source:** uploads over 500 KB are auto-oriented, capped at 2000 px and re-encoded
  (alpha → PNG, else JPEG q85 — no WebP on disk, so no downstream tool can be handed a format it
  can't open). Embroidery artwork is exempt on both client and server.
- **Fixed the upload leg:** browser-side downscale wired into `apiUploadFile`, the one choke point all
  11 upload callers share.
- **Verified end to end:** same 6 MB photo over real HTTP → **6,003,607 → 208,010 bytes (3.5%)**; a
  15.53 MB pick left the browser as **385,548 bytes (2.4%)** — a file multer would previously have
  rejected at its 10 MB cap.
- **⚠️ `priority` is deprecated in Next 16 and silently does nothing** — caught in the browser (no
  `fetchpriority` attribute emitted). Now `loading="eager" fetchPriority="high"`. **~8 other
  components still pass the dead prop** and lazy-load their above-the-fold images; not touched.
- **Second pass — the home page is a separate bug.** CrUX field data (real users, p75):
  **LCP 3905 ms, load delay 2113 ms, load duration only 289 ms** — so image bytes are NOT the home
  page's problem; discovering them late is. Fixed one concrete cause: `app/(student)/page.tsx`
  chained the shop feed *inside* `getMaintenance().then()`, making two API round trips **strictly
  serial**. Now concurrent (verified: start 3 ms apart and overlap). The rest is the client-render
  waterfall — the SSR fix is **blocked on an owner decision** because the JWT lives in `localStorage`,
  so a Server Component can't know the viewer's price role.
- **⚠️ None of this is deployed** — still uncommitted, which is why the live site was unchanged.

## 2026-07-31 (b) — App-only gate verified + shipped with the flag OFF · dead-app bug caught · attendance breaks were broken on prod

**Deployed with `NEXT_PUBLIC_APP_ONLY` unset, so prod behaviour is unchanged.** Turning it on is a
VPS env edit + rebuild — the exact commands are in `HANDOFF.md`. Gates: `eslint` 0 errors ·
`next build` 0 (run twice, flag OFF and flag ON) · `tsc` 0 · **backend 161/161**.

- **Phase 9 done in a real browser against a production build**, not dev: flag OFF is byte-identical
  to today (gate string absent from the HTML); flag ON bounces `/` to `/get-app` while `/admin`,
  `/workshop`, `/tv/<key>`, `/privacy`, `/terms`, `/delete-account` all still open; an Android UA on
  `/join/ABC123` lands on the real Play listing with `&referrer=join_ABC123`.
- **Caught a bug that would have bricked the app.** The gate keyed off `window.Capacitor` alone, but
  `Bridge.java:266` only injects it when `DOCUMENT_START_SCRIPT` is supported — **Android WebView
  105+**. Below that the app would have redirected *itself* to the Play Store forever. Now accepts
  `window.Capacitor || window.androidBridge`; proved with a controlled comparison where only the
  injected global changes (Capacitor → holds · androidBridge only → holds · neither → bounces).
- `TeamKeyEntry` verified with the real staff and workshop keys, a pasted `/s/<key>` link, and a
  wrong key.
- **Owner decisions:** PWA users get bounced too; App Store id `6793976053`.
- **Known and deliberately not fixed:** the gate only runs on full page loads, so `/admin` →
  (client-side) `/login` escapes it; and the bypass token ships in the page source. Both are
  properties of a client-side gate, both recorded in `HANDOFF.md` for an owner call.

**Separately — attendance breaks were live-broken on prod since 2026-07-30.** Shipped with 161/161
tests but never clicked; the first click threw `Cannot read properties of undefined (reading
'start_time')` at an Arabic-only worker. `staffPayload` returned half a payload while the frontend
maps every break action through one `mapAttendancePayload`. The write always succeeded (201) — only
the render died, so workers retried into «لديك خروج مؤقت مفتوح». Fixed by making
`attendanceController.todayPayload()` the single source of the payload shape. Then walked end to end:
request → approve → «طلعت» → «رجعت» → balance 10 س → 9 س 59 د, and the money path «خرجت بدون موافقة»
→ خصم ١٬٠٠٠ د.ع → «أوافق وألغي الخصم» → deduction cleared while the allowance stays spent.

## 2026-07-30 (b) — Apple rejection fixed: camera crash (2.1a) + in-app account deletion (5.1.1v)

**Uncommitted. Migration 076 applied to the laptop dev DB + mirrored into `db/schema.sql`. The
codemagic.yaml fix is on the `ios-appstore` branch (worktree), NOT main.** Gates: backend
**161/161** (+8 new) · live HTTP e2e **15/15** · `tsc` 0 · `eslint` 0 · **browser-verified on a
390px phone viewport, console clean**.

- **Camera crash** — the repo has no `Info.plist` at all; `npx cap add ios` regenerates it every
  build, so the app shipped without `NSCameraUsageDescription`. iOS kills any app that opens the
  camera without it, which is exactly what "tapped Take Photo → crash" is. New codemagic step
  injects the camera + photo-library strings after `cap sync` and **fails the build** if they are
  missing, so this cannot silently regress. Also sets `ITSAppUsesNonExemptEncryption=false`.
- **Account deletion** — new `POST /auth/account/delete` + `GET /auth/account/deletion-preview`
  (`accountController.js`), new `/account` screen linked from the student nav, and `/delete-account`
  rewritten to point at the real flow instead of "message us on Instagram".
- Deletion **anonymises** rather than row-deletes: `orders.student_id` is `ON DELETE RESTRICT`, so a
  real delete is refused the moment a student has an order and would destroy the shop's sales
  records. The account dies (phone/email NULLed, password replaced, `token_version` bumped so every
  JWT dies at once, cart/notifications/trusted devices cleared); the order survives on its
  `checkout_groups` delivery snapshot so an in-flight sash still ships.
- Retail only (`SELF_DELETE_ROLES`) — reps and staff/workshop keep admin-managed deletion.
- New `npm run demo-account` recreates the App Review demo login, because the reviewer walking this
  very flow would otherwise destroy it and fail the next submission.

Open: enter the real Apple reply (screen recording), push, rebuild on Codemagic, resubmit.

## 2026-07-30 — الخروج المؤقت: temporary-leave button beside بصمة + 10h monthly allowance

**Uncommitted on main. Migration 075 applied to the laptop dev DB + mirrored into `db/schema.sql`.**
Gates: backend **153/153** (+26 new) · `tsc` 0 · `eslint` 0 errors. **Browser walkthrough NOT done**
(stopped at the owner's request). Spec:
`docs/superpowers/specs/2026-07-30-attendance-temporary-leave-design.md`.

- New `staff_attendance_breaks` table + `break_monthly_minutes` on both settings layers (global
  default 600 = 10 hours, nullable per-staff override).
- New `backend/lib/attendanceBreak.js` owns the whole money rule: free only if approved AND inside
  the allowance; anything else deducted at the existing per-minute rate, frozen per row. Every
  change re-runs the worker's whole month so the parts always sum to the balance.
- New `backend/controllers/attendanceBreakController.js`: staff request → leave → return → cancel,
  admin list/balances/approve/reject/correct-duration. Wired into `routes/staff.js` + `routes/admin.js`.
- `worked_minutes` now excludes break time (new `present_minutes`/`break_minutes` on records);
  بصمة الخروج auto-closes a break the worker forgot to end.
- New `components/staff/StaffBreakControl.tsx` on both attendance surfaces (full card + compact
  `/staff` row) with the allowance bar, live timer, and the «خرجت بدون موافقة» escape hatch;
  new «الخروج المؤقت» section on `/admin/attendance`.

Open:
- Browser walkthrough (staff request → admin approve → طلعت → رجعت → over-quota deduction).
- Owner decision: should lateness deductions also reach the salary balance? (see spec, last section)

## 2026-07-29 — الورشة: piece rates split by customer type (ممثلين / تجزئة) — SHIPPED

**Pushed to main `8832922`, CI green, deployed. Migration 072 applied to prod by the deploy.**
Gates: backend **123/123** (+5 new) · `tsc` 0 · `eslint` 0 · live e2e on the dev DB · browser-verified
as a workshop worker and as staff.

**Done**
- Migration 072: `audience` (`wholesale`/`retail`) on `workshop_piece_rates` + `workshop_production_entries`;
  unique key is now `(operation, product, audience)`. `DEFAULT 'wholesale'` backfills all existing rows.
  Retail rates seeded equal to wholesale so no job is ever worth 0 on day one.
- `insertProduction`, `upsertRate`, `ratesMatrix` all resolve by audience — they had to change together,
  because the migration invalidates the 2-column conflict target and makes the un-filtered rate lookup
  match two rows.
- Audience is **required** on every production entry — no default, validated server-side.
- `ledgerFor` + `dashboard` return `production_wholesale` / `production_retail` (+ `pieces_*`).
- Worker screen: «لمين هالشغل؟» toggle (unselected by default, submit disabled until tapped), live price
  follows the choice, حسابك shows the two totals, each ledger line names its audience.
- Admin: two price inputs per job in أسعار القطع, the same required choice on تسجيل القطع, and a
  الكل/ممثلين/تجزئة filter on نظرة عامة (المستحق under الكل only — حوافز/خصومات belong to no audience).
- Payout card panel removed from the workshop crew's screen + its two backend routes deleted.

**Next**
- **Enter the real تجزئة wages in `/admin/workshop` → أسعار القطع.** Every retail rate currently equals its
  wholesale twin, so the split is structurally correct but changes no numbers until this is done.
- The payout-card feature remains uncommitted and undeployed — see HANDOFF for the blocking accrual issue.

---

## 2026-07-20 — Order editing repaired: priced spec lines were uneditable · student academic info had no edit path

**Branch `security-fixes`, committed, NOT pushed. No migration for this fix.** Reported by the owner as "editing on order for
retail has issues, and the student info on the order can't be edited". Both were confirmed against live Neon data before any
code changed. **Separately, migrations 067 (`users.token_version`) + 068 (`otp_send_events`) WERE applied to Neon this session**
— not for this fix, but because `middleware/auth.js` on this branch selects `token_version` on every authenticated request, so
the backend 500s on the old schema. That was already on the deploy checklist; it is now done rather than pending.

**① Priced spec lines were silently hidden from the editor.** `editContext` + `patchOrderDetails` filtered editable lines with
`COALESCE(price_snapshot,0) = 0`, intended as "never touch price rows". That conflated a line *carrying* a price with an edit
*changing* one — the UPDATE only ever writes `customer_text`, so the price was never reachable either way. Live impact:
**208 typed lines across 166 retail orders were uneditable**, exactly the embroidery texts staff need to fix — «القبعة من
الجانب» ٩٧، «القبعة من الأعلى» ٤٤، «تطريز ردن الروب» ٥٩، «ردن الروب» ٨. Verified on a real order (نبأ علي عبود): the old query
returned `[]` (the UI showed «لا توجد بنود نصية قابلة للتعديل»), the new one returns both ردن الروب lines. **Fix:** drop the
price condition, keep `customer_text IS NOT NULL`. Money safety is unchanged — the UPDATE sets only `customer_text` and is
scoped by `order_id`.

**② الجامعة / القسم / نوع الدراسة / الاسم had no edit path anywhere in the app** — the order page rendered them read-only and
`/edit` didn't offer them; only انستغرام had a ✎. **Fix:** new `university_name` / `department` / `study_type` branches in
`applyStudentInfo` (students-table only — no checkout_groups mirror), inline ✎ on all four rows of «بيانات الطالب», and the
same fields on the `/edit` page. `study_type` is a Postgres enum, so it gets a `<Select>` (صباحي/مسائي/غير محدد).

**③ Hardening found by the critic pass.** (a) A refactor to a computed payload key had broken the *existing* انستغرام edit —
`kind: "instagram"` serialised to a key the backend ignores, so it returned a success toast on a write that never happened.
The quick-edit `kind` is now typed as `keyof QuickEditPayload["student"]`, so a key that the backend doesn't accept **fails to
compile** (proven: reintroducing the old value produces TS2345). (b) `applyStudentInfo` validated *inline*, so a bad
`study_type` returned 400 **after** name/university/department were already committed → validation is now a separate
`validateStudentInfo()` pass that runs before any write. (c) `patchOrderDetails` committed item texts, then wrote student info
outside that transaction → item texts, student info, notes and the audit row now all land in **one** transaction.
(d) `saveFullSetOrder` could 400 after the طقم was already persisted, skipping the audit row → it validates before persisting.
(e) name `maxLength` was 160 client-side vs `clean(…,120)` server-side (silent truncation) → both 120 now.

**Gates:** BE `node --check` 0 · **NEW `backend/test/orderEditStudentInfo.test.js` 14/14** (offline — points DATABASE_URL at
localhost so the Neon guard stays intact; includes a spy proving **zero** UPDATEs run when validation fails) · FE `tsc` 0 ·
`eslint` 0 · live-data verification read-only inside a `SET TRANSACTION READ ONLY` block. The 2 pre-existing failures in
`test/authOtpChallenge.test.js` + `test/batchASecurity.test.js` are unrelated — they're DB-backed and die at `lib/db.js:10` on
require (the shared-Neon guard).

**Verified end-to-end over real HTTP against Neon** (admin JWT, order احلام صبحي `82c8946f`): `edit-context` returns both
previously-hidden 3000-price cap lines; `PATCH .../details` on one of them returns `items_changed: 1` — the identical call
returned 400 «عنصر غير قابل للتعديل» before the fix — with `price_snapshot` still **3000** afterwards, confirming money is
untouched. A student-info PATCH returns `student_info_fields: ["instagram_username"]`, i.e. the key is actually applied (it was
`[]` under the computed-key regression). Both write tests used the row's OWN current value, so no live data changed. Browser
renders all five ✎ affordances as admin. **Owner's own click-through still pending.**

## 2026-07-19 — Security fix LS-01: OTP is no longer a login on its own (branch `security-fixes`)

First item of the `SECURITY_AUDIT_REPORT_2026-07-16.md` plan. **The hole:** `POST /auth/resend-otp` was unauthenticated and let
the caller pick `{phone, purpose}`, and `login-verify`/`verify-otp` minted a JWT from `{phone, code}` with **no password check
and no role restriction** — so anyone who could read a victim's WhatsApp OTP logged in as them, admin included. Password+OTP
collapsed to OTP-only. **The fix:** the OTP row now carries a secret `challenge_id` + `user_id` (migration **066**, applied to
Neon, additive and backward compatible with the deployed old code). A challenge is issued only by a flow that already proved
something (correct bcrypt password for login; a just-created account for registration), and verification is addressed **by
challenge, never by phone** — the caller can't name the account it wants a token for. The phone-addressed
`verifyOtp(phone,code,purpose)` was deleted outright so no legacy path remains. Registration-verify additionally hard-refuses
any non-`retail` role. Resend now takes only a challenge and refreshes that row **in place** (same id — rotating it stranded
clients whose response was lost on a flaky network), metered by a new `sends` counter so it can't pump WhatsApp messages.
**Also closed** (found by the critic pass, same threat model): phone-OTP password reset used a stale deny-list, so `worker` and
`design_helper` — added by migrations 060/062 — could be taken over with one intercepted OTP; it's now an allow-list
(`retail`, `wholesaler` only). Side benefit: the unauthenticated "send a WhatsApp to any number" primitive is gone, which was a
Zentramsg sender-ban vector.

**Same session — batch 2.** **LS-04** the `?role=` catalog override was honoured for anyone, leaking the rep price book to
anonymous callers and (via `getShop`'s `audience`) wholesaler-only products to retail accounts → now admin + production
**managers** only, deliberately not every `role='staff'` since presser/tailor/embroiderer are denied money everywhere else.
**LS-10** NEW `backend/lib/password.js` applied at every `bcrypt.hash` site: **8-character minimum for everyone** (owner
decision — the audit's 12 for privileged accounts was rejected as too much friction) and banned shipped defaults.
**Enforced only when a password is SET — existing short passwords still log in** (test covers it).
`admin123`/`staff123`/`cust123`/`test1234` removed from all seed files; live DB scanned → **0 weak passwords across all 7
privileged accounts**. **LS-14** `getDesignByStudent` now enforces `staffScopeAllows` + strips the student phone for
non-designers (NB the endpoint has no frontend caller — the `designs` table is dead). **LS-15** health no longer returns raw
driver errors. **LS-16** `poweredByHeader: false` + anti-framing/nosniff/referrer/permissions headers; **CSP + HSTS left for
nginx** with the server move.

**Email removed entirely** (owner): SMTP was never configured in prod so the flow was already dead, and it carried a
reset-token endpoint + nodemailer (3 of the audit's high-severity advisories) for nothing. Registration and referral join no
longer take an email; `/auth/forgot-password`, `/auth/reset-password`, `lib/email.js` and `/reset-password/[token]` are gone.
Privileged accounts are reset by an admin or with the NEW `npm run set-password` — that script is why removing email doesn't
strand the admin account. **Registration errors now name the failing field** (`{error, code, field}` → the form pins the
message under the right input) instead of a blanket «تعذّر إنشاء الحساب».

Gates: `node --check` 0 · **backend tests 38/38** (23 new, six-role matrix + legacy-password login) · **live HTTP e2e 14/14 on
Neon, self-cleaned** · anonymous catalog payloads byte-identical · health verified against a dead DB · tsc 0 · eslint 0.
Committed to branch `security-fixes` (`7571497`). **NOT pushed — prod is still fully vulnerable until it is.** Browser
walkthrough pending. See HANDOFF.

**Sequencing note:** LS-03 (DB TLS) and the nginx half of LS-06 are deliberately deferred to the server migration (~2026-07-21,
DB moves to the new box — the Neon-CA fix would be wrong there), and **LS-02 secrets rotation should ride with it** since env
vars are being re-created anyway. That move is also the chance to finally split dev from prod (they share one Neon DB today).

## 2026-07-18 — Season scaling prep: caching · polling calm-down · pg-boss calligraphy worker · infra dials

Prep for the months 8–10 joining season (referral spikes of +1000 students in minutes). ① **In-process TTL cache**
(`backend/lib/memoCache.js`): join-code lookup 60s, full-set packages + rep pricing 60s (approval/existing-order reads stay
live), storefront shop/product feeds 120s keyed per audience+role, promo setting 60s — with immediate invalidation on admin
edits (التسعيرة del, promo del, and a route-level hook that clears catalog cache on ANY successful admin catalog mutation).
Money/settlement is never cached. ② **Polling**: waiting-screen approval poll 12s→45s±10s jitter, bell 30s→60s±15s (hidden
tabs already skip). ③ **Calligraphy generates server-side**: pg-boss queue on the existing Neon DB + new PM2 `loloshop-worker`;
the browser only watches progress (close the tab, plates keep generating); 2-min-stall watchdog falls back to the old client
loop. `processNext` logic extracted verbatim to `lib/calligraphyEngine.js` (shared, behavior unchanged). ④ **Dials**: DB pool
10→25, SLOW QUERY log >500ms, PM2 memory caps 800M/1G/500M. **Owner decisions:** rate limits UNCHANGED (accepted CGNAT risk +
documented emergency valve), no «تحقق الآن» button, monitoring developer-only, dev-DB split + CI builds deferred. Gates:
node --check 0 · unit 5/5 · tsc 0 · eslint 0 · live e2e on Neon 40/41 (1 = wrong test expectation, documented), self-cleaned.
Runbook: `docs/ops/2026-07-18-season-rollout.md`. NOT pushed. See HANDOFF.

## 2026-07-17 (d) — حذف = piece-only · admin/مدير الإنتاج order edit (full طقم + quick ✎) · custom order to existing student

① **Delete now removes ONE piece**, not the whole bundle: both `DELETE /production/orders/:id` and `/admin/orders/:id` delete the
single order row (items cascade), keep siblings, and drop the checkout_group only when the last piece goes. UI copy updated
(«حذف القطعة»). ② **Order editing for admin + manager** (new `orderEditController`, mounted under /api/production behind
`requireStaffType()`): «تعديل الطلب» button on the order page opens `/staff/orders/[id]/edit` — the rep's FullSetOrderForm
pre-filled + student info (name/IG/phones); the save goes through `persistFullSetOrder` then **restores the bundle's rep-approval
state exactly** (approved stays approved, NULL stays NULL — an admin edit can never hide an order in pending). Quick ✎ edits on
spec-line texts + instagram on ANY order via `PATCH /production/orders/:id/details`. ③ **Custom order → existing student**: both
`/admin/custom-order` and NEW `/staff/custom-order` (manager, «طلب مخصص» sidebar link) share `components/staff/CustomOrderForm`
with a طالب جديد/طالب موجود toggle; picking a student pre-fills their طقم (upsert = edit, never duplicate). Retail self-registered
students are excluded from search AND rejected server-side (their cart bundles must never be re-priced by the طقم form). Gates:
`node --check` 0 · `tsc` 0 (source) · `eslint` 0 · **live e2e on Neon 38/38, self-cleaned**. Browser walkthrough = user
(TESTING-WALKTHROUGH.md §2026-07-17). See HANDOFF.

## 2026-07-17 (c) — Navigation batch: state-restore on 5 screens · multi-role sidebar · orphan pages deleted

Full-app navigation audit + fixes. ① **State restoration** (the «forgets your place on back» bug, same class fixed for the
stations on 07-16) ported to 5 more screens via the same sessionStorage mirror pattern: `/staff/queue` (rail/source/rep/batch/
zone/search/page — the URL-driven dims restore via router.replace), `/admin/orders` (all ~12 filters + sort; `?wholesaler=` URL
still wins + the click-a-rep approval default preserved), rep bulk console (tab/zone/view/search + **checkbox selection**, pruned
after first fetch), `QueueView` on `/staff`, and `CalligraphyTool` (chips/رep filters/search/sticky-bar). ② **Sidebar multi-role
fix**: nav links now merge across `staff_types[]` (tailor+embroiderer sees both قائمة التطريز AND الفصال); role label shows all
roles joined. ③ **Orphans deleted**: `/verify-otp` (+`VerifyOtpForm`), `/wholesaler/batch`, `/wholesaler/package`,
`/admin/wholesalers/[id]/students` (dead duplicate — admin uses the staff console route); robots.ts + sitemap cleaned (sitemap
advertised nonexistent `/showcase`). Gates: `tsc` 0 · `eslint` 0. Browser walkthrough = user. See HANDOFF 2026-07-17 (c).

## 2026-07-17 (b) — Designer sees full student info (phone + instagram + intake) on the order page

Per user: designers contact students to confirm designs, so the PII-lean strip no longer applies to them. In
`productionController.getOrder`: `canSeeContact` now includes any staff with the `designer` type (sole or multi-role), and the
lean intake-null skips designers — they get the full intake card (customer name, phones, instagram, governorate, event date,
notes). Money stays hidden (price + intake.deposit still stripped by canSeeMoney). No FE change needed — the «بيانات الطالب» card
already renders contact rows when the backend supplies them. Verified over real HTTP with a real designer JWT (مضر محمد): phone +
instagram + intake present, price/deposit absent. Note: designers do NOT have the StationConsole — they still use the flat
QueueView on `/staff` (console is التطريز/الفصال/الكوي only).

## 2026-07-17 — Owner money rules locked + repairs: شال=20k admin · cost backfill +682k · retail duplicate-proofing

Owner locked the settlement rule (admin gets all except package margin + شال margin; شال admin = 20,000 for every rep). Applied:
config repair (باقر/أنس flat شال → pairs), cost backfill on 47 orders (+682k admin due, 0 rule violations / 0 cost>price after),
pin+self-heal ported to retail `configureFullSet`/`configurePackage` (scoped `package_id IS NOT NULL`, cart never touched),
rep-card counts stopped counting cancelled. 141 vs 148 explained (141 approved + 3 pending + 4 rejected). See HANDOFF 2026-07-17.

## 2026-07-16 (c) — Money audit: cancelled rows no longer counted in rep/admin/batch totals · cost drift quantified

Post-repair audit (invariant scans + critic). Fixed 3 «cancelled orders summed into money» bugs: rep approval list
(`listOrdersForApproval` — the repaired students showed 180k until this), admin bundle totals (`listOrders` group=bundle, cancelled
pieces stay visible but uncounted), batch student totals (`getBatch`, consistency — 0 batches in DB). Verified over real HTTP.
NOT fixed (reported, pending user): 42 pre-Jul-15 orders understate admin cost by 722k IQD (old code dropped addon-admin) + 3 with
cost>price; retail `configureFullSet`/`configurePackage` still carry the featured-drift duplicate class; محمد باقر legacy flat
التسعيرة (shawl admin=selling=30k). See HANDOFF 2026-07-16 (c).

## 2026-07-16 (b) — FIX: wholesaler edit duplicated the sash order (38 bundles, +2.6M IQD phantom)

Root cause: the طقم form stopped sending `package_id`, so `fullSetOrder.js` resolved each piece to the *first active product per
type* (`featured DESC`). When «وشاح الفراشة» went featured on 2026-07-06 the sash re-resolved to a different product id on every
EDIT of an older order → the (student, product) upsert missed → a **second live sash order** was inserted (65+65=130k, 90+90=180k…).
Fix in `backend/lib/fullSetOrder.js`: existing live order now **pins the product per piece type** on edit; deselect-cancel is
type-based within the bundle; post-upsert **self-heal** cancels any second live same-type order in the checkout group. Data repair
on Neon: 38 stale sash orders cancelled (audit_log `repair_duplicate_sash`), 1 lost شال photo restored, 0 duplicate bundles remain.
Verified: repro script FAIL→PASS + self-heal PASS (self-cleaning, live DB) · `node --check` 0. **Uncommitted; prod still has the
buggy code until next push — re-run the duplicate scan after deploy.**

## 2026-07-16 — Station console: «عرض بالطلب» / «عرض بالقطع» for التطريز · الفصال · الكوي

One shared `StationConsole` (spec `docs/superpowers/specs/2026-07-16-station-console-two-view-modes-design.md`) replacing the flat
per-order lists on the three stations, supporting both real work modes:
1. **«عرض بالطلب»** (default) — students-only list (name + N قطعة + X/Y مناطق + متأخر) → tap → full-screen sheet with the student's
   pieces: inline **zone checkboxes with the stitch text + plate thumbnail** (التطريز), or one «تم الفصال»/«إنهاء الكوي» button per
   piece. All zones done → the piece auto-advances (existing engine) and stays visible as a green ✓ row.
2. **«عرض بالقطع»** — flat work items: **zone chips with pending counts** (التطريز: كل يمين، ثم كل يسار…) or **piece-type chips**
   (الفصال/الكوي: وشاح/روب/شال), tap-to-select rows + sticky bulk bar. NEW `POST /production/embroidery-zone-bulk` (same guards as
   the single tick, per-item skip-and-report, auto-advance). الفصال gets a third «المنجزة» view (search + إرجاع).
3. Backend: `getQueue?station=1` enrichment — per-order `zones` (batched `detectZonesForOrders`, one order_items query, text+image
   content, شال امريكي still excluded) + backend-granted `can_advance`/`advance_label` on الكوي rows + `student_id` everywhere
   (also on tailor-queue). State machine untouched; الفصال stays parallel + retail-only; manager `/staff/queue` untouched.
Verified: BE `node --check` 0 · FE `tsc` 0 · `eslint` 0 · live API smoke (30 embroidery rows all carrying zones w/ plate URLs,
15/15 pressing rows granted, bulk validation 400, no raw jsonb leak). **Browser testing = user** (tokens + steps appended to
`TESTING-WALKTHROUGH.md`, untracked). Uncommitted→committed locally, NOT pushed.

## 2026-07-15 — Pipeline rework: stage-2 deleted · «بانتظار التصميم» · calligraphy workbench · كوي station + routing

Whole staff pipeline reshaped (committed locally, **NOT pushed/deployed**; spec `docs/superpowers/specs/2026-07-15-staff-pipeline-labels-calligraphy-stations-design.md`):
1. **Label**: `design_complete` now renders **«بانتظار التصميم»** everywhere (was the lying «اكتمل التصميم»).
2. **Stage-2 «تحويل التصميم لتطريز» DELETED** from the live pipeline — design goes straight to التطريز (advance + both approve flows + design-team desk). `converting` kept drain-only (0 rows at cutover; re-drain after deploy).
3. **Calligraphy workbench**: plates **auto-attach** to their order line on generation («ربط بالطلب» removed); grid **grouped by student/order** with zone ✓/✗ chips, clickable student → the order (`?from=` back), order-level **«تحويل للتطريز»** button (admin/designer/manager only — the real state machine), sticky filter bar (status/ممثل/بحث), **«تنزيل إلى مجلد…»** (folder picker, ZIP fallback), ممثل filter on the auto queue, **cap-side** 4th zone (migration 065, applied).
4. **الكوي**: gets **every order except caps** — plain sash/robe/shawl now START at pressing (all 5 creation paths); dedicated minimal station (name + product photo + design gallery + sizes/قياسات + advance), design images unblocked server-side, contact/money still stripped.
5. **Orders page**: final-design upload + preview + red nag **removed**; new shared `DesignGallery` (zone images + legacy final design, fullscreen + تنزيل) on the full view + كوي station. Queue «تصميم مفقود» now counts plate images (`has_design_images`).

Verified: BE `node --check` all · FE `tsc` 0 / `eslint` 0 · self-cleaning e2e **25/25** on Neon (send happy/409/403-gate, auto-link catch-up, presser visibility, state-machine edges) · live HTTP smoke (queue 4 zones incl cap_side=175 real pending; plates carry order context). Browser testing deferred to user (tokens + walkthrough in `TESTING-WALKTHROUGH.md`, untracked).

New standalone module tracking garment **quantities** through the Syrian workshop (قص → أوفرلوك/قبعة → خياطة/تسكير) and paying workers **per piece** — separate from the Team-A order pipeline; **no auto-handoff to Team A** (deferred), `orders` untouched. Migration **060** (applied to Neon): `worker` role + 6 `workshop_*` tables. Backend `workshopController.js` + `/api/workshop` (secret-URL portal no-OTP, runs/assignments, **append-only ledger with frozen rate**, reconciliation warnings, payments/balance). Frontend: Syrian-dialect worker portal (`/w/[key]`) + worker screen (`/workshop`), admin dashboard (`/admin/workshop`: overview/runs/workers/rates) + sidebar link. Identity: workers are `users role='worker'`; ابو عبدو linked from his existing staff user (فصال screen untouched). Verified: BE e2e **22/22** on Neon + HTTP smoke (200s / key-gate) + browser (portal + admin overview + run-detail reconciliation, console clean); FE `tsc`/`eslint` 0. **Uncommitted, not deployed.** ⚠️ Set `WORKSHOP_PORTAL_KEY` in prod `.env`. Demo «(تجريبي)» data left in DB (see HANDOFF). Spec: `docs/superpowers/specs/2026-07-10-workshop-team-b-design.md`.

## 2026-07-07 — Back-nav fix · calligraphy preview+designer · money-gate · freestyle TV

Four items (uncommitted on main, not deployed — see HANDOFF for detail):
1. **Order back button** returns to origin (`?from=` + same-origin referrer fallback; open-redirect hardened) instead of always the dashboard. 6 entry points + order page.
2. **Calligraphy AI preview** now closable (overlay portaled to `document.body`); tool extracted to shared `CalligraphyTool`.
3. **Calligraphy AI opened to designers** (`/staff/calligraphy` + sidebar link; backend `requireStaffType('designer')`).
4. **Money-gate**: revenue/profit hidden by default on `/admin` + `/tv`, revealed by a disguised 🎓 + secret passphrase (stripped server-side on TV via `x-tv-reveal` header; hashed in `site_settings.money_gate`, min 8, rate-limited). **TV freestyle-redesigned** into a full-screen scene cinema (6 rotating money-free scenes + old Iraq map kept + money scene only while revealed, auto-hides 90s). Dashboard money masked + new non-money charts (orders-trend, pipeline).

Verified: FE `tsc` 0 · `eslint` 0 · BE `node --check` OK; TV + dashboard driven live in-browser; money-gate server-side confirmed (no-reveal/wrong→null, correct→figures). Passphrase `lolo2026` (change before deploy — dev+prod share the DB). Critic-reviewed; hardening fixes applied.

## 2026-07-07 — Homepage trust-first feed (above طقم التخرج الكامل)

Replaced the five stacked marketing bands (`ShopCover`, `AtelierStory`, `MilestoneStory`, `DesignProcess`) with a single Instagram-native trust scroll (`HomeTrustStory.tsx`): full-bleed opening grad photo, vertical photo feed with captions, short craft copy, soft CTA link to `#catalog`. `VipHomeBand` restyled as a feed post (square photo, caption below, no heavy card). `FullSetBand` + catalog + store location unchanged. Approval mockup: `design-mockups/trust-feed/index.html`.


- Retail robe + full-set wizard: sleeve embroidery toggles grouped under a visible **«ردن الروب»** card with larger checkboxes (الردن الأيمن / الأيسر) instead of buried per-group fieldsets.

## 2026-07-02 — Wholesaler custom order + shawl notes

- **Edit fix:** `persistFullSetOrder` now normalizes `student.phone ?? ''` so editing name-only custom orders no longer 500s on `checkout_groups.phone_primary NOT NULL`.
- **Custom order confirmation:** removed auto-approve from `quickFullSetOrder` — custom orders stay `pending` until the rep confirms from «طلبات الطلاب». FE: updated copy, redirect to pending orders, «تعديل» link + «تأكيد وإرسال للإنتاج» on pending rows.
- **Shawl notes:** migration `058_retail_shawl_notes.sql` adds optional «ملاحظات» prompts to top-level shawl products; retail product page renders notes textarea alongside optional photo for `type=shawl`; `seed-v2.js` updated for fresh installs.

Verified:
- Backend `node --check` on `fullSetOrder.js`, `wholesalerController.js`.
- Migration 058 applied to Neon.
- Frontend `npx tsc --noEmit` 0.

## 2026-07-02 — Retail cap/robe form improvements

- Removed generic retail cap photo group «صورة القبعة» (migration 050 superseded).
- Cap «القبعة من الجانب» / «القبعة من الأعلى»: when student picks «بكتابة», text is required and reference photo is optional.
- Robe «ردن الروب» single-select replaced with optional left/right sleeve toggles (+5,000 د.ع each) with required text + optional photo per checked sleeve.
- محيط الصدر is now optional on retail product page and retail full-set wizard (range-checked when provided).
- Migration `057_retail_cap_robe_form.sql` + `seed-full-set.js` updated for fresh installs.

Verified:
- Backend `node --check` on `orderController.js`, `seed-full-set.js`.
- Frontend `npx tsc --noEmit` 0.

## 2026-06-29 — Staff attendance separated from salary

- Separated «بصمة الموظف» from salary: staff now have an independent `/staff/attendance` page/link, while `/staff/me` is salary/activity only.
- `/staff` now shows only the compact attendance button for all staff role dashboards; the full attendance card stays on `/staff/attendance`.
- Attendance check-in no longer creates salary deduction transactions, and salary summaries ignore older attendance-sourced transactions.
- Added admin-controlled per-staff exemption via `/admin/attendance`: each employee can be marked «مطلوبة» or «معفى» from attendance.
- Applied migration `054_attendance_exemptions.sql` to the configured database.

Verified:
- Backend syntax checks for touched controllers/routes.
- Frontend `npm run lint`.
- Frontend `npx tsc --noEmit`.
- Verified `staff_attendance_user_settings.attendance_required` exists in DB.
- Browser-smoked `/staff` after clearing the PWA service worker cache: only the compact attendance button appears before «مراجعة التصاميم».

## 2026-06-29 — Google Play readiness pages + PWA shell

- Added public Arabic policy pages for Google Play review: `/privacy`, `/terms`, and `/delete-account`.
- Linked `/privacy` and `/terms` from the shared public/student footer, with `/delete-account` linked from the privacy policy page for Google Play account-deletion access.
- Added a reusable legal page layout and included the policy routes in the public sitemap.
- Added PWA registration, `public/sw.js`, and `public/offline.html` so the app has an install/offline fallback shell.
- Expanded `manifest.json` with `scope`, portrait orientation, and store categories.
- Added `/.well-known/assetlinks.json` as an env-driven Next route for Trusted Web Activity verification.
- Added `frontend/.env.example` entries for `NEXT_PUBLIC_API_URL`, `ANDROID_PACKAGE_NAME`, and `ANDROID_SHA256_CERT_FINGERPRINTS`; updated frontend `.gitignore` so the example file can be committed.

Verified:
- Frontend `npm run lint`.
- Frontend `npm run build`.

Open:
- After creating/uploading the Android App Bundle in Play Console, copy the Play App Signing SHA-256 into `ANDROID_SHA256_CERT_FINGERPRINTS` and redeploy so `https://lolo-shop96.com/.well-known/assetlinks.json` returns the real Digital Asset Links JSON instead of 404.
- Still need Android/TWA wrapper generation with Bubblewrap, Play Console store listing assets, Data safety form, reviewer test access, and closed testing if the account requires it.

## 2026-06-29 — Staff attendance, payroll removal, admin custom orders

- Added staff attendance / «بصمة الموظفين» model and APIs: admin-controlled shift times, grace minutes, per-minute late deduction, network/location verification settings, staff check-in/check-out, attendance records, and override support.
- Added per-staff attendance overrides so each employee can have a custom arrival/departure time, grace window, and per-minute deduction while others keep the default schedule.
- Initially connected late attendance markers to payroll ledger entries; superseded above by the attendance/salary separation.
- Added admin removal for manual «حافز» and «خصم» transactions.
- Added admin custom order creation using the existing full-set order form/persistence, with optional wholesaler attachment.
- Added frontend pages/entry points for `/admin/attendance`, `/admin/custom-order`, and staff self-service attendance on `/staff/me`.

Verified:
- Applied migration `052_staff_attendance.sql` to the configured database.
- Applied migration `053_staff_attendance_user_settings.sql` to the configured database.
- Backend smoke script passed for attendance check-in, manual salary transaction removal, and admin custom order creation (temporary data cleaned up).
- Backend smoke script passed for per-staff attendance override: default 9:00, staff override 10:00, check-in record used 10:00.
- Backend syntax checks for touched controllers/routes.
- Frontend `npm run lint`.
- Frontend `npx tsc --noEmit`.

Open:
- Browser smoke test still needed for staff check-in/out, admin attendance settings, payroll transaction removal, and admin custom order creation.
