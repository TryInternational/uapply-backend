const httpStatus = require('http-status');
const { Booking } = require('../models');
const ApiError = require('../utils/ApiError');

/** The refundable security deposit added to every booking, in KD. */
const DEPOSIT_KWD = 200;

/**
 * What a booking actually earned, excluding the refundable deposit.
 *
 * Manual bookings carry `actualAmount` — the money the office really
 * received — and that is the number revenue is built from, even when it
 * is 0 (a gifted or owner stay must not inflate revenue with the rack
 * rate). Website bookings predate the field: for those, `price` is the
 * full amount charged online, deposit included, so the deposit comes
 * back off.
 */
const rentOf = (booking) => {
  if (typeof booking.actualAmount === 'number' && !Number.isNaN(booking.actualAmount)) {
    return booking.actualAmount;
  }
  return Math.max(Number(booking.price || 0) - DEPOSIT_KWD, 0);
};

/** What the guest handed over as a deposit, and what has gone back. */
const depositOf = (booking) => {
  const status = booking.depositStatus || (booking.insuranceReturned ? 'returned' : 'collected');
  const amount = typeof booking.depositAmount === 'number' ? booking.depositAmount : DEPOSIT_KWD;

  if (status === 'waived') {
    return { collected: 0, returned: 0 };
  }

  const returned =
    status === 'returned'
      ? Number(booking.depositReturnedAmount || 0) || amount
      : Number(booking.depositReturnedAmount || 0);

  return { collected: amount, returned: Math.min(returned, amount) };
};

/**
 * Create a booking
 * @param {Object} bookingBody
 * @returns {Promise<Booking>}
 */

async function checkAvailability(startDate, endDate) {
  const bookings = await Booking.find({
    $and: [
      { status: 'booked' },
      { blocked: false },
      {
        $or: [{ startDate: { $lte: endDate }, endDate: { $gte: startDate } }],
      },
    ],
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
  const bookings = await Booking.find({
    $and: [{ status: 'booked' }, { blocked: false }],
  });
  let bookedDates = [];
  bookings.forEach((booking) => {
    // Assuming you want to include both the start and end date in the range
    const currentDate = new Date(booking.startDate);

    while (currentDate.toISOString().split('T')[0] <= new Date(booking.endDate).toISOString().split('T')[0]) {
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
  const { startDate, endDate, ...otherFilters } = filter;

  if (startDate && endDate) {
    otherFilters.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    };
  }
  Object.keys(otherFilters).forEach((key) => {
    if (!otherFilters[key]) {
      delete otherFilters[key];
    }
  });
  const bookings = await Booking.paginate(otherFilters, options);
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
    { $or: [{ fullname: regex }, { phoneNo: regex }, { email: regex }, { civilId: regex }, { alternatePhoneNo: regex }] },
    options
  );
  return bookings;
};

const getTotalAmounts = async () => {
  const bookings = await Booking.find({ status: 'booked', blocked: false });

  const totalAmountsByMonth = {};
  const revenueByMonth = {};
  let totalRentingAmount = 0;
  let totalInsuranceAmount = 0;
  let depositsCollected = 0;
  let depositsReturned = 0;

  bookings.forEach((booking) => {
    const created = new Date(booking.createdAt);
    const month = created.getMonth() + 1;
    const year = created.getFullYear();
    const legacyKey = `${year}-${month}`;
    const key = `${year}-${String(month).padStart(2, '0')}`;

    const rent = rentOf(booking);
    const deposit = depositOf(booking);

    if (!totalAmountsByMonth[legacyKey]) {
      totalAmountsByMonth[legacyKey] = 0;
    }
    if (!revenueByMonth[key]) {
      revenueByMonth[key] = 0;
    }

    /* Legacy key keeps the old shape (rent + deposit) so nothing that
     * still reads it breaks; revenueByMonth is rent only, which is what
     * the dashboard chart plots. */
    totalAmountsByMonth[legacyKey] += rent + deposit.collected;
    revenueByMonth[key] += rent;

    totalRentingAmount += rent;
    totalInsuranceAmount += deposit.collected;
    depositsCollected += deposit.collected;
    depositsReturned += deposit.returned;
  });

  return {
    totalAmountsByMonth,
    revenueByMonth,
    totalRentingAmount,
    totalInsuranceAmount,
    depositsCollected,
    depositsReturned,
    depositsOnHand: depositsCollected - depositsReturned,
    bookings: bookings.length,
  };
};

/**
 * Record a deposit as returned, partly returned or waived.
 *
 * `insuranceReturned` is kept in step so older screens that only know
 * about the boolean still read correctly.
 */
const updateDepositById = async (bookingId, { status, amount, note }) => {
  const booking = await getBookingById(bookingId);
  if (!booking) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  }

  const held = typeof booking.depositAmount === 'number' ? booking.depositAmount : DEPOSIT_KWD;

  if (status === 'returned') {
    const returned = amount === undefined || amount === null ? held : Number(amount);
    if (Number.isNaN(returned) || returned < 0 || returned > held) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Returned amount must be between 0 and ${held}`);
    }
    booking.depositStatus = 'returned';
    booking.depositReturnedAmount = returned;
    booking.depositReturnedAt = new Date();
    booking.insuranceReturned = true;
  } else if (status === 'waived') {
    booking.depositStatus = 'waived';
    booking.depositReturnedAmount = 0;
    booking.depositReturnedAt = new Date();
    booking.insuranceReturned = false;
  } else {
    booking.depositStatus = 'collected';
    booking.depositReturnedAmount = 0;
    booking.depositReturnedAt = undefined;
    booking.insuranceReturned = false;
  }

  if (note !== undefined) {
    booking.depositNote = note;
  }

  await booking.save();
  return booking;
};

/**
 * Bookings grouped for the back-office tabs: who is in the chalet right
 * now, who is arriving, and who has already left.
 */
const getStayGroups = async () => {
  const now = new Date();
  const bookings = await Booking.find({ status: 'booked', blocked: false }).sort({ startDate: 1 });

  const stayingNow = [];
  const upcoming = [];
  const past = [];

  bookings.forEach((booking) => {
    const start = new Date(booking.startDate);
    const end = new Date(booking.endDate);
    if (start <= now && end >= now) {
      stayingNow.push(booking);
    } else if (start > now) {
      upcoming.push(booking);
    } else {
      past.push(booking);
    }
  });

  return { stayingNow, upcoming, past: past.reverse() };
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
  getTotalAmounts,
  updateDepositById,
  getStayGroups,
  rentOf,
  depositOf,
  DEPOSIT_KWD,
};
