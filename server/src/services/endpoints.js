const crypto = require('crypto');

function createEndpointCredentials() {
  const endpointId = crypto.randomBytes(16).toString('base64url');
  const viewingToken = crypto.randomBytes(32).toString('base64url');
  return { endpointId, viewingToken, viewingTokenHash: hashToken(viewingToken) };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function constantTimeEquals(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

module.exports = { createEndpointCredentials, hashToken, constantTimeEquals };
