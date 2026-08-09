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

const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const otpLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });
const verifyLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

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
