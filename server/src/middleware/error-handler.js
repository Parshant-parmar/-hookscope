function errorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
  if (error?.type === 'entity.too.large' || error?.status === 413) {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body must not exceed 256 KB' } });
  }
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } });
  }
  req.app.locals.logger.error({ err: error.message, path: req.path }, 'Request failed');
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
}

module.exports = { errorHandler };
