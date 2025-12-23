const express = require('express');
const { auth } = require('../../middlewares/auth');
const { aptitudeTestController } = require('../../controllers');
const validate = require('../../middlewares/validate');
// const { aptitudeTestValidation } = require('../../validations');

const router = express.Router();

router
  .route('/')
  .post(/* validate(aptitudeTestValidation.createAptitudeTest), */ aptitudeTestController.createAptitudeTest)
  .get(aptitudeTestController.getAptitudeTests);

router
  .route('/:id')
  .get(aptitudeTestController.getAptitudeTest)
  .patch(/* validate(aptitudeTestValidation.updateAptitudeTest), */ aptitudeTestController.updateAptitudeTest)
  .delete(aptitudeTestController.deleteAptitudeTest);

module.exports = router;
