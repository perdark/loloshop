// LoloShop v2 seed — products + admin-managed option groups/options with real prices.
// Idempotent: skips products that already exist (matched by type + name_ar).
// Run: npm run seed:v2
require('dotenv').config();
const { query, pool } = require('./lib/db');

// product spec: base_price + groups[{..., options:[{label_ar, price_delta, requires_customer_text?, requires_customer_image?, image?}]}]
const PRODUCTS = [
  {
    type: 'sash', name_ar: 'وشاح تخرج', description: 'وشاح تخرج فاخر', base_price: 30000, customizable: true,
    groups: [
      { name_ar: 'نوع الوشاح', input_type: 'single_select', required: true, has_image: true,
        options: ['مثلث', 'مثلث صغير', 'مثلث حاد', 'ملكي خماسي', 'عادي', 'منحني'].map((l) => ({ label_ar: l, price_delta: 0 })) },
      { name_ar: 'اللون', input_type: 'single_select', required: false, has_image: true,
        options: ['ماروني', 'أسود', 'أبيض', 'كحلي', 'أخضر داكن'].map((l) => ({ label_ar: l, price_delta: 0 })) },
      { name_ar: 'إطار', input_type: 'toggle', required: false, has_image: false,
        options: [{ label_ar: 'مع إطار', price_delta: 5000 }] },
      { name_ar: 'تصميم من الخلف', input_type: 'toggle', required: false, has_image: true,
        options: [{ label_ar: 'نعم', price_delta: 0 }] },
    ],
  },
  {
    type: 'cap', name_ar: 'قبعة تخرج', description: 'قبعة تخرج', base_price: 20000, customizable: false,
    groups: [
      { name_ar: 'الشكل', input_type: 'single_select', required: true, has_image: false,
        options: [{ label_ar: 'عادية', price_delta: 0 }, { label_ar: 'مثلثة', price_delta: 0 }] },
      { name_ar: 'تطريز القبعة', input_type: 'single_select', required: false, has_image: true,
        hint_ar: 'الأدمن يرفع صورة توضيحية للطلاب',
        options: [
          { label_ar: 'بدون', price_delta: 0, requires_customer_text: false, requires_customer_image: false },
          { label_ar: 'من الجانب', price_delta: 0, requires_customer_text: true, requires_customer_image: true },
          { label_ar: 'من الأعلى', price_delta: 0, requires_customer_text: true, requires_customer_image: true },
        ] },
      { name_ar: 'كسرات القبعة', input_type: 'toggle', required: false, has_image: false,
        options: [{ label_ar: 'مع كسرات', price_delta: 0 }] },
    ],
  },
  {
    type: 'robe', name_ar: 'روب تخرج', description: 'روب تخرج — السعر يبدأ حسب نوع القماش', base_price: 25000, customizable: false,
    groups: [
      { name_ar: 'نوع القماش', input_type: 'single_select', required: true, has_image: true,
        options: [
          { label_ar: 'قماش 1', price_delta: 0 },
          { label_ar: 'قماش 2', price_delta: 5000 },
          { label_ar: 'قماش 3', price_delta: 10000 },
          { label_ar: 'قماش 4', price_delta: 15000 },
        ] },
      { name_ar: 'تطريز الأكمام (ردان)', input_type: 'counter', required: false, has_image: true, max_select: 2,
        options: [{ label_ar: 'تطريز ردن', price_delta: 5000, requires_customer_text: true, requires_customer_image: true }] },
      { name_ar: 'كسرات', input_type: 'toggle', required: false, has_image: false,
        options: [{ label_ar: 'كسرات', price_delta: 5000 }] },
    ],
  },
  {
    type: 'shawl', name_ar: 'شال أمريكي (ملكي للممثلين)', description: 'شال أمريكي — للبنات فقط',
    base_price: 30000, customizable: false, gender_restriction: 'female',
    role_prices: [{ role: 'wholesaler', base_price: 20000 }],
    groups: [],
  },
];

