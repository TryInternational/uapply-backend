const { Registration, Event } = require('../models');
const ApiError = require('../utils/ApiError');
const eventEmailService = require('./eventEmail.service');

class RegistrationService {
  // Register user for event
  async registerForEvent(eventId, registrationData) {
    const event = await Event.findById(eventId);

    if (!event) {
      throw new ApiError(404, 'Event not found');
    }

    if (event.status !== 'active') {
      throw new ApiError(400, 'Event is not available for registration');
    }

    if (event.availableSeats <= 0) {
      throw new ApiError(400, 'Event is fully booked');
    }

    // Check if user already registered
    const existingRegistration = await Registration.findOne({
      event: eventId,
      'user.email': registrationData.user.email,
      status: { $in: ['confirmed', 'pending'] }
    });

    if (existingRegistration) {
      throw new ApiError(400, 'User already registered for this event');
    }

    // Create registration
    const registration = new Registration({
      event: eventId,
      ...registrationData
    });

    await registration.save();

    // Update available seats
    event.availableSeats -= 1;
    await event.save();

    // Send confirmation email
    try {
      await eventEmailService.sendRegistrationConfirmation(registration, event);
    } catch (emailError) {
      console.error('Failed to send confirmation email:', emailError);
      // Don't fail the registration if email fails
    }

    return registration;
  }

  // Get registration by confirmation code
  async getRegistrationByCode(confirmationCode) {
    const registration = await Registration.findOne({ confirmationCode })
      .populate('event')
      .lean();

    if (!registration) {
      throw new ApiError(404, 'Registration not found');
    }

    return registration;
  }

  // Cancel registration
  async cancelRegistration(registrationId, reason = '') {
    const registration = await Registration.findById(registrationId);

    if (!registration) {
      throw new ApiError(404, 'Registration not found');
    }

    if (registration.status === 'cancelled') {
      throw new ApiError(400, 'Registration already cancelled');
    }

    // Update registration status
    registration.status = 'cancelled';
    registration.cancellationReason = reason;
    registration.cancelledAt = new Date();
    await registration.save();

    // Update available seats
    const event = await Event.findById(registration.event);
    if (event) {
      event.availableSeats += 1;
      await event.save();
    }

    // Send cancellation email
    try {
      await eventEmailService.sendCancellationConfirmation(registration, event);
    } catch (emailError) {
      console.error('Failed to send cancellation email:', emailError);
    }

    return registration;
  }

  // Get registrations for an event
  async getEventRegistrations(eventId, options = {}) {
    const { page = 1, limit = 50, status } = options;
    
    const query = { event: eventId };
    if (status) query.status = status;

    const skip = (page - 1) * limit;

    const registrations = await Registration.find(query)
      .sort({ registrationDate: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Registration.countDocuments(query);

    return {
      registrations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  // Update registration status (for admin)
  async updateRegistrationStatus(registrationId, status, notes = '') {
    const registration = await Registration.findById(registrationId);

    if (!registration) {
      throw new ApiError(404, 'Registration not found');
    }

    const oldStatus = registration.status;
    registration.status = status;
    registration.statusNotes = notes;
    registration.statusUpdatedAt = new Date();

    await registration.save();

    // Handle seat availability changes
    if (oldStatus === 'cancelled' && ['confirmed', 'pending'].includes(status)) {
      // Reactivating registration - reduce available seats
      const event = await Event.findById(registration.event);
      if (event && event.availableSeats > 0) {
        event.availableSeats -= 1;
        await event.save();
      }
    } else if (['confirmed', 'pending'].includes(oldStatus) && status === 'cancelled') {
      // Cancelling registration - increase available seats
      const event = await Event.findById(registration.event);
      if (event) {
        event.availableSeats += 1;
        await event.save();
      }
    }

    return registration;
  }

  // Get user's registrations
  async getUserRegistrations(email, options = {}) {
    const { page = 1, limit = 10, upcoming = true } = options;
    
    const query = { 'user.email': email };
    
    if (upcoming) {
      // Get events that haven't passed yet
      const upcomingEvents = await Event.find({ 
        date: { $gte: new Date() } 
      }).select('_id');
      
      query.event = { $in: upcomingEvents.map(e => e._id) };
    }

    const skip = (page - 1) * limit;

    const registrations = await Registration.find(query)
      .populate('event', 'title date startTime endTime location type')
      .sort({ registrationDate: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Registration.countDocuments(query);

    return {
      registrations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }
}

module.exports = new RegistrationService();
