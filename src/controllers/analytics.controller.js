const mongoose = require('mongoose');
const { Event, Registration } = require('../models');
const catchAsync = require('../utils/catchAsync');

class AnalyticsController {
  // GET /api/analytics/dashboard
  getDashboardStats = catchAsync(async (req, res) => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));

    // Total events
    const totalEvents = await Event.countDocuments();
    const activeEvents = await Event.countDocuments({ status: 'active' });
    const upcomingEvents = await Event.countDocuments({ 
      date: { $gte: new Date() },
      status: 'active'
    });

    // Total registrations
    const totalRegistrations = await Registration.countDocuments();
    const confirmedRegistrations = await Registration.countDocuments({ 
      status: 'confirmed' 
    });
    const thisMonthRegistrations = await Registration.countDocuments({
      registrationDate: { $gte: startOfMonth }
    });

    // Popular event types
    const eventTypeStats = await Event.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Registration trends (last 30 days)
    const registrationTrends = await Registration.aggregate([
      {
        $match: {
          registrationDate: { 
            $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) 
          }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$registrationDate' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Occupancy rates
    const occupancyStats = await Event.aggregate([
      {
        $match: { status: 'active' }
      },
      {
        $project: {
          title: 1,
          totalSeats: 1,
          availableSeats: 1,
          occupancyRate: {
            $multiply: [
              { $divide: [
                { $subtract: ['$totalSeats', '$availableSeats'] },
                '$totalSeats'
              ]},
              100
            ]
          }
        }
      },
      { $sort: { occupancyRate: -1 } },
      { $limit: 10 }
    ]);

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalEvents,
          activeEvents,
          upcomingEvents,
          totalRegistrations,
          confirmedRegistrations,
          thisMonthRegistrations
        },
        eventTypeStats,
        registrationTrends,
        occupancyStats
      }
    });
  });

  // GET /api/analytics/events/:id
  getEventAnalytics = catchAsync(async (req, res) => {
    const eventId = req.params.id;

    // Registration status breakdown
    const statusBreakdown = await Registration.aggregate([
      { $match: { event: new mongoose.Types.ObjectId(eventId) } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Registration timeline
    const registrationTimeline = await Registration.aggregate([
      { $match: { event: new mongoose.Types.ObjectId(eventId) } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$registrationDate' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Nationality breakdown
    const nationalityBreakdown = await Registration.aggregate([
      { $match: { event: new mongoose.Types.ObjectId(eventId) } },
      { $group: { _id: '$user.nationality', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // English level breakdown
    const englishLevelBreakdown = await Registration.aggregate([
      { $match: { event: new mongoose.Types.ObjectId(eventId) } },
      { $group: { _id: '$englishLevel', count: { $sum: 1 } } }
    ]);

    // UTM source analysis
    const utmAnalysis = await Registration.aggregate([
      { $match: { event: new mongoose.Types.ObjectId(eventId) } },
      { 
        $group: { 
          _id: '$utmData.source', 
          count: { $sum: 1 },
          campaigns: { $addToSet: '$utmData.campaign' }
        } 
      },
      { $sort: { count: -1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        statusBreakdown,
        registrationTimeline,
        nationalityBreakdown,
        englishLevelBreakdown,
        utmAnalysis
      }
    });
  });

  // GET /api/analytics/export
  exportData = catchAsync(async (req, res) => {
    const { type, format, dateFrom, dateTo } = req.query;

    // This would implement CSV/Excel export functionality
    // For now, return JSON data that can be processed by frontend

    let data;
    const dateFilter = {};
    if (dateFrom) dateFilter.$gte = new Date(dateFrom);
    if (dateTo) dateFilter.$lte = new Date(dateTo);

    switch (type) {
      case 'events':
        data = await Event.find(
          Object.keys(dateFilter).length ? { date: dateFilter } : {}
        ).populate('createdBy', 'name email');
        break;
      
      case 'registrations':
        data = await Registration.find(
          Object.keys(dateFilter).length ? { registrationDate: dateFilter } : {}
        ).populate('event', 'title date type location');
        break;
      
      default:
        throw new ApiError(400, 'Invalid export type');
    }

    res.status(200).json({
      success: true,
      data: data,
      meta: {
        type,
        format,
        exportDate: new Date(),
        recordCount: data.length
      }
    });
  });

  // GET /api/analytics/revenue
  getRevenueStats = catchAsync(async (req, res) => {
    const { period = 'month' } = req.query;
    
    let groupBy;
    switch (period) {
      case 'day':
        groupBy = { $dateToString: { format: '%Y-%m-%d', date: '$registrationDate' } };
        break;
      case 'week':
        groupBy = { $week: '$registrationDate' };
        break;
      case 'month':
        groupBy = { $dateToString: { format: '%Y-%m', date: '$registrationDate' } };
        break;
      default:
        groupBy = { $dateToString: { format: '%Y-%m', date: '$registrationDate' } };
    }

    const revenueStats = await Registration.aggregate([
      {
        $match: {
          status: { $in: ['confirmed', 'attended'] },
          paymentStatus: 'paid'
        }
      },
      {
        $lookup: {
          from: 'events',
          localField: 'event',
          foreignField: '_id',
          as: 'eventData'
        }
      },
      {
        $unwind: '$eventData'
      },
      {
        $group: {
          _id: groupBy,
          totalRevenue: { $sum: '$eventData.price' },
          registrationCount: { $sum: 1 },
          averagePrice: { $avg: '$eventData.price' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        revenueStats,
        period
      }
    });
  });
}

module.exports = new AnalyticsController();
