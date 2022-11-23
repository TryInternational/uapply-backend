const express = require('express');

const universityDetailsController = require('../../controllers/universityDetails.controller');

const router = express.Router();

router.post('/', universityDetailsController.createUniversityDetail);
// router.post('/:bookingId/sendClassLink', validate(bookingValidation.updateBooking), universityDetailsController.sendClassLink);

router.route('/').get(universityDetailsController.getUniversitiesDetails);
// router.route(auth('/getBookingByEmail/:email')).get(universityDetailsController.getBookingByEmail);

router.route('/search/:text').get(universityDetailsController.searchUniversitiesDetails);

router
  .route('/:uniId')
  .patch(universityDetailsController.updateUniversityDetail)
  .delete(universityDetailsController.deleteUniversityDetail);

router.route('/:uniId').get(universityDetailsController.getUniversityDetails);

// router.post('/confirm', universityDetailsController.confirm);
// router.post('/execute', universityDetailsController.execute);

module.exports = router;
