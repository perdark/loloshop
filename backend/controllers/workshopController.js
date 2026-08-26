// Workshop (الورشة / Team B) — direct daily piecework and wage ledger.
const bcrypt = require('bcrypt');
const { query, tx } = require('../lib/db');
const { signToken } = require('../middleware/auth');
const { secretMatches } = require('../lib/secretCompare');
const { assertPasswordOk } = require('../lib/password');

const SALT_ROUNDS = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ⚠️ The operation list is CODE, not a table. `workshop_piece_rates` stores an amount per
// (operation, product, audience) but never the vocabulary itself, so adding a job means
// editing all four constants below AND seeding its rate rows — in db/schema.sql (the file
// `npm run migrate` actually applies) as well as a numbered migration. Miss the seed and the
// job appears on the screen paying nothing; miss `PRODUCT_OPS` and `upsertRate` 400s on a
// pair the rates screen just offered. Mirror `WorkshopOperation` in frontend/lib/workshop.ts
// too — the Arabic labels come from here, so the frontend only needs the union widened.
const OPERATIONS = ['cut', 'overlock', 'cap_sew', 'robe_sew', 'shawl_close', 'american_shawl', 'ruler'];
const PRODUCTS = ['robe', 'cap', 'shawl', 'sash'];
const PRODUCT_OPS = {
  robe: ['cut', 'overlock', 'robe_sew'],
  // 'ruler' (مسطرة) is cap-only by owner decision 2026-08-26. It is not restricted to one
  // worker: any active workshop worker may log it, exactly like every other operation.
  cap: ['cut', 'cap_sew', 'ruler'],
  shawl: ['cut', 'shawl_close', 'american_shawl'],
  sash: ['cut', 'shawl_close'],
};
const OP_LABEL_AR = {
  cut: 'قص', overlock: 'أوفرلوك', cap_sew: 'خياطة القبعة',
  robe_sew: 'خياطة الروب', shawl_close: 'تسكير الشال', american_shawl: 'شال امريكي',
  ruler: 'مسطرة',
};
const PRODUCT_LABEL_AR = { robe: 'روب', cap: 'قبعة', shawl: 'شال', sash: 'وشاح' };
const AUDIENCES = ['wholesale', 'retail'];
const AUDIENCE_LABEL_AR = { wholesale: 'ممثلين', retail: 'تجزئة' };
const n = (v) => Number(v || 0);
const validInt = (v, min = 0) => Number.isInteger(v) && v >= min;
const validDate = (v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(String(v));

async function attachWorker(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT id, is_lead, active FROM workshop_workers WHERE user_id = $1`, [req.user.id]
    );
    req.worker = rows[0] || null;
    next();
  } catch (error) { next(error); }
}

function requireLead(req, res, next) {
  if (req.user.role === 'admin' || (req.worker?.is_lead && req.worker.active)) return next();
  return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
}

function requireWorkerSelf(req, res, next) {
  if (req.worker?.active) return next();
  return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
}

function portalKeyOk(provided) {
  return secretMatches(provided, process.env.WORKSHOP_PORTAL_KEY);
}

async function portalMembers(req, res) {
  if (!portalKeyOk(req.query.key)) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  const { rows } = await query(
    `SELECT u.id, u.name FROM users u JOIN workshop_workers w ON w.user_id = u.id
     WHERE u.role = 'worker' AND w.active = TRUE ORDER BY u.name`
  );
  res.json({ data: rows });
}

async function portalLogin(req, res) {
  const { key, worker_id, password } = req.body || {};
  if (!portalKeyOk(key)) return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  if (!UUID_RE.test(String(worker_id)) || !password) {
    return res.status(401).json({ error: 'بيانات خاطئة', code: 'ERR_INVALID_CREDENTIALS' });
  }
  const { rows } = await query(
    `SELECT u.id, u.name, u.role, u.password_hash, u.token_version FROM users u
     JOIN workshop_workers w ON w.user_id = u.id
     WHERE u.id = $1 AND u.role = 'worker' AND w.active = TRUE`, [worker_id]
  );
  if (!rows.length || !(await bcrypt.compare(String(password), rows[0].password_hash))) {
    return res.status(401).json({ error: 'بيانات خاطئة', code: 'ERR_INVALID_CREDENTIALS' });
  }
  const user = rows[0];
  res.json({ token: signToken(user), user: { id: user.id, name: user.name, role: user.role } });
}

function validatePiece(body) {
  const { product, operation, qty, work_date, audience } = body || {};
  if (!PRODUCTS.includes(product) || !OPERATIONS.includes(operation) || !PRODUCT_OPS[product]?.includes(operation)) {
    return 'نوع القطعة أو الشغل غير صحيح';
  }
  // No default on purpose: the audience decides the wage, so an unstated one is an
  // error rather than a guess.
  if (!AUDIENCES.includes(audience)) return 'حدد لمين هالشغل: ممثلين أو تجزئة';
  if (!validInt(qty, 1)) return 'الكمية غير صحيحة';
  if (!validDate(work_date)) return 'التاريخ غير صحيح';
  return null;
}

async function insertProduction({ workerId, body, actorUserId }) {
  const error = validatePiece(body);
  if (error) return { error };
  const rate = await query(
    `SELECT amount FROM workshop_piece_rates WHERE operation = $1 AND product = $2 AND audience = $3`,
    [body.operation, body.product, body.audience]
  );
  const unitRate = n(rate.rows[0]?.amount);
  const amount = unitRate * body.qty;
  const { rows } = await query(
    `INSERT INTO workshop_production_entries
       (worker_id, product, operation, audience, qty, rate, amount, work_date, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date,CURRENT_DATE),$9,$10)
     RETURNING id, qty, rate, amount, audience, work_date, created_at`,
    [workerId, body.product, body.operation, body.audience, body.qty, unitRate, amount,
      body.work_date || null, String(body.note || '').trim() || null, actorUserId]
  );
  return { data: rows[0] };
}

async function ledgerFor(workerId, limit = 100) {
  const totals = await query(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM workshop_production_entries WHERE worker_id=$1),0) AS production,
       COALESCE((SELECT SUM(amount) FROM workshop_production_entries WHERE worker_id=$1 AND audience='wholesale'),0) AS production_wholesale,
       COALESCE((SELECT SUM(amount) FROM workshop_production_entries WHERE worker_id=$1 AND audience='retail'),0) AS production_retail,
       COALESCE((SELECT SUM(amount) FROM workshop_adjustments WHERE worker_id=$1 AND kind='bonus'),0) AS bonuses,
       COALESCE((SELECT SUM(amount) FROM workshop_adjustments WHERE worker_id=$1 AND kind='deduction'),0) AS deductions,
       COALESCE((SELECT SUM(qty) FROM workshop_production_entries WHERE worker_id=$1),0)::int AS pieces`,
    [workerId]
  );
  const entries = await query(
    `SELECT id, 'production' AS kind, product, operation, audience, qty, rate, amount,
            work_date AS entry_date, note AS reason, created_at
       FROM workshop_production_entries WHERE worker_id=$1
     UNION ALL
     SELECT id, kind, NULL, NULL, NULL, 0, 0, amount, entry_date, reason, created_at
       FROM workshop_adjustments WHERE worker_id=$1
     ORDER BY created_at DESC LIMIT $2`, [workerId, limit]
  );
  const t = totals.rows[0];
  const production = n(t.production), bonuses = n(t.bonuses), deductions = n(t.deductions);
  return {
    production,
    production_wholesale: n(t.production_wholesale),
    production_retail: n(t.production_retail),
    bonuses, deductions, payable: production + bonuses - deductions,
    pieces: n(t.pieces),
    entries: entries.rows.map((r) => ({
      ...r, qty: n(r.qty), rate: n(r.rate), amount: n(r.amount),
      product_label_ar: r.product ? PRODUCT_LABEL_AR[r.product] : null,
      operation_label_ar: r.operation ? OP_LABEL_AR[r.operation] : null,
      audience_label_ar: r.audience ? AUDIENCE_LABEL_AR[r.audience] : null,
    })),
  };
}

