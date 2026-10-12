const http = require('http');
const { WebSocket } = require('ws');
const request = require('supertest');
const { createApp } = require('../src/app');
const { attachTunnelServer } = require('../src/tunnel/ws-server');
const { MemoryDb } = require('./helpers/memory-db');

describe('WebSocket tunnel authentication', () => {
  let server; let app; let detach;
  beforeEach(() => { const db = new MemoryDb(); app = createApp({ db, publicBaseUrl: 'http://localhost:3000', logger: { error: () => {} } }); server = http.createServer(app); detach = attachTunnelServer(server, { db, tunnelManager: app.locals.tunnelManager }); });
  afterEach(() => new Promise((resolve) => { detach(); server.close(resolve); }));
  test('accepts the correct token and rejects an incorrect one', async () => {
    const endpoint = (await request(app).post('/api/endpoints').send({})).body;
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `ws://127.0.0.1:${server.address().port}/api/tunnels/${endpoint.endpointId}`;
    await expect(new Promise((resolve, reject) => { const socket = new WebSocket(base, { headers: { Authorization: `Bearer ${endpoint.viewingToken}` } }); socket.once('message', (message) => { socket.close(); resolve(JSON.parse(message)); }); socket.once('error', reject); })).resolves.toMatchObject({ type: 'ready', endpointId: endpoint.endpointId });
    await expect(new Promise((resolve) => { const socket = new WebSocket(base, { headers: { Authorization: 'Bearer invalid' } }); socket.once('unexpected-response', (_, response) => resolve(response.statusCode)); socket.once('error', () => resolve(0)); })).resolves.toBe(401);
  });
});
