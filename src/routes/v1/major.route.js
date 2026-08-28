const express = require('express');
const { majorController } = require('../../controllers');
const { optionalUlearnStudentAuth } = require('../../middlewares/ulearnStudentAuth');

const router = express.Router();

// optionalUlearnStudentAuth: links the attempt to a signed-in ulearn student
// when a valid Bearer token is present; anonymous submissions work unchanged.
router.route('/saveMajor').post(optionalUlearnStudentAuth(), majorController.saveMajorTest);
router.route('/').get(majorController.getMajors);
router.route('/update-qualified').patch(majorController.updateAllMajorsQualified);
router.route('/:majorId').get(majorController.getMajor);
router.route('/search/:text').get(majorController.searchMajors);
router.route('/:majorId').delete(majorController.deleteMajor);
router.route('/:majorId').patch(majorController.updateMajor);

module.exports = router;
