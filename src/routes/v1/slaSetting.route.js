const express = require('express');

const slaSettingController = require('../../controllers/slaSetting.controller');
const { softAuth, requireAdmin } = require('../../middlewares/subAgentScope');

const router = express.Router();

// Read is open to any caller the CRM already lets in: the rings, the overdue
// filter and the dashboard count all need the thresholds, and they carry no
// student data. Writing is admin-only.
router.route('/').get(softAuth, slaSettingController.getSlaSettings);
router.route('/').put(softAuth, requireAdmin, slaSettingController.updateSlaSettings);

module.exports = router;
