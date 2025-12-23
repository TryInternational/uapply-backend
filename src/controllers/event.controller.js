const { eventService, registrationService } = require('../services');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');

class EventController {
  // GET /api/events
  getEvents = catchAsync(async (req, res) => {
    const filters = {
      type: req.query.type,
      status: req.query.status,
      upcoming: req.query.upcoming === 'true'
    };

    const options = {
      page: req.query.page,
      limit: req.query.limit,
      sortBy: req.query.sortBy,
      sortOrder: req.query.sortOrder
    };

    console.log('Event Controller - Query params:', req.query);
    console.log('Event Controller - Filters:', filters);
    console.log('Event Controller - Options:', options);

    const result = await eventService.getEvents(filters, options);
    
    console.log('Event Controller - Result:', { 
      eventsCount: result.events.length, 
      total: result.pagination.total 
    });

    res.status(200).json({
      success: true,
      data: result
    });
  });

  // GET /api/events/:id
  getEvent = catchAsync(async (req, res) => {
    const event = await eventService.getEventById(req.params.id);

    res.status(200).json({
      success: true,
      data: { event }
    });
  });

  // POST /api/events
  createEvent = catchAsync(async (req, res) => {
    const eventData = {
      title: req.body.title,
      description: req.body.description,
      type: req.body.type,
      date: req.body.date,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
      location: req.body.location,
      totalSeats: req.body.totalSeats,
      price: req.body.price,
      currency: req.body.currency,
      instructor: req.body.instructor,
      requirements: req.body.requirements,
      tags: req.body.tags
    };

    const event = await eventService.createEvent(eventData, req.user.id);

    res.status(201).json({
      success: true,
      message: 'Event created successfully',
      data: { event }
    });
  });

  // PUT /api/events/:id
  updateEvent = catchAsync(async (req, res) => {
    const updateData = {
      title: req.body.title,
      description: req.body.description,
      type: req.body.type,
      date: req.body.date,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
      location: req.body.location,
      totalSeats: req.body.totalSeats,
      price: req.body.price,
      currency: req.body.currency,
      status: req.body.status,
      instructor: req.body.instructor,
      requirements: req.body.requirements,
      tags: req.body.tags
    };

    // Remove undefined values
    Object.keys(updateData).forEach(key => 
      updateData[key] === undefined && delete updateData[key]
    );

    const event = await eventService.updateEvent(req.params.id, updateData, req.user.id);

    res.status(200).json({
      success: true,
      message: 'Event updated successfully',
      data: { event }
    });
  });

  // DELETE /api/events/:id
  deleteEvent = catchAsync(async (req, res) => {
    const result = await eventService.deleteEvent(req.params.id, req.user.id);

    res.status(200).json({
      success: true,
      message: result.message
    });
  });

  // GET /api/events/:id/stats
  getEventStats = catchAsync(async (req, res) => {
    const stats = await eventService.getEventStats(req.params.id);

    res.status(200).json({
      success: true,
      data: { stats }
    });
  });

  // GET /api/events/:id/registrations
  getEventRegistrations = catchAsync(async (req, res) => {
    const options = {
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status
    };

    const result = await registrationService.getEventRegistrations(req.params.id, options);

    res.status(200).json({
      success: true,
      data: result
    });
  });
}

module.exports = new EventController();
