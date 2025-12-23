const ieltsRegistrationService = require('../services/ieltsRegistration.service');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');
const httpStatus = require('http-status');
const config = require('../config/config');
const { googlesheet } = require('../thirdparty');
const { DateTime } = require('luxon');

class IeltsRegistrationController {
  // POST /api/v1/ielts-registration
  createRegistration = catchAsync(async (req, res) => {
    const registrationData = {
      name: req.body.name,
      email: req.body.email,
      phoneNumber: req.body.phoneNumber,
      studyDestination: req.body.studyDestination,
      previousIELTS: req.body.previousIELTS,
      englishLevel: req.body.englishLevel,
      age: req.body.age,
      nationality: req.body.nationality,
      fieldOfStudy: req.body.fieldOfStudy,
      grade: req.body.grade,
      scholarship: req.body.scholarship,
      guests: req.body.guests || [],
    };

    const registration = await ieltsRegistrationService.createRegistration(registrationData);

    const payload = {
      'Date of Booking': DateTime.fromJSDate(new Date(registration.createdAt))
        .setZone('Asia/Kuwait')
        .toFormat('MMM dd yyyy [at] hh:mm a'),
      Slot: req.body.registrationTime || '4:00 PM - 6:00 PM',
      Date: req.body.bookingDate || DateTime.now().toFormat('yyyy-MM-dd'),
      'Full Name': registrationData.name,
      'Phone Number': registrationData.phoneNumber,
      Nationality: registrationData.nationality,
      Email: registrationData.email,
      'Previous IELTS': registrationData.previousIELTS,
      'English Level': registrationData.englishLevel,
      Age: registrationData.age,
      Major: registrationData.fieldOfStudy,
      'Study Destination': registrationData.studyDestination,
    };

    // Try to add to Google Sheets, but don't fail the entire request if it fails
    try {
      if (config.googlesheet.ieltsRegistration) {
        await googlesheet.addRow(config.googlesheet.ieltsRegistration, payload);
      }
    } catch (error) {
      console.error('Failed to add row to Google Sheets:', error.message);
      // Continue with the response even if Google Sheets fails
    }

    res.status(httpStatus.CREATED).json({
      success: true,
      message: 'IELTS registration created successfully',
      data: {
        registration: {
          id: registration._id,
          confirmationCode: registration.confirmationCode,
          name: registration.name,
          email: registration.email,
          status: registration.status,
          registrationDate: registration.registrationDate,
        },
      },
    });
  });

  // GET /api/v1/ielts-registration/:confirmationCode
  getRegistrationByCode = catchAsync(async (req, res) => {
    const registration = await ieltsRegistrationService.getRegistrationByCode(req.params.confirmationCode);

    res.status(httpStatus.OK).json({
      success: true,
      data: { registration },
    });
  });

  // GET /api/v1/ielts-registration/email/:email
  getRegistrationByEmail = catchAsync(async (req, res) => {
    const registration = await ieltsRegistrationService.getRegistrationByEmail(req.params.email);

    res.status(httpStatus.OK).json({
      success: true,
      data: { registration },
    });
  });

  // GET /api/v1/ielts-registration (Admin only)
  getAllRegistrations = catchAsync(async (req, res) => {
    const filters = {
      status: req.query.status,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      syncStatus: req.query.syncStatus,
    };

    const options = {
      page: req.query.page || 1,
      limit: req.query.limit || 50,
      sortBy: req.query.sortBy || 'registrationDate',
      sortOrder: req.query.sortOrder || 'desc',
    };

    const result = await ieltsRegistrationService.getAllRegistrations(filters, options);

    res.status(httpStatus.OK).json({
      success: true,
      data: result,
    });
  });

  // PUT /api/v1/ielts-registration/:id/status (Admin only)
  updateRegistrationStatus = catchAsync(async (req, res) => {
    const { status, notes } = req.body;

    if (!['pending', 'confirmed', 'cancelled'].includes(status)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid status value');
    }

    const registration = await ieltsRegistrationService.updateRegistrationStatus(req.params.id, status, notes);

    res.status(httpStatus.OK).json({
      success: true,
      message: 'Registration status updated successfully',
      data: { registration },
    });
  });

  // POST /api/v1/ielts-registration/:id/retry-sync (Admin only)
  retrySheetsSync = catchAsync(async (req, res) => {
    const registration = await ieltsRegistrationService.retrySheetsSync(req.params.id);

    res.status(httpStatus.OK).json({
      success: true,
      message: 'Registration synced to Google Sheets successfully',
      data: { registration },
    });
  });

  // GET /api/v1/ielts-registration/available-seats
  getAvailableSeats = catchAsync(async (req, res) => {
    const { date, time } = req.query;

    if (!date || !time) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Date and time are required');
    }

    const availableSeats = await ieltsRegistrationService.getAvailableSeats(date, time);

    res.status(httpStatus.OK).json({
      success: true,
      data: { availableSeats },
    });
  });

  // GET /api/v1/ielts-registration/stats (Admin only)
  getRegistrationStats = catchAsync(async (req, res) => {
    const stats = await ieltsRegistrationService.getRegistrationStats();

    res.status(httpStatus.OK).json({
      success: true,
      data: { stats },
    });
  });
}

module.exports = new IeltsRegistrationController();
