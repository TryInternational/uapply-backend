const Joi = require('joi');

const createAptitudeTest = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    number: Joi.string().required(),
    dob: Joi.date().required(),
    score: Joi.number().min(0).max(100).required(),
    testType: Joi.string().valid('practice', 'official', 'mock').required(),
    language: Joi.string().valid('en', 'ar').required(),
    destination: Joi.string().required(),
    degree: Joi.string().required(),
    nationality: Joi.string().required(),
    timeTaken: Joi.number().min(0).required(),
  }),
};

const updateAptitudeTest = {
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
  body: Joi.object().keys({
    name: Joi.string(),
    number: Joi.string(),
    dob: Joi.date(),
    score: Joi.number().min(0).max(100),
    testType: Joi.string().valid('practice', 'official', 'mock'),
    language: Joi.string().valid('en', 'ar'),
    destination: Joi.string(),
    degree: Joi.string(),
    nationality: Joi.string(),
    timeTaken: Joi.number().min(0),
  })
  .min(1), // At least one field to update
};

const getAptitudeTest = {
  params: Joi.object().keys({
    id: Joi.string().required(),
  }),
};

const deleteAptitudeTest = {
  ...getAptitudeTest,
};

module.exports = {
  createAptitudeTest,
  updateAptitudeTest,
  getAptitudeTest,
  deleteAptitudeTest,
};
