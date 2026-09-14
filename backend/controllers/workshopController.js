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
     RETURNING id, qty, rate, amount, audience, to_char(work_date,'YYYY-MM-DD') AS work_date, created_at`,
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
    // ⚠️ `to_char`, NEVER the raw `date` column. `work_date`/`entry_date` are DATE, and pg
    // hands a DATE back as a JS Date at the SERVER's local midnight — which `JSON.stringify`
    // then writes as UTC, so prod (Europe/Berlin) turned 2026-09-11 into
    // "2026-09-10T21:00:00.000Z". The admin list printed that string verbatim, and the edit
    // modal's date input read its first ten characters and silently moved the day BACK ONE
    // on every save. Same trap as attendanceController.dateKey (2026-09-08) and the 40,000
    // IQD deduction before it; `salaryController` has always done it this way.
    `SELECT id, 'production' AS kind, product, operation, audience, qty, rate, amount,
            to_char(work_date,'YYYY-MM-DD') AS entry_date, note AS reason, created_at
       FROM workshop_production_entries WHERE worker_id=$1
     UNION ALL
     SELECT id, kind, NULL, NULL, NULL, 0, 0, amount,
            to_char(entry_date,'YYYY-MM-DD'), reason, created_at
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

/**
 * Remove a worker from the workshop roster (admin only, 2026-09-14).
 *
 * ⚠️ THIS REFUSES ANY WORKER WHO HAS EVER BEEN PAID, AND THAT REFUSAL IS THE FEATURE.
 * Both `workshop_production_entries.worker_id` and `workshop_adjustments.worker_id` are
 * **ON DELETE CASCADE**, so deleting the roster row silently takes the worker's entire wage
 * ledger with it — every قطعة they were paid for, every حافز and خصم. Nothing in the app
 * would show anything missing afterwards; the totals would simply be smaller. «إيقاف»
 * (active = FALSE) already exists and is the right tool for someone who has left: it keeps
 * the money history and only stops them being picked on «تسجيل القطع».
 * So delete is for the row that should never have existed — a typo, a «(تجريبي)» test
 * worker, an account added twice.
 *
 * ⚠️ AND IT NEVER DELETES A `users` ROW. Deleting a user cascades far outside the workshop —
 * `staff_attendance_records`, `staff_salary_transactions`, `staff_salaries`,
 * `staff_activity_log`, `staff_payroll_statements` are all ON DELETE CASCADE on `user_id`,
 * i.e. the person's بصمات and راتب. A workshop-only account (`role = 'worker'`, created by
 * «+ عامل») is instead SOFT-deleted — `deleted_at` + a `token_version` bump, which is what
 * middleware/auth.js reads to refuse a login — so the wage history of everyone ELSE, which
 * points at this user through `created_by`, stays readable. A LINKED STAFF account
 * (`role = 'staff'`) is not touched at all: that person still works in the shop, they are
 * just no longer on the workshop roster.
 */
