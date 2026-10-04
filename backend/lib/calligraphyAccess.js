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

module.exports = { mayUseTool, mayPushOrder, allowToolUser, TOOL_STAFF_TYPES, PUSH_STAFF_TYPES };
