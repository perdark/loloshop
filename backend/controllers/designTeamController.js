// أيادي التصميم — an isolated, retail-design-only collaboration desk.
//
// IMPORTANT: team accounts use users.role='design_helper', not role='staff'. That
// makes every existing attendance/payroll/general-production route deny them by
// default. This controller is their complete and deliberately narrow surface.

const bcrypt = require('bcrypt');
const { query, tx } = require('../lib/db');
const { signToken } = require('../middleware/auth');
const { publish } = require('../lib/eventBus');
const { secretMatches } = require('../lib/secretCompare');
const { publicUrl } = require('../lib/upload');
const { assertPasswordOk } = require('../lib/password');

const SALT_ROUNDS = 10;
const TEAM_ID = true;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 160;
const MAX_NOTE_LENGTH = 2000;
const MAX_REASON_LENGTH = 2000;

function httpError(status, error, code) {
  const err = new Error(error);
  err.status = status;
  err.code = code;
  return err;
}

function sendKnownError(res, err) {
  if (!err || !err.status) return false;
  res.status(err.status).json({ error: err.message, code: err.code || 'ERR_SERVER' });
  return true;
}

function validUuid(value) {
  return UUID_RE.test(String(value || ''));
}

function cleanOptional(value, maxLength) {
  if (value == null) return null;
  const clean = String(value).trim();
  if (!clean) return null;
  if (clean.length > maxLength) throw httpError(400, 'القيمة طويلة جداً', 'ERR_VALIDATION');
  return clean;
}

function requiredName(value) {
  const name = cleanOptional(value, MAX_NAME_LENGTH);
  if (!name) throw httpError(400, 'الاسم مطلوب', 'ERR_VALIDATION');
  return name;
}

function requiredPassword(value) {
  // design_helper accounts are privileged staff — see lib/password.js for the tiers.
  return assertPasswordOk(typeof value === 'string' ? value : String(value ?? ''), 'privileged');
}

function portalKeyOk(provided) {
  // Fail closed: unlike the normal staff portal this key reveals only the small
  // first-stage design team, and an absent key means the portal does not exist.
  return secretMatches(provided, process.env.DESIGN_TEAM_PORTAL_KEY);
}

function isActiveMember(req) {
  // The ACTIVE membership row IS the authorization — role-agnostic (2026-07-15):
  // محمد هيثم runs the desk from his normal STAFF (manager) account, while his helpers
  // stay role='design_helper'. Membership rows are only ever created by admin/lead
  // (createOrSetLead/createHelper), so this widens nothing beyond the roster.
  return !!req.designTeamMember?.active;
}

function isLead(req) {
  return isActiveMember(req) && req.designTeamMember.member_role === 'lead';
}

function canManage(req) {
  return req.user?.role === 'admin' || isLead(req);
}

