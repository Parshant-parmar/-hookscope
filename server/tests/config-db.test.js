const { loadConfig } = require('../src/config');
const { connectDatabase } = require('../src/db');

describe('configuration and database failures', () => {
  test('reports missing required configuration', () => {
    expect(() => loadConfig({})).toThrow('Missing required configuration');
  });
  test('validates network and retention settings and parses an explicit CORS allow-list', () => {
    const env = { MONGODB_URI: 'mongodb://localhost:27017', MONGODB_DB: 'test', PUBLIC_BASE_URL: 'http://localhost:3000', CORS_ORIGINS: 'https://dashboard.example, https://preview.example' };
    expect(loadConfig(env).corsOrigins).toEqual(['https://dashboard.example', 'https://preview.example']);
    expect(() => loadConfig({ ...env, PORT: '0' })).toThrow('PORT must be an integer');
    expect(() => loadConfig({ ...env, ENDPOINT_RETENTION_DAYS: '0' })).toThrow('ENDPOINT_RETENTION_DAYS must be an integer');
    expect(() => loadConfig({ ...env, PUBLIC_BASE_URL: 'ftp://example.com' })).toThrow('PUBLIC_BASE_URL must use http or https');
  });
  test('wraps database connection failures clearly', async () => {
    await expect(connectDatabase({ mongoUri: 'mongodb://127.0.0.1:1', mongoDbName: 'hookscope_test' })).rejects.toThrow('MongoDB connection failed:');
  }, 10_000);
});
