const router = require('express').Router();
const c = require('../controllers/authController');
const account = require('../controllers/accountController');
const { authRequired } = require('../middleware/auth');
const { normalizePhoneBody } = require('../lib/otp');
const rateLimit = require('express-rate-limit');
const { accountLoginLimit } = require('../lib/accountLoginLimit');

// Default a leading 0 onto phone numbers (e.g. 7713644460 → 07713644460) so a user
// who omits it still matches their account and receives the OTP.
router.use(normalizePhoneBody);

// ⚠️ EVERY LIMIT HERE IS PER EGRESS IP, AND IRAQI CARRIERS CGNAT — the same warning
// routes/join.js carries. Zain/Asiacell/Korek put whole regions behind a handful of public
// addresses, so "one IP" is routinely a whole cohort arriving within minutes of each other.
//
// These were raised on 2026-08-15 ahead of a large intake. That is safe ONLY because in every
// case the real control is per-phone or per-challenge and therefore IP-INDEPENDENT — raising
// the IP ceiling does not remove it:
//
//   · register / resend / forgot-password → `otp_send_events` caps sends at 5/hour PER PHONE,
//     inside a transaction holding a per-phone advisory lock (lib/otp.js createOtp). That is
//     the cap that actually protects the WhatsApp sender from a ban, and it cannot be escaped
//     by changing IP.
//   · verify-otp / login-verify → MAX_OTP_ATTEMPTS = 5 PER CHALLENGE, and a challenge id is a
//     UUID the caller must already have been given. Five wrong guesses burn it.
//   · login → `accountLoginLimit` caps 10/15min PER ACCOUNT (hashed identifier, successful
//     logins excluded), which is what actually stops password brute force.
//
// The IP limits below are now only a brake on bulk automation. They are env-tunable on
// purpose: during an intake the owner must be able to change a number with
// `pm2 restart loloshop-api --update-env` — no deploy, no laptop, no waiting for a developer.
// Lower them again the moment abuse shows up; the defaults here are chosen for a cohort, not
// for a quiet week.
const envInt = (key, fallback) => {
  const n = parseInt(process.env[key] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: envInt('LOGIN_IP_MAX', 100) });
const otpLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: envInt('OTP_IP_MAX_PER_HOUR', 60) });
const verifyLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: envInt('OTP_VERIFY_IP_MAX', 100) });

router.post('/register', otpLimit, c.register);
router.post('/login', loginLimit, accountLoginLimit, c.login);
router.post('/login-verify', verifyLimit, c.loginVerifyOtp);
router.get('/me', authRequired, c.me);
router.post('/verify-otp', verifyLimit, c.postVerifyOtp);
router.post('/resend-otp', otpLimit, c.resendOtp);
router.post('/forgot-password-phone', otpLimit, c.forgotPasswordPhone);
router.post('/reset-password-phone', verifyLimit, c.resetPasswordPhone);

// Self-service account deletion (Apple guideline 5.1.1(v)) — see accountController.
// The delete call takes the account password, so it is throttled like any other
// password check; the preview is a plain read and needs no extra limit.
const deleteLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
router.get('/account/deletion-preview', authRequired, account.deletionPreview);
router.post('/account/delete', authRequired, deleteLimit, account.deleteAccount);

// Private staff portal (phoneless staff: name + password, no OTP). Key-gated; see authController.
const portalLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
router.get('/staff-portal/members', portalLimit, c.staffPortalMembers);
router.post('/staff-portal-login', loginLimit, accountLoginLimit, c.staffPortalLogin);

module.exports = router;