async function mySummary(req, res) {
  const [ledger, rates] = await Promise.all([ledgerFor(req.worker.id), ratesMatrix()]);
  res.json({ ...ledger, rates });
}

async function myProduction(req, res) {
  const result = await insertProduction({ workerId: req.worker.id, body: req.body, actorUserId: req.user.id });
  if (result.error) return res.status(400).json({ error: result.error, code: 'ERR_VALIDATION' });
  res.status(201).json(result.data);
}

async function listWorkers(req, res) {
  const { rows } = await query(
    `SELECT w.id, w.user_id, w.is_lead, w.active, u.name, u.role,
       COALESCE(p.production,0) AS production, COALESCE(p.pieces,0)::int AS pieces,
       COALESCE(a.bonuses,0) AS bonuses, COALESCE(a.deductions,0) AS deductions
     FROM workshop_workers w JOIN users u ON u.id=w.user_id
     LEFT JOIN (SELECT worker_id,SUM(amount) production,SUM(qty) pieces FROM workshop_production_entries GROUP BY worker_id) p ON p.worker_id=w.id
     LEFT JOIN (SELECT worker_id,
       SUM(amount) FILTER (WHERE kind='bonus') bonuses,
       SUM(amount) FILTER (WHERE kind='deduction') deductions
       FROM workshop_adjustments GROUP BY worker_id) a ON a.worker_id=w.id
     ORDER BY w.is_lead DESC,u.name`
  );
  res.json({ data: rows.map((r) => ({
    id: r.id, user_id: r.user_id, name: r.name, role: r.role, is_lead: r.is_lead,
    active: r.active, is_staff: r.role === 'staff', pieces: n(r.pieces), production: n(r.production),
    bonuses: n(r.bonuses), deductions: n(r.deductions),
    payable: n(r.production) + n(r.bonuses) - n(r.deductions),
  })) });
}

