const express = require('express');

const applicationsController = require('../../controllers/application.controller');

const router = express.Router();

router.post('/', applicationsController.createApplication);
// router.post('/:bookingId/sendClassLink', validate(bookingValidation.updateBooking), applicationsController.sendClassLink);

router.route('/').get(applicationsController.getApplications);
// router.route(auth('/getBookingByEmail/:email')).get(applicationsController.getBookingByEmail);

// router.route('/search/:text').get(applicationsController.searchCourses);

router
  .route('/:applicationId')
  .patch(applicationsController.updateApplication)
  .delete(applicationsController.deleteApplication);

router.route('/:applicationId').get(applicationsController.getApplication);
router.route('/student/:studentId').get(applicationsController.getApplicationByStudentId);

module.exports = router;
