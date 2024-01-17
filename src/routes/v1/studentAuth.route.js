const express = require('express');
const validate = require('../../middlewares/validate');
const authValidation = require('../../validations/auth.validation');
const studentAuthController = require('../../controllers/studentAuth.controller');
const auth = require('../../middlewares/auth');

const router = express.Router();

router.post('/register', validate(authValidation.register), studentAuthController.register);
router.post('/login', studentAuthController.login);
router.post('/logout', validate(authValidation.logout), studentAuthController.logout);
router.post('/refresh-tokens', validate(authValidation.refreshTokens), studentAuthController.refreshTokens);
router.post('/forgot-password', validate(authValidation.forgotPassword), studentAuthController.forgotPassword);
router.post('/reset-password', validate(authValidation.resetPassword), studentAuthController.resetPassword);
router.post('/send-verification-email', auth(), studentAuthController.sendVerificationEmail);
router.post('/verify-email', validate(authValidation.verifyEmail), studentAuthController.verifyEmail);

module.exports = router;