async function createWorker(req, res) {
  const { name, password, is_lead = false, link_user_id } = req.body || {};
  if (link_user_id) {
    if (!UUID_RE.test(String(link_user_id))) return res.status(400).json({ error: 'مستخدم غير صحيح', code: 'ERR_VALIDATION' });
    const exists = await query(`SELECT id FROM users WHERE id=$1`, [link_user_id]);
    if (!exists.rows.length) return res.status(404).json({ error: 'المستخدم غير موجود', code: 'ERR_NOT_FOUND' });
    const ins = await query(
      `INSERT INTO workshop_workers(user_id,is_lead) VALUES($1,$2)
       ON CONFLICT(user_id) DO NOTHING RETURNING id`, [link_user_id, !!is_lead]
    );
    if (!ins.rows.length) return res.status(409).json({ error: 'مضاف مسبقاً للورشة', code: 'ERR_DUPLICATE' });
    return res.status(201).json({ id: ins.rows[0].id });
  }
  if (!name?.trim()) return res.status(400).json({ error: 'الاسم مطلوب', code: 'ERR_VALIDATION' });
  assertPasswordOk(String(password || ''), 'privileged');
  const hash = await bcrypt.hash(String(password), SALT_ROUNDS);
  const result = await tx(async (client) => {
    const u = await client.query(`INSERT INTO users(name,password_hash,role) VALUES($1,$2,'worker') RETURNING id`, [name.trim(), hash]);
    const w = await client.query(`INSERT INTO workshop_workers(user_id,is_lead) VALUES($1,$2) RETURNING id`, [u.rows[0].id, !!is_lead]);
    return { worker_id: w.rows[0].id, user_id: u.rows[0].id };
  });
  res.status(201).json(result);
}

