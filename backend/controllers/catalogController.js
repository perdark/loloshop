const { query, tx } = require('../lib/db');
const { publicUrl } = require('../lib/upload');
const { publish } = require('../lib/eventBus');

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// JSONB arrays must be JSON.stringify'd before binding — pg otherwise serializes a JS
// array as a Postgres array literal ('{…}') and the jsonb column rejects it.
function jsonArray(value) {
  return JSON.stringify(Array.isArray(value) ? value.map((v) => String(v)) : []);
}

// Best-effort traceability for admin package writes (mirrors the order audit pattern).
async function auditPackage(req, action, id, details) {
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
     VALUES ($1, $2, 'package', $3, $4)`,
    [req.user.id, action, id, JSON.stringify(details || {})]
  );
}

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
            p.image_url, p.image_fit, p.featured, p.parent_id, p.wholesaler_only, p.retail_only,
            p.compare_at_price,
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

  // Enforce audience visibility for non-admin/staff users
  const isPrivileged = req.user && (req.user.role === 'admin' || req.user.role === 'staff');
  if (!isPrivileged) {
    if (row.wholesaler_only && role !== 'wholesaler') {
      return res.status(404).json({ error: 'المنتج غير موجود', code: 'ERR_NOT_FOUND' });
    }
    if (row.retail_only && role === 'wholesaler') {
      return res.status(404).json({ error: 'المنتج غير موجود', code: 'ERR_NOT_FOUND' });
    }
  }

  const gallery = await query(
    `SELECT id, url, sort FROM product_images WHERE product_id = $1 ORDER BY sort, created_at`,
    [id]
  );

  // Load own groups
  const ownGroups = await query(
    `SELECT id, name_ar, input_type, sort, required, has_image, hint_ar, image_url,
            max_select, gender_restriction, requires_customer_image, requires_customer_text,
            customer_text_prompt_ar, customer_text_placeholder_ar
     FROM option_groups WHERE product_id = $1 AND active = TRUE ORDER BY sort, created_at`,
    [id]
  );

  // Load parent groups if this product has a parent
  let parentGroups = { rows: [] };
  if (row.parent_id) {
    parentGroups = await query(
      `SELECT id, name_ar, input_type, sort, required, has_image, hint_ar, image_url,
              max_select, gender_restriction, requires_customer_image, requires_customer_text,
              customer_text_prompt_ar, customer_text_placeholder_ar
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
      `SELECT o.id, o.group_id, o.label_ar, o.image_url, o.sort,
              o.requires_customer_image, o.requires_customer_text,
              o.customer_text_prompt_ar, o.customer_text_placeholder_ar,
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

  // Locked options are keyed by the product being viewed (the child), so inherited
  // parent groups can be locked at the child level too.
  const lockedByGroup = {};
  if (groupIds.length) {
    const locks = await query(
      `SELECT group_id, option_id FROM product_locked_options
       WHERE product_id = $1 AND group_id = ANY($2::uuid[])`,
      [id, groupIds]
    );
    locks.rows.forEach((l) => (lockedByGroup[l.group_id] = l.option_id));
  }

  const data = {
    ...row,
    price_role: role,
    images: gallery.rows,
    groups: allGroupRows.map((g) => ({
      ...g,
      options: byGroup[g.id] || [],
      locked_option_id: lockedByGroup[g.id] || null,
    })),
  };
  res.json({ data });
}

// ---------- PUBLIC: shop feed (packages-first, products grouped by type) ----------
async function getShop(req, res) {
  const role = await priceRoleForUser(req.user, req.query.role);
  // Audience drives the funnel: wholesaler-students see only the package form (FE redirect),
  // retail browses products + cart, guests browse anonymously.
  const audience = !req.user ? 'guest' : role === 'wholesaler' ? 'wholesaler_student' : 'retail';
  // Audience-based visibility filter:
  //   guest / retail  → hide wholesaler_only products
  //   wholesaler_student → hide retail_only products
  const audienceFilter =
    audience === 'wholesaler_student'
      ? 'AND p.retail_only = FALSE'
      : 'AND p.wholesaler_only = FALSE';
  const products = await query(
    `SELECT p.id, p.type, p.name_ar, p.description, p.customizable, p.gender_restriction,
            p.image_url, p.image_fit, p.featured, p.sort, p.compare_at_price,
            COALESCE(ppr.base_price, p.base_price) AS base_price
     FROM products p
     LEFT JOIN product_price_roles ppr ON ppr.product_id = p.id AND ppr.role = $1
     WHERE p.active = TRUE
       ${audienceFilter}
       AND NOT EXISTS (
         SELECT 1 FROM products c WHERE c.parent_id = p.id AND c.active = TRUE
       )
     ORDER BY p.type, p.sort, p.created_at DESC`,
    [role]
  );
  // Packages are surfaced as a single form to wholesaler-students; retail reaches them via the
  // cart suggestion (listPackages), never as a tile grid on the home feed.
  let packages = [];
  if (role === 'wholesaler') {
    const pk = await query(
      `SELECT id, name_ar, price, image_url, sort FROM packages
       WHERE active = TRUE AND role = $1 AND is_full_set = FALSE ORDER BY sort, created_at`,
      [role]
    );
    packages = pk.rows;
  }
  // Full-set tiers (طقم كامل) ARE a retail storefront entity — the form-wizard funnel.
  let full_set_packages = [];
  if (audience !== 'wholesaler_student') {
    const fs = await query(
      `SELECT id, name_ar, price, image_url, story_image_url, sort, description,
              badge_label, accent, features, included_items
       FROM packages
       WHERE active = TRUE AND role = 'retail' AND is_full_set = TRUE
       ORDER BY sort, created_at`
    );
    full_set_packages = fs.rows;
  }
  const by_type = {};
  products.rows.forEach((p) => (by_type[p.type] ||= []).push(p));
  res.json({ data: { price_role: role, audience, packages, full_set_packages, by_type } });
}

// ---------- ADMIN: list all products (incl. inactive) for catalog editor ----------
async function listProductsAdmin(req, res) {
  const { rows } = await query(
    `SELECT p.id, p.type, p.name_ar, p.description, p.base_price, p.compare_at_price, p.customizable,
            p.gender_restriction, p.image_url, p.image_fit, p.featured, p.sort, p.active,
            p.wholesaler_only, p.retail_only, p.parent_id,
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
// Coerce an optional compare-at (old) price: empty/null → null (clears it),
// otherwise a non-negative integer. Returns { ok, value } so callers can 400 on bad input.
function normalizeCompareAtPrice(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { ok: false, value: null };
  return { ok: true, value: Math.round(n) };
}

async function createProduct(req, res) {
  const { type, name_ar, description, base_price, customizable, gender_restriction, parent_id } = req.body;
  if (!type || !name_ar || base_price == null) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  const cap = normalizeCompareAtPrice(req.body.compare_at_price);
  if (!cap.ok) {
    return res.status(400).json({ error: 'السعر قبل الخصم غير صالح', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(
    `INSERT INTO products (type, name_ar, description, base_price, compare_at_price, customizable, gender_restriction, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [type, name_ar, description || null, base_price, cap.value, !!customizable, gender_restriction || null, parent_id || null]
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
  // Mutual exclusivity: wholesaler_only and retail_only cannot both be true.
  if (req.body.retail_only === true) req.body.wholesaler_only = false;
  if (req.body.wholesaler_only === true) req.body.retail_only = false;

  // image_fit is a closed set ('cover' | 'contain'); reject bad values before
  // hitting the DB CHECK constraint so the client gets a clean 400.
  if (req.body.image_fit != null && !['cover', 'contain'].includes(req.body.image_fit)) {
    return res.status(400).json({ error: 'قيمة عرض الصورة غير صالحة', code: 'ERR_VALIDATION' });
  }

  // compare_at_price (السعر قبل الخصم): empty/null clears it; reject negatives before
  // the DB CHECK so the client gets a clean Arabic 400.
  if (req.body.compare_at_price !== undefined) {
    const cap = normalizeCompareAtPrice(req.body.compare_at_price);
    if (!cap.ok) {
      return res.status(400).json({ error: 'السعر قبل الخصم غير صالح', code: 'ERR_VALIDATION' });
    }
    req.body.compare_at_price = cap.value;
  }

  const upd = buildUpdate(
    'products',
    ['name_ar', 'description', 'base_price', 'compare_at_price', 'customizable', 'gender_restriction', 'image_url', 'image_fit', 'featured', 'sort', 'active', 'wholesaler_only', 'retail_only', 'parent_id'],
    req.body, req.params.id
  );
  if (!upd) return res.status(400).json({ error: 'لا تغييرات', code: 'ERR_VALIDATION' });
  const { rows } = await query(upd.sql, upd.params);
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

async function deleteProduct(req, res) {
  const { id } = req.params;

  // Guard: refuse if this product is a parent of other products.
  // The FK is ON DELETE SET NULL, so a hard delete would silently orphan children.
  const children = await query(
    `SELECT 1 FROM products WHERE parent_id = $1 LIMIT 1`, [id]
  );
  if (children.rows.length) {
    return res.status(400).json({ error: 'احذف المنتجات الفرعية أولاً', code: 'ERR_HAS_CHILDREN' });
  }

  // Attempt hard delete — cascades to option_groups, product_images, price roles,
  // locked options, package_products (all ON DELETE CASCADE).
  try {
    const { rows } = await query(
      `DELETE FROM products WHERE id = $1 RETURNING id`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
    return res.json({ data: { id: rows[0].id, mode: 'deleted' } });
  } catch (err) {
    // FK violation: product is referenced by order_items (ON DELETE RESTRICT) or similar history.
    if (err.code === '23503') {
      const { rows } = await query(
        `UPDATE products SET active = FALSE WHERE id = $1 RETURNING id`, [id]
      );
      if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
      return res.json({ data: { id: rows[0].id, mode: 'archived' } });
    }
    throw err;
  }
}

// ---------- ADMIN: option groups ----------
async function createGroup(req, res) {
  const { id } = req.params; // product id
  const {
    name_ar, input_type, sort, required, has_image, hint_ar, image_url,
    max_select, gender_restriction, requires_customer_text,
  } = req.body;
  if (!name_ar) return res.status(400).json({ error: 'الاسم مطلوب', code: 'ERR_VALIDATION' });
  const { rows } = await query(
    `INSERT INTO option_groups
       (product_id, name_ar, input_type, sort, required, has_image, hint_ar, image_url,
        max_select, gender_restriction, requires_customer_text)
     VALUES ($1,$2,COALESCE($3::option_input,'single_select'),COALESCE($4,0),COALESCE($5,FALSE),COALESCE($6,FALSE),$7,$8,
             COALESCE($9,1),$10,COALESCE($11,FALSE))
     RETURNING id`,
    [id, name_ar, input_type, sort, required, has_image, hint_ar || null, image_url || null,
     max_select, gender_restriction || null, requires_customer_text]
  );
  res.status(201).json({ data: { id: rows[0].id } });
}

async function updateGroup(req, res) {
  const upd = buildUpdate(
    'option_groups',
    ['name_ar', 'input_type', 'sort', 'required', 'has_image', 'hint_ar', 'image_url', 'max_select', 'gender_restriction', 'requires_customer_image', 'requires_customer_text', 'customer_text_prompt_ar', 'customer_text_placeholder_ar', 'active'],
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
  const { label_ar, price_delta, image_url, sort, requires_customer_text } = req.body;
  if (!label_ar) return res.status(400).json({ error: 'الاسم مطلوب', code: 'ERR_VALIDATION' });
  const { rows } = await query(
    `INSERT INTO options (group_id, label_ar, price_delta, image_url, sort, requires_customer_text)
     VALUES ($1, $2, COALESCE($3,0), $4, COALESCE($5,0), COALESCE($6,FALSE)) RETURNING id`,
    [id, label_ar, price_delta, image_url || null, sort, requires_customer_text]
  );
  res.status(201).json({ data: { id: rows[0].id } });
}

async function updateOption(req, res) {
  const upd = buildUpdate(
    'options',
    ['label_ar', 'price_delta', 'image_url', 'sort', 'requires_customer_image', 'requires_customer_text', 'customer_text_prompt_ar', 'customer_text_placeholder_ar', 'active'],
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

// ---------- ADMIN: lock / unlock a group's option for a (child) product ----------
async function lockGroupOption(req, res) {
  const { id } = req.params; // product id (the child being viewed)
  const { group_id, option_id } = req.body;
  if (!group_id || !option_id) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }

  // Group must belong to this product OR to its parent (inherited group).
  const grp = await query(
    `SELECT g.id
       FROM option_groups g
       JOIN products p ON p.id = $1
      WHERE g.id = $2
        AND (g.product_id = p.id OR g.product_id = p.parent_id)`,
    [id, group_id]
  );
  if (!grp.rows.length) {
    return res.status(404).json({ error: 'المجموعة غير مرتبطة بهذا المنتج', code: 'ERR_NOT_FOUND' });
  }

  // Option must belong to that group.
  const opt = await query(
    `SELECT id FROM options WHERE id = $1 AND group_id = $2`,
    [option_id, group_id]
  );
  if (!opt.rows.length) {
    return res.status(404).json({ error: 'الخيار لا ينتمي لهذه المجموعة', code: 'ERR_NOT_FOUND' });
  }

  const { rows } = await query(
    `INSERT INTO product_locked_options (product_id, group_id, option_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (product_id, group_id) DO UPDATE SET option_id = EXCLUDED.option_id
     RETURNING product_id, group_id, option_id`,
    [id, group_id, option_id]
  );
  res.json({ data: rows[0] });
}

async function unlockGroupOption(req, res) {
  const { id, groupId } = req.params;
  await query(
    `DELETE FROM product_locked_options WHERE product_id = $1 AND group_id = $2`,
    [id, groupId]
  );
  res.json({ data: { product_id: id, group_id: groupId, cleared: true } });
}

// ---------- PUBLIC: list packages with sash type labels (+ optional VIP filter) ----------
async function listPackages(req, res) {
  const role = await priceRoleForUser(req.user, req.query.role);
  const wantVip = req.query.vip === '1' || req.query.vip === 'true';
  const wantFullSet = req.query.full_set === '1' || req.query.full_set === 'true';
  // Admins may request inactive rows too (for the admin management list).
  const includeInactive =
    (req.query.all === '1' || req.query.all === 'true') && req.user && req.user.role === 'admin';
  const where = ['p.role = $1'];
  if (!includeInactive) where.push('p.active = TRUE');
  if (wantVip) where.push('p.is_vip = TRUE');
  else if (wantFullSet) where.push('p.is_full_set = TRUE');
  // Full-set tiers order through the form wizard, not the legacy package/upsell flows —
  // keep them out of unfiltered lists (the admin all=1 list still sees everything).
  else if (!includeInactive) where.push('p.is_full_set = FALSE');
  const { rows } = await query(
    `SELECT p.id, p.name_ar, p.price, p.image_url, p.sort, p.active,
            p.is_vip, p.is_full_set, p.description, p.features, p.included_items, p.badge_label, p.accent,
            p.story_image_url, p.gallery,
            pr.sash_type_option_id,
            o.label_ar AS sash_type_label,
            COALESCE((
              SELECT json_agg(json_build_object('id', pp2.id, 'type', pp2.type, 'name_ar', pp2.name_ar) ORDER BY pp2.type)
              FROM package_products pl JOIN products pp2 ON pp2.id = pl.product_id
              WHERE pl.package_id = p.id AND pp2.active = TRUE
            ), '[]'::json) AS products
     FROM packages p
     LEFT JOIN package_rules pr ON pr.package_id = p.id
     LEFT JOIN options o ON o.id = pr.sash_type_option_id
     WHERE ${where.join(' AND ')}
     ORDER BY p.sort, p.created_at`,
    [role]
  );
  res.json({ data: rows });
}

// ---------- ADMIN: package composition — which catalog products the package bundles ----------
async function setPackageProducts(req, res) {
  const { id } = req.params;
  const ids = Array.isArray(req.body.product_ids) ? [...new Set(req.body.product_ids)].slice(0, 10) : [];
  const pkg = await query(`SELECT id FROM packages WHERE id = $1`, [id]);
  if (!pkg.rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  let valid = [];
  if (ids.length) {
    const { rows } = await query(
      `SELECT id, type FROM products WHERE id = ANY($1::uuid[]) AND active = TRUE`, [ids]
    );
    if (rows.length !== ids.length) {
      return res.status(400).json({ error: 'منتج غير صالح', code: 'ERR_VALIDATION' });
    }
    // one product per type — a full set is one robe + one cap + one sash
    const types = rows.map((r) => r.type);
    if (new Set(types).size !== types.length) {
      return res.status(400).json({ error: 'منتج واحد فقط لكل نوع داخل الباقة', code: 'ERR_VALIDATION' });
    }
    valid = rows;
  }
  await tx(async (client) => {
    await client.query(`DELETE FROM package_products WHERE package_id = $1`, [id]);
    for (const pid of ids) {
      await client.query(
        `INSERT INTO package_products (package_id, product_id) VALUES ($1, $2)`, [id, pid]
      );
    }
  });
  await auditPackage(req, 'package_set_products', id, { product_ids: ids });
  publish({ type: 'catalog', resource: 'package', id });
  res.json({ data: { package_id: id, products: valid } });
}

// ---------- ADMIN: package CRUD (incl. VIP tier) ----------
async function createPackage(req, res) {
  const { name_ar, price, role, image_url, story_image_url, sort, is_vip, is_full_set, description, badge_label, accent } = req.body;
  if (!name_ar || price == null) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  if (accent && !HEX_RE.test(accent)) {
    return res.status(400).json({ error: 'لون غير صالح', code: 'ERR_VALIDATION' });
  }
  if (is_vip && is_full_set) {
    return res.status(400).json({ error: 'الباقة إما VIP أو طقم كامل، ليس كلاهما', code: 'ERR_VALIDATION' });
  }
  // VIP and full-set are retail-only tiers: default role to 'retail' when either flag is set.
  const effectiveRole = role || (is_vip || is_full_set ? 'retail' : null);
  const { rows } = await query(
    `INSERT INTO packages
       (name_ar, price, role, image_url, sort, is_vip, is_full_set, description, features, included_items, badge_label, accent, story_image_url, gallery)
     VALUES ($1, $2, COALESCE($3::price_role,'wholesaler'), $4, COALESCE($5,0),
             COALESCE($6,FALSE), COALESCE($7,FALSE), $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14::jsonb)
     RETURNING id`,
    [
      name_ar, price, effectiveRole, image_url || null, sort || null,
      !!is_vip, !!is_full_set, description || null, jsonArray(req.body.features), jsonArray(req.body.included_items),
      badge_label || null, accent || null, story_image_url || null, jsonArray(req.body.gallery),
    ]
  );
  await auditPackage(req, 'package_create', rows[0].id, { name_ar, is_vip: !!is_vip, is_full_set: !!is_full_set });
  publish({ type: 'catalog', resource: 'package', id: rows[0].id });
  res.status(201).json({ data: { id: rows[0].id } });
}

async function updatePackage(req, res) {
  if (req.body.accent && !HEX_RE.test(req.body.accent)) {
    return res.status(400).json({ error: 'لون غير صالح', code: 'ERR_VALIDATION' });
  }
  // Stringify JSONB arrays before they reach buildUpdate (pg array-literal pitfall).
  if (req.body.features !== undefined) req.body.features = jsonArray(req.body.features);
  if (req.body.included_items !== undefined) req.body.included_items = jsonArray(req.body.included_items);
  if (req.body.gallery !== undefined) req.body.gallery = jsonArray(req.body.gallery);
  const upd = buildUpdate(
    'packages',
    ['name_ar', 'price', 'role', 'image_url', 'story_image_url', 'sort', 'active',
     'is_vip', 'is_full_set', 'description', 'features', 'included_items', 'badge_label', 'accent', 'gallery'],
    req.body, req.params.id
  );
  if (!upd) return res.status(400).json({ error: 'لا تغييرات', code: 'ERR_VALIDATION' });
  const { rows } = await query(upd.sql, upd.params);
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await auditPackage(req, 'package_update', req.params.id, { fields: Object.keys(req.body) });
  publish({ type: 'catalog', resource: 'package', id: req.params.id });
  res.json({ data: rows[0] });
}

async function deletePackage(req, res) {
  const { rows } = await query(
    `UPDATE packages SET active = FALSE WHERE id = $1 RETURNING id`, [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  await auditPackage(req, 'package_delete', req.params.id, {});
  publish({ type: 'catalog', resource: 'package', id: req.params.id });
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

// ---------- HERO SLIDES (home slider) ----------
const HERO_COLS = 'id, image_url, kicker_ar, title_ar, caption_ar, accent, cta_label_ar, cta_href, sort';

async function getHeroSlides(req, res) {
  const { rows } = await query(
    `SELECT ${HERO_COLS} FROM hero_slides WHERE active = TRUE ORDER BY sort, created_at`
  );
  res.json({ data: rows });
}

async function listHeroSlidesAdmin(req, res) {
  const { rows } = await query(
    `SELECT ${HERO_COLS}, active FROM hero_slides ORDER BY active DESC, sort, created_at`
  );
  res.json({ data: rows });
}

async function createHeroSlide(req, res) {
  const { image_url, kicker_ar, title_ar, caption_ar, accent, cta_label_ar, cta_href, sort } = req.body;
  if (!image_url || !title_ar) {
    return res.status(400).json({ error: 'الصورة والعنوان مطلوبان', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(
    `INSERT INTO hero_slides (image_url, kicker_ar, title_ar, caption_ar, accent, cta_label_ar, cta_href, sort)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,0)) RETURNING id`,
    [image_url, kicker_ar || null, title_ar, caption_ar || null, accent || null, cta_label_ar || null, cta_href || null, sort]
  );
  res.status(201).json({ data: { id: rows[0].id } });
}

async function updateHeroSlide(req, res) {
  const upd = buildUpdate(
    'hero_slides',
    ['image_url', 'kicker_ar', 'title_ar', 'caption_ar', 'accent', 'cta_label_ar', 'cta_href', 'sort', 'active'],
    req.body, req.params.id
  );
  if (!upd) return res.status(400).json({ error: 'لا تغييرات', code: 'ERR_VALIDATION' });
  const { rows } = await query(upd.sql, upd.params);
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

async function deleteHeroSlide(req, res) {
  const { rows } = await query(`DELETE FROM hero_slides WHERE id = $1 RETURNING id`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  res.json({ data: rows[0] });
}

module.exports = {
  getHeroSlides, listHeroSlidesAdmin, createHeroSlide, updateHeroSlide, deleteHeroSlide,
  priceRoleForUser, getProductFull, getShop, listProductsAdmin,
  addProductImage, deleteProductImage,
  createProduct, updateProduct, deleteProduct,
  createGroup, updateGroup, deleteGroup,
  createOption, updateOption, deleteOption,
  setOptionPriceRole, setProductPriceRole, uploadImage,
  lockGroupOption, unlockGroupOption,
  listPackages, createPackage, updatePackage, deletePackage, setPackageRule, setPackageProducts,
};
