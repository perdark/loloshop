// backend/controllers/costController.js — /admin/costs: the cost model's editor + «الربح الحقيقي».
//
// Every row here is the admin's to add, edit and delete (owner, 2026-09-26: «كلشي خليه قابل
// للتعديل او الاضافة او الحذف»). The only thing the server insists on is that numbers are
// numbers: an IQD amount is a non-negative integer, a recipe quantity is a positive decimal.
// Full reasoning for the model lives in db/migrations/113_cost_model.sql and lib/trueProfit.js.

const { query } = require('../lib/db');
const { computePnl, loadSettings, DEFAULT_SETTINGS } = require('../lib/trueProfit');

const CATEGORIES = ['material', 'embroidery', 'press', 'packaging', 'operating', 'other'];
const PRODUCT_TYPES = ['sash', 'robe', 'cap', 'shawl'];
const AUDIENCES = ['all', 'retail', 'rep'];
const KINDS = ['monthly', 'one_off', 'loss'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const MAX_IQD = 1_000_000_000;

const bad = (res, error, code = 'ERR_VALIDATION') => res.status(400).json({ error, code });
const notFound = (res) => res.status(404).json({ error: 'البند غير موجود', code: 'ERR_NOT_FOUND' });

const text = (v, max = 200) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const iqd = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MAX_IQD ? n : null;
};
const qtyOf = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 100000 ? Math.round(n * 1000) / 1000 : null;
};

const ITEM_COLS = 'id, category, name_ar, unit_ar, unit_cost::float AS unit_cost, confirmed, note_ar, sort';
const LINE_COLS = 'id, product_type, product_id, audience, cost_item_id, qty::float AS qty, note_ar';
const EXP_COLS = `id, kind, category, name_ar, amount::float AS amount,
  to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on, confirmed, note_ar`;

/**
 * Build a SET clause from whitelisted, already-validated fields. `fields` maps column → value;
 * undefined means «not sent», which is different from null («clear it»).
 */
function setClause(fields, startAt = 1) {
  const cols = Object.entries(fields).filter(([, v]) => v !== undefined);
  return {
    sql: cols.map(([c], i) => `${c} = $${startAt + i}`).join(', '),
    values: cols.map(([, v]) => v),
  };
}

// ── The whole model in one read ────────────────────────────────────────────

async function getModel(req, res) {
  const [items, lines, expenses, settings, products] = await Promise.all([
    query(`SELECT ${ITEM_COLS} FROM cost_items ORDER BY category, sort, name_ar`),
    query(`SELECT ${LINE_COLS} FROM product_cost_lines ORDER BY product_type, product_id NULLS FIRST, created_at`),
    query(`SELECT ${EXP_COLS} FROM shop_expenses ORDER BY kind, starts_on DESC, name_ar`),
    loadSettings(),
    query(`SELECT id, name_ar, type::text AS type, active, parent_id FROM products ORDER BY type, sort NULLS LAST, name_ar`),
  ]);
  res.json({
    items: items.rows,
    lines: lines.rows,
    expenses: expenses.rows,
    settings,
    products: products.rows,
  });
}

// ── cost_items ─────────────────────────────────────────────────────────────

function readItem(body, partial) {
  const out = {};
  if (!partial || body.category !== undefined) {
    if (!CATEGORIES.includes(body.category)) return { error: 'التصنيف غير صالح' };
    out.category = body.category;
  }
  if (!partial || body.name_ar !== undefined) {
    const n = text(body.name_ar, 120);
    if (!n) return { error: 'اكتب اسم البند' };
    out.name_ar = n;
  }
  if (!partial || body.unit_ar !== undefined) out.unit_ar = text(body.unit_ar, 30) || 'قطعة';
  if (!partial || body.unit_cost !== undefined) {
    const c = iqd(body.unit_cost);
    if (c === null) return { error: 'السعر لازم يكون رقم صحيح موجب بالدينار' };
    out.unit_cost = c;
  }
  if (body.confirmed !== undefined) out.confirmed = body.confirmed === true;
  if (body.note_ar !== undefined) out.note_ar = text(body.note_ar, 300);
  if (body.sort !== undefined) {
    const s = Number(body.sort);
    if (!Number.isInteger(s)) return { error: 'الترتيب غير صالح' };
    out.sort = s;
  }
  return { fields: out };
}

async function createItem(req, res) {
  const { error, fields } = readItem(req.body || {}, false);
  if (error) return bad(res, error);
  if (fields.sort === undefined) {
    const r = await query(`SELECT COALESCE(MAX(sort), 0) + 10 AS s FROM cost_items WHERE category = $1`, [fields.category]);
    fields.sort = r.rows[0].s;
  }
  fields.updated_by = req.user.id;
  const cols = Object.keys(fields);
  const r = await query(
    `INSERT INTO cost_items (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING ${ITEM_COLS}`,
    Object.values(fields)
  );
  res.status(201).json({ item: r.rows[0] });
}

