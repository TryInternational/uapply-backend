const express = require('express');
const validate = require('../../middlewares/validate');
const auth = require('../../middlewares/auth');
const bookingValidation = require('../../validations/booking.validation');
const bookingController = require('../../controllers/booking.controller');

const router = express.Router();

router.post('/', validate(bookingValidation.createBooking), bookingController.createBooking);
router.route('/unavailable-dates').get(bookingController.getBookedDates);

router.route('/').get(validate(bookingValidation.getBookings), bookingController.getBookings);
router.route('/months').get(validate(bookingValidation.getBookings), bookingController.getBookingByMonths);

router.route('/:type/export').get(validate(bookingValidation.getBookings), bookingController.exportFile);
router.route('/search/:text').get(bookingController.searchBookings);

router
  .route('/:bookingId')
  .patch(bookingController.updateBooking)
  .delete(auth('manageBookings'), validate(bookingValidation.deleteBooking), bookingController.deleteBooking);

router.route('/:bookingId').get(validate(bookingValidation.getBooking), bookingController.getBooking);

module.exports = router;
