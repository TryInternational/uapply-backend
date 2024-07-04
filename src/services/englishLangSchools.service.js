const httpStatus = require('http-status');
const { EnglishLangSchool } = require('../models');
const ApiError = require('../utils/ApiError');

const createEnglishLangSchool = async (schoolBody) => {
  return EnglishLangSchool.create(schoolBody);
};

const queryEnglishLangSchool = async (filter, options) => {
  const school = await EnglishLangSchool.paginate(filter, options);
  return school;
};

const getEnglishLangSchoolById = async (id) => {
  return EnglishLangSchool.findById(id);
};

const updateEnglishLangSchoolById = async (schoolId, updateBody) => {
  const school = await getEnglishLangSchoolById(schoolId);
  if (!school) {
    throw new ApiError(httpStatus.NOT_FOUND, 'EnglishLangSchool not found');
  }
  // if (updateBody.email && (await Students.isEmailTaken(updateBody.email, studentId))) {
  //   throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  // }
  Object.assign(school, updateBody);
  await school.save();
  return school;
};

const deleteEnglishLangSchoolById = async (studentId) => {
  const school = await getEnglishLangSchoolById(studentId);
  if (!school) {
    throw new ApiError(httpStatus.NOT_FOUND, 'EnglishLangSchool not found');
  }
  await school.remove();
  return school;
};

const searchEnglishLangSchool = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(text, 'i');
  const subject = await EnglishLangSchool.paginate({ name: regex }, options);
  return subject;
};
module.exports = {
  createEnglishLangSchool,
  queryEnglishLangSchool,
  getEnglishLangSchoolById,
  updateEnglishLangSchoolById,
  deleteEnglishLangSchoolById,
  searchEnglishLangSchool,
};
