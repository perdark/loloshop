const router = require('express').Router();
const c = require('../controllers/authController');
const { authRequired } = require('../middleware/auth');
const { normalizePhoneBody } = require('../lib/otp');
const rateLimit = require('express-rate-limit');

// Default a leading 0 onto phone numbers (e.g. 7713644460 → 07713644460) so a user
// who omits it still matches their account and receives the OTP.
router.use(normalizePhoneBody);

const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const otpLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });
const verifyLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.post('/register', otpLimit, c.register);
router.post('/login', loginLimit, c.login);
router.post('/login-verify', verifyLimit, c.loginVerifyOtp);
router.get('/me', authRequired, c.me);
router.post('/verify-otp', verifyLimit, c.postVerifyOtp);
router.post('/resend-otp', otpLimit, c.resendOtp);
router.post('/forgot-password-phone', otpLimit, c.forgotPasswordPhone);
router.post('/reset-password-phone', verifyLimit, c.resetPasswordPhone);

// Private staff portal (phoneless staff: name + password, no OTP). Key-gated; see authController.
const portalLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
router.get('/staff-portal/members', portalLimit, c.staffPortalMembers);
router.post('/staff-portal-login', loginLimit, c.staffPortalLogin);

module.exports = router;
