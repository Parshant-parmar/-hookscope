function createCreationRateLimit({ windowMs = 60_000, max = 10 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const recent = (hits.get(key) || []).filter((time) => now - time < windowMs);
    if (recent.length >= max) {
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many endpoint creation requests' } });
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

module.exports = { createCreationRateLimit };
