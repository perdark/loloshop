'use strict';
// Who may use الخط العربي. Two lists on purpose — see routes/calligraphy.js header.
// `embroiderer` was added 2026-09-02 (owner: «خليه يكدر يصمم ويستعمل الخط العربي»); he
// generates and downloads plates + DST for his own station and never pushes an order.
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

module.exports = { mayUseTool, mayPushOrder, TOOL_STAFF_TYPES, PUSH_STAFF_TYPES };