async function updateItem(req, res) {
  if (!UUID_RE.test(req.params.id)) return notFound(res);
  const { error, fields } = readItem(req.body || {}, true);
  if (error) return bad(res, error);
  if (!Object.keys(fields).length) return bad(res, 'ماكو تعديل');
  const { sql, values } = setClause({ ...fields, updated_by: req.user.id });
  const r = await query(
    `UPDATE cost_items SET ${sql}, updated_at = now() WHERE id = $${values.length + 1} RETURNING ${ITEM_COLS}`,
    [...values, req.params.id]
  );
  if (!r.rows.length) return notFound(res);
  res.json({ item: r.rows[0] });
}

async function deleteItem(req, res) {
  if (!UUID_RE.test(req.params.id)) return notFound(res);
  // product_cost_lines.cost_item_id is ON DELETE CASCADE — the recipe lines using it go too,
  // which the confirm modal says out loud.
  const r = await query(`DELETE FROM cost_items WHERE id = $1 RETURNING id`, [req.params.id]);
  if (!r.rows.length) return notFound(res);
  res.json({ ok: true });
}

// ── product_cost_lines ─────────────────────────────────────────────────────

async function readLine(body, partial) {
  const out = {};
  if (!partial || body.product_type !== undefined) {
    if (!PRODUCT_TYPES.includes(body.product_type)) return { error: 'نوع المنتج غير صالح' };
    out.product_type = body.product_type;
  }
  if (!partial || body.product_id !== undefined) {
    if (body.product_id == null || body.product_id === '') {
      out.product_id = null;
    } else {
      if (!UUID_RE.test(String(body.product_id))) return { error: 'المنتج غير صالح' };
      const p = await query(`SELECT type::text AS type FROM products WHERE id = $1`, [body.product_id]);
      if (!p.rows.length) return { error: 'المنتج غير موجود' };
      if (out.product_type && p.rows[0].type !== out.product_type) {
        return { error: 'المنتج مو من نفس النوع' };
      }
      out.product_id = body.product_id;
      out._product_type = p.rows[0].type;
    }
  }
  if (!partial || body.audience !== undefined) {
    const a = body.audience ?? 'all';
    if (!AUDIENCES.includes(a)) return { error: 'الفئة غير صالحة' };
    out.audience = a;
  }
  if (!partial || body.cost_item_id !== undefined) {
    if (!UUID_RE.test(String(body.cost_item_id || ''))) return { error: 'اختر بند التكلفة' };
    const ci = await query(`SELECT 1 FROM cost_items WHERE id = $1`, [body.cost_item_id]);
    if (!ci.rows.length) return { error: 'بند التكلفة غير موجود' };
    out.cost_item_id = body.cost_item_id;
  }
  if (!partial || body.qty !== undefined) {
    const q = qtyOf(body.qty);
    if (q === null) return { error: 'الكمية لازم تكون رقم أكبر من صفر' };
    out.qty = q;
  }
  if (body.note_ar !== undefined) out.note_ar = text(body.note_ar, 300);
  return { fields: out };
}

async function createLine(req, res) {
  const { error, fields } = await readLine(req.body || {}, false);
  if (error) return bad(res, error);
  delete fields._product_type;
  const cols = Object.keys(fields);
  const r = await query(
    `INSERT INTO product_cost_lines (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING ${LINE_COLS}`,
    Object.values(fields)
  );
  res.status(201).json({ line: r.rows[0] });
}

async function updateLine(req, res) {
  if (!UUID_RE.test(req.params.id)) return notFound(res);
  const { error, fields } = await readLine(req.body || {}, true);
  if (error) return bad(res, error);
  // Moving a line onto a product: the line's type must follow that product's type.
  if (fields._product_type) {
    const cur = await query(`SELECT product_type FROM product_cost_lines WHERE id = $1`, [req.params.id]);
    if (!cur.rows.length) return notFound(res);
    const type = fields.product_type || cur.rows[0].product_type;
    if (type !== fields._product_type) return bad(res, 'المنتج مو من نفس النوع');
  }
  delete fields._product_type;
  if (!Object.keys(fields).length) return bad(res, 'ماكو تعديل');
  const { sql, values } = setClause(fields);
  const r = await query(
    `UPDATE product_cost_lines SET ${sql}, updated_at = now() WHERE id = $${values.length + 1} RETURNING ${LINE_COLS}`,
    [...values, req.params.id]
  );
  if (!r.rows.length) return notFound(res);
  res.json({ line: r.rows[0] });
}

async function deleteLine(req, res) {
  if (!UUID_RE.test(req.params.id)) return notFound(res);
  const r = await query(`DELETE FROM product_cost_lines WHERE id = $1 RETURNING id`, [req.params.id]);
  if (!r.rows.length) return notFound(res);
  res.json({ ok: true });
}

// ── shop_expenses ──────────────────────────────────────────────────────────