async function updateWorker(req, res) {
  const { id } = req.params;
  if (!UUID_RE.test(String(id))) return res.status(400).json({ error: 'معرّف غير صحيح', code: 'ERR_VALIDATION' });
  const cur = await query(`SELECT w.user_id,u.role FROM workshop_workers w JOIN users u ON u.id=w.user_id WHERE w.id=$1`, [id]);
  if (!cur.rows.length) return res.status(404).json({ error: 'العامل غير موجود', code: 'ERR_NOT_FOUND' });
  const sets = [], values = [];
  for (const field of ['is_lead', 'active']) {
    if (typeof req.body[field] === 'boolean') { values.push(req.body[field]); sets.push(`${field}=$${values.length}`); }
  }
  // Validate BEFORE any write: the name/roster updates below commit immediately, so a
  // rejected password used to leave a half-applied edit behind.
  if (cur.rows[0].role === 'worker' && req.body.password) {
    assertPasswordOk(String(req.body.password), 'privileged');
  }
  if (sets.length) { values.push(id); await query(`UPDATE workshop_workers SET ${sets.join(',')} WHERE id=$${values.length}`, values); }
  if (cur.rows[0].role === 'worker' && req.body.name?.trim()) await query(`UPDATE users SET name=$1,updated_at=NOW() WHERE id=$2`, [req.body.name.trim(), cur.rows[0].user_id]);
  if (cur.rows[0].role === 'worker' && req.body.password) {
    await query(
      `UPDATE users
       SET password_hash=$1, token_version=token_version+1, updated_at=NOW()
       WHERE id=$2`,
      [await bcrypt.hash(String(req.body.password), SALT_ROUNDS), cur.rows[0].user_id]
    );
  }
  res.json({ ok: true });
}

async function linkCandidates(req, res) {
  const { rows } = await query(
    `SELECT u.id,u.name FROM users u WHERE u.role='staff'
     AND NOT EXISTS(SELECT 1 FROM workshop_workers w WHERE w.user_id=u.id) ORDER BY u.name`
  );
  res.json({ data: rows });
}

async function ratesMatrix() {
  const { rows } = await query(`SELECT operation,product,audience,amount FROM workshop_piece_rates`);
  const saved = Object.fromEntries(rows.map((r) => [`${r.operation}:${r.product}:${r.audience}`, n(r.amount)]));
  return PRODUCTS.flatMap((product) => PRODUCT_OPS[product].flatMap((operation) =>
    AUDIENCES.map((audience) => ({
      operation, product, audience,
      operation_label_ar: OP_LABEL_AR[operation],
      product_label_ar: PRODUCT_LABEL_AR[product],
      audience_label_ar: AUDIENCE_LABEL_AR[audience],
      amount: saved[`${operation}:${product}:${audience}`] || 0,
    }))));
}

async function listRates(req, res) { res.json({ data: await ratesMatrix() }); }

async function upsertRate(req, res) {
  const { operation, product, audience, amount } = req.body || {};
  if (!PRODUCTS.includes(product) || !PRODUCT_OPS[product]?.includes(operation)
      || !AUDIENCES.includes(audience) || !validInt(amount)) {
    return res.status(400).json({ error: 'العملية أو السعر غير صحيح', code: 'ERR_VALIDATION' });
  }
  await query(
    `INSERT INTO workshop_piece_rates(operation,product,audience,amount,updated_by) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(operation,product,audience) DO UPDATE SET amount=EXCLUDED.amount,updated_at=NOW(),updated_by=EXCLUDED.updated_by`,
    [operation, product, audience, amount, req.user.id]
  );
  res.json({ ok: true });
}

async function createProduction(req, res) {
  if (!UUID_RE.test(String(req.body.worker_id))) return res.status(400).json({ error: 'العامل غير صحيح', code: 'ERR_VALIDATION' });
  const worker = await query(`SELECT id FROM workshop_workers WHERE id=$1 AND active=TRUE`, [req.body.worker_id]);
  if (!worker.rows.length) return res.status(404).json({ error: 'العامل غير موجود', code: 'ERR_NOT_FOUND' });
  const result = await insertProduction({ workerId: req.body.worker_id, body: req.body, actorUserId: req.user.id });
  if (result.error) return res.status(400).json({ error: result.error, code: 'ERR_VALIDATION' });
  res.status(201).json(result.data);
}

async function createAdjustment(req, res) {
  const { worker_id, kind, amount, reason, entry_date } = req.body || {};
  if (!UUID_RE.test(String(worker_id)) || !['bonus', 'deduction'].includes(kind) || !validInt(amount, 1) || !String(reason || '').trim() || !validDate(entry_date)) {
    return res.status(400).json({ error: 'بيانات الحافز أو الخصم غير صحيحة', code: 'ERR_VALIDATION' });
  }
  const { rows } = await query(
    `INSERT INTO workshop_adjustments(worker_id,kind,amount,reason,entry_date,created_by)
     VALUES($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE),$6) RETURNING id`,
    [worker_id, kind, amount, String(reason).trim(), entry_date || null, req.user.id]
  );
  res.status(201).json({ id: rows[0].id });
}

