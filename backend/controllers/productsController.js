const { query } = require('../lib/db');

async function list(req, res) {
  const { type } = req.query;
  const params = [];
  let where = `active = TRUE`;
  if (type) {
    params.push(type);
    where += ` AND type = $${params.length}`;
  }
  const { rows: products } = await query(
    `SELECT id, type, name_ar, description, base_price, customizable
     FROM products WHERE ${where} ORDER BY created_at DESC`,
    params
  );
  if (!products.length) return res.json({ data: [] });
  const ids = products.map((p) => p.id);
  const { rows: variants } = await query(
    `SELECT id, product_id, color, material, size, price, image_url
     FROM product_variants WHERE product_id = ANY($1::uuid[]) AND active = TRUE`,
    [ids]
  );
  const byProduct = {};
  variants.forEach((v) => {
    (byProduct[v.product_id] ||= []).push(v);
  });
  const data = products.map((p) => ({ ...p, variants: byProduct[p.id] || [] }));
  res.json({ data });
}

async function getOne(req, res) {
  const { id } = req.params;
  const { rows: products } = await query(
    `SELECT id, type, name_ar, description, base_price, customizable
     FROM products WHERE id = $1 AND active = TRUE`,
    [id]
  );
  if (!products.length) return res.status(404).json({ error: 'المنتج غير موجود', code: 'ERR_NOT_FOUND' });
  const { rows: variants } = await query(
    `SELECT id, color, material, size, price, image_url FROM product_variants
     WHERE product_id = $1 AND active = TRUE`,
    [id]
  );
  res.json({ data: { ...products[0], variants } });
}

async function createProduct(req, res) {
  const { type, name_ar, description, base_price, customizable } = req.body;
  if (!type || !name_ar || base_price == null) {
    return res.status(400).json({ error: 'بيانات ناقصة', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(
    `INSERT INTO products (type, name_ar, description, base_price, customizable)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [type, name_ar, description || null, base_price, !!customizable]
  );
  res.status(201).json({ data: { id: rows[0].id } });
}

async function createVariant(req, res) {
  const { id } = req.params;
  const { color, material, size, price, image_url } = req.body;
  if (price == null) return res.status(400).json({ error: 'السعر مطلوب', code: 'ERR_VALIDATION' });
  const { rows } = await query(
    `INSERT INTO product_variants (product_id, color, material, size, price, image_url)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [id, color || null, material || null, size || null, price, image_url || null]
  );
  res.status(201).json({ data: { id: rows[0].id } });
}

module.exports = { list, getOne, createProduct, createVariant };
