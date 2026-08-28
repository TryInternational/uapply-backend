const express = require('express');

const validate = require('../../middlewares/validate');
const partnersValidation = require('../../validations/partners.validation');
const partnersController = require('../../controllers/partners.controller');
const { softAuth, denySubAgent, requireAuth, requireReviewer } = require('../../middlewares/subAgentScope');

const router = express.Router();

// Staff only. The directory lists OTHER partners and their performance, which
// is precisely what a partner must never see — so the partner roles are
// refused here rather than merely having the nav entry hidden from them.
router.route('/directory').get(softAuth, denySubAgent, partnersController.getDirectory);
router.route('/:partnerId/students').get(softAuth, denySubAgent, partnersController.getPartnerStudents);

// Writes. requireAuth, never the APPLICATION_AUTH-flagged legacyGate: adding a
// partner CREATES AN ACCOUNT, so this surface starts closed and stays closed
// regardless of the rollout flag -- the same reasoning as the review routes.
// requireReviewer, because adding a partner directly is the same capability as
// approving their request, and that is what reviewers already do.
router
  .route('/')
  .post(requireAuth, requireReviewer, validate(partnersValidation.createPartner), partnersController.createPartner);
router
  .route('/:partnerId/logo')
  .patch(requireAuth, requireReviewer, validate(partnersValidation.updateLogo), partnersController.updateLogo);

module.exports = router;