async function deleteWorker(req, res) {
  const { id } = req.params;
  if (!UUID_RE.test(String(id))) return res.status(400).json({ error: 'معرّف غير صحيح', code: 'ERR_VALIDATION' });
  const cur = await query(
    `SELECT w.id, w.user_id, u.name, u.role,
       (SELECT count(*) FROM workshop_production_entries e WHERE e.worker_id = w.id)::int AS entries,
       (SELECT count(*) FROM workshop_adjustments a WHERE a.worker_id = w.id)::int AS adjustments
     FROM workshop_workers w JOIN users u ON u.id = w.user_id WHERE w.id = $1`,
    [id]
  );
  if (!cur.rows.length) return res.status(404).json({ error: 'العامل غير موجود', code: 'ERR_NOT_FOUND' });
  const worker = cur.rows[0];

  if (worker.entries > 0 || worker.adjustments > 0) {
    const parts = [];
    if (worker.entries > 0) parts.push(`${worker.entries} تسجيل قطع`);
    if (worker.adjustments > 0) parts.push(`${worker.adjustments} حافز/خصم`);
    return res.status(409).json({
      error: `ما ينحذف — عند ${worker.name} ${parts.join(' و')} بسجل الأجور. استخدم «إيقاف» حتى يبقى السجل.`,
      code: 'ERR_HAS_HISTORY',
    });
  }

  // A workshop-only login is retired with the roster row; a real staff account never is.
  const retireAccount = worker.role === 'worker';
  await tx(async (client) => {
    await client.query(`DELETE FROM workshop_workers WHERE id = $1`, [id]);
    if (retireAccount) {
      await client.query(
        `UPDATE users SET deleted_at = NOW(), token_version = token_version + 1, updated_at = NOW()
          WHERE id = $1 AND deleted_at IS NULL`,
        [worker.user_id]
      );
    }
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'workshop_worker_deleted', 'workshop_worker', $2, $3)`,
      [req.user.id, id, JSON.stringify({
        name: worker.name, user_id: worker.user_id, role: worker.role, account_retired: retireAccount,
      })]
    );
  });
  res.json({ ok: true, account_retired: retireAccount });
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

/**
 * Load a production entry and decide whether this caller may fix it.
 *
 * ⚠️ A PLAIN WORKER MAY EDIT AND DELETE THEIR OWN ROW, AND THAT IS DELIBERATE.
 * The reported problem is «العامل سجّل قطعة غلط وما يكدر يشيلها» — the worker records their
 * own piecework through `myProduction`, notices the mistake immediately, and today the only
 * repair is an admin on a laptop. Letting them fix their own row adds NO new power: they can
 * already create any entry they like for themselves through that same endpoint, so a worker
 * who wanted to inflate their wage never needed this door. What it removes is a wrong number
 * sitting in the ledger until someone else has time.
 * Everyone else's row still needs a lead or an admin, and both paths write an audit row —
 * this is money, so «منو غيّرها» has to be answerable afterwards.
 */
async function loadEntryFor(req, id) {
  if (!UUID_RE.test(String(id))) return { status: 400, error: 'معرّف غير صحيح', code: 'ERR_VALIDATION' };
  const { rows } = await query(
    // `to_char` over `e.*`'s own work_date — the audit row below quotes `before`, and a raw
    // DATE would put "2026-09-10T21:00:00.000Z" in the shop's only record of what the entry
    // used to say. The evidence has to read the day a human would.
    `SELECT e.*, to_char(e.work_date,'YYYY-MM-DD') AS work_date, w.user_id AS worker_user_id
       FROM workshop_production_entries e
       JOIN workshop_workers w ON w.id = e.worker_id WHERE e.id = $1`, [id]
  );
  if (!rows.length) return { status: 404, error: 'التسجيل غير موجود', code: 'ERR_NOT_FOUND' };
  const entry = rows[0];
  const privileged = req.user.role === 'admin' || (req.worker?.is_lead && req.worker.active);
  const mine = req.worker?.active && req.worker.id === entry.worker_id;
  if (!privileged && !mine) return { status: 403, error: 'ممنوع', code: 'ERR_FORBIDDEN' };
  return { entry };
}

/** Edit a recorded piece. The wage is ALWAYS recomputed from `workshop_piece_rates` —
 *  a client never sends `rate` or `amount`, exactly as on the insert path. */
async function updateProduction(req, res) {
  const found = await loadEntryFor(req, req.params.id);
  if (found.error) return res.status(found.status).json({ error: found.error, code: found.code });
  const { entry } = found;

  // Merge over the stored row so a partial edit (just the qty, say) is still validated as a
  // whole — product/operation/audience are a triple and only the triple has a price.
  const next = {
    product:   req.body?.product   ?? entry.product,
    operation: req.body?.operation ?? entry.operation,
    audience:  req.body?.audience  ?? entry.audience,
    qty:       req.body?.qty       ?? entry.qty,
    work_date: req.body?.work_date ?? null,
    note:      req.body?.note,
  };
  if (typeof next.qty === 'string' && next.qty.trim() !== '') next.qty = Number(next.qty);
  const invalid = validatePiece(next);
  if (invalid) return res.status(400).json({ error: invalid, code: 'ERR_VALIDATION' });

  const rate = await query(
    `SELECT amount FROM workshop_piece_rates WHERE operation = $1 AND product = $2 AND audience = $3`,
    [next.operation, next.product, next.audience]
  );
  const unitRate = n(rate.rows[0]?.amount);
  const amount = unitRate * next.qty;
  const note = req.body && 'note' in req.body ? (String(req.body.note || '').trim() || null) : entry.note;

  const updated = await tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE workshop_production_entries
          SET product = $2, operation = $3, audience = $4, qty = $5, rate = $6, amount = $7,
              work_date = COALESCE($8::date, work_date), note = $9
        WHERE id = $1
        RETURNING id, product, operation, audience, qty, rate, amount,
                  to_char(work_date,'YYYY-MM-DD') AS work_date, note, created_at`,
      [entry.id, next.product, next.operation, next.audience, next.qty, unitRate, amount,
       next.work_date || null, note]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'workshop_entry_updated', 'workshop_entry', $2, $3)`,
      [req.user.id, entry.id, JSON.stringify({
        worker_id: entry.worker_id,
        before: { product: entry.product, operation: entry.operation, audience: entry.audience,
                  qty: n(entry.qty), rate: n(entry.rate), amount: n(entry.amount),
                  work_date: entry.work_date, note: entry.note },
        after:  { product: next.product, operation: next.operation, audience: next.audience,
                  qty: next.qty, rate: unitRate, amount, note },
        by_self: req.worker?.id === entry.worker_id,
      })]
    );
    return rows[0];
  });
  res.json({ data: { ...updated, qty: n(updated.qty), rate: n(updated.rate), amount: n(updated.amount) } });
}

/** Remove a recorded piece. Hard delete — the row IS the wage, and a "cancelled" piece that
 *  still sat in the table would have to be filtered out of `ledgerFor`, `dashboard`,
 *  `listWorkers` and every SUM in this file, four places that must agree forever. The audit
 *  row below is the record that it existed, and it carries the whole entry. */
async function deleteProduction(req, res) {
  const found = await loadEntryFor(req, req.params.id);
  if (found.error) return res.status(found.status).json({ error: found.error, code: found.code });
  const { entry } = found;
  await tx(async (client) => {
    await client.query(`DELETE FROM workshop_production_entries WHERE id = $1`, [entry.id]);
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'workshop_entry_deleted', 'workshop_entry', $2, $3)`,
      [req.user.id, entry.id, JSON.stringify({
        worker_id: entry.worker_id, product: entry.product, operation: entry.operation,
        audience: entry.audience, qty: n(entry.qty), rate: n(entry.rate), amount: n(entry.amount),
        work_date: entry.work_date, note: entry.note,
        by_self: req.worker?.id === entry.worker_id,
      })]
    );
  });
  res.json({ ok: true });
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
            to_char(p.work_date,'YYYY-MM-DD') entry_date,p.note reason,p.created_at
       FROM workshop_production_entries p JOIN workshop_workers w ON w.id=p.worker_id JOIN users u ON u.id=w.user_id
     UNION ALL
     SELECT a.id,a.kind,u.name,NULL,NULL,NULL,0,0,a.amount,
            to_char(a.entry_date,'YYYY-MM-DD'),a.reason,a.created_at
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
  mySummary, myProduction, listWorkers, createWorker, updateWorker, deleteWorker, linkCandidates,
  listRates, upsertRate, createProduction, updateProduction, deleteProduction,
  createAdjustment, workerLedger, dashboard,
  validatePiece, insertProduction, ratesMatrix, ledgerFor,
  OPERATIONS, PRODUCTS, PRODUCT_OPS, AUDIENCES, AUDIENCE_LABEL_AR,
};
