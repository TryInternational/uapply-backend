const express = require('express');

const exibitionStudentController = require('../../controllers/exibitionStudent.controller');

const router = express.Router();
router.route('/').post(exibitionStudentController.createExibitionStudent);

router.route('/').get(exibitionStudentController.getExibitionStudents);

router
  .route('/:id')
  .patch(exibitionStudentController.updateExibitionStudent)
  .delete(exibitionStudentController.deleteExibitionStudent);

router.route('/:id').get(exibitionStudentController.getExibitionStudent);

module.exports = router;
