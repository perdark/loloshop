/* Shared mock data for the /staff/queue design mockups — sized for SCALE (160+ live
   production orders), so the dense-table + rep/batch drill-down directions are realistic.
   Mirrors the real ProductionQueueItem shape. RTL Arabic. Deterministic (seeded) so every
   mockup shows the exact same data and reloads are stable. */
(function () {
  // ── seeded PRNG (stable across reloads) ──
  let _s = 20260618;
  const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const wpick = (items) => { // weighted by .w
    const t = items.reduce((s, x) => s + x.w, 0); let r = rnd() * t;
    for (const x of items) { if ((r -= x.w) <= 0) return x; } return items[items.length - 1];
  };

  const STAGES = [
    { key: 'design_complete', label: 'اكتمل التصميم', short: 'التصميم', w: 18, done: false },
    { key: 'converting',      label: 'تحويل لتطريز',   short: 'تحويل',   w: 11, done: false },
    { key: 'embroidery',      label: 'قيد التطريز',    short: 'تطريز',   w: 30, done: false },
    { key: 'pressing',        label: 'قيد الكوي',      short: 'كوي',     w: 13, done: false },
    { key: 'preparing',       label: 'قيد التجهيز',    short: 'تجهيز',   w: 16, done: false },
    { key: 'ready',           label: 'جاهز للاستلام',  short: 'جاهز',    w: 20, done: true  },
  ];

  // Embroidery-zone / pleat filter keys (mirrors EMBROIDERY_ZONE_LABELS).
  const ZONES = [
    { key: 'sash_right', label: 'وشاح يمين',  for: 'sash' },
    { key: 'sash_left',  label: 'وشاح يسار',  for: 'sash' },
    { key: 'sash_back',  label: 'وشاح خلف',   for: 'sash' },
    { key: 'cap_side',   label: 'قبعة جانب',  for: 'cap'  },
    { key: 'cap_top',    label: 'قبعة أعلى',  for: 'cap'  },
    { key: 'robe_pleat', label: 'روب كسرات',  for: 'robe' },
  ];

  const REPS = [
    { id: 'r1', name: 'مكتب النور للتخرج', batches: ['دفعة نيسان', 'دفعة أيار'] },
    { id: 'r2', name: 'ممثل الفرات',        batches: ['دفعة أيار'] },
    { id: 'r3', name: 'مكتب الرافدين',      batches: ['دفعة آذار', 'دفعة نيسان'] },
    { id: 'r4', name: 'مكتب الجامعة',       batches: ['دفعة شباط', 'دفعة آذار'] },
    { id: 'r5', name: 'ممثل المستقبل',      batches: ['دفعة أيار'] },
  ];

  const FIRST = ['سارة','مريم','زينب','فاطمة','نور','رقية','آلاء','تبارك','حوراء','دعاء','مروة','رفل','بنين','زهراء','شهد','ضحى','إيمان','هبة',
    'علي','حسين','عبد الله','محمد','يوسف','كرار','مصطفى','حيدر','أحمد','عمر','باقر','سجاد','مرتضى','حمزة','عباس','أمير','منتظر','سيف'];
  const LAST = ['الجبوري','الكناني','التميمي','الموسوي','العبيدي','الدليمي','الزيدي','الساعدي','الشمري','العزاوي','الربيعي','الخفاجي','المالكي','الحسناوي','البدري','الطائي','العامري'];
  const UNIS = ['جامعة بغداد','الجامعة المستنصرية','جامعة البصرة','جامعة الموصل','جامعة الكوفة','الجامعة التكنولوجية','جامعة كربلاء','جامعة بابل','جامعة الأنبار','جامعة ذي قار','جامعة القادسية','جامعة ديالى'];
  const DEPTS = ['هندسة الحاسوب','طب الأسنان','القانون','الصيدلة','إدارة الأعمال','علوم الحاسوب','الهندسة المدنية','الطب','التمريض','العمارة','المحاسبة','الإعلام','علوم الحياة','اللغة الإنجليزية','الفيزياء'];
  const STAFF = ['مضر محمد','محمد عماد','محمد عادل','علي حسن','زينب كريم'];

  const zoneFor = (type) => {
    const opts = ZONES.filter((z) => z.for === type);
    return opts.length ? pick(opts).key : 'sash_right';
  };

  const orders = [];
  let id = 1000;
  // ~160 orders: build student-by-student; ~22% are full bundles (وشاح+روب+قبعة).
  const TARGET = 168;
  let gi = 0;
  while (orders.length < TARGET) {
    const student = `${pick(FIRST)} ${pick(LAST)}`;
    const uni = pick(UNIS), dept = pick(DEPTS);
    const isWholesaler = rnd() < 0.74;
    const rep = isWholesaler ? pick(REPS) : null;
    const batch = rep ? pick(rep.batches) : null;
    const source = isWholesaler ? 'wholesaler' : 'retail';
    const bundle = rnd() < 0.22;
    const gid = bundle ? `g${++gi}` : null;
    const pieces = bundle ? ['sash', 'robe', 'cap'] : [pick(['sash', 'sash', 'sash', 'robe', 'cap'])];
    for (const type of pieces) {
      const st = wpick(STAGES).key;
      const working = rnd() < 0.16 ? pick(STAFF) : null;
      // time in stage (minutes) — most fresh, a tail of overdue.
      const mins = rnd() < 0.16 ? 90 + Math.floor(rnd() * 220) : Math.floor(rnd() * 80);
      // missing final design: reached embroidery+ but no final design (rare).
      const reached = ['embroidery', 'pressing', 'preparing', 'ready'].includes(st);
      const missing = reached && type === 'sash' && rnd() < 0.06;
      orders.push({
        id: ++id, student, uni, dept,
        product: type === 'sash' ? 'وشاح' : type === 'robe' ? 'روب' : 'قبعة',
        type, stage: st, source,
        rep: rep ? rep.name : null,
        batch, working, mins, group: gid, missing,
        zone: type === 'sash' ? zoneFor('sash') : type === 'cap' ? zoneFor('cap') : 'robe_pleat',
      });
      if (orders.length >= TARGET + 2) break;
    }
    gi++;
  }

  // compute live rep counts from generated orders
  const reps = REPS.map((r) => {
    const mine = orders.filter((o) => o.rep === r.name);
    return {
      id: r.id, name: r.name, batches: r.batches,
      orders: mine.length,
      ready: mine.filter((o) => o.stage === 'ready').length,
    };
  });

  window.QUEUE_DATA = {
    stages: STAGES,
    zones: ZONES,
    sources: { retail: 'تجزئة', wholesaler: 'ممثلين' },
    orders,
    reps,
    total: orders.length,
  };
})();