async function readExpense(body, partial, current = null) {
  const out = {};
  if (!partial || body.kind !== undefined) {
    if (!KINDS.includes(body.kind)) return { error: 'نوع المصروف غير صالح' };
    out.kind = body.kind;
  }
  if (!partial || body.name_ar !== undefined) {
    const n = text(body.name_ar, 120);
    if (!n) return { error: 'اكتب اسم المصروف' };
    out.name_ar = n;
  }
  if (!partial || body.category !== undefined) out.category = text(body.category, 40) || 'other';
  if (!partial || body.amount !== undefined) {
    const a = iqd(body.amount);
    if (a === null) return { error: 'المبلغ لازم يكون رقم صحيح موجب بالدينار' };
    out.amount = a;
  }
  if (!partial || body.starts_on !== undefined) {
    if (!DATE_RE.test(String(body.starts_on || ''))) return { error: 'التاريخ غير صالح' };
    out.starts_on = body.starts_on;
  }
  if (body.ends_on !== undefined) {
    if (body.ends_on == null || body.ends_on === '') out.ends_on = null;
    else if (!DATE_RE.test(String(body.ends_on))) return { error: 'تاريخ الانتهاء غير صالح' };
    else out.ends_on = body.ends_on;
  }
  if (body.confirmed !== undefined) out.confirmed = body.confirmed === true;
  if (body.note_ar !== undefined) out.note_ar = text(body.note_ar, 300);

  // The table CHECK, said in Arabic before Postgres says it in English.
  const kind = out.kind ?? current?.kind;
  const starts = out.starts_on ?? current?.starts_on;
  const ends = out.ends_on !== undefined ? out.ends_on : current?.ends_on;
  if (kind !== 'monthly' && ends) {
    if (out.kind && out.ends_on === undefined) out.ends_on = null; // switching kind drops the end date
    else return { error: 'تاريخ الانتهاء بس للمصاريف الشهرية' };
  }
  if (kind === 'monthly' && ends && starts && ends < starts) return { error: 'تاريخ الانتهاء قبل البداية' };
  return { fields: out };
}

async function createExpense(req, res) {
  const { error, fields } = await readExpense(req.body || {}, false);
  if (error) return bad(res, error);
  fields.updated_by = req.user.id;
  const cols = Object.keys(fields);
  const r = await query(
    `INSERT INTO shop_expenses (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING ${EXP_COLS}`,
    Object.values(fields)
  );
  res.status(201).json({ expense: r.rows[0] });
}

async function updateExpense(req, res) {
  if (!UUID_RE.test(req.params.id)) return notFound(res);
  const cur = await query(`SELECT ${EXP_COLS} FROM shop_expenses WHERE id = $1`, [req.params.id]);
  if (!cur.rows.length) return notFound(res);
  const { error, fields } = await readExpense(req.body || {}, true, cur.rows[0]);
  if (error) return bad(res, error);
  if (!Object.keys(fields).length) return bad(res, 'ماكو تعديل');
  const { sql, values } = setClause({ ...fields, updated_by: req.user.id });
  const r = await query(
    `UPDATE shop_expenses SET ${sql}, updated_at = now() WHERE id = $${values.length + 1} RETURNING ${EXP_COLS}`,
    [...values, req.params.id]
  );
  res.json({ expense: r.rows[0] });
}

async function deleteExpense(req, res) {
  if (!UUID_RE.test(req.params.id)) return notFound(res);
  const r = await query(`DELETE FROM shop_expenses WHERE id = $1 RETURNING id`, [req.params.id]);
  if (!r.rows.length) return notFound(res);
  res.json({ ok: true });
}

// ── settings ───────────────────────────────────────────────────────────────

async function updateSettings(req, res) {
  const cur = await loadSettings();
  const next = { ...DEFAULT_SETTINGS, ...cur };
  const b = req.body || {};
  if (b.usd_iqd !== undefined) {
    const v = iqd(b.usd_iqd);
    if (!v || v < 100 || v > 100000) return bad(res, 'سعر الصرف غير منطقي');
    next.usd_iqd = v;
  }
  if (b.unsalaried_day_rate !== undefined) {
    const v = iqd(b.unsalaried_day_rate);
    if (v === null || v > 1_000_000) return bad(res, 'أجر اليوم غير صالح');
    next.unsalaried_day_rate = v;
  }
  await query(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ('cost_settings', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(next)]
  );
  res.json({ settings: next });
}

// ── the P&L ────────────────────────────────────────────────────────────────

async function pnl(req, res) {
  try {
    res.json(await computePnl({ from: req.query.from, to: req.query.to }));
  } catch (e) {
    if (e.status === 400) return bad(res, e.message, e.code);
    throw e;
  }
}

module.exports = {
  getModel,
  createItem, updateItem, deleteItem,
  createLine, updateLine, deleteLine,
  createExpense, updateExpense, deleteExpense,
  updateSettings,
  pnl,
};
