const httpStatus = require('http-status');
const { Booking } = require('../models');
const ApiError = require('../utils/ApiError');
const { firestore } = require('../thirdparty/firebase');

/**
 * Create a booking
 * @param {Object} bookingBody
 * @returns {Promise<Booking>}
 */
const createBooking = async (bookingBody) => {
  try {
    const booking = await Booking.create(bookingBody);
    return booking;
  } catch (error) {
    console.log(error);
  }
};

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
};
