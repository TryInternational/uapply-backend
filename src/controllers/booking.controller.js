/* eslint-disable eqeqeq */
/* eslint-disable array-callback-return */
const httpStatus = require('http-status');
const { pick } = require('lodash');

const moment = require('moment-timezone');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

const { bookingService, paymentService } = require('../services');
const { fatoorah } = require('../thirdparty');
const { DateToString } = require('../utils/Common');

const createBooking = catchAsync(async (req, res) => {
  try {
    const bookingPayload = {
      ...req.body,
    };

    const booking = await bookingService.createBooking(bookingPayload);

    const paymentPayload = {
      amount: parseInt(req.body.price, 10),
      bookingId: booking._id,
      discountAmount: req.body.price,
      discount: req.body.discountType !== 'null',
      amountPaid: req.body.price,
      totalPrice: req.body.price,
      paymentMode: req.body.modeOfPayment,
      status: 'Pending',
    };

    const payment = await paymentService.createPayment(paymentPayload);

    booking.paymentId = payment._id;

    await booking.save();
    const transactionPayload = {
      PaymentMethodId: 1,
      CustomerName: req.body.fullname,
      DisplayCurrencyIso: 'KWD',
      MobileCountryCode: req.body.countryCode,
      CustomerMobile: req.body.phoneNo,
      CustomerEmail: req.body.email,
      InvoiceValue: req.body.price,
      CustomerReference: booking._id,
      InvoiceItems: [
        {
          ItemName: 'Beach House',
          Quantity: 1,
          UnitPrice: req.body.price,
        },
      ],
    };
    const transaction = await fatoorah.executePayment(transactionPayload);
    payment.transactionId = transaction.InvoiceId;
    payment.orderNo = booking.orderNo;
    await payment.save();
    res.status(httpStatus.CREATED).send({ paymentUrl: transaction.PaymentURL, orderNo: booking.orderNo });
  } catch (error) {
    res.status(500).send(error.statusCode);
  }
});

const getBookings = catchAsync(async (req, res) => {
  // await publishMessage();

  const filter = pick(req.query, ['name', 'status', 'stage', 'level', 'course', 'duration', 'ageGroup', 'optionType']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await bookingService.queryBookings(filter, options);
  res.send(result);
});
const getBookingByMonths = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await bookingService.queryBookings(
    {
      $and: [
        {
          $expr: {
            $and: [
              {
                $eq: [
                  {
                    $month: '$createdAt',
                  },
                  parseInt(req.query.month, 10),
                ],
              },
              {
                $eq: [
                  {
                    $year: '$createdAt',
                  },
                  parseInt(req.query.year, 10),
                ],
              },
            ],
          },
        },
        { status: 'Paid' },
      ],
    },
    options
  );
  res.send(result);
});
const getBookingByEmail = catchAsync(async (req, res) => {
  const email = req.params;
  const result = await bookingService.emailQuery(email);
  res.send(result);
});
const getBookedDates = catchAsync(async (req, res) => {
  try {
    const bookedDates = await bookingService.getBookedDates();
    res.json({ bookedDates });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

const getBooking = catchAsync(async (req, res) => {
  const booking = await bookingService.getBookingById(req.params.bookingId);

  if (!booking) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  }
  res.send(booking);
});

const updateBooking = catchAsync(async (req, res) => {
  const booking = await bookingService.updateBookingById(req.params.bookingId, req.body);
  res.send(booking);
});

const deleteBooking = catchAsync(async (req, res) => {
  await bookingService.deleteBookingById(req.params.bookingId);
  res.status(httpStatus.NO_CONTENT).send();
});

const exportFile = catchAsync(async (req, res) => {
  // const filter = pick(req.query, ['name', 'status', 'stage']);
  // const options = pick({ ...req.query, populate: 'course:name subject,paymentId: amount' }, [
  //   'sortBy',
  //   'limit',
  //   'page',
  //   'populate',
  // ]);
  const result = await bookingService.getBookings();
  const array = result.map((doc) => ({
    'ORDER NO': doc.orderNo,
    NAME: doc.fullname,
    EMAIL: doc.email,
    MOBILE: doc.phoneNumber,

    'DATE OF BIRTH': DateToString({
      dateIsoString: doc.dob,
    }),
    'Start date': DateToString({
      dateIsoString: doc.courseStartDate,
    }),
    Renewal: DateToString({
      dateIsoString: doc.courseEndDate,
    }),
    COURSE: doc.course ? doc.course.name : 'Course not found',
    'amount paid': doc.amountPaid,
    'Date of Booking': moment(doc.createdAt).tz('Asia/Kuwait').format('MMM DD YYYY [at] hh:mm a'),
    'days per week': doc.daysPerWeek,
    'hours per day': doc.hoursPerDay,
    'course type': doc.ageGroup,
    status: doc.status,
    stage: doc.stage || 'Pending',
  }));
  const payload = {
    pdf: {
      template: `table.handlebars`,
      format: 'A1',
      context: {
        array,
        name: 'Bookings',
      },
    },
    csv: array,
    excel: array,
  };

  const actions = {
    pdf: exportService.createPdf,
    csv: exportService.createCsv,
    excel: exportService.createExcel,
  };

  return actions[req.params.type](payload[req.params.type], res, 'Booking');
});

const searchBookings = catchAsync(async (req, res) => {
  // const filter = pick(req.query, ['name', 'status', 'stage']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const results = await bookingService.searchBooking(req.params.text, options);
  res.status(200).send(results);
});

module.exports = {
  createBooking,
  getBookings,
  getBooking,
  updateBooking,
  deleteBooking,
  exportFile,
  getBookingByEmail,
  searchBookings,
  getBookingByMonths,
  getBookedDates,
};
