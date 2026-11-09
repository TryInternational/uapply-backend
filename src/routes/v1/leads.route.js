const express = require('express');
const responseCache = require('../../middlewares/responseCache');
const auth = require('../../middlewares/auth');
// const validate = require('../../middlewares/validate');
// const userValidation = require('../../validations/user.validation');
const leadController = require('../../controllers/lead.controller');
const { requireAuth, denySubAgent } = require('../../middlewares/subAgentScope');

const router = express.Router();

router.route('/').post(leadController.createLead).get(leadController.getLeads);
router.route('/months').get(leadController.getLeadsByMonths);
router.route('/facets').get(requireAuth, denySubAgent, leadController.getLeadFacets);
router.route('/country').get(leadController.getTop5ByContry);
router.route('/degree').get(leadController.getTop5ByDegrees);

router.route('/leads-dashboard-data').get(responseCache(), leadController.getDashboardData);

router
  .route('/:leadId')
  .get(leadController.getLead)
  .patch(leadController.updateLead)
  .delete(auth('manageUsers'), leadController.deleteLead);
// Staff-only lead actions (the Leads row menu).
router.route('/:leadId/convert').post(requireAuth, denySubAgent, leadController.convertLead);
router.route('/:leadId/assign').post(requireAuth, denySubAgent, leadController.assignLead);
router.route('/:leadId/follow-up').post(requireAuth, denySubAgent, leadController.setLeadFollowUp);
router.route('/search/:text').get(leadController.searchLeads);

module.exports = router;
