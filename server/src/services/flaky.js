const crypto = require('crypto');

function normalizeFlaky(input) {
  if (input === undefined) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('flaky configuration must be an object');
  const allowed = ['initialFailures', 'failureStatus', 'delayMs', 'retryAfterSeconds', 'successStatus', 'successBody'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error('flaky configuration contains an unsupported field');
  const value = {
    initialFailures: input.initialFailures ?? 0, failureStatus: input.failureStatus ?? 500, delayMs: input.delayMs ?? 0,
    retryAfterSeconds: input.retryAfterSeconds ?? null, successStatus: input.successStatus ?? 202, successBody: input.successBody ?? '',
  };
  if (!Number.isInteger(value.initialFailures) || value.initialFailures < 0 || value.initialFailures > 50) throw new Error('initialFailures must be an integer between 0 and 50');
  for (const key of ['failureStatus', 'successStatus']) if (!Number.isInteger(value[key]) || value[key] < 100 || value[key] > 599) throw new Error(`${key} must be an HTTP status`);
  if (!Number.isInteger(value.delayMs) || value.delayMs < 0 || value.delayMs > 10_000) throw new Error('delayMs must be between 0 and 10000');
  if (value.retryAfterSeconds !== null && (!Number.isInteger(value.retryAfterSeconds) || value.retryAfterSeconds < 1 || value.retryAfterSeconds > 86_400)) throw new Error('retryAfterSeconds must be between 1 and 86400');
  if (typeof value.successBody !== 'string' || Buffer.byteLength(value.successBody) > 8192) throw new Error('successBody must be a string no longer than 8 KB');
  return value;
}
function eventKey(headers, rawBody) {
  const explicit = headers['x-event-id'] || headers['stripe-event-id'];
  return typeof explicit === 'string' && explicit.length <= 512 ? explicit : crypto.createHash('sha256').update(rawBody).digest('hex');
}
async function nextAttempt(db, endpointId, key, expiresAt) {
  const value = await db.collection('deliveryAttempts').findOneAndUpdate({ endpointId, eventKey: key }, { $inc: { count: 1 }, $setOnInsert: { endpointId, eventKey: key, expiresAt } }, { upsert: true, returnDocument: 'after' });
  return value.count;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports = { normalizeFlaky, eventKey, nextAttempt, delay };
