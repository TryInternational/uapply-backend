const express = require('express');

const goalController = require('../../controllers/goal.controller');
const { requireAuth, requireAdmin, denySubAgent } = require('../../middlewares/subAgentScope');

const router = express.Router();

// Company goals per year: read by signed-in staff (partners are refused — the
// totals include company revenue), written by admins only.
router.route('/:year').get(requireAuth, denySubAgent, goalController.getGoals);
router.route('/:year').put(requireAuth, requireAdmin, goalController.updateGoals);

module.exports = router;
