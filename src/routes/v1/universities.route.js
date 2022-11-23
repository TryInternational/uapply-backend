const express = require('express');

const universitiesController = require('../../controllers/universities.controller');

const router = express.Router();

router.post('/', universitiesController.createUniversity);
// router.post('/:bookingId/sendClassLink', validate(bookingValidation.updateBooking), universitiesController.sendClassLink);

router.route('/').get(universitiesController.getUniversities);
// router.route(auth('/getBookingByEmail/:email')).get(universitiesController.getBookingByEmail);

router.route('/search/:text').get(universitiesController.searchUniversities);

router.route('/:uniId').patch(universitiesController.updateUniversity).delete(universitiesController.deleteUniversity);

router.route('/:uniId').get(universitiesController.getUniversity);

// router.post('/confirm', universitiesController.confirm);
// router.post('/execute', universitiesController.execute);

module.exports = router;