// Attach the active roster record without granting access by itself. Admin is
// intentionally allowed through the module even without a membership row.
async function attachTeamMember(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT id, team_id, member_role, active
         FROM design_team_members
        WHERE user_id = $1 AND team_id = $2 AND active = TRUE`,
      [req.user.id, TEAM_ID]
    );
    req.designTeamMember = rows[0] || null;
    next();
  } catch (err) {
    next(err);
  }
}

function requireTeamAccess(req, res, next) {
  if (req.user?.role === 'admin' || isActiveMember(req)) return next();
  return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
}

// Claiming and marking ready are actual team work, not an admin action.
function requireTeamWorker(req, res, next) {
  if (isActiveMember(req)) return next();
  return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
}

function requireTeamLead(req, res, next) {
  if (canManage(req)) return next();
  return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
}

function memberDto(row) {
  if (!row) return null;
  // `id` is deliberately the user id so the frontend can pass it directly to
  // PATCH/DELETE /members/:userId. membership_id remains available for diagnostics.
  return {
    id: row.user_id,
    user_id: row.user_id,
    membership_id: row.membership_id || row.id,
    name: row.name,
    email: row.email || null,
    member_role: row.member_role,
    active: !!row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function memberRows(client = null) {
  const db = client || { query };
  const { rows } = await db.query(
    `SELECT m.id AS membership_id, m.user_id, m.member_role, m.active,
            m.created_at, m.updated_at, u.name, u.email
       FROM design_team_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.team_id = $1
      ORDER BY CASE WHEN m.member_role = 'lead' THEN 0 ELSE 1 END,
               m.active DESC, u.name ASC`,
    [TEAM_ID]
  );
  return rows;
}

async function memberByUserId(userId, client = null) {
  const db = client || { query };
  const { rows } = await db.query(
    `SELECT m.id AS membership_id, m.user_id, m.member_role, m.active,
            m.created_at, m.updated_at, u.name, u.email
       FROM design_team_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.team_id = $1 AND m.user_id = $2`,
    [TEAM_ID, userId]
  );
  return rows[0] || null;
}

async function teamSummary(client = null) {
  const db = client || { query };
  const { rows } = await db.query(
    `SELECT t.id, t.name_ar, t.helper_limit,
            COUNT(m.user_id) FILTER (
              WHERE m.active = TRUE AND m.member_role = 'helper'
            )::int AS active_helper_count
       FROM design_teams t
       LEFT JOIN design_team_members m ON m.team_id = t.id
      WHERE t.id = $1
      GROUP BY t.id, t.name_ar, t.helper_limit`,
    [TEAM_ID]
  );
  return rows[0] || null;
}

// ── Private, no-OTP portal ───────────────────────────────────────────────────

async function portalMembers(req, res) {
  if (!portalKeyOk(req.query.key)) {
    return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  }
  const { rows } = await query(
    `SELECT u.id, u.name
       FROM design_team_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.team_id = $1
        AND m.active = TRUE
        AND u.role = 'design_helper'
      ORDER BY CASE WHEN m.member_role = 'lead' THEN 0 ELSE 1 END, u.name ASC`,
    [TEAM_ID]
  );
  res.json({ data: rows });
}

async function portalLogin(req, res) {
  const { key, user_id, password } = req.body || {};
  if (!portalKeyOk(key)) {
    return res.status(404).json({ error: 'غير موجود', code: 'ERR_NOT_FOUND' });
  }
  if (!validUuid(user_id) || !password) {
    return res.status(401).json({ error: 'بيانات خاطئة', code: 'ERR_INVALID_CREDENTIALS' });
  }
  const { rows } = await query(
    `SELECT u.id, u.name, u.role, u.password_hash
       FROM users u
       JOIN design_team_members m ON m.user_id = u.id
      WHERE u.id = $1
        AND u.role = 'design_helper'
        AND m.team_id = $2
        AND m.active = TRUE`,
    [user_id, TEAM_ID]
  );
  if (!rows.length || !(await bcrypt.compare(String(password), rows[0].password_hash))) {
    return res.status(401).json({ error: 'بيانات خاطئة', code: 'ERR_INVALID_CREDENTIALS' });
  }
  const user = rows[0];
  res.json({ token: signToken(user), user: { id: user.id, name: user.name, role: user.role } });
}

// ── Session / roster ─────────────────────────────────────────────────────────

async function session(req, res) {
  const summary = await teamSummary();
  if (!summary) return res.status(404).json({ error: 'الفريق غير موجود', code: 'ERR_NOT_FOUND' });
  const manage = canManage(req);
  const team = {
    id: summary.id,
    name_ar: summary.name_ar,
    helper_limit: Number(summary.helper_limit),
    active_helper_count: Number(summary.active_helper_count || 0),
  };
  if (manage) {
    // A portal path is only returned to the admin/lead who can share it. Helpers
    // can log in with a received link but are not a portal-key distribution UI.
    if (process.env.DESIGN_TEAM_PORTAL_KEY) {
      team.portal_path = `/d/${encodeURIComponent(process.env.DESIGN_TEAM_PORTAL_KEY)}`;
    }
    team.members = (await memberRows()).map(memberDto);
  }
  res.json({
    data: {
      viewer: {
        id: req.user.id,
        name: req.user.name,
        member_role: isActiveMember(req) ? req.designTeamMember.member_role : null,
        is_lead: isLead(req),
        can_manage: manage,
      },
      team,
    },
  });
}

async function listMembers(req, res) {
  res.json({ data: (await memberRows()).map(memberDto) });
}

async function ensureEmailFree(client, email, exceptUserId = null) {
  if (!email) return;
  const params = exceptUserId ? [email, exceptUserId] : [email];
  const sql = exceptUserId
    ? `SELECT id FROM users WHERE email = $1 AND id <> $2 LIMIT 1`
    : `SELECT id FROM users WHERE email = $1 LIMIT 1`;
  const { rows } = await client.query(sql, params);
  if (rows.length) throw httpError(409, 'البريد الإلكتروني مستخدم', 'ERR_EMAIL_TAKEN');
}

async function lockTeam(client) {
  const { rows } = await client.query(
    `SELECT id, helper_limit FROM design_teams WHERE id = $1 FOR UPDATE`,
    [TEAM_ID]
  );
  if (!rows.length) throw httpError(404, 'الفريق غير موجود', 'ERR_NOT_FOUND');
  return rows[0];
}

// Admin-only. Either create a new, phoneless dedicated lead account (the normal
// Muhammad setup) or promote an existing design_helper account by user_id.
async function createOrSetLead(req, res) {
  const body = req.body || {};
  try {
    let userId;
    if (body.user_id != null && String(body.user_id).trim() !== '') {
      if (!validUuid(body.user_id)) throw httpError(400, 'مستخدم غير صحيح', 'ERR_VALIDATION');
      userId = String(body.user_id);
    } else {
      requiredName(body.name);
      requiredPassword(body.password);
    }

    const result = await tx(async (client) => {
      await lockTeam(client);
      if (userId) {
        const found = await client.query(
          `SELECT id, role FROM users WHERE id = $1 FOR UPDATE`,
          [userId]
        );
        if (!found.rows.length || found.rows[0].role !== 'design_helper') {
          throw httpError(404, 'حساب فريق التصميم غير موجود', 'ERR_NOT_FOUND');
        }
      } else {
        const name = requiredName(body.name);
        const password = requiredPassword(body.password);
        const email = cleanOptional(body.email, MAX_EMAIL_LENGTH);
        await ensureEmailFree(client, email);
        const hash = await bcrypt.hash(password, SALT_ROUNDS);
        const created = await client.query(
          `INSERT INTO users (name, email, password_hash, role, phone_verified)
           VALUES ($1, $2, $3, 'design_helper', TRUE)
           RETURNING id`,
          [name, email, hash]
        );
        userId = created.rows[0].id;
      }

      // The partial unique index permits exactly one active lead. Deactivate first
      // so an existing helper promoted to lead can be upserted safely.
      await client.query(
        `UPDATE design_team_members
            SET active = FALSE
          WHERE team_id = $1 AND active = TRUE AND member_role = 'lead'`,
        [TEAM_ID]
      );
      await client.query(
        `INSERT INTO design_team_members (team_id, user_id, member_role, active)
         VALUES ($1, $2, 'lead', TRUE)
         ON CONFLICT (user_id) DO UPDATE
           SET team_id = EXCLUDED.team_id, member_role = 'lead', active = TRUE`,
        [TEAM_ID, userId]
      );
      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
         VALUES ($1, 'design_team_set_lead', 'user', $2, $3)`,
        [req.user.id, userId, JSON.stringify({ team: 'design_team' })]
      );
      return userId;
    });
    const member = await memberByUserId(result);
    res.status(201).json({ data: memberDto(member) });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'تعذر تعيين قائد الفريق', code: 'ERR_DUPLICATE' });
    }
    throw err;
  }
}