async function workerLedger(req, res) {
  if (!UUID_RE.test(String(req.params.id))) return res.status(400).json({ error: 'العامل غير صحيح', code: 'ERR_VALIDATION' });
  res.json(await ledgerFor(req.params.id, 250));
}

async function dashboard(req, res) {
  const workers = await query(
    `SELECT COUNT(*)::int active_workers FROM workshop_workers WHERE active=TRUE`
  );
  const totals = await query(
    `SELECT
       COALESCE((SELECT SUM(qty) FROM workshop_production_entries),0)::int pieces,
       COALESCE((SELECT SUM(qty) FROM workshop_production_entries WHERE audience='wholesale'),0)::int pieces_wholesale,
       COALESCE((SELECT SUM(qty) FROM workshop_production_entries WHERE audience='retail'),0)::int pieces_retail,
       COALESCE((SELECT SUM(amount) FROM workshop_production_entries),0) production,
       COALESCE((SELECT SUM(amount) FROM workshop_production_entries WHERE audience='wholesale'),0) production_wholesale,
       COALESCE((SELECT SUM(amount) FROM workshop_production_entries WHERE audience='retail'),0) production_retail,
       COALESCE((SELECT SUM(amount) FROM workshop_adjustments WHERE kind='bonus'),0) bonuses,
       COALESCE((SELECT SUM(amount) FROM workshop_adjustments WHERE kind='deduction'),0) deductions`
  );
  const t = totals.rows[0];
  const recent = await query(
    `SELECT p.id,'production' kind,u.name worker_name,p.product,p.operation,p.audience,p.qty,p.rate,p.amount,
            p.work_date entry_date,p.note reason,p.created_at
       FROM workshop_production_entries p JOIN workshop_workers w ON w.id=p.worker_id JOIN users u ON u.id=w.user_id
     UNION ALL
     SELECT a.id,a.kind,u.name,NULL,NULL,NULL,0,0,a.amount,a.entry_date,a.reason,a.created_at
       FROM workshop_adjustments a JOIN workshop_workers w ON w.id=a.worker_id JOIN users u ON u.id=w.user_id
     ORDER BY created_at DESC LIMIT 100`
  );
  res.json({ totals: {
    active_workers: n(workers.rows[0].active_workers), pieces: n(t.pieces),
    pieces_wholesale: n(t.pieces_wholesale), pieces_retail: n(t.pieces_retail),
    production: n(t.production),
    production_wholesale: n(t.production_wholesale), production_retail: n(t.production_retail),
    bonuses: n(t.bonuses), deductions: n(t.deductions), payable: n(t.production) + n(t.bonuses) - n(t.deductions),
  }, workers: (await workerRows()).data,
  recent: recent.rows.map((r) => ({ ...r, qty: n(r.qty), rate: n(r.rate), amount: n(r.amount),
    product_label_ar: r.product ? PRODUCT_LABEL_AR[r.product] : null,
    operation_label_ar: r.operation ? OP_LABEL_AR[r.operation] : null,
    audience_label_ar: r.audience ? AUDIENCE_LABEL_AR[r.audience] : null,
  })) });
}

async function workerRows() {
  let payload;
  const fakeRes = { json: (value) => { payload = value; } };
  await listWorkers({}, fakeRes);
  return payload;
}

module.exports = {
  attachWorker, requireLead, requireWorkerSelf, portalMembers, portalLogin,
  mySummary, myProduction, listWorkers, createWorker, updateWorker, linkCandidates,
  listRates, upsertRate, createProduction, createAdjustment, workerLedger, dashboard,
  validatePiece, insertProduction, ratesMatrix, ledgerFor,
  OPERATIONS, PRODUCTS, PRODUCT_OPS, AUDIENCES, AUDIENCE_LABEL_AR,
};
