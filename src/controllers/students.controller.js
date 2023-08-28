/* eslint-disable no-nested-ternary */
const httpStatus = require('http-status');
const pick = require('../utils/pick');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { studentsService } = require('../services');

const createStudent = catchAsync(async (req, res) => {
  const student = await studentsService.createStudent({ ...req.body });
  res.status(httpStatus.CREATED).send(student);
});

const getStudents = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'role', 'qualified', 'degree', 'nationality', 'residence', 'status', 'stage']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await studentsService.queryStudents(filter, options);
  res.send(result);
});

const getStudent = catchAsync(async (req, res) => {
  const student = await studentsService.getStudentById(req.params.studentId);
  if (!student) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Student not found');
  }
  res.send(student);
});

const updateStudent = catchAsync(async (req, res) => {
  const student = await studentsService.updateStudentById(req.params.studentId, req.body);
  res.send(student);
});

const deleteStudent = catchAsync(async (req, res) => {
  await studentsService.deleteStudentById(req.params.studentId);
  res.status(httpStatus.NO_CONTENT).send();
});
const getStudentsByMonths = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await studentsService.queryStudents(
    {
      $and: [
        {
          createdAt: {
            $gte: req.query.startDate,
            $lte: req.query.endDate,
          },
        },
        { qualified: req.query.qualified },
      ],
    },
    options
  );
  res.send(result);
});
const searchStudents = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate', 'qualified']);
  const results = await studentsService.searchStudent(req.params.text, options);
  res.status(200).send(results);
});

module.exports = {
  createStudent,
  getStudents,
  getStudent,
  updateStudent,
  deleteStudent,
  searchStudents,
  getStudentsByMonths,
};
