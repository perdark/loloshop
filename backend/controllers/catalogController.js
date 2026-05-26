const { query } = require('../lib/db');
const { publicUrl } = require('../lib/upload');

// --- Price role: rep-linked students pay 'wholesaler' prices, others 'retail' ---
async function priceRoleForUser(user, override) {
  if (override === 'wholesaler' || override === 'retail') return override;
  if (!user) return 'retail';
  if (user.role === 'admin' || user.role === 'staff') return 'retail';
  const { rows } = await query(
    `SELECT wholesaler_id FROM students WHERE user_id = $1`,
    [user.id]
  );
  return rows[0]?.wholesaler_id ? 'wholesaler' : 'retail';
}

// ---------- PUBLIC: full product config for the configurator ----------
async function getProductFull(req, res) {
  const { id } = req.params;
  const role = await priceRoleForUser(req.user, req.query.role);
  const prod = await query(
    `SELECT p.id, p.type, p.name_ar, p.description, p.customizable, p.gender_restriction,
            p.image_url, p.featured, p.parent_id,
            par.name_ar AS parent_name_ar, par.image_url AS parent_image_url,
            COALESCE(ppr.base_price, p.base_price) AS base_price
     FROM products p
     LEFT JOIN product_price_roles ppr ON ppr.product_id = p.id AND ppr.role = $2
     LEFT JOIN products par ON par.id = p.parent_id
     WHERE p.id = $1 AND p.active = TRUE`,
    [id, role]
  );
  if (!prod.rows.length) {
    return res.status(404).json({ error: 'المنتج غير موجود', code: 'ERR_NOT_FOUND' });
  }
  const row = prod.rows[0];

  const gallery = await query(
    `SELECT id, url, sort FROM product_images WHERE product_id = $1 ORDER BY sort, created_at`,
    [id]
  );

  // Load own groups
  const ownGroups = await query(
    `SELECT id, name_ar, input_type, sort, required, has_image, hint_ar, image_url,
            max_select, gender_restriction, requires_customer_image
     FROM option_groups WHERE product_id = $1 AND active = TRUE ORDER BY sort, created_at`,
    [id]
  );

  // Load parent groups if this product has a parent
  let parentGroups = { rows: [] };
  if (row.parent_id) {
    parentGroups = await query(
      `SELECT id, name_ar, input_type, sort, required, has_image, hint_ar, image_url,
              max_select, gender_restriction, requires_customer_image
       FROM option_groups WHERE product_id = $1 AND active = TRUE ORDER BY sort, created_at`,
      [row.parent_id]
    );
  }

  // Collect all group IDs (parent first, then child's own)
  const allGroupRows = [
    ...parentGroups.rows.map(g => ({ ...g, _inherited: true })),
    ...ownGroups.rows.map(g => ({ ...g, _inherited: false })),
  ];
  const groupIds = allGroupRows.map((g) => g.id);

  let options = { rows: [] };
  if (groupIds.length) {
    options = await query(
      `SELECT o.id, o.group_id, o.label_ar, o.image_url, o.sort, o.requires_customer_image,
              COALESCE(opr.price_delta, o.price_delta) AS price_delta
       FROM options o
       LEFT JOIN option_price_roles opr ON opr.option_id = o.id AND opr.role = $2
       WHERE o.group_id = ANY($1::uuid[]) AND o.active = TRUE
       ORDER BY o.sort, o.created_at`,
      [groupIds, role]
    );
  }
  const byGroup = {};
  options.rows.forEach((o) => (byGroup[o.group_id] ||= []).push(o));

  const data = {
    ...row,
    price_role: role,
    images: gallery.rows,
    groups: allGroupRows.map((g) => ({ ...g, options: byGroup[g.id] || [] })),
  };
  res.json({ data });
}

