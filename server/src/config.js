const required = ['MONGODB_URI', 'MONGODB_DB', 'PUBLIC_BASE_URL'];

function loadConfig(env = process.env) {
  const missing = required.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }
  const baseUrl = new URL(env.PUBLIC_BASE_URL);
  if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('PUBLIC_BASE_URL must use http or https');
  const number = (name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
    return value;
  };
  return {
    port: number('PORT', 3000, { min: 1, max: 65535 }),
    mongoUri: env.MONGODB_URI,
    mongoDbName: env.MONGODB_DB,
    publicBaseUrl: baseUrl.origin,
    endpointRetentionDays: number('ENDPOINT_RETENTION_DAYS', 7, { max: 365 }),
    requestRetentionDays: number('REQUEST_RETENTION_DAYS', 7, { max: 365 }),
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean),
  };
}

module.exports = { loadConfig };
