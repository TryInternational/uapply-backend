const httpStatus = require('http-status');
const { Students } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a student
 * @param {Object} studentBody
 * @returns {Promise<Students>}
 */
const createStudent = async (studentBody) => {
  // if (await Students.isEmailTaken(studentBody.email)) {
  //   throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  // }
  return Students.create({ ...studentBody, phoneNo: studentBody.phoneNo.replace(/[+\s]/g, '') });
};

/**
 * Query for users
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
const queryStudents = async (filter, options) => {
  const student = await Students.paginate(filter, options);
  return student;
};

/**
 * Get student by id
 * @param {ObjectId} id
 * @returns {Promise<Students>}
 */
const getStudentById = async (id) => {
  return Students.findById(id);
};

/**
 * Get student by email
 * @param {string} email
 * @returns {Promise<Students>}
 */
const getStudentByEmail = async (email) => {
  return Students.findOne({ email });
};

/**
 * Update student by id
 * @param {ObjectId} studentId
 * @param {Object} updateBody
 * @returns {Promise<Students>}
 */
const updateStudentById = async (studentId, updateBody) => {
  const student = await getStudentById(studentId);
  if (!student) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Students not found');
  }
  // if (updateBody.email && (await Students.isEmailTaken(updateBody.email, studentId))) {
  //   throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  // }
  Object.assign(student, updateBody);
  await student.save();
  return student;
};

/**
 * Delete student by id
 * @param {ObjectId} studentId
 * @returns {Promise<Students>}
 */
const deleteStudentById = async (studentId) => {
  const student = await getStudentById(studentId);
  if (!student) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Students not found');
  }
  await student.remove();
  return student;
};

const searchStudent = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(text, 'i');
  const students = await Students.paginate(
    {
      $and: [
        {
          qualified: options.qualified,
          $or: [{ fullname: regex }, { phoneNo: regex }, { email: regex }, { webUrl: regex }],
        },
      ],
    },
    options
  );
  return students;
};

module.exports = {
  createStudent,
  queryStudents,
  getStudentById,
  getStudentByEmail,
  updateStudentById,
  deleteStudentById,
  searchStudent,
};
