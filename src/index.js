const mongoose = require('mongoose');
const http = require('http'); // Import http module
const { Server } = require('socket.io'); // Import Socket.io
const cors = require('cors');
const app = require('./app');
const config = require('./config/config');
const logger = require('./config/logger');
const roleAccessService = require('./services/roleAccess.service');
const agreementService = require('./services/agreement.service');
const agreementRenderService = require('./services/agreementRender.service');
const ensureUlearnStudentIndexes = require('./utils/ensureUlearnStudentIndexes');

let server;

// Create HTTP server
const httpServer = http.createServer(app);

app.use(
  cors({
    origin: ['http://localhost:3001', 'https://staging.backoffice.uapplyabroad.com', 'https://backoffice.uapplyabroad.com'], // Replace with your Firebase Hosting URL
    credentials: true,
  })
);
// Initialize Socket.io
const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:3001', 'https://staging.backoffice.uapplyabroad.com', 'https://backoffice.uapplyabroad.com'], // Allow frontend origin
    methods: ['GET', 'POST'], // Allowed HTTP methods
    credentials: true, // Allow credentials (if needed)
  },
});

// Attach io to the app instance
app.set('io', io);

// Socket.io connection handler
io.on('connection', (socket) => {
  logger.info(`A user connected: ${socket.id}`);

  // Join a room for the user (e.g., using userId)
  socket.on('subscribe', (userId) => {
    socket.join(userId);
    logger.info(`User ${userId} subscribed to notifications`);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    logger.info(`User disconnected: ${socket.id}`);
  });
});

// Function to send a real-time notification to a specific user
const sendNotification = (userIds, message) => {
  userIds.forEach((userId) => {
    io.to(userId).emit('notification', { message, createdAt: new Date() });
    logger.info(`Notification sent to user ${userId}: ${message}`);
  });
};

// Make the `sendNotification` function available globally (optional)
global.sendNotification = sendNotification;

// Connect to MongoDB and start the server
mongoose.connect(config.mongoose.url, config.mongoose.options).then(async () => {
  logger.info('Connected to MongoDB');

  // Self-healing: drop the obsolete non-partial unique indexes on
  // ulearnstudents. Without this, the SECOND phone-only student to sign in
  // fails with E11000 on googleId_1 (every document missing the field indexes
  // as the same null). Idempotent, and never blocks startup.
  await ensureUlearnStudentIndexes();

  // Resume WhatsApp broadcasts a previous instance left half-sent.
  require('./services/whatsappBroadcast.services') // eslint-disable-line global-require
    .resumeStalled(io)
    .then((n) => n && logger.info(`[whatsapp] resumed ${n} stalled broadcast(s)`))
    .catch((e) => logger.warn(`[whatsapp] resumeStalled: ${e.message}`));

  // Load the roles collection before accepting traffic, so the very first
  // request is answered from real rights rather than from an empty cache.
  // Never throws: on failure the gates fall back to LEGACY_*_ROLE_IDS, which
  // is exactly the behaviour that shipped before roleAccess existed.
  await roleAccessService.warm();

  /**
   * Emailed links point somewhere real — or say so, loudly.
   *
   * Every invite, password reset and approval email builds its link from
   * config.appUrls. Those come from BACKOFFICE_URL / SUBAGENT_PORTAL_URL, and
   * .env.staging shipped with both set to http://localhost:3002 — so a real
   * school counsellor was emailed a "Set your password" button pointing at a
   * machine that is not theirs. Nothing failed; the mail sent perfectly and the
   * link was simply dead for the recipient.
   *
   * The tell is the combination: a LOCAL link while the database is REMOTE.
   * That pairing only happens by mistake — a developer running against a local
   * Mongo is fine, and a deployed host never has a localhost link.
   */
  const isLocalUrl = (u) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(u || '');
  const localLinks = Object.entries(config.appUrls).filter(([, url]) => isLocalUrl(url));
  const dbIsLocal = isLocalUrl(String(config.mongoose.url || '').replace(/^mongodb(\+srv)?:/, 'http:'));
  if (localLinks.length && !dbIsLocal) {
    logger.error(
      `EMAILED LINKS POINT AT LOCALHOST while the database is remote: ` +
        `${localLinks.map(([k, v]) => `${k}=${v}`).join(', ')}. ` +
        `Anyone invited from this instance receives a dead link. ` +
        `Set BACKOFFICE_URL and SUBAGENT_PORTAL_URL in .env.${process.env.APP_ENV || '<env>'}.`
    );
  } else {
    logger.info(`emailed links: backoffice=${config.appUrls.backoffice} subagent=${config.appUrls.subAgentPortal}`);
  }

  httpServer.listen(config.port, () => {
    logger.info(`Listening to port ${config.port}`);
    // Sub-agent agreements: hourly reminders to unsigned partners + expiry. Idempotent.
    setTimeout(
      () => agreementService.sendReminders().catch((e) => logger.error(`agreement reminders: ${e.message}`)),
      60 * 1000
    );
    setInterval(
      () => agreementService.sendReminders().catch((e) => logger.error(`agreement reminders: ${e.message}`)),
      60 * 60 * 1000
    );
  });
});

const exitHandler = () => {
  agreementRenderService.closeBrowser().catch(() => {});
  if (httpServer) {
    httpServer.close(() => {
      logger.info('Server closed');
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
};

const unexpectedErrorHandler = (error) => {
  logger.error(error);
  exitHandler();
};

process.on('uncaughtException', unexpectedErrorHandler);
process.on('unhandledRejection', unexpectedErrorHandler);

process.on('SIGTERM', () => {
  logger.info('SIGTERM received');
  if (httpServer) {
    httpServer.close();
  }
});
