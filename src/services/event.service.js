const { Event, Registration } = require('../models');
const ApiError = require('../utils/ApiError');

class EventService {
  // Get all events with filtering and pagination
  async getEvents(filters = {}, options = {}) {
    const {
      type,
      status,
      upcoming
    } = filters;
    
    const {
      page = 1,
      limit = 10,
      sortBy = 'date',
      sortOrder = 'asc'
    } = options;

    const query = {};
    
    if (type) query.type = type;
    if (status) query.status = status;
    if (upcoming) query.date = { $gte: new Date() };

    console.log('EventService - Filters received:', { type, status, upcoming });
    console.log('EventService - Query built:', JSON.stringify(query));

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const events = await Event.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('createdBy', 'name email')
      .lean();

    const total = await Event.countDocuments(query);
    
    console.log('EventService - Query results:', { eventsFound: events.length, total });

    return {
      events,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  // Get single event by ID
  async getEventById(eventId) {
    const event = await Event.findById(eventId)
      .populate('createdBy', 'name email')
      .lean();

    if (!event) {
      throw new ApiError(404, 'Event not found');
    }

    return event;
  }

  // Create new event
  async createEvent(eventData, createdBy) {
    // Validate date is in future
    if (new Date(eventData.date) <= new Date()) {
      throw new ApiError(400, 'Event date must be in the future');
    }

    // Validate time format and logic
    if (eventData.startTime >= eventData.endTime) {
      throw new ApiError(400, 'Start time must be before end time');
    }

    const event = new Event({
      ...eventData,
      createdBy,
      availableSeats: eventData.totalSeats
    });

    await event.save();
    return event;
  }

  // Update event
  async updateEvent(eventId, updateData, userId) {
    const event = await Event.findById(eventId);

    if (!event) {
      throw new ApiError(404, 'Event not found');
    }

    // Check if user has permission to update
    if (event.createdBy.toString() !== userId.toString()) {
      throw new ApiError(403, 'Not authorized to update this event');
    }

    // Prevent reducing total seats below current registrations
    if (updateData.totalSeats && updateData.totalSeats < (event.totalSeats - event.availableSeats)) {
      throw new ApiError(400, 'Cannot reduce total seats below current registrations');
    }

    // Update available seats if total seats changed
    if (updateData.totalSeats) {
      const registrationCount = event.totalSeats - event.availableSeats;
      updateData.availableSeats = updateData.totalSeats - registrationCount;
    }

    Object.assign(event, updateData);
    await event.save();

    return event;
  }

  // Delete event (soft delete by changing status)
  async deleteEvent(eventId, userId) {
    const event = await Event.findById(eventId);

    if (!event) {
      throw new ApiError(404, 'Event not found');
    }

    if (event.createdBy.toString() !== userId.toString()) {
      throw new ApiError(403, 'Not authorized to delete this event');
    }

    // Check if event has registrations
    const registrationCount = await Registration.countDocuments({ 
      event: eventId, 
      status: { $in: ['confirmed', 'pending'] } 
    });

    if (registrationCount > 0) {
      // Soft delete - change status to cancelled
      event.status = 'cancelled';
      await event.save();
      return { message: 'Event cancelled due to existing registrations' };
    } else {
      // Hard delete if no registrations
      await Event.findByIdAndDelete(eventId);
      return { message: 'Event deleted successfully' };
    }
  }

  // Get event statistics
  async getEventStats(eventId) {
    const event = await Event.findById(eventId);
    if (!event) {
      throw new ApiError(404, 'Event not found');
    }

    const registrations = await Registration.find({ event: eventId });
    
    const stats = {
      totalRegistrations: registrations.length,
      confirmedRegistrations: registrations.filter(r => r.status === 'confirmed').length,
      pendingRegistrations: registrations.filter(r => r.status === 'pending').length,
      cancelledRegistrations: registrations.filter(r => r.status === 'cancelled').length,
      attendedCount: registrations.filter(r => r.status === 'attended').length,
      noShowCount: registrations.filter(r => r.status === 'no-show').length,
      availableSeats: event.availableSeats,
      occupancyRate: ((event.totalSeats - event.availableSeats) / event.totalSeats * 100).toFixed(2)
    };

    return stats;
  }
}

module.exports = new EventService();
