/**
 * Central error handling (NFR-4, NFR-10).
 * Express 5 forwards errors thrown inside async handlers to here automatically,
 * so controllers do not need try/catch around every database call.
 */

function notFound(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Mongoose validation error -> 400 with readable messages
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ message: 'Validation failed', errors: messages });
  }
  // Bad ObjectId in a URL, e.g. /api/bookings/abc
  if (err.name === 'CastError') {
    return res.status(400).json({ message: `Invalid ${err.path}` });
  }
  // Request body bigger than allowed (a photo or video that is too large, or an oversized JSON body)
  if (err.type === 'entity.too.large') {
    const isPortfolio = /\/portfolio\/?$/.test(req.path);
    const isFile = /\/media\/?$/.test(req.path);
    return res.status(413).json({
      message: isPortfolio ? 'That photo is too large. Photos can be up to 5 MB.' : isFile ? 'That file is too large. Photos can be up to 5 MB and videos up to 15 MB.' : 'That request is too large.',
    });
  }
  // Unique index violation (duplicate email, duplicate review for a booking)
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'value';
    return res.status(409).json({ message: `Duplicate ${field}` });
  }

  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({
    message: status === 500 ? 'Something went wrong on the server' : err.message,
  });
}

module.exports = { notFound, errorHandler };
