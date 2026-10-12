const { hashToken, constantTimeEquals } = require('../services/endpoints');

async function authenticateEndpoint(req, res, next) {
  try {
    const authorization = req.get('authorization') || '';
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
    const endpoint = await req.app.locals.db.collection('endpoints').findOne({ endpointId: req.params.id });
    if (!endpoint || endpoint.expiresAt <= new Date() || !match || !constantTimeEquals(endpoint.viewingTokenHash, hashToken(match[1]))) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint was not found' } });
    }
    req.endpoint = endpoint;
    return next();
  } catch (error) { return next(error); }
}
module.exports = { authenticateEndpoint };
