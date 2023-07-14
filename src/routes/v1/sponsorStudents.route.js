const express = require('express');
const auth = require('../../middlewares/auth');
const sponsorStudents = require('../../controllers/sponsorStudents.controller');

const router = express.Router();

router.route('/').post(sponsorStudents.createSponsorStudent);
router.route('/').get(sponsorStudents.getSponsorStudents);

router
  .route('/:sponsorStudentsId')
  .patch(sponsorStudents.updateSponsorStudent)
  .delete(auth('manageRoles'), sponsorStudents.deleteSponsorStudent);

router.route('/:sponsorStudentsId').get(sponsorStudents.getSponsorStudent);

module.exports = router;