async function getOrCreateProduct(p) {
  const found = await query(`SELECT id FROM products WHERE type = $1 AND name_ar = $2`, [p.type, p.name_ar]);
  if (found.rows.length) {
    console.log(`= product exists: ${p.name_ar}`);
    return { id: found.rows[0].id, created: false };
  }
  const { rows } = await query(
    `INSERT INTO products (type, name_ar, description, base_price, customizable, gender_restriction)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [p.type, p.name_ar, p.description, p.base_price, !!p.customizable, p.gender_restriction || null]
  );
  console.log(`+ product: ${p.name_ar} (base ${p.base_price})`);
  return { id: rows[0].id, created: true };
}

async function seedGroups(productId, groups) {
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const { rows } = await query(
      `INSERT INTO option_groups
         (product_id, name_ar, input_type, sort, required, has_image, hint_ar, max_select,
          gender_restriction, requires_customer_text, requires_customer_image)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,FALSE),COALESCE($11,FALSE))
       RETURNING id`,
      [
        productId, g.name_ar, g.input_type, gi, !!g.required, !!g.has_image,
        g.hint_ar || null, g.max_select || 1, g.gender_restriction || null,
        g.requires_customer_text || false, g.requires_customer_image || false,
      ]
    );
    const gid = rows[0].id;
    for (let oi = 0; oi < g.options.length; oi++) {
      const o = g.options[oi];
      await query(
        `INSERT INTO options
           (group_id, label_ar, price_delta, sort, requires_customer_text, requires_customer_image)
         VALUES ($1,$2,$3,$4,COALESCE($5,FALSE),COALESCE($6,FALSE))`,
        [
          gid, o.label_ar, o.price_delta || 0, oi,
          o.requires_customer_text || false, o.requires_customer_image || false,
        ]
      );
    }
    console.log(`   + group "${g.name_ar}" (${g.options.length} options)`);
  }
}

async function seedPackages() {
  const tiers = [
    { name_ar: 'بكج ملكي', sash_type: 'ملكي خماسي' },
    { name_ar: 'بكج عادي', sash_type: 'عادي' },
  ];
  for (const t of tiers) {
    const exists = await query(`SELECT id FROM packages WHERE name_ar = $1`, [t.name_ar]);
    if (exists.rows.length) { console.log(`= package exists: ${t.name_ar}`); continue; }
    const pkg = await query(
      `INSERT INTO packages (name_ar, role, price, active) VALUES ($1,'wholesaler',0,FALSE) RETURNING id`,
      [t.name_ar]
    );
    const opt = await query(
      `SELECT o.id FROM options o JOIN option_groups g ON g.id = o.group_id
       JOIN products p ON p.id = g.product_id
       WHERE p.type='sash' AND g.name_ar='نوع الوشاح' AND o.label_ar=$1 LIMIT 1`,
      [t.sash_type]
    );
    if (opt.rows.length) {
      await query(
        `INSERT INTO package_rules (package_id, sash_type_option_id) VALUES ($1,$2)
         ON CONFLICT (sash_type_option_id) DO NOTHING`,
        [pkg.rows[0].id, opt.rows[0].id]
      );
    }
    console.log(`+ package: ${t.name_ar} (price 0, INACTIVE — set price + activate after open question)`);
  }
}

async function main() {
  for (const p of PRODUCTS) {
    const { id, created } = await getOrCreateProduct(p);
    if (created) {
      if (p.groups && p.groups.length) await seedGroups(id, p.groups);
      for (const rp of p.role_prices || []) {
        await query(
          `INSERT INTO product_price_roles (product_id, role, base_price) VALUES ($1,$2,$3)
           ON CONFLICT (product_id, role) DO UPDATE SET base_price = EXCLUDED.base_price`,
          [id, rp.role, rp.base_price]
        );
        console.log(`   + role price: ${rp.role} = ${rp.base_price}`);
      }
    }
  }
  await seedPackages();
  console.log('v2 seed complete.');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
