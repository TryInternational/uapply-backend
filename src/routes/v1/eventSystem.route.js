const express = require('express');
const eventRoutes = require('./event.route');
const registrationRoutes = require('./registration.route');
const eventAuthRoutes = require('./eventAuth.route');
const analyticsRoutes = require('./analytics.route');

const router = express.Router();

// Mount event system routes
router.use('/events', eventRoutes);
router.use('/registrations', registrationRoutes);
router.use('/event-auth', eventAuthRoutes);
router.use('/analytics', analyticsRoutes);

// Health check endpoint for event system
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Event Management System is running',
    timestamp: new Date().toISOString(),
    version: process.env.API_VERSION || '1.0.0',
    services: {
      events: 'operational',
      registrations: 'operational',
      authentication: 'operational',
      analytics: 'operational'
    }
  });
});

// API documentation endpoint for event system
router.get('/docs', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Event Management System API Documentation',
    baseUrl: '/api/v1/event-system',
    endpoints: {
      events: {
        'GET /events': 'Get all events with filtering and pagination',
        'GET /events/:id': 'Get single event details',
        'POST /events': 'Create new event (Auth required - Admin/Staff)',
        'PUT /events/:id': 'Update event (Auth required - Admin/Staff)',
        'DELETE /events/:id': 'Delete event (Auth required - Admin only)',
        'GET /events/:id/stats': 'Get event statistics (Auth required - Admin/Staff)',
        'GET /events/:id/registrations': 'Get event registrations (Auth required - Admin/Staff)'
      },
      registrations: {
        'POST /registrations/events/:eventId/register': 'Register for event (Rate limited)',
        'GET /registrations/:confirmationCode': 'Get registration by confirmation code',
        'PUT /registrations/:id/cancel': 'Cancel registration',
        'GET /registrations/user/:email': 'Get user registration history',
        'GET /registrations': 'Get all registrations (Auth required - Admin/Staff)',
        'PUT /registrations/:id/status': 'Update registration status (Auth required - Admin/Staff)',
        'POST /registrations/:id/resend-confirmation': 'Resend confirmation email (Auth required - Admin/Staff)'
      },
      authentication: {
        'POST /event-auth/login': 'User login (Rate limited)',
        'GET /event-auth/me': 'Get user profile (Auth required)',
        'POST /event-auth/change-password': 'Change password (Auth required)',
        'POST /event-auth/register': 'Register new user (Auth required - Admin only)',
        'GET /event-auth/users': 'Get all users (Auth required - Admin only)',
        'PUT /event-auth/users/:id': 'Update user (Auth required - Admin only)',
        'DELETE /event-auth/users/:id': 'Delete user (Auth required - Admin only)'
      },
      analytics: {
        'GET /analytics/dashboard': 'Get dashboard statistics (Auth required - Admin/Staff)',
        'GET /analytics/events/:id': 'Get event-specific analytics (Auth required - Admin/Staff)',
        'GET /analytics/revenue': 'Get revenue statistics (Auth required - Admin/Staff)',
        'GET /analytics/export': 'Export data (Auth required - Admin only)'
      }
    },
    authentication: {
      type: 'Bearer Token',
      header: 'Authorization: Bearer <token>',
      description: 'Use JWT token obtained from /event-auth/login'
    },
    rateLimiting: {
      registration: '5 requests per 15 minutes per IP',
      authentication: '5 requests per 15 minutes per IP'
    }
  });
});

module.exports = router;
