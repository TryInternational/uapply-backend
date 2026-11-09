const httpStatus = require('http-status');
const { School } = require('../models');
const ApiError = require('../utils/ApiError');

const createSchool = async (schoolBody) => {
  return School.create(schoolBody);
};

const querySchool = async (filter, options) => {
  const school = await School.paginate(filter, options);
  return school;
};

const getSchoolById = async (id) => {
  return School.findById(id);
};

const updateSchoolById = async (schoolId, updateBody) => {
  const school = await getSchoolById(schoolId);
  if (!school) {
    throw new ApiError(httpStatus.NOT_FOUND, 'School not found');
  }
  // if (updateBody.email && (await Students.isEmailTaken(updateBody.email, studentId))) {
  //   throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  // }
  Object.assign(school, updateBody);
  await school.save();
  return school;
};

const deleteSchoolById = async (studentId) => {
  const school = await getSchoolById(studentId);
  if (!school) {
    throw new ApiError(httpStatus.NOT_FOUND, 'School not found');
  }
  await school.remove();
  return school;
};

// The search text is matched literally: names like "American International
// School Kuwait (AIS)" carry regex metacharacters, so an unescaped pattern never
// matched the school itself (and let any typed pattern run as a regex).
const escapeRegex = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const searchSchool = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(escapeRegex(String(text || '').trim()), 'i');
  const subject = await School.paginate({ english_name: regex }, options);
  return subject;
};
module.exports = {
  createSchool,
  querySchool,
  getSchoolById,
  updateSchoolById,
  deleteSchoolById,
  searchSchool,
};
