const express = require('express');
const helmet = require('helmet');
const xss = require('xss-clean');
const mongoSanitize = require('express-mongo-sanitize');
const compression = require('compression');
const cors = require('cors');
const passport = require('passport');
const httpStatus = require('http-status');
const config = require('./config/config');
const morgan = require('./config/morgan');
const logger = require('./config/logger');
const { jwtStrategy } = require('./config/passport');
const { authLimiter } = require('./middlewares/rateLimiter');
const routes = require('./routes/v1');
const { errorConverter, errorHandler } = require('./middlewares/error');
const ApiError = require('./utils/ApiError');

const app = express();

// Deployment is App Engine flex, so every request arrives through a front-end
// proxy and req.ip would otherwise be that proxy for ALL callers -- collapsing
// every rate limiter onto a single bucket.
//
// A HOP COUNT, never `true`. Trusting every hop makes Express take the
// left-most X-Forwarded-For entry, which the caller writes, so a spoofed header
// would hand out a fresh rate-limit bucket per request -- and would do it to
// authLimiter on /v1/auth too, weakening login brute-force protection that has
// nothing to do with this feature. Confirm the real hop count on the deployed
// instance before changing TRUST_PROXY_HOPS.
app.set('trust proxy', config.trustProxyHops);

if (config.env !== 'test') {
  app.use(morgan.successHandler);
  app.use(morgan.errorHandler);
}

// Set security HTTP headers
app.use(helmet());

// Parse JSON request body. Capture the raw buffer so the WhatsApp webhook can
// verify Meta's X-Hub-Signature-256 HMAC (the parsed body can't be re-hashed).
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Parse URL-encoded request body
app.use(express.urlencoded({ extended: true }));

// Sanitize request data
app.use(xss());
app.use(mongoSanitize());

// Gzip compression
app.use(compression());

const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
  // Let the browser reuse a preflight answer for a day (Chrome caps it at 2 h).
  // Without it Chrome re-asks after 5 s, so nearly every call from the back
  // office (another origin, with an Authorization header) cost an extra round
  // trip to App Engine before the real request — ~0.4 s each from Kuwait/India.
  maxAge: 86400,
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Explicit OPTIONS handler for all routes
app.options('*', cors(corsOptions));
passport.use('jwt', jwtStrategy);

/**
 * Limit repeated failed requests to auth endpoints.
 *
 * Gated on the deployment being a REAL one, not on NODE_ENV. `npm run dev`
 * runs with NODE_ENV=production (against APP_ENV=staging), so the old
 * `config.env === 'production'` check armed a 20-failures-per-15-minutes
 * brute-force limiter against localhost — where the only person hitting it is
 * a developer signing in as six demo accounts in a row, who then gets 429s
 * with no explanation for a quarter of an hour.
 *
 * The test is the configured back-office URL, which is a property of the
 * deployment and cannot be influenced by a caller — unlike req.ip, which
 * depends on trust-proxy being right. A deployed host never matches it, so
 * production protection is unchanged.
 */
const isLocalDeployment = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(config.appUrls.backoffice || '');
if (config.env === 'production' && !isLocalDeployment) {
  app.use('/v1/auth', authLimiter);
} else if (isLocalDeployment) {
  logger.warn('auth rate limiter DISABLED — local deployment detected from appUrls.backoffice');
}

// One-off check of TRUST_PROXY_HOPS on a new host (Cloud Run behind the load
// balancer): with DEBUG_IP_ECHO=true, GET /v1/_ip shows the caller the address
// the API takes as theirs next to the raw X-Forwarded-For. req.ip must equal
// your own public IP. Off unless the variable is set; switch it off after.
if (process.env.DEBUG_IP_ECHO === 'true') {
  app.get('/v1/_ip', (req, res) => res.json({ ip: req.ip, xff: req.headers['x-forwarded-for'] || null }));
}

// v1 API routes
app.use('/v1', routes);

// Send back a 404 error for any unknown API request
app.use((req, res, next) => {
  next(new ApiError(httpStatus.NOT_FOUND, 'Not found'));
});

// Convert error to ApiError, if needed
app.use(errorConverter);

// Handle error
app.use(errorHandler);

module.exports = app;
