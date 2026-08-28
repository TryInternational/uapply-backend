const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
});

/**
 * The public access-request form.
 *
 * Note this does NOT skip successful requests, unlike authLimiter: on a sign-up
 * endpoint the successful calls are exactly the abuse you are trying to stop.
 * Five an hour is generous for a human filling in one form and useless to a
 * script filling the reviewer queue with noise.
 */
/**
 * A plain per-IP volume ceiling, in front of the two keyed limiters below.
 *
 * Needed precisely BECAUSE those two put the email in the key: without this a
 * caller varying the address each time passes both indefinitely, filling the
 * reviewer queue, mailing arbitrary recipients, and growing the limiter's
 * in-memory store two keys at a time.
 */
const accessRequestIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { code: 429, message: 'Too many access requests from this network. Please try again later.' },
});

const accessRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  // Keyed on network AND target address. Keying on IP alone lets one caller
  // spend the whole budget mailing a single address they do not own; keying on
  // email alone lets a botnet walk around it. Requires app.set('trust proxy')
  // -- without it req.ip is the App Engine front end and every caller shares
  // one bucket.
  keyGenerator: (req) => `${req.ip}|${String((req.body && req.body.email) || '').toLowerCase()}`,
  message: { code: 429, message: 'Too many access requests from this network. Please try again later.' },
});

/**
 * A second, address-only ceiling. Stops the same inbox being mailed from many
 * networks, which the combined key above deliberately does not cover.
 */
const accessRequestEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => String((req.body && req.body.email) || '').toLowerCase(),
  message: { code: 429, message: 'Too many access requests for this email address. Please try again later.' },
});

module.exports = {
  authLimiter,
  accessRequestIpLimiter,
  accessRequestLimiter,
  accessRequestEmailLimiter,
};
