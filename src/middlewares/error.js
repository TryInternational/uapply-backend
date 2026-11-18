const mongoose = require('mongoose');
const httpStatus = require('http-status');
const config = require('../config/config');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');

/**
 * Mongoose's two "the request was wrong" errors, as an operational ApiError.
 *
 * Without this they are converted below with isOperational=false, and outside
 * development every non-operational error is replaced by a bare 500 "Internal
 * Server Error" — so a missing required field, an invalid email or a malformed
 * id in the URL all reached the user as a server crash. The message is built
 * from the field messages only ("Invalid email"), never Mongoose's own prefix
 * with the model and path names.
 */
const asClientError = (err) => {
  if (err instanceof mongoose.Error.ValidationError) {
    const parts = Object.values(err.errors || {}).map((e) => {
      if (e && e.kind === 'required') return `${e.path} is required`;
      if (e && e.name === 'CastError') return `${e.path} is not valid`;
      // A validator that throws (`throw new Error('Invalid email')`) keeps its
      // own words in `reason`; Mongoose's wrapper message quotes the path and
      // the rejected value, which is not for the person who typed it.
      if (e && e.reason && e.reason.message) return e.reason.message;
      return e && e.path ? `${e.path} is not valid` : 'A value is not valid';
    });
    return new ApiError(
      httpStatus.BAD_REQUEST,
      parts.length ? parts.join(', ') : 'Some details are not valid',
      true,
      err.stack
    );
  }
  if (err instanceof mongoose.Error.CastError) {
    // A malformed id in the URL is "no such record", not a server fault.
    if (err.path === '_id' || err.kind === 'ObjectId')
      return new ApiError(httpStatus.NOT_FOUND, 'Not found', true, err.stack);
    return new ApiError(httpStatus.BAD_REQUEST, `${err.path} is not valid`, true, err.stack);
  }
  return null;
};

const errorConverter = (err, req, res, next) => {
  let error = err;
  const clientError = asClientError(err);
  if (clientError) return next(clientError);
  if (!(error instanceof ApiError)) {
    const statusCode =
      error.statusCode || error instanceof mongoose.Error ? httpStatus.BAD_REQUEST : httpStatus.INTERNAL_SERVER_ERROR;
    const message = error.message || httpStatus[statusCode];
    error = new ApiError(statusCode, message, false, err.stack);
  }
  next(error);
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let { statusCode, message } = err;
  if (config.env === 'production' && !err.isOperational) {
    statusCode = httpStatus.INTERNAL_SERVER_ERROR;
    message = httpStatus[httpStatus.INTERNAL_SERVER_ERROR];
  }

  res.locals.errorMessage = err.message;

  const response = {
    code: statusCode,
    message,
    // A string `code` is a machine-readable reason (e.g. WINDOW_CLOSED from the
    // WhatsApp client); the numeric `code` above stays the HTTP status for callers
    // that already read it.
    ...(typeof err.code === 'string' && { errorCode: err.code }),
    ...(config.env === 'development' && { stack: err.stack }),
  };

  // ALWAYS log server-side. The response above deliberately hides the real
  // message outside development, which is right for the client — but the log
  // used to be gated on development too, so in staging and production every
  // 500 was completely silent and undiagnosable. The client still sees only
  // "Internal Server Error"; the operator now sees what actually happened.
  const detail = {
    method: req.method,
    path: req.originalUrl,
    statusCode: err.statusCode,
    name: err.name,
    message: err.message,
  };
  // Mongo duplicate-key errors carry the offending index, which is the single
  // most useful field when an insert starts failing after a schema change.
  if (err.code === 11000 || err.code === 11001) {
    detail.mongoCode = err.code;
    detail.keyPattern = err.keyPattern;
    detail.keyValue = err.keyValue;
  }
  if (statusCode >= 500) {
    logger.error(`${detail.method} ${detail.path} → ${statusCode}`, detail);
    logger.error(err.stack || err);
  } else if (config.env === 'development') {
    logger.error(err);
  }

  res.status(statusCode).send(response);
};

module.exports = {
  errorConverter,
  errorHandler,
};
