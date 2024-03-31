const httpStatus = require('http-status');
const { Booking } = require('../models');
const ApiError = require('../utils/ApiError');
const { firestore } = require('../thirdparty/firebase');

/**
 * Create a booking
 * @param {Object} bookingBody
 * @returns {Promise<Booking>}
 */

async function checkAvailability(startDate, endDate) {
  const bookings = await Booking.find({
    $or: [{ startDate: { $lte: endDate }, endDate: { $gte: startDate } }],
    status: 'booked',
  });

  return bookings.length === 0;
}

const createBooking = async (bookingBody) => {
  const availability = await checkAvailability(bookingBody.startDate, bookingBody.endDate);
  if (!availability) {
    throw new ApiError('Selected dates are not available.');
  }
  const newBooking = await Booking.create(bookingBody);
  return newBooking;
};

async function getBookedDates() {
  const bookings = await Booking.find({ status: 'booked' });
  let bookedDates = [];
  bookings.forEach((booking) => {
    // Assuming you want to include both the start and end date in the range
    const currentDate = new Date(booking.startDate);
    while (currentDate <= booking.endDate) {
      bookedDates.push(currentDate.toISOString().split('T')[0]); // Format to 'YYYY-MM-DD'
      currentDate.setDate(currentDate.getDate() + 1);
    }
  });
  // Remove duplicates if any
  bookedDates = [...new Set(bookedDates)];
  return bookedDates;
}
/**
 * Query for bookings
 * @param {Object} _filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
const queryBookings = async (filter, options) => {
  const bookings = await Booking.paginate(filter, options);
  return bookings;
};

/**
 * Get booking by id
 * @param {ObjectId} id
 * @returns {Promise<User>}
 */
const getBookingById = async (id) => {
  return Booking.findById(id);
};
const getBookings = async () => {
  return Booking.find();
};
const emailQuery = async (email) => {
  return Booking.find(email);
};

/**
 * Update booking by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<User>}
 */
const updateBookingById = async (id, updateBody) => {
  const booking = await getBookingById(id);
  if (!booking) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  }
  Object.assign(booking, updateBody);
  await booking.save();
  return booking;
};

/**
 * Delete booking by id
 * @param {ObjectId} bookingId
 * @returns {Promise<User>}
 */
const deleteBookingById = async (bookingId) => {
  const booking = await getBookingById(bookingId);
  if (!booking) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  }
  await booking.remove();
  return booking;
};

const searchBooking = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(text, 'i');
  const bookings = await Booking.paginate(
    { $and: [{ status: 'Paid', $or: [{ fullname: regex }, { phoneNumber: regex }, { email: regex }] }] },
    options
  );
  return bookings;
};

module.exports = {
  createBooking,
  queryBookings,
  getBookingById,
  updateBookingById,
  deleteBookingById,
  emailQuery,
  getBookings,
  searchBooking,
  getBookedDates,
};
