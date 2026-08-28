const express = require('express');
const activitiesController = require('../../controllers/activities.controller');

const { softAuth, scopeSubAgentToOwnStudent } = require('../../middlewares/subAgentScope');

const router = express.Router();

// A sub-agent may reach these only for a student it owns; see
// scopeSubAgentToOwnStudent. softAuth only identifies the caller, so behaviour
// for every other role is unchanged.
router.use(softAuth, scopeSubAgentToOwnStudent);

// Append-only timeline: create + list, no update/delete.
router.route('/').post(activitiesController.createActivity).get(activitiesController.getActivities);

module.exports = router;
