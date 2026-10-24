'use strict';
// Who may use الخط العربي (and, since 2026-10-04, الاستوديو — the same audience). Two lists
// on purpose — see routes/calligraphy.js header.
// `embroiderer` was added 2026-09-02 (owner: «خليه يكدر يصمم ويستعمل الخط العربي»); he
// generates and downloads his own plates for his own station, and never pushes an order.
const { query } = require('./db');
const { staffTypesOf } = require('../middleware/auth');

const TOOL_STAFF_TYPES = ['manager', 'designer', 'embroiderer'];
const PUSH_STAFF_TYPES = ['manager', 'designer'];

function hasAny(user, types) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'staff') return false;
  return staffTypesOf(user).some((t) => types.includes(t));
}
const mayUseTool = (user) => hasAny(user, TOOL_STAFF_TYPES);
const mayPushOrder = (user) => hasAny(user, PUSH_STAFF_TYPES);

// Express middleware form of mayUseTool, extended with أيادي التصميم — an ACTIVE
// design_team member (محمد هيثم + his helpers), checked here rather than in the shared
// predicate above because it needs a DB lookup, not a role/staff_type check. Moved out of
// routes/calligraphy.js on 2026-10-04 so the Studio tool (routes/studio.js) shares the exact
// same gate instead of a second copy drifting from it. Behaviour is unchanged: membership
// must be active (a deactivated helper's still-valid JWT is rejected), mirroring
// designTeamController.attachTeamMember's fail-closed rule.
async function allowToolUser(req, res, next) {
  try {
    const u = req.user;
    if (!u) return res.status(401).json({ error: 'غير مصرح', code: 'ERR_AUTH' });
    if (mayUseTool(u)) return next();
    if (u.role === 'design_helper') {
      const { rows } = await query(
        `SELECT 1 FROM design_team_members WHERE user_id = $1 AND active = TRUE LIMIT 1`,
        [u.id]
      );
      if (rows.length) return next();
    }
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  } catch (err) {
    return next(err);
  }
}

// «تحويل للتطريز» — the order-level send. Owner 2026-10-25: «ايادي التصميم تكون تقريبا
// كموظفة تكدر تنطي تم للطلب». Measured on the 2026-10-25 prod dump: since 2026-09-09 every
// design that أيادي التصميم drew in this tool was pushed into التطريز by somebody else —
// 262 orders carry a helper's plate text and مضر's advance — so the work went down under the
// pusher's name in staff_activity_log. An ACTIVE member may now send it themselves, and the
// advance is written under THEIR id. Same fail-closed membership rule as allowToolUser.
// Still excluded: embroiderer (PUSH_STAFF_TYPES is unchanged) and a deactivated helper.
async function isActiveDesignMember(user) {
  if (!user || user.role !== 'design_helper') return false;
  const { rows } = await query(
    `SELECT 1 FROM design_team_members WHERE user_id = $1 AND active = TRUE LIMIT 1`,
    [user.id]
  );
  return rows.length > 0;
}

async function allowPushUser(req, res, next) {
  try {
    if (mayPushOrder(req.user)) return next();
    if (await isActiveDesignMember(req.user)) {
      req.designTeamPusher = true;
      return next();
    }
    return res.status(403).json({ error: 'ممنوع', code: 'ERR_FORBIDDEN' });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  mayUseTool, mayPushOrder, allowToolUser, allowPushUser, isActiveDesignMember,
  TOOL_STAFF_TYPES, PUSH_STAFF_TYPES,
};
