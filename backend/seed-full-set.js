// LoloShop full-set seed — the real Instagram order-form fields as admin-managed
// option groups on robe / cap / sash, plus a sample full-set package (طقم التخرج الكامل).
//
// Source of truth: the actual order form used on @loloshop96 DMs —
//   الروب: اللون، القماش (كوبرا اندنوسي)، الفصال (ملكي)، الردن سادة/بكتابة + القياسات
//   القبعة: اللون، الشكل (عادية/مثلثة)، الجانب سادة/بكتابة، الأعلى سادة/بكتابة
//   الوشاح: اللون، النوع، العرض (يفضل ١٤-١٥ سم)، لون التطريز
//   (نصوص الوشاح يمين/يسار/خلف تُجمع في معالج الطلب وتُخزن كأسطر order_items — ليست خيارات)
//
// Idempotent: groups matched by (product_id, name_ar); options by (group_id, label_ar).
// Superseded placeholder groups are DEACTIVATED (active=FALSE, reversible from the admin
// catalog), never deleted. Run: npm run seed:fullset
require('dotenv').config();
const { query, pool } = require('./lib/db');

// Per product type: groups to ensure + legacy groups to deactivate.
const FORM_GROUPS = {
  robe: {
    deactivate: ['تطريز الأكمام (ردان)'], // replaced by the explicit ردن الروب question below
    groups: [
      { name_ar: 'لون الروب', input_type: 'single_select', required: true, has_image: true,
        options: ['أسود', 'كحلي', 'أبيض', 'عنابي', 'أخضر داكن', 'رمادي'].map((l) => ({ label_ar: l })) },
      { name_ar: 'فصال الروب', input_type: 'single_select', required: true, has_image: true,
        hint_ar: 'الفصال الملكي أوسع وأفخم',
        options: [{ label_ar: 'ملكي' }, { label_ar: 'عادي' }] },
      { name_ar: 'ردن الروب', input_type: 'single_select', required: true, has_image: false,
        hint_ar: 'كتابة مطرزة على الردن أو سادة',
        options: [
          { label_ar: 'سادة' },
          { label_ar: 'بكتابة', price_delta: 5000, requires_customer_text: true },
        ] },
    ],
    // real fabrics → appended to نوع القماش when it exists (seed-v2 DBs), otherwise a
    // fresh قماش الروب group is created (see fallbackGroups handling below).
    appendOptions: [{
      group_ar: 'نوع القماش',
      fallbackGroup: { name_ar: 'قماش الروب', input_type: 'single_select', required: true, has_image: true },
      options: [
        { label_ar: 'كوبرا اندنوسي', price_delta: 0 },
        { label_ar: 'كوبرا كوري', price_delta: 5000 },
      ],
    }],
  },
  cap: {
    deactivate: ['تطريز القبعة'], // replaced by the two explicit side/top questions below
    groups: [
      { name_ar: 'لون القبعة', input_type: 'single_select', required: true, has_image: true,
        options: ['أسود', 'كحلي', 'أبيض', 'عنابي'].map((l) => ({ label_ar: l })) },
      { name_ar: 'الشكل', input_type: 'single_select', required: true, has_image: false,
        options: [{ label_ar: 'عادية' }, { label_ar: 'مثلثة' }] },
      { name_ar: 'القبعة من الجانب', input_type: 'single_select', required: true, has_image: false,
        options: [
          { label_ar: 'سادة' },
          { label_ar: 'بكتابة', price_delta: 3000, requires_customer_text: true },
        ] },
      { name_ar: 'القبعة من الأعلى', input_type: 'single_select', required: true, has_image: false,
        hint_ar: 'مثال: {وَمَا تَوْفِيقِي إِلَّا بِاللَّه}',
        options: [
          { label_ar: 'سادة' },
          { label_ar: 'بكتابة', price_delta: 3000, requires_customer_text: true },
        ] },
    ],
    appendOptions: [],
  },
  sash: {
    deactivate: ['تصميم من الخلف'], // back content now: canvas (designer path) or back text (form path)
    groups: [
      { name_ar: 'نوع الوشاح', input_type: 'single_select', required: true, has_image: true,
        options: [{ label_ar: 'عادي' }, { label_ar: 'ملكي', price_delta: 5000 }] },
      { name_ar: 'عرض الوشاح', input_type: 'single_select', required: false, has_image: false,
        hint_ar: 'يُفضّل ١٤–١٥ سم',
        options: [{ label_ar: '١٢ سم' }, { label_ar: '١٤ سم' }, { label_ar: '١٥ سم' }] },
      { name_ar: 'لون التطريز', input_type: 'single_select', required: false, has_image: true,
        options: ['ذهبي', 'أسود', 'أبيض', 'فضي', 'كحلي'].map((l) => ({ label_ar: l })) },
    ],
    appendOptions: [{ group_ar: 'اللون', options: [
      { label_ar: 'برتقالي' },
      { label_ar: 'رمادي فاتح' },
    ] }],
  },
};

