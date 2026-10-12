function createRequestRateLimit({ windowMs = 60_000, max = 120 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now(); const key = req.params.id;
    const recent = (hits.get(key) || []).filter((time) => now - time < windowMs);
    if (recent.length >= max) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Capture endpoint rate limit exceeded' } });
    recent.push(now); hits.set(key, recent); return next();
  };
}
module.exports = { createRequestRateLimit };
