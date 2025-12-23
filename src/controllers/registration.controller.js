const { registrationService, eventEmailService } = require('../services');
const { Registration, Event } = require('../models');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');

class RegistrationController {
  // POST /api/events/:eventId/register
  registerForEvent = catchAsync(async (req, res) => {
    const registrationData = {
      user: {
        fullName: req.body.fullName,
        email: req.body.email,
        phone: req.body.phone,
        nationality: req.body.nationality
      },
      englishLevel: req.body.englishLevel,
      previousIELTS: req.body.previousIELTS,
      previousScore: req.body.previousScore,
      specialRequests: req.body.specialRequests,
      utmData: {
        source: req.body.utmSource,
        medium: req.body.utmMedium,
        campaign: req.body.utmCampaign,
        term: req.body.utmTerm,
        content: req.body.utmContent
      }
    };

    const registration = await registrationService.registerForEvent(
      req.params.eventId, 
      registrationData
    );

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: { 
        registration: {
          confirmationCode: registration.confirmationCode,
          status: registration.status,
          registrationDate: registration.registrationDate
        }
      }
    });
  });

  // GET /api/registrations/:confirmationCode
  getRegistrationByCode = catchAsync(async (req, res) => {
    const registration = await registrationService.getRegistrationByCode(
      req.params.confirmationCode
    );

    res.status(200).json({
      success: true,
      data: { registration }
    });
  });

  // PUT /api/registrations/:id/cancel
  cancelRegistration = catchAsync(async (req, res) => {
    const registration = await registrationService.cancelRegistration(
      req.params.id,
      req.body.reason
    );

    res.status(200).json({
      success: true,
      message: 'Registration cancelled successfully',
      data: { registration }
    });
  });

  // PUT /api/registrations/:id/status (Admin only)
  updateRegistrationStatus = catchAsync(async (req, res) => {
    const { status, notes } = req.body;

    if (!['confirmed', 'pending', 'cancelled', 'attended', 'no-show'].includes(status)) {
      throw new ApiError(400, 'Invalid status value');
    }

    const registration = await registrationService.updateRegistrationStatus(
      req.params.id,
      status,
      notes
    );

    res.status(200).json({
      success: true,
      message: 'Registration status updated successfully',
      data: { registration }
    });
  });

  // GET /api/registrations/user/:email
  getUserRegistrations = catchAsync(async (req, res) => {
    const options = {
      page: req.query.page,
      limit: req.query.limit,
      upcoming: req.query.upcoming === 'true'
    };

    const result = await registrationService.getUserRegistrations(
      req.params.email,
      options
    );

    res.status(200).json({
      success: true,
      data: result
    });
  });

  // GET /api/registrations (Admin only)
  getAllRegistrations = catchAsync(async (req, res) => {
    const filters = {
      status: req.query.status,
      eventType: req.query.eventType,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo
    };

    const options = {
      page: req.query.page || 1,
      limit: req.query.limit || 50,
      sortBy: req.query.sortBy || 'registrationDate',
      sortOrder: req.query.sortOrder || 'desc'
    };

    // Build query
    const query = {};
    if (filters.status) query.status = filters.status;
    
    if (filters.dateFrom || filters.dateTo) {
      query.registrationDate = {};
      if (filters.dateFrom) query.registrationDate.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) query.registrationDate.$lte = new Date(filters.dateTo);
    }

    const skip = (options.page - 1) * options.limit;
    const sort = { [options.sortBy]: options.sortOrder === 'desc' ? -1 : 1 };

    let registrations = await Registration.find(query)
      .populate('event', 'title date type location')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(options.limit))
      .lean();

    // Filter by event type if specified
    if (filters.eventType) {
      registrations = registrations.filter(reg => reg.event && reg.event.type === filters.eventType);
    }

    const total = await Registration.countDocuments(query);

    const result = {
      registrations,
      pagination: {
        page: parseInt(options.page),
        limit: parseInt(options.limit),
        total,
        pages: Math.ceil(total / options.limit)
      }
    };

    res.status(200).json({
      success: true,
      data: result
    });
  });

  // POST /api/registrations/:id/resend-confirmation
  resendConfirmation = catchAsync(async (req, res) => {
    const registration = await Registration.findById(req.params.id);
    if (!registration) {
      throw new ApiError(404, 'Registration not found');
    }

    const event = await Event.findById(registration.event);
    if (!event) {
      throw new ApiError(404, 'Event not found');
    }

    await eventEmailService.sendRegistrationConfirmation(registration, event);

    res.status(200).json({
      success: true,
      message: 'Confirmation email sent successfully'
    });
  });
}

module.exports = new RegistrationController();
