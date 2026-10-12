const express = require('express');
const { createEndpointCredentials, hashToken, constantTimeEquals } = require('../services/endpoints');
const { createCreationRateLimit } = require('../middleware/creation-rate-limit');
const { authenticateEndpoint } = require('../middleware/authenticate-endpoint');
const { normalizeFlaky } = require('../services/flaky');

function endpointsRouter({ db, publicBaseUrl, rateLimitOptions, endpointRetentionDays = 7 }) {
  const router = express.Router();
  router.post('/', express.json({ limit: '8kb', strict: true }), createCreationRateLimit(rateLimitOptions), async (req, res, next) => {
    try {
      if (req.body && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some((key) => key !== 'name'))) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Only an optional name field is accepted' } });
      }
      if (req.body?.name !== undefined && (typeof req.body.name !== 'string' || req.body.name.length > 80)) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'name must be a string of at most 80 characters' } });
      }
      const { endpointId, viewingToken, viewingTokenHash } = createEndpointCredentials();
      const createdAt = new Date();
      await db.collection('endpoints').insertOne({ endpointId, viewingTokenHash, name: req.body?.name || null, createdAt, expiresAt: new Date(createdAt.getTime() + endpointRetentionDays * 86400_000), nextSequence: 0 });
      return res.status(201).json({ endpointId, captureUrl: `${publicBaseUrl}/h/${endpointId}`, viewingToken });
    } catch (error) { return next(error); }
  });

  router.get('/:id/requests', authenticateEndpoint, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
      const requests = await db.collection('capturedRequests').find({ endpointId: req.params.id }).sort({ receivedAt: -1 }).limit(limit).toArray();
      return res.json({ requests: requests.map((item) => ({ ...item, _id: item._id.toString() })) });
    } catch (error) { return next(error); }
  });
  router.patch('/:id/config', express.json({ limit: '16kb', strict: true }), authenticateEndpoint, async (req, res, next) => {
    try {
      if (!req.body || Object.keys(req.body).some((key) => key !== 'flaky')) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Only flaky configuration is accepted' } });
      const flaky = normalizeFlaky(req.body.flaky); await db.collection('endpoints').findOneAndUpdate({ endpointId: req.params.id }, { $set: { flaky } }, { returnDocument: 'after' });
      return res.json({ flaky });
    } catch (error) { if (error.message.includes('must') || error.message.includes('unsupported') || error.message.includes('between')) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: error.message } }); return next(error); }
  });
  router.get('/:id/retries', authenticateEndpoint, async (req, res, next) => {
    try {
      const requests = await db.collection('capturedRequests').find({ endpointId: req.params.id }).sort({ eventKey: 1, attempt: 1 }).toArray(); const groups = new Map();
      requests.forEach((item) => { const group = groups.get(item.eventKey) || []; const previous = group[group.length - 1]; group.push({ requestId: item.requestId, attempt: item.attempt, receivedAt: item.receivedAt, sincePreviousMs: previous ? new Date(item.receivedAt) - new Date(previous.receivedAt) : null, response: item.response, succeeded: item.response.status < 400 }); groups.set(item.eventKey, group); });
      return res.json({ groups: [...groups.entries()].map(([eventKey, attempts]) => ({ eventKey, attempts })) });
    } catch (error) { return next(error); }
  });
  router.post('/:id/requests/:requestId/replay', authenticateEndpoint, async (req, res, next) => {
    try {
      const captured = await db.collection('capturedRequests').findOne({ endpointId: req.params.id, requestId: req.params.requestId });
      if (!captured) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Captured request was not found' } });
      const result = await req.app.locals.tunnelManager.replay(req.params.id, captured); return res.json(result);
    } catch (error) { const status = /No CLI tunnel|timed out|disconnected/.test(error.message) ? 503 : 500; return res.status(status).json({ error: { code: 'REPLAY_UNAVAILABLE', message: error.message } }); }
  });
  router.delete('/:id', authenticateEndpoint, async (req, res, next) => {
    try { await db.collection('endpoints').deleteOne({ endpointId: req.params.id }); await db.collection('capturedRequests').deleteMany({ endpointId: req.params.id }); return res.status(204).end(); } catch (error) { return next(error); }
  });
  return router;
}

module.exports = { endpointsRouter };
