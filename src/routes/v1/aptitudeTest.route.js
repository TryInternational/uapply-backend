const express = require('express');
const { auth } = require('../../middlewares/auth');
const { aptitudeTestController } = require('../../controllers');
const validate = require('../../middlewares/validate');
const { optionalUlearnStudentAuth } = require('../../middlewares/ulearnStudentAuth');
// const { aptitudeTestValidation } = require('../../validations');

const router = express.Router();

router
  .route('/')
  // optionalUlearnStudentAuth: links the attempt to a signed-in ulearn student
  // when a valid Bearer token is present; anonymous submissions work unchanged.
  .post(optionalUlearnStudentAuth(), /* validate(aptitudeTestValidation.createAptitudeTest), */ aptitudeTestController.createAptitudeTest)
  .get(aptitudeTestController.getAptitudeTests);

router
  .route('/:id')
  .get(aptitudeTestController.getAptitudeTest)
  .patch(/* validate(aptitudeTestValidation.updateAptitudeTest), */ aptitudeTestController.updateAptitudeTest)
  .delete(aptitudeTestController.deleteAptitudeTest);
router.route('/search/:text').get(aptitudeTestController.searchAptitudeTest);

module.exports = router;
