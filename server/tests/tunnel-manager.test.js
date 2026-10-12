const { EventEmitter } = require('events');
const { createTunnelManager, validateResult } = require('../src/services/tunnel-manager');

class FakeSocket extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.sent = []; this.closed = null; }
  send(value, callback) { this.sent.push(JSON.parse(value)); callback?.(); }
  close(code, reason) { this.closed = { code, reason }; this.readyState = 3; this.emit('close'); }
  ping() { this.pinged = true; }
  terminate() { this.terminated = true; this.readyState = 3; this.emit('close'); }
}
describe('tunnel protocol manager', () => {
  test('validates replay result payloads', () => { expect(validateResult({ type: 'replay_result', replayId: 'id', status: 200, durationMs: 3, bodyPreview: 'ok' })).toBe(true); expect(validateResult({ type: 'replay_result', replayId: 'id', status: 200 })).toBe(false); });
  test('performs replay round trip and rejects malformed frames', async () => { const manager = createTunnelManager(); const socket = new FakeSocket(); manager.connect('endpoint', socket); const replay = manager.replay('endpoint', { method: 'POST', path: '/', query: {}, headers: {}, rawBodyBase64: '' }); const message = socket.sent.find((item) => item.type === 'replay'); socket.emit('message', Buffer.from(JSON.stringify({ type: 'replay_result', replayId: message.replayId, status: 201, durationMs: 4, bodyPreview: 'done' }))); await expect(replay).resolves.toEqual({ status: 201, durationMs: 4, bodyPreview: 'done' }); socket.emit('message', Buffer.from('{')); expect(socket.closed.code).toBe(1003); });
  test('only retains one active tunnel and removes dead heartbeats', () => { const manager = createTunnelManager(); const first = new FakeSocket(); const second = new FakeSocket(); manager.connect('endpoint', first); manager.connect('endpoint', second); expect(first.closed.code).toBe(4000); manager.heartbeat(); expect(second.pinged).toBe(true); manager.heartbeat(); expect(second.terminated).toBe(true); expect(manager.isConnected('endpoint')).toBe(false); });
  test('fails pending replays when the tunnel disconnects', async () => { const manager = createTunnelManager(); const socket = new FakeSocket(); manager.connect('endpoint', socket); const replay = manager.replay('endpoint', { method: 'POST', path: '/', query: {}, headers: {}, rawBodyBase64: '' }); socket.close(); await expect(replay).rejects.toThrow('Tunnel disconnected'); });
});
