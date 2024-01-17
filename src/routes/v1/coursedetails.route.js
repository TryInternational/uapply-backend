const express = require('express');

const coursedetailsController = require('../../controllers/coursedetails.controller');

const router = express.Router();

router.post('/', coursedetailsController.createCourseDetail);
// router.post('/:bookingId/sendClassLink', validate(bookingValidation.updateBooking), coursedetailsController.sendClassLink);

router.route('/').get(coursedetailsController.getCourseDetails);
router.route('/:courseRefId').get(coursedetailsController.getCourseDetailsByRef);

// router.route(auth('/getBookingByEmail/:email')).get(coursedetailsController.getBookingByEmail);

router.route('/search/:text').get(coursedetailsController.searchCoursesDetail);

router
  .route('/:courseId')
  .patch(coursedetailsController.updateCourseDetail)
  .delete(coursedetailsController.deleteCourseDetail);

router.route('/course/:courseId').get(coursedetailsController.getCourseDetail);

// router.post('/confirm', coursedetailsController.confirm);
// router.post('/execute', coursedetailsController.execute);

module.exports = router;
