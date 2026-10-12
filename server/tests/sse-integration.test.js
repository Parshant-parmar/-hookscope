const http = require('http');
const request = require('supertest');
const { createApp } = require('../src/app');
const { MemoryDb } = require('./helpers/memory-db');

function receiveEvent(server, endpoint, lastEventId = 0) {
  return new Promise((resolve, reject) => {
    const client = http.request({ host: '127.0.0.1', port: server.address().port, path: `/api/endpoints/${endpoint.endpointId}/stream`, headers: { authorization: `Bearer ${endpoint.viewingToken}`, 'last-event-id': String(lastEventId) } });
    client.on('response', (response) => { let text = ''; response.on('data', (chunk) => { text += chunk; const match = /id: (\d+)\nevent: request\ndata: (.+)\n\n/.exec(text); if (match) { response.destroy(); resolve({ id: Number(match[1]), data: JSON.parse(match[2]) }); } }); });
    client.on('error', reject); client.end();
  });
}
describe('SSE integration', () => {
  let app; let server;
  beforeEach(() => { app = createApp({ db: new MemoryDb(), publicBaseUrl: 'http://localhost:3000', logger: { error: () => {} }, rateLimitOptions: { max: 50 }, captureRateLimitOptions: { max: 50 } }); server = app.listen(0, '127.0.0.1'); });
  afterEach(() => new Promise((resolve) => server.close(resolve)));
  test('delivers a live request to the authorized endpoint stream', async () => { const endpoint = (await request(app).post('/api/endpoints').send({})).body; const event = receiveEvent(server, endpoint); await request(app).post(`/h/${endpoint.endpointId}`).send('live').expect(202); expect((await event).data.sequence).toBe(1); });
  test('recovers a missed request after reconnect', async () => { const endpoint = (await request(app).post('/api/endpoints').send({})).body; await request(app).post(`/h/${endpoint.endpointId}`).send('one').expect(202); await request(app).post(`/h/${endpoint.endpointId}`).send('two').expect(202); const event = await receiveEvent(server, endpoint, 1); expect(event.id).toBe(2); expect(Buffer.from(event.data.rawBodyBase64, 'base64').toString()).toBe('two'); });
});
