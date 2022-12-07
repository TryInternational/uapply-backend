const express = require('express');
const auth = require('../../middlewares/auth');
// const validate = require('../../middlewares/validate');
// const userValidation = require('../../validations/user.validation');
const studentController = require('../../controllers/students.controller');

const router = express.Router();

router
  .route('/')
  .post(auth('manageUsers'), studentController.createStudent)
  .get(auth('getUsers'), studentController.getStudents);

router
  .route('/:studentId')
  .get(auth('getUsers'), studentController.getStudent)
  .patch(auth('manageUsers'), studentController.updateStudent)
  .delete(auth('manageUsers'), studentController.deleteStudent);

module.exports = router;