async function createHelper(req, res) {
  const body = req.body || {};
  try {
    const name = requiredName(body.name);
    const password = requiredPassword(body.password);
    const email = cleanOptional(body.email, MAX_EMAIL_LENGTH);
    const result = await tx(async (client) => {
      const team = await lockTeam(client);
      const count = await client.query(
        `SELECT COUNT(*)::int AS count
           FROM design_team_members
          WHERE team_id = $1 AND active = TRUE AND member_role = 'helper'`,
        [TEAM_ID]
      );
      if (Number(count.rows[0].count) >= Number(team.helper_limit)) {
        throw httpError(409, 'تم الوصول إلى الحد الأقصى لعضوين في الفريق', 'ERR_HELPER_LIMIT');
      }
      await ensureEmailFree(client, email);
      const hash = await bcrypt.hash(password, SALT_ROUNDS);
      const created = await client.query(
        `INSERT INTO users (name, email, password_hash, role, phone_verified)
         VALUES ($1, $2, $3, 'design_helper', TRUE)
         RETURNING id`,
        [name, email, hash]
      );
      const userId = created.rows[0].id;
      await client.query(
        `INSERT INTO design_team_members (team_id, user_id, member_role, active)
         VALUES ($1, $2, 'helper', TRUE)`,
        [TEAM_ID, userId]
      );
      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
         VALUES ($1, 'design_team_add_helper', 'user', $2, $3)`,
        [req.user.id, userId, JSON.stringify({ team: 'design_team' })]
      );
      return userId;
    });
    const member = await memberByUserId(result);
    res.status(201).json({ data: memberDto(member) });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'تعذر إضافة عضو الفريق', code: 'ERR_DUPLICATE' });
    }
    throw err;
  }
}

async function updateMember(req, res) {
  const { userId } = req.params;
  if (!validUuid(userId)) return res.status(400).json({ error: 'مستخدم غير صحيح', code: 'ERR_VALIDATION' });
  try {
    const result = await tx(async (client) => {
      const team = await lockTeam(client);
      const current = await memberByUserId(userId, client);
      if (!current) throw httpError(404, 'عضو الفريق غير موجود', 'ERR_NOT_FOUND');
      // A lead may administrate the two helpers, but not another/current lead.
      if (req.user.role !== 'admin' && current.member_role !== 'helper') {
        throw httpError(403, 'يمكن للقائد تعديل أعضاء الفريق فقط', 'ERR_FORBIDDEN');
      }
      // The lead is replaced using POST /lead so the singleton always remains valid.
      if (current.member_role === 'lead' && req.body?.active === false) {
        throw httpError(409, 'عيّن قائداً جديداً قبل إيقاف القائد الحالي', 'ERR_LEAD_REQUIRED');
      }

      const userSets = [];
      const userValues = [];
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
        userValues.push(requiredName(req.body.name));
        userSets.push(`name = $${userValues.length}`);
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'email')) {
        const email = cleanOptional(req.body.email, MAX_EMAIL_LENGTH);
        await ensureEmailFree(client, email, userId);
        userValues.push(email);
        userSets.push(`email = $${userValues.length}`);
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'password')) {
        userValues.push(await bcrypt.hash(requiredPassword(req.body.password), SALT_ROUNDS));
        userSets.push(`password_hash = $${userValues.length}`);
      }
      if (userSets.length) {
        userValues.push(userId);
        await client.query(
          `UPDATE users SET ${userSets.join(', ')} WHERE id = $${userValues.length}`,
          userValues
        );
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'active')) {
        if (typeof req.body.active !== 'boolean') {
          throw httpError(400, 'حالة العضو غير صالحة', 'ERR_VALIDATION');
        }
        // Reactivating a helper consumes the same scarce capacity as creating
        // one. The team row is locked above, so concurrent reactivations cannot
        // exceed the two-active-helper limit.
        if (req.body.active && !current.active && current.member_role === 'helper') {
          const active = await client.query(
            `SELECT COUNT(*)::int AS count
               FROM design_team_members
              WHERE team_id = $1
                AND active = TRUE
                AND member_role = 'helper'
                AND user_id <> $2`,
            [TEAM_ID, userId]
          );
          if (Number(active.rows[0].count) >= Number(team.helper_limit)) {
            throw httpError(409, 'تم الوصول إلى الحد الأقصى لعضوين في الفريق', 'ERR_HELPER_LIMIT');
          }
        }
        await client.query(
          `UPDATE design_team_members SET active = $1 WHERE team_id = $2 AND user_id = $3`,
          [req.body.active, TEAM_ID, userId]
        );
        if (!req.body.active && current.active && current.member_role === 'helper') {
          await client.query(
            `UPDATE design_team_tasks
                SET assigned_to = NULL, assigned_at = NULL,
                    ready_by = NULL, ready_at = NULL, updated_by = $2
              WHERE team_id = $1
                AND assigned_to = $3
                AND status = 'open'
                AND resolved_at IS NULL`,
            [TEAM_ID, req.user.id, userId]
          );
        }
      }
      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
         VALUES ($1, 'design_team_update_member', 'user', $2, $3)`,
        [req.user.id, userId, JSON.stringify({ fields: Object.keys(req.body || {}) })]
      );
      return userId;
    });
    res.json({ data: memberDto(await memberByUserId(result)) });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'البريد الإلكتروني مستخدم', code: 'ERR_EMAIL_TAKEN' });
    }
    throw err;
  }
}

