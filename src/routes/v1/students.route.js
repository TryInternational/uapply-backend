const express = require('express');
const auth = require('../../middlewares/auth');
// const validate = require('../../middlewares/validate');
// const userValidation = require('../../validations/user.validation');
const studentController = require('../../controllers/students.controller');

const router = express.Router();

router.route('/').post(studentController.createStudent).get(studentController.getStudents);
router.route('/months').get(studentController.getStudentsByMonths);

router
  .route('/:studentId')
  .get(studentController.getStudent)
  .patch(studentController.updateStudent)
  .delete(auth('manageUsers'), studentController.deleteStudent);
router.route('/search/:text').get(studentController.searchStudents);

module.exports = router;
