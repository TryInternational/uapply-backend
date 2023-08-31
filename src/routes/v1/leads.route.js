const express = require('express');
const auth = require('../../middlewares/auth');
// const validate = require('../../middlewares/validate');
// const userValidation = require('../../validations/user.validation');
const leadController = require('../../controllers/lead.controller');

const router = express.Router();

router.route('/').post(leadController.createLead).get(leadController.getLeads);
router.route('/months').get(leadController.getLeadsByMonths);

router
  .route('/:leadId')
  .get(auth('getUsers'), leadController.getLead)
  .patch(leadController.updateLead)
  .delete(auth('manageUsers'), leadController.deleteLead);
router.route('/search/:text').get(leadController.searchLeads);

module.exports = router;
