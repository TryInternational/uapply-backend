const express = require('express');
const auth = require('../../middlewares/auth');
const workExperienceController = require('../../controllers/workExperience.controller');

const router = express.Router();

router.route('/').post(workExperienceController.createWorkExperience);
router.route('/').get(workExperienceController.getWorkExperiences);

router
  .route('/:workExpId')
  .patch(auth('manageRoles'), workExperienceController.updateWorkExperience)
  .delete(auth('manageRoles'), workExperienceController.deleteWorkExperience);

router.route('/:workExpId').get(workExperienceController.getWorkExperience);

module.exports = router;
