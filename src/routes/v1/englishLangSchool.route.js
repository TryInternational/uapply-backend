const express = require('express');

const englishLangSchoolController = require('../../controllers/englishLangSchool.controller');

const router = express.Router();

router.post('/', englishLangSchoolController.createSchool);

router.route('/').get(englishLangSchoolController.getSchools);

router.route('/search/:text').get(englishLangSchoolController.searchSchools);

router.route('/:schoolId').patch(englishLangSchoolController.updateSchool).delete(englishLangSchoolController.deleteSchool);

router.route('/:schoolId').get(englishLangSchoolController.getSchool);

module.exports = router;