const SAMPLE_PACKAGE = {
  name_ar: 'طقم التخرج الكامل',
  price: 95000,
  description: 'روب + قبعة + وشاح بمواصفاتك الكاملة — السعر شامل التوصيل لجميع المحافظات، والدفع كاش عند الاستلام.',
  badge_label: 'طقم كامل',
  features: ['تفصيل حسب قياساتك', 'تطريز الاسم والشعار', 'توصيل لجميع المحافظات', 'دفع كاش عند الاستلام'],
  included_items: ['روب تخرج بقياساتك', 'قبعة تخرج', 'وشاح مطرز بالاسم والشعار'],
};

async function productIdByType(type) {
  const { rows } = await query(
    `SELECT id, name_ar FROM products
     WHERE type = $1 AND active = TRUE AND parent_id IS NULL
     ORDER BY featured DESC, sort, created_at LIMIT 1`,
    [type]
  );
  return rows[0] || null;
}

async function ensureGroup(productId, g, sortBase) {
  const found = await query(
    `SELECT id FROM option_groups WHERE product_id = $1 AND name_ar = $2`,
    [productId, g.name_ar]
  );
  let gid;
  if (found.rows.length) {
    gid = found.rows[0].id;
    console.log(`   = group exists: ${g.name_ar}`);
  } else {
    const { rows } = await query(
      `INSERT INTO option_groups
         (product_id, name_ar, input_type, sort, required, has_image, hint_ar, max_select)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1) RETURNING id`,
      [productId, g.name_ar, g.input_type, sortBase, !!g.required, !!g.has_image, g.hint_ar || null]
    );
    gid = rows[0].id;
    console.log(`   + group: ${g.name_ar}`);
  }
  await ensureOptions(gid, g.options);
  return gid;
}

async function ensureOptions(groupId, options) {
  for (let oi = 0; oi < options.length; oi++) {
    const o = options[oi];
    const found = await query(
      `SELECT id FROM options WHERE group_id = $1 AND label_ar = $2`,
      [groupId, o.label_ar]
    );
    if (found.rows.length) { console.log(`     = option exists: ${o.label_ar}`); continue; }
    await query(
      `INSERT INTO options (group_id, label_ar, price_delta, sort, requires_customer_text, requires_customer_image)
       VALUES ($1,$2,$3,$4,COALESCE($5,FALSE),COALESCE($6,FALSE))`,
      [groupId, o.label_ar, o.price_delta || 0, oi, o.requires_customer_text || false, o.requires_customer_image || false]
    );
    console.log(`     + option: ${o.label_ar}${o.price_delta ? ` (+${o.price_delta})` : ''}`);
  }
}

async function seedProductForms() {
  for (const [type, spec] of Object.entries(FORM_GROUPS)) {
    const prod = await productIdByType(type);
    if (!prod) { console.warn(`! no active ${type} product — skipped (run seed:v2 first)`); continue; }
    console.log(`▸ ${type}: ${prod.name_ar}`);

    for (const legacyName of spec.deactivate) {
      const { rows } = await query(
        `UPDATE option_groups SET active = FALSE
         WHERE product_id = $1 AND name_ar = $2 AND active = TRUE RETURNING id`,
        [prod.id, legacyName]
      );
      if (rows.length) console.log(`   − deactivated legacy group: ${legacyName} (reversible from admin catalog)`);
    }

    const { rows: maxSort } = await query(
      `SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM option_groups WHERE product_id = $1`, [prod.id]
    );
    let sort = maxSort[0].next;
    for (const g of spec.groups) await ensureGroup(prod.id, g, sort++);

    for (const app of spec.appendOptions) {
      const grp = await query(
        `SELECT id FROM option_groups WHERE product_id = $1 AND name_ar = $2`,
        [prod.id, app.group_ar]
      );
      if (grp.rows.length) {
        console.log(`   ▸ appending to ${app.group_ar}:`);
        await ensureOptions(grp.rows[0].id, app.options);
      } else if (app.fallbackGroup) {
        await ensureGroup(prod.id, { ...app.fallbackGroup, options: app.options }, sort++);
      } else {
        console.warn(`   ! group "${app.group_ar}" not found — options skipped`);
      }
    }
  }
}

async function seedFullSetPackage() {
  const exists = await query(
    `SELECT id FROM packages WHERE name_ar = $1 AND is_full_set = TRUE`, [SAMPLE_PACKAGE.name_ar]
  );
  if (exists.rows.length) { console.log(`= package exists: ${SAMPLE_PACKAGE.name_ar}`); return; }
  const { rows } = await query(
    `INSERT INTO packages
       (name_ar, role, price, active, is_full_set, description, badge_label, features, included_items)
     VALUES ($1, 'retail', $2, TRUE, TRUE, $3, $4, $5::jsonb, $6::jsonb) RETURNING id`,
    [
      SAMPLE_PACKAGE.name_ar, SAMPLE_PACKAGE.price, SAMPLE_PACKAGE.description,
      SAMPLE_PACKAGE.badge_label,
      JSON.stringify(SAMPLE_PACKAGE.features), JSON.stringify(SAMPLE_PACKAGE.included_items),
    ]
  );
  console.log(`+ package: ${SAMPLE_PACKAGE.name_ar} (${SAMPLE_PACKAGE.price}) → ${rows[0].id}`);
}

(async () => {
  try {
    await seedProductForms();
    await seedFullSetPackage();
    console.log('Done ✓');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
