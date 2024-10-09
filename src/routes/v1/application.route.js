const express = require('express');

const applicationsController = require('../../controllers/application.controller');

const router = express.Router();

router.post('/', applicationsController.createApplication);
// router.post('/:bookingId/sendClassLink', validate(bookingValidation.updateBooking), applicationsController.sendClassLink);

router.route('/').get(applicationsController.getApplications);
// router.route(auth('/getBookingByEmail/:email')).get(applicationsController.getBookingByEmail);

router.route('/application-counts').get(applicationsController.getApplicationsByPhase);
router.route('/application-counts-university').get(applicationsController.getTopUniversities);
router.route('/application-enrolled-university').get(applicationsController.getEnrolledUniversities);
router.route('/application-dashboard-data').get(applicationsController.getDashboardData);

router.route('/count-by-month').get(applicationsController.getApplicationsCountByMonth);

router.route('/enrolled-count-by-month').get(applicationsController.getEnrolledApplicationsCountByMonth);

router
  .route('/:applicationId')
  .patch(applicationsController.updateApplication)
  .delete(applicationsController.deleteApplication);

router.route('/:applicationId').get(applicationsController.getApplication);
router.route('/student/:studentId').get(applicationsController.getApplicationByStudentId);

module.exports = router;
