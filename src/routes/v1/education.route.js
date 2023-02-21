const express = require('express');
const auth = require('../../middlewares/auth');
const educationController = require('../../controllers/education.controller');

const router = express.Router();

router.route('/').post(educationController.createStudentEducation);
router.route('/').get(educationController.getStudentEducations);

router
  .route('/:educationId')
  .patch(auth('manageRoles'), educationController.updateStudentEducation)
  .delete(auth('manageRoles'), educationController.deleteStudentEducation);

router.route('/:educationId').get(educationController.getStudentEducation);

module.exports = router;