async function deactivateMember(req, res) {
  const { userId } = req.params;
  if (!validUuid(userId)) return res.status(400).json({ error: 'مستخدم غير صحيح', code: 'ERR_VALIDATION' });
  try {
    const result = await tx(async (client) => {
      await lockTeam(client);
      const current = await memberByUserId(userId, client);
      if (!current) throw httpError(404, 'عضو الفريق غير موجود', 'ERR_NOT_FOUND');
      if (current.member_role !== 'helper') {
        throw httpError(403, 'استخدم تعيين قائد جديد بدلاً من إزالة القائد', 'ERR_FORBIDDEN');
      }
      if (req.user.role !== 'admin' && !isLead(req)) {
        throw httpError(403, 'ممنوع', 'ERR_FORBIDDEN');
      }
      await client.query(
        `UPDATE design_team_members SET active = FALSE WHERE team_id = $1 AND user_id = $2`,
        [TEAM_ID, userId]
      );
      // Do not leave an unfinished task owned by someone who no longer has
      // access. A ready task stays ready for Muhammad's decision, but an open
      // claim returns to the shared board for the remaining team member.
      await client.query(
        `UPDATE design_team_tasks
            SET assigned_to = NULL, assigned_at = NULL,
                ready_by = NULL, ready_at = NULL, updated_by = $2
          WHERE team_id = $1
            AND assigned_to = $3
            AND status = 'open'
            AND resolved_at IS NULL`,
        [TEAM_ID, req.user.id, userId]
      );
      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
         VALUES ($1, 'design_team_deactivate_helper', 'user', $2, $3)`,
        [req.user.id, userId, JSON.stringify({ team: 'design_team' })]
      );
      return userId;
    });
    res.json({ data: { id: result, active: false } });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    throw err;
  }
}

// ── Retail design-job projection ─────────────────────────────────────────────
// The desk works REAL retail orders sitting at the first design stage — the ones
// the (removed) student Fabric designer used to feed. A typed-spec retail order
// arrives as design_id IS NULL, has_embroidery = TRUE, status = 'design_complete'.
// The query is deliberately allow-listed: no phone, gender, price, cost, checkout,
// intake, delivery, or measurements. The team sees only the visual spec it must
// design — the color / per-side embroidery text + reference photos + the final art.
const JOB_WHERE = `
   WHERE s.wholesaler_id IS NULL
     AND o.status = 'design_complete'
     AND o.design_id IS NULL
     AND o.has_embroidery = TRUE
     AND o.returned_to_customer = FALSE`;

const JOB_SELECT = `
  SELECT o.id AS order_id, o.status, o.created_at, o.final_design_url, o.notes AS order_notes,
         u.name AS student_name, u.phone AS student_phone,
         s.full_name_third, s.gender, s.university_name, s.department, s.instagram_username,
         cg.instagram_username AS cg_instagram, cg.phone_primary AS cg_phone,
         cg.event_date, cg.governorate, cg.notes AS cg_notes,
         p.name_ar AS product_name_ar, p.type AS product_type,
         t.status AS task_status, t.note AS task_note,
         t.assigned_to AS task_assigned_to, t.assigned_at,
         assigned.name AS assigned_name,
         t.ready_by AS task_ready_by, t.ready_at, ready.name AS ready_name,
         COALESCE(spec.lines, '[]'::json) AS spec_lines
    FROM orders o
    JOIN students s ON s.id = o.student_id
    JOIN users u ON u.id = s.user_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN checkout_groups cg ON cg.id = o.checkout_group_id
    LEFT JOIN design_team_tasks t
      ON t.order_id = o.id AND t.team_id = TRUE AND t.resolved_at IS NULL
    LEFT JOIN users assigned ON assigned.id = t.assigned_to
    LEFT JOIN users ready ON ready.id = t.ready_by
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
               'label', oi.label_snapshot,
               'text', oi.customer_text,
               'image_url', oi.customer_image_url
             ) ORDER BY oi.id) AS lines
        FROM order_items oi
       WHERE oi.order_id = o.id
         AND (oi.customer_text IS NOT NULL OR oi.customer_image_url IS NOT NULL)
    ) spec ON TRUE`;

// Normalize an Instagram handle for display + a clean profile link (strip @, URL, spaces).
function cleanInstagram(value) {
  if (!value) return null;
  let h = String(value).trim();
  if (!h) return null;
  h = h.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/\/.*$/, '').replace(/\s+/g, '');
  return h || null;
}

function jobDto(row) {
  if (!row) return null;
  return {
    order_id: row.order_id,
    status: row.status,
    created_at: row.created_at,
    final_design_url: row.final_design_url || null,
    student: {
      name: row.student_name,
      full_name: row.full_name_third || row.student_name || null,
      university_name: row.university_name || null,
      department: row.department || null,
      gender: row.gender || null,
      instagram: cleanInstagram(row.instagram_username || row.cg_instagram),
      phone: row.student_phone || row.cg_phone || null,
      event_date: row.event_date || null,
      governorate: row.governorate || null,
      notes: row.order_notes || row.cg_notes || null,
    },
    product: {
      name_ar: row.product_name_ar,
      type: row.product_type,
    },
    spec_lines: Array.isArray(row.spec_lines)
      ? row.spec_lines
          .filter((l) => l && (l.text || l.image_url))
          .map((l) => ({ label: l.label || null, text: l.text || null, image_url: l.image_url || null }))
      : [],
    task: row.task_status
      ? {
          status: row.task_status,
          note: row.task_note || null,
          assigned_to: row.task_assigned_to
            ? { id: row.task_assigned_to, name: row.assigned_name || null }
            : null,
          assigned_at: row.assigned_at || null,
          ready_by: row.task_ready_by
            ? { id: row.task_ready_by, name: row.ready_name || null }
            : null,
          ready_at: row.ready_at || null,
        }
      : null,
  };
}

async function jobByOrderId(orderId, client = null) {
  const db = client || { query };
  const { rows } = await db.query(`${JOB_SELECT} ${JOB_WHERE} AND o.id = $1 LIMIT 1`, [orderId]);
  return rows[0] || null;
}

async function listJobs(req, res) {
  const { rows } = await query(
    `${JOB_SELECT} ${JOB_WHERE}
       ORDER BY CASE WHEN t.status = 'ready' THEN 0 ELSE 1 END,
                o.created_at ASC`
  );
  res.json({ data: rows.map(jobDto) });
}

async function getJob(req, res) {
  const { orderId } = req.params;
  if (!validUuid(orderId)) return res.status(400).json({ error: 'الطلب غير صحيح', code: 'ERR_VALIDATION' });
  const row = await jobByOrderId(orderId);
  if (!row) return res.status(404).json({ error: 'مهمة التصميم غير موجودة', code: 'ERR_NOT_FOUND' });
  res.json({ data: jobDto(row) });
}

// Lock the order before changing a task or making a lead decision. The retail +
// first-design-stage predicates live here as a second server-side boundary; a
// caller cannot spoof an order id from another source (wholesaler) or stage.
async function lockRetailPendingOrder(client, orderId) {
  const o = await client.query(
    `SELECT o.id, o.student_id, s.user_id AS student_user_id
       FROM orders o
       JOIN students s ON s.id = o.student_id
      WHERE o.id = $1
        AND s.wholesaler_id IS NULL
        AND o.status = 'design_complete'
        AND o.design_id IS NULL
        AND o.has_embroidery = TRUE
        AND o.returned_to_customer = FALSE
      FOR UPDATE OF o`,
    [orderId]
  );
  if (!o.rows.length) return null;
  return {
    orderId,
    studentId: o.rows[0].student_id,
    studentUserId: o.rows[0].student_user_id,
  };
}

async function claimJob(req, res) {
  const { orderId } = req.params;
  if (!validUuid(orderId)) return res.status(400).json({ error: 'الطلب غير صحيح', code: 'ERR_VALIDATION' });
  try {
    const outcome = await tx(async (client) => {
      const job = await lockRetailPendingOrder(client, orderId);
      if (!job) return { missing: true };
      const claimed = await client.query(
        `INSERT INTO design_team_tasks
           (order_id, team_id, status, note, assigned_to, assigned_at, ready_by, ready_at, resolved_at, updated_by)
         VALUES ($1, $2, 'open', NULL, $3, NOW(), NULL, NULL, NULL, $3)
         ON CONFLICT (order_id) DO UPDATE
           SET status = 'open', note = NULL,
               assigned_to = EXCLUDED.assigned_to, assigned_at = NOW(),
               ready_by = NULL, ready_at = NULL, resolved_at = NULL,
               updated_by = EXCLUDED.updated_by
         WHERE design_team_tasks.resolved_at IS NOT NULL
            OR (design_team_tasks.status = 'open'
                AND (design_team_tasks.assigned_to IS NULL
                     OR design_team_tasks.assigned_to = EXCLUDED.assigned_to))
         RETURNING order_id`,
        [orderId, TEAM_ID, req.user.id]
      );
      if (!claimed.rows.length) return { conflict: true };
      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
         VALUES ($1, 'design_team_claim', 'order', $2, $3)`,
        [req.user.id, orderId, JSON.stringify({ team: 'design_team' })]
      );
      return { ok: true };
    });
    if (outcome.missing) return res.status(404).json({ error: 'مهمة التصميم غير موجودة', code: 'ERR_NOT_FOUND' });
    if (outcome.conflict) return res.status(409).json({ error: 'المهمة قيد العمل أو جاهزة للمراجعة', code: 'ERR_TASK_UNAVAILABLE' });
    res.json({ data: jobDto(await jobByOrderId(orderId)) });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    throw err;
  }
}

