const request = require('supertest');
const { createApp } = require('../src/app');
const { MemoryDb } = require('./helpers/memory-db');
const { validatePort, localRequest } = require('../../cli/src/listen');
const { eventKey } = require('../src/services/flaky');

function setup() { const db = new MemoryDb(); return { db, app: createApp({ db, publicBaseUrl: 'http://localhost:3000', logger: { error: () => {} }, rateLimitOptions: { max: 100 }, captureRateLimitOptions: { max: 1000 } }) }; }
async function endpoint(app) { return (await request(app).post('/api/endpoints').send({})).body; }
const auth = (item) => ({ authorization: `Bearer ${item.viewingToken}` });
describe('Milestone 3 endpoint behavior', () => {
  test('rejects unauthorized configuration and replay', async () => { const { app } = setup(); const item = await endpoint(app); await request(app).patch(`/api/endpoints/${item.endpointId}/config`).send({ flaky: {} }).expect(404); await request(app).post(`/api/endpoints/${item.endpointId}/requests/nope/replay`).expect(404); });
  test('flaky mode fails initial attempts and returns Retry-After', async () => { const { app } = setup(); const item = await endpoint(app); await request(app).patch(`/api/endpoints/${item.endpointId}/config`).set(auth(item)).send({ flaky: { initialFailures: 2, failureStatus: 429, retryAfterSeconds: 5, successStatus: 201, successBody: 'ok' } }).expect(200); await request(app).post(`/h/${item.endpointId}`).set('x-event-id', 'evt_1').send('same').expect('Retry-After', '5').expect(429); await request(app).post(`/h/${item.endpointId}`).set('x-event-id', 'evt_1').send('same').expect(429); await request(app).post(`/h/${item.endpointId}`).set('x-event-id', 'evt_1').send('same').expect(201, 'ok'); });
  test('assigns unique, complete attempt numbers under 50 concurrent deliveries', async () => { const { app, db } = setup(); const item = await endpoint(app); await Promise.all(Array.from({ length: 50 }, () => request(app).post(`/h/${item.endpointId}`).set('x-event-id', 'evt_parallel').send('same').expect(202))); const stored = await db.collection('capturedRequests').find({ endpointId: item.endpointId }).toArray(); expect(stored.map((record) => record.attempt).sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1)); });
  test('returns retry-analysis timings and outcome', async () => { const { app } = setup(); const item = await endpoint(app); await request(app).post(`/h/${item.endpointId}`).set('x-event-id', 'evt_group').send('x').expect(202); await request(app).post(`/h/${item.endpointId}`).set('x-event-id', 'evt_group').send('x').expect(202); const result = await request(app).get(`/api/endpoints/${item.endpointId}/retries`).set(auth(item)).expect(200); expect(result.body.groups[0].attempts.map((attempt) => attempt.attempt)).toEqual([1, 2]); expect(result.body.groups[0].attempts[1].sincePreviousMs).toEqual(expect.any(Number)); });
  test('reports no tunnel rather than attempting server-side replay', async () => { const { app } = setup(); const item = await endpoint(app); await request(app).post(`/h/${item.endpointId}`).send('x').expect(202); const captured = (await request(app).get(`/api/endpoints/${item.endpointId}/requests`).set(auth(item))).body.requests[0]; await request(app).post(`/api/endpoints/${item.endpointId}/requests/${captured.requestId}/replay`).set(auth(item)).expect(503); });
});
describe('CLI safety', () => {
  test('accepts only explicit valid ports', () => { expect(validatePort('3000')).toBe(3000); expect(() => validatePort('0')).toThrow(); expect(() => validatePort('80.5')).toThrow(); });
  test('reports local connection refusal without contacting arbitrary hosts', async () => { const result = await localRequest(1, { request: { method: 'POST', path: '/webhook', query: {}, headers: {}, rawBodyBase64: '' } }); expect(result.status).toBe(0); expect(result.bodyPreview).toMatch(/Local connection failed/); });
});

describe('delivery identity hardening', () => {
  test('does not use malformed or unbounded event-id header values as a database key', () => {
    const body = Buffer.from('body');
    expect(eventKey({ 'x-event-id': ['unexpected'] }, body)).toMatch(/^[a-f0-9]{64}$/);
    expect(eventKey({ 'x-event-id': 'x'.repeat(513) }, body)).toMatch(/^[a-f0-9]{64}$/);
  });
});
