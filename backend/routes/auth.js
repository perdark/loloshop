const router = require('express').Router();
const c = require('../controllers/authController');
const { authRequired } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const otpLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });
const verifyLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.post('/register', otpLimit, c.register);
router.post('/login', loginLimit, c.login);
router.post('/login-verify', verifyLimit, c.loginVerifyOtp);
router.get('/me', authRequired, c.me);
router.post('/verify-otp', verifyLimit, c.postVerifyOtp);
router.post('/resend-otp', otpLimit, c.resendOtp);
router.post('/forgot-password', otpLimit, c.forgotPassword);
router.post('/reset-password', verifyLimit, c.resetPassword);
router.post('/forgot-password-phone', otpLimit, c.forgotPasswordPhone);
router.post('/reset-password-phone', verifyLimit, c.resetPasswordPhone);

module.exports = router;
