const express = require('express');
const validate = require('../../middlewares/validate');
const auth = require('../../middlewares/auth');
const bookingValidation = require('../../validations/booking.validation');
const bookingController = require('../../controllers/booking.controller');

const router = express.Router();

router.post('/', bookingController.createBooking);
router.route('/unavailable-dates').get(bookingController.getBookedDates);

router.route('/').get(validate(bookingValidation.getBookings), bookingController.getBookings);
router.route('/months').get(validate(bookingValidation.getBookings), bookingController.getBookingByMonths);
router.route('/total-amounts').get(bookingController.getTotalAmounts);

router.route('/:type/export').get(validate(bookingValidation.getBookings), bookingController.exportFile);
router.route('/search/:text').get(bookingController.searchBookings);

router.route('/:bookingId').patch(bookingController.updateBooking).delete(bookingController.deleteBooking);

router.route('/:bookingId').get(validate(bookingValidation.getBooking), bookingController.getBooking);

module.exports = router;
