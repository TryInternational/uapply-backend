const express = require('express');

const appliedStudentController = require('../../controllers/appliedStudent.conntroller');

const router = express.Router();
router.route('/').post(appliedStudentController.createAppliedStudent);

router.route('/').get(appliedStudentController.getAppliedStudent);

router.route('/months').get(appliedStudentController.getAmountPermonth);

router
  .route('/:id')
  .patch(appliedStudentController.updateAppliedStudent)
  .delete(appliedStudentController.deleteAppliedStudent);

router.route('/:id').get(appliedStudentController.getAppliedStudentById);

module.exports = router;