async function markReady(req, res) {
  const { orderId } = req.params;
  if (!validUuid(orderId)) return res.status(400).json({ error: 'الطلب غير صحيح', code: 'ERR_VALIDATION' });
  let note;
  try {
    note = cleanOptional(req.body?.note, MAX_NOTE_LENGTH);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    throw err;
  }
  try {
    const outcome = await tx(async (client) => {
      const job = await lockRetailPendingOrder(client, orderId);
      if (!job) return { missing: true };
      const override = isLead(req);
      const ready = await client.query(
        `INSERT INTO design_team_tasks
           (order_id, team_id, status, note, assigned_to, assigned_at, ready_by, ready_at, resolved_at, updated_by)
         VALUES ($1, $2, 'ready', $3, $4, NOW(), $4, NOW(), NULL, $4)
         ON CONFLICT (order_id) DO UPDATE
           SET status = 'ready', note = EXCLUDED.note,
               assigned_to = CASE
                 WHEN design_team_tasks.resolved_at IS NOT NULL THEN EXCLUDED.assigned_to
                 ELSE COALESCE(design_team_tasks.assigned_to, EXCLUDED.assigned_to)
               END,
               assigned_at = CASE
                 WHEN design_team_tasks.resolved_at IS NOT NULL THEN NOW()
                 ELSE design_team_tasks.assigned_at
               END,
               ready_by = EXCLUDED.ready_by, ready_at = NOW(), resolved_at = NULL,
               updated_by = EXCLUDED.updated_by
         WHERE design_team_tasks.resolved_at IS NOT NULL
            OR (design_team_tasks.status = 'open'
                AND ($5::boolean
                     OR design_team_tasks.assigned_to IS NULL
                     OR design_team_tasks.assigned_to = EXCLUDED.assigned_to))
         RETURNING order_id`,
        [orderId, TEAM_ID, note, req.user.id, override]
      );
      if (!ready.rows.length) return { conflict: true };
      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
         VALUES ($1, 'design_team_ready', 'order', $2, $3)`,
        [req.user.id, orderId, JSON.stringify({ has_note: !!note })]
      );
      return { ok: true };
    });
    if (outcome.missing) return res.status(404).json({ error: 'مهمة التصميم غير موجودة', code: 'ERR_NOT_FOUND' });
    if (outcome.conflict) return res.status(409).json({ error: 'المهمة يعمل عليها عضو آخر', code: 'ERR_TASK_UNAVAILABLE' });
    res.json({ data: jobDto(await jobByOrderId(orderId)) });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    throw err;
  }
}

// A helper (or admin) uploads the finished design artwork onto the order. Same
// storage path as the staff designer's final-design upload; scoped to the desk.
async function uploadFinalDesign(req, res) {
  const { orderId } = req.params;
  if (!validUuid(orderId)) return res.status(400).json({ error: 'الطلب غير صحيح', code: 'ERR_VALIDATION' });
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف', code: 'ERR_VALIDATION' });
  const url = publicUrl(req, 'images', req.file.filename);
  const outcome = await tx(async (client) => {
    const job = await lockRetailPendingOrder(client, orderId);
    if (!job) return null;
    await client.query(`UPDATE orders SET final_design_url = $1 WHERE id = $2`, [url, orderId]);
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'final_design', 'order', $2, $3)`,
      [req.user.id, orderId, JSON.stringify({ url, design_team: true })]
    );
    return job;
  });
  if (!outcome) return res.status(404).json({ error: 'مهمة التصميم غير موجودة', code: 'ERR_NOT_FOUND' });
  res.json({ data: { url } });
}