// ---------- PUBLIC: shop feed (packages-first, products grouped by type) ----------
async function getShop(req, res) {
  const role = await priceRoleForUser(req.user, req.query.role);
  const products = await query(
    `SELECT p.id, p.type, p.name_ar, p.description, p.customizable, p.gender_restriction,
            p.image_url, p.featured, p.sort,
            COALESCE(ppr.base_price, p.base_price) AS base_price
     FROM products p
     LEFT JOIN product_price_roles ppr ON ppr.product_id = p.id AND ppr.role = $1
     WHERE p.active = TRUE
       AND NOT EXISTS (
         SELECT 1 FROM products c WHERE c.parent_id = p.id AND c.active = TRUE
       )
     ORDER BY p.type, p.sort, p.created_at DESC`,
    [role]
  );
  // packages are wholesaler-only for now (retail sees none unless retail packages exist)
  const packages = await query(
    `SELECT id, name_ar, price, image_url, sort FROM packages
     WHERE active = TRUE AND role = $1 ORDER BY sort, created_at`,
    [role]
  );
  const by_type = {};
  products.rows.forEach((p) => (by_type[p.type] ||= []).push(p));
  res.json({ data: { price_role: role, packages: packages.rows, by_type } });
}

// ---------- ADMIN: list all products (incl. inactive) for catalog editor ----------
async function listProductsAdmin(req, res) {
  const { rows } = await query(
    `SELECT p.id, p.type, p.name_ar, p.description, p.base_price, p.customizable,
            p.gender_restriction, p.image_url, p.featured, p.sort, p.active,
            p.parent_id,
            par.name_ar AS parent_name,
            (SELECT COUNT(*)::int FROM option_groups g WHERE g.product_id = p.id) AS group_count,
            (SELECT COUNT(*)::int FROM product_images i WHERE i.product_id = p.id) AS image_count
     FROM products p
     LEFT JOIN products par ON par.id = p.parent_id
     ORDER BY p.active DESC, p.type, par.name_ar NULLS FIRST, p.sort, p.created_at DESC`
  );
  res.json({ data: rows });
}

// ---------- ADMIN: product gallery ----------
async function addProductImage(req, res) {
  const { id } = req.params;
  const { url, sort } = req.body;
  if (!url) return res.status(400).json({ error: 'الرابط مطلوب', code: 'ERR_VALIDATION' });
  const { rows } = await query(
    `INSERT INTO product_images (product_id, url, sort) VALUES ($1, $2, COALESCE($3,0)) RETURNING id`,
    [id, url, sort]
  );
  res.status(201).json({ data: { id: rows[0].id } });
}

