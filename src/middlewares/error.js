const mongoose = require('mongoose');
const httpStatus = require('http-status');
const config = require('../config/config');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');

const errorConverter = (err, req, res, next) => {
  let error = err;
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
