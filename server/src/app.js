const express = require('express');
const path = require('path');
const helmet = require('helmet');
const healthRouter = require('./routes/health');
const { endpointsRouter } = require('./routes/endpoints');
const { captureRouter } = require('./routes/capture');
const { errorHandler } = require('./middleware/error-handler');
const { createEventHub } = require('./services/event-hub');
const { authenticateEndpoint } = require('./middleware/authenticate-endpoint');
const { createTunnelManager } = require('./services/tunnel-manager');

function createApp({ db, publicBaseUrl, logger = console, rateLimitOptions, captureRateLimitOptions, endpointRetentionDays, requestRetentionDays, corsOrigins = [], eventHub = createEventHub(), tunnelManager = createTunnelManager({ logger }) } = {}) {
  if (!db) throw new Error('A database connection is required');
  const app = express();
  app.locals.logger = logger;
  app.locals.db = db;
  app.locals.tunnelManager = tunnelManager;
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://cdn.tailwindcss.com'], styleSrc: ["'self'", "'unsafe-inline'"] } } }));
  // The dashboard is same-origin by default.  Cross-origin access is opt-in and
  // never reflects arbitrary Origin headers (tokens travel in Authorization).
  app.use('/api', (req, res, next) => {
    const origin = req.get('origin');
    if (origin && corsOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Last-Event-ID');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });
  app.use('/api', healthRouter);
  app.use('/api/endpoints', endpointsRouter({ db, publicBaseUrl, rateLimitOptions, endpointRetentionDays }));
  app.get('/api/endpoints/:id/stream', authenticateEndpoint, async (req, res, next) => {
    try {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders?.();
      let lastSent = Number(req.get('last-event-id') || 0);
      if (!Number.isSafeInteger(lastSent) || lastSent < 0) lastSent = 0;
      const send = (item) => { if (item.sequence <= lastSent) return; lastSent = item.sequence; res.write(`id: ${item.sequence}\nevent: request\ndata: ${JSON.stringify(item)}\n\n`); };
      const unsubscribe = eventHub.subscribe(req.params.id, { send });
      const missed = await db.collection('capturedRequests').find({ endpointId: req.params.id, sequence: { $gt: lastSent } }).sort({ sequence: 1 }).toArray();
      missed.forEach(send);
      const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 25_000);
      req.on('close', () => { clearInterval(keepAlive); unsubscribe(); });
    } catch (error) { return next(error); }
  });
  app.use('/h', captureRouter({ db, eventHub, rateLimitOptions: captureRateLimitOptions, requestRetentionDays }));
  app.use('/shared', express.static(path.join(__dirname, '../../shared')));
  app.use(express.static(path.join(__dirname, '../../web')));
  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} was not found` } }));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
