// backend/routes/app.js — the app-presence beacon, for EVERY signed-in role.
//
// ⚠️ WHY THIS IS NOT ON routes/staff.js. That router is `authRequired, requireRole('staff')` for
// its whole length, so the 084 beacon it carries can only ever be reached by staff — which is
// exactly why students and ممثلين had no usage signal at all. This router is authRequired only.
//
// ⚠️ STAFF WRITE BOTH TABLES FROM THIS ONE REQUEST. `staff_app_opens` feeds the nightly staff
// report and sits beside payroll rules, so it is not widened or replaced; it is written in
// addition. Staff therefore still cost exactly one request, and the old /staff/app-open
// endpoint keeps working for any client that has not been updated.

const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { authRequired } = require('../middleware/auth');
const appPresence = require('../lib/appPresence');
const staffPresence = require('../lib/staffPresence');

router.use(authRequired);

// Called from the ROOT layout on every mount and every return-to-foreground. Answers 204 even
// when limited, so a tripped limit is invisible to the person using the app.
const openLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  handler: (req, res) => res.status(204).end(),
});

/**
 * POST /api/app/open — «التطبيق مفتوح هسه».
 *
 * ALWAYS 204, success or failure. This is a fire-and-forget beacon on the root layout: a
 * student mid-checkout must never see an error, a spinner or a retry because a stats write
 * failed. A tracking endpoint that can break a page is worse than no tracking.
 */
router.post('/open', openLimit, async (req, res) => {
  const platform = req.body && req.body.platform;
  try {
    await appPresence.recordOpen({ userId: req.user.id, platform });
    if (req.user.role === 'staff') {
      // Kept in sync with 084 deliberately — see the header.
      await staffPresence.recordAppOpen({ userId: req.user.id, platform });
    }
  } catch (err) {
    console.error('app-open track failed:', err.message);
  }
  return res.status(204).end();
});

module.exports = router;
