const express = require('express');
const validate = require('../../middlewares/validate');
const v = require('../../validations/agreement.validation');
const c = require('../../controllers/agreement.controller');
const { accessRequestIpLimiter } = require('../../middlewares/rateLimiter');
const { requireAuth, requireReviewer, requireAdmin, requireSubAgent } = require('../../middlewares/subAgentScope');

const router = express.Router();

/**
 * Sub-agent agreements.
 *
 * Three audiences, three gates:
 *   /sign/:token   public — the partner, holding the emailed single-use link
 *   /mine          the signed-in sub-agent, their own completed agreement
 *   everything else  reviewers (admins for settings and the signatory's signature)
 *
 * Nothing public writes anything except the partner's own signature or
 * decline on the agreement the token names, and only while it is open.
 */

// ---- public: the signing page ------------------------------------------
router.get('/sign/:token', accessRequestIpLimiter, validate(v.tokenParam), c.openForSigning);
router.post('/sign/:token', accessRequestIpLimiter, validate(v.signAgreement), c.sign);
router.post('/sign/:token/decline', accessRequestIpLimiter, validate(v.declineAgreement), c.declineSigning);

// ---- the partner's own copy -------------------------------------------------
router.get('/mine', requireAuth, requireSubAgent, c.mine);
router.get('/mine/pdf', requireAuth, requireSubAgent, c.minePdfLink);

// ---- settings (read: reviewers, write: admins) --------------------------------
router.get('/settings', requireAuth, requireReviewer, c.getSettings);
router.put('/settings', requireAuth, requireAdmin, validate(v.updateSettings), c.updateSettings);
router.post('/settings/signature', requireAuth, requireAdmin, validate(v.setSignature), c.setSignature);
router.get('/settings/signature', requireAuth, requireAdmin, c.signatureLink);

// ---- reviewers -------------------------------------------------------------
router.get('/', requireAuth, requireReviewer, validate(v.listAgreements), c.list);
router.post('/', requireAuth, requireReviewer, validate(v.createAgreement), c.create);
router.post('/preview', requireAuth, requireReviewer, validate(v.previewAgreement), c.preview);
router.get('/:agreementId', requireAuth, requireReviewer, validate(v.idParam), c.get);
router.get('/:agreementId/pdf', requireAuth, requireReviewer, validate(v.idParam), c.pdfLink);
router.get('/:agreementId/document.pdf', requireAuth, requireReviewer, validate(v.idParam), c.currentPdf);
router.post('/:agreementId/send', requireAuth, requireReviewer, validate(v.idParam), c.send);
router.post('/:agreementId/resend', requireAuth, requireReviewer, validate(v.idParam), c.resend);
router.post('/:agreementId/countersign', requireAuth, requireReviewer, validate(v.idParam), c.countersign);
router.post('/:agreementId/void', requireAuth, requireReviewer, validate(v.voidAgreement), c.voidAgreement);

module.exports = router;
