const express = require('express');
const { createRequestRateLimit } = require('../middleware/request-rate-limit');
const crypto = require('crypto');
const { eventKey, nextAttempt, delay } = require('../services/flaky');

function captureRouter({ db, eventHub, rateLimitOptions, requestRetentionDays = 7 }) {
  const router = express.Router();
  router.all('/:id', createRequestRateLimit(rateLimitOptions), express.raw({ type: '*/*', limit: '256kb' }), async (req, res, next) => {
    try {
      const endpoint = await db.collection('endpoints').findOne({ endpointId: req.params.id });
      if (!endpoint) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Capture endpoint was not found' } });
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const updated = await db.collection('endpoints').findOneAndUpdate({ endpointId: req.params.id }, { $inc: { nextSequence: 1 } }, { returnDocument: 'after' });
      const sequence = updated.nextSequence;
      const receivedAt = new Date();
      const deliveryKey = eventKey(req.headers, rawBody);
      const expiresAt = new Date(receivedAt.getTime() + requestRetentionDays * 86400_000);
      const attempt = await nextAttempt(db, req.params.id, deliveryKey, expiresAt);
      const flaky = endpoint.flaky;
      const failed = flaky && attempt <= flaky.initialFailures;
      if (flaky?.delayMs) await delay(flaky.delayMs);
      const responseStatus = failed ? flaky.failureStatus : (flaky?.successStatus || 202);
      const responseBody = failed ? '' : (flaky?.successBody || '');
      const captured = {
        requestId: crypto.randomUUID(),
        endpointId: req.params.id,
        sequence,
        method: req.method,
        path: req.path,
        query: req.query,
        headers: req.headers,
        rawBodyBase64: rawBody.toString('base64'),
        bodySize: rawBody.length,
        receivedAt,
        expiresAt,
        sourceIp: req.ip,
        eventKey: deliveryKey,
        attempt,
        response: { status: responseStatus, retryAfterSeconds: failed ? flaky?.retryAfterSeconds || null : null },
      };
      await db.collection('capturedRequests').insertOne(captured);
      const all = await db.collection('capturedRequests').find({ endpointId: req.params.id }).sort({ sequence: -1 }).toArray();
      if (all.length > 200) await db.collection('capturedRequests').deleteMany({ _id: { $in: all.slice(200).map((item) => item._id) } });
      eventHub.publish(req.params.id, captured);
      if (failed && flaky.retryAfterSeconds) res.set('Retry-After', String(flaky.retryAfterSeconds));
      return res.status(responseStatus).send(responseBody);
    } catch (error) { return next(error); }
  });
  return router;
}

module.exports = { captureRouter };