async function deleteProductImage(req, res) {
  const { rows } = await query(`DELETE FROM product_images WHERE id = $1 RETURNING id`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

// ---------- ADMIN: products ----------
async function createProduct(req, res) {
  const { type, name_ar, description, base_price, customizable, gender_restriction, parent_id } = req.body;
  if (!type || !name_ar || base_price == null) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(
    `INSERT INTO products (type, name_ar, description, base_price, customizable, gender_restriction, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [type, name_ar, description || null, base_price, !!customizable, gender_restriction || null, parent_id || null]
  );
  res.status(201).json({ data: { id: rows[0].id } });
}

function buildUpdate(table, allowed, body, id, returning = 'id') {
  const sets = [];
  const params = [];
  for (const col of allowed) {
    if (body[col] !== undefined) {
      params.push(body[col]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (!sets.length) return null;
  params.push(id);
  return {
    sql: `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${returning}`,
    params,
  };
}

async function updateProduct(req, res) {
  const upd = buildUpdate(
    'products',
    ['name_ar', 'description', 'base_price', 'customizable', 'gender_restriction', 'image_url', 'featured', 'sort', 'active', 'parent_id'],
    req.body, req.params.id
  );
  if (!upd) return res.status(400).json({ error: 'لا تغييرات', code: 'ERR_VALIDATION' });
  const { rows } = await query(upd.sql, upd.params);
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

async function deleteProduct(req, res) {
  // soft delete to preserve order history
  const { rows } = await query(
    `UPDATE products SET active = FALSE WHERE id = $1 RETURNING id`, [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

// ---------- ADMIN: option groups ----------
async function createGroup(req, res) {
  const { id } = req.params; // product id
  const {
    name_ar, input_type, sort, required, has_image, hint_ar, image_url,
    max_select, gender_restriction,
  } = req.body;
  if (!name_ar) return res.status(400).json({ error: 'الاسم مطلوب', code: 'ERR_VALIDATION' });
  const { rows } = await query(
    `INSERT INTO option_groups
       (product_id, name_ar, input_type, sort, required, has_image, hint_ar, image_url, max_select, gender_restriction)
     VALUES ($1,$2,COALESCE($3,'single_select'),COALESCE($4,0),COALESCE($5,FALSE),COALESCE($6,FALSE),$7,$8,COALESCE($9,1),$10)
     RETURNING id`,
    [id, name_ar, input_type, sort, required, has_image, hint_ar || null, image_url || null, max_select, gender_restriction || null]
  );
  res.status(201).json({ data: { id: rows[0].id } });
}

async function updateGroup(req, res) {
  const upd = buildUpdate(
    'option_groups',
    ['name_ar', 'input_type', 'sort', 'required', 'has_image', 'hint_ar', 'image_url', 'max_select', 'gender_restriction', 'requires_customer_image', 'active'],
    req.body, req.params.id
  );
  if (!upd) return res.status(400).json({ error: 'لا تغييرات', code: 'ERR_VALIDATION' });
  const { rows } = await query(upd.sql, upd.params);
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

async function deleteGroup(req, res) {
  const { rows } = await query(`DELETE FROM option_groups WHERE id = $1 RETURNING id`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

// ---------- ADMIN: options ----------
async function createOption(req, res) {
  const { id } = req.params; // group id
  const { label_ar, price_delta, image_url, sort } = req.body;
  if (!label_ar) return res.status(400).json({ error: 'الاسم مطلوب', code: 'ERR_VALIDATION' });
  const { rows } = await query(
    `INSERT INTO options (group_id, label_ar, price_delta, image_url, sort)
     VALUES ($1, $2, COALESCE($3,0), $4, COALESCE($5,0)) RETURNING id`,
    [id, label_ar, price_delta, image_url || null, sort]
  );
  res.status(201).json({ data: { id: rows[0].id } });
}

async function updateOption(req, res) {
  const upd = buildUpdate(
    'options',
    ['label_ar', 'price_delta', 'image_url', 'sort', 'requires_customer_image', 'active'],
    req.body, req.params.id
  );
  if (!upd) return res.status(400).json({ error: 'لا تغييرات', code: 'ERR_VALIDATION' });
  const { rows } = await query(upd.sql, upd.params);
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

async function deleteOption(req, res) {
  const { rows } = await query(`DELETE FROM options WHERE id = $1 RETURNING id`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

// ---------- ADMIN: role price overrides (upsert / clear) ----------
async function setOptionPriceRole(req, res) {
  const { id } = req.params; // option id
  const { role, price_delta } = req.body;
  if (!['wholesaler', 'retail'].includes(role)) {
    return res.status(400).json({ error: 'دور غير صالح', code: 'ERR_VALIDATION' });
  }
  if (price_delta == null) {
    await query(`DELETE FROM option_price_roles WHERE option_id = $1 AND role = $2`, [id, role]);
    return res.json({ data: { cleared: true } });
  }
  await query(
    `INSERT INTO option_price_roles (option_id, role, price_delta) VALUES ($1, $2, $3)
     ON CONFLICT (option_id, role) DO UPDATE SET price_delta = EXCLUDED.price_delta`,
    [id, role, price_delta]
  );
  res.json({ data: { option_id: id, role, price_delta } });
}

async function setProductPriceRole(req, res) {
  const { id } = req.params; // product id
  const { role, base_price } = req.body;
  if (!['wholesaler', 'retail'].includes(role)) {
    return res.status(400).json({ error: 'دور غير صالح', code: 'ERR_VALIDATION' });
  }
  if (base_price == null) {
    await query(`DELETE FROM product_price_roles WHERE product_id = $1 AND role = $2`, [id, role]);
    return res.json({ data: { cleared: true } });
  }
  await query(
    `INSERT INTO product_price_roles (product_id, role, base_price) VALUES ($1, $2, $3)
     ON CONFLICT (product_id, role) DO UPDATE SET base_price = EXCLUDED.base_price`,
    [id, role, base_price]
  );
  res.json({ data: { product_id: id, role, base_price } });
}

// ---------- PUBLIC: list active packages with sash type labels ----------
async function listPackages(req, res) {
  const role = await priceRoleForUser(req.user, req.query.role);
  const { rows } = await query(
    `SELECT p.id, p.name_ar, p.price, p.image_url, p.sort,
            pr.sash_type_option_id,
            o.label_ar AS sash_type_label
     FROM packages p
     LEFT JOIN package_rules pr ON pr.package_id = p.id
     LEFT JOIN options o ON o.id = pr.sash_type_option_id
     WHERE p.active = TRUE AND p.role = $1
     ORDER BY p.sort, p.created_at`,
    [role]
  );
  res.json({ data: rows });
}

// ---------- ADMIN: package CRUD ----------
async function createPackage(req, res) {
  const { name_ar, price, role, image_url, sort } = req.body;
  if (!name_ar || price == null) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(
    `INSERT INTO packages (name_ar, price, role, image_url, sort)
     VALUES ($1, $2, COALESCE($3,'wholesaler'), $4, COALESCE($5,0)) RETURNING id`,
    [name_ar, price, role || null, image_url || null, sort || null]
  );
  res.status(201).json({ data: { id: rows[0].id } });
}

async function updatePackage(req, res) {
  const upd = buildUpdate(
    'packages',
    ['name_ar', 'price', 'role', 'image_url', 'sort', 'active'],
    req.body, req.params.id
  );
  if (!upd) return res.status(400).json({ error: 'لا تغييرات', code: 'ERR_VALIDATION' });
  const { rows } = await query(upd.sql, upd.params);
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

async function deletePackage(req, res) {
  const { rows } = await query(
    `UPDATE packages SET active = FALSE WHERE id = $1 RETURNING id`, [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

async function setPackageRule(req, res) {
  const { id } = req.params;
  const { sash_type_option_id } = req.body;
  if (!sash_type_option_id) {
    return res.status(400).json({ error: 'خيار نوع الوشاح مطلوب', code: 'ERR_VALIDATION' });
  }
  await query(
    `INSERT INTO package_rules (package_id, sash_type_option_id) VALUES ($1, $2)
     ON CONFLICT (sash_type_option_id) DO UPDATE SET package_id = EXCLUDED.package_id`,
    [id, sash_type_option_id]
  );
  res.json({ data: { package_id: id, sash_type_option_id } });
}

// ---------- ADMIN: image upload (option / group illustrative images) ----------
async function uploadImage(req, res) {
  if (!req.file) return res.status(400).json({ error: 'لا ملف', code: 'ERR_VALIDATION' });
  res.status(201).json({ data: { url: publicUrl(req, 'images', req.file.filename) } });
}

module.exports = {
  priceRoleForUser, getProductFull, getShop, listProductsAdmin,
  addProductImage, deleteProductImage,
  createProduct, updateProduct, deleteProduct,
  createGroup, updateGroup, deleteGroup,
  createOption, updateOption, deleteOption,
  setOptionPriceRole, setProductPriceRole, uploadImage,
  listPackages, createPackage, updatePackage, deletePackage, setPackageRule,
};