// ── Lead decisions ───────────────────────────────────────────────────────────
// Only an active lead (محمد هيثم) or an admin reaches these. Approve pushes the
// order forward into the normal production pipeline (design_complete → embroidery;
// stage-2 «التحويل» removed 2026-07-15), exactly like the staff designer's advance.
// Reject bounces the task back to the helper with a note WITHOUT touching the
// order — an internal rework, not a send-back to the student.
async function approveJob(req, res) {
  const { orderId } = req.params;
  if (!validUuid(orderId)) return res.status(400).json({ error: 'الطلب غير صحيح', code: 'ERR_VALIDATION' });
  const result = await tx(async (client) => {
    const job = await lockRetailPendingOrder(client, orderId);
    if (!job) return null;
    await client.query(
      `UPDATE orders
          SET status = 'embroidery', working_staff_id = NULL, working_since = NULL
        WHERE id = $1`,
      [orderId]
    );
    await client.query(
      `UPDATE design_team_tasks SET resolved_at = NOW(), status = 'ready', updated_by = $2
        WHERE order_id = $1`,
      [orderId, req.user.id]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'approve_design', 'order', $2, $3)`,
      [req.user.id, orderId, JSON.stringify({ design_team: true })]
    );
    await client.query(
      `INSERT INTO notifications (user_id, type, title_ar, body_ar, link)
       VALUES ($1, 'design_approved', $2, $3, '/')`,
      [job.studentUserId, 'تمت الموافقة على تصميمك', 'اعتُمد تصميم الوشاح وانتقل إلى التطريز']
    );
    return job;
  });
  if (!result) return res.status(404).json({ error: 'مهمة التصميم غير موجودة', code: 'ERR_NOT_FOUND' });
  publish({ type: 'order', orderId, status: 'embroidery' });
  publish({ type: 'presence', orderId, working_staff_id: null, working_staff_name: null });
  res.json({ data: { id: orderId, approval_status: 'approved', advanced: 1 } });
}

async function rejectJob(req, res) {
  const { orderId } = req.params;
  if (!validUuid(orderId)) return res.status(400).json({ error: 'الطلب غير صحيح', code: 'ERR_VALIDATION' });
  let reason;
  try {
    reason = cleanOptional(req.body?.reason, MAX_REASON_LENGTH);
    if (!reason) throw httpError(400, 'يرجى كتابة سبب الإعادة', 'ERR_VALIDATION');
  } catch (err) {
    if (sendKnownError(res, err)) return;
    throw err;
  }
  const result = await tx(async (client) => {
    const job = await lockRetailPendingOrder(client, orderId);
    if (!job) return null;
    // Reopen the task for the helper with the lead's note. The order stays at
    // design_complete in the desk — the design was not accepted, but nothing in
    // production changes until it is approved.
    const reopened = await client.query(
      `UPDATE design_team_tasks
          SET status = 'open', note = $2, ready_by = NULL, ready_at = NULL,
              resolved_at = NULL, updated_by = $3
        WHERE order_id = $1
        RETURNING order_id`,
      [orderId, reason, req.user.id]
    );
    if (!reopened.rows.length) return { noTask: true, job };
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'design_team_reject', 'order', $2, $3)`,
      [req.user.id, orderId, JSON.stringify({ reason, design_team: true })]
    );
    return { job };
  });
  if (!result) return res.status(404).json({ error: 'مهمة التصميم غير موجودة', code: 'ERR_NOT_FOUND' });
  if (result.noTask) return res.status(409).json({ error: 'لا توجد مهمة قيد المراجعة لإعادتها', code: 'ERR_TASK_UNAVAILABLE' });
  res.json({ data: { id: orderId, approval_status: 'reopened' } });
}

module.exports = {
  attachTeamMember,
  requireTeamAccess,
  requireTeamWorker,
  requireTeamLead,
  portalMembers,
  portalLogin,
  session,
  listMembers,
  createOrSetLead,
  createHelper,
  updateMember,
  deactivateMember,
  listJobs,
  getJob,
  claimJob,
  markReady,
  uploadFinalDesign,
  approveJob,
  rejectJob,
};
