const express = require('express');

const schoolController = require('../../controllers/school.controller');

const router = express.Router();

router.post('/', schoolController.createSchool);

router.route('/').get(schoolController.getSchools);

router.route('/search/:text').get(schoolController.searchSchools);

router.route('/:schoolId').patch(schoolController.updateSchool).delete(schoolController.deleteSchool);

router.route('/:schoolId').get(schoolController.getSchool);

module.exports = router;
