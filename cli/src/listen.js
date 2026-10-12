const http = require('http');
const { WebSocket } = require('ws');

function validatePort(port) { const value = Number(port); if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('Port must be an integer between 1 and 65535'); return value; }
function localRequest(port, replay) {
  return new Promise((resolve) => {
    const path = replay.request.path + (Object.keys(replay.request.query || {}).length ? `?${new URLSearchParams(replay.request.query).toString()}` : ''); const started = Date.now();
    const headers = { ...replay.request.headers, host: '127.0.0.1' }; delete headers.connection; delete headers['content-length']; headers['content-length'] = Buffer.from(replay.request.rawBodyBase64 || '', 'base64').length;
    const request = http.request({ host: '127.0.0.1', port, method: replay.request.method, path, headers, timeout: 8_000 }, (response) => { const chunks = []; let length = 0; response.on('data', (chunk) => { if (length < 8192) { chunks.push(chunk.subarray(0, 8192 - length)); length += chunk.length; } }); response.on('end', () => resolve({ status: response.statusCode || 0, durationMs: Date.now() - started, bodyPreview: Buffer.concat(chunks).toString('utf8') })); });
    request.on('timeout', () => request.destroy(new Error('Local request timed out'))); request.on('error', (error) => resolve({ status: 0, durationMs: Date.now() - started, bodyPreview: `Local connection failed: ${error.code || error.message}` })); request.end(Buffer.from(replay.request.rawBodyBase64 || '', 'base64'));
  });
}
function startListener({ port, endpointId, token, baseUrl = process.env.HOOKSCOPE_URL || 'http://localhost:3000', WebSocketImpl = WebSocket, log = console }) {
  const localPort = validatePort(port); if (!/^[A-Za-z0-9_-]{22}$/.test(endpointId) || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Endpoint ID or token format is invalid');
  const url = new URL(`/api/tunnels/${endpointId}`, baseUrl); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; let stopped = false; let attempt = 0; let socket;
  const connect = () => { if (stopped) return; socket = new WebSocketImpl(url, { headers: { Authorization: `Bearer ${token}` }, maxPayload: 64 * 1024 }); socket.on('open', () => { attempt = 0; log.log(`Tunnel connected. Public capture URL: ${new URL(`/h/${endpointId}`, baseUrl)}`); }); socket.on('message', async (raw) => { let message; try { message = JSON.parse(raw.toString()); } catch (_) { return socket.close(1003, 'Malformed message'); } if (message.type === 'ready') return log.log('Tunnel ready.'); if (message.type !== 'replay' || typeof message.replayId !== 'string' || !message.request) return socket.close(1003, 'Malformed message'); const result = await localRequest(localPort, message); log.log(`Replay ${message.replayId}: ${result.status || 'failed'} in ${result.durationMs}ms`); socket.send(JSON.stringify({ type: 'replay_result', replayId: message.replayId, ...result })); }); socket.on('close', () => { if (stopped) return; const wait = Math.min(30_000, 500 * (2 ** attempt)) + Math.floor(Math.random() * 250); attempt += 1; log.log(`Tunnel disconnected; retrying in ${wait}ms`); setTimeout(connect, wait); }); socket.on('error', () => {}); };
  connect(); const stop = () => { stopped = true; socket?.close(1000, 'CLI stopped'); }; process.once('SIGINT', stop); process.once('SIGTERM', stop); return { stop };
}
module.exports = { validatePort, localRequest, startListener };
