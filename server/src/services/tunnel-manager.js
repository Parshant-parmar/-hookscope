const crypto = require('crypto');

function validateResult(message) {
  return message && message.type === 'replay_result' && typeof message.replayId === 'string' && typeof message.status === 'number' && Number.isInteger(message.status) && message.status >= 0 && message.status <= 599 && Number.isFinite(message.durationMs) && message.durationMs >= 0 && typeof message.bodyPreview === 'string' && Buffer.byteLength(message.bodyPreview) <= 8192;
}
function createTunnelManager({ replayTimeoutMs = 10_000, logger = { warn: () => {} } } = {}) {
  const tunnels = new Map();
  function remove(endpointId, socket) { const tunnel = tunnels.get(endpointId); if (tunnel?.socket !== socket) return; tunnels.delete(endpointId); for (const pending of tunnel.pending.values()) { clearTimeout(pending.timeout); pending.reject(new Error('Tunnel disconnected')); } }
  return {
    connect(endpointId, socket) {
      const previous = tunnels.get(endpointId); if (previous) previous.socket.close(4000, 'Replaced by a new tunnel');
      const tunnel = { socket, pending: new Map(), alive: true }; tunnels.set(endpointId, tunnel);
      socket.on('pong', () => { tunnel.alive = true; });
      socket.on('message', (payload) => { if (Buffer.byteLength(payload) > 64 * 1024) return socket.close(1009, 'Frame too large'); let message; try { message = JSON.parse(payload.toString()); } catch (_) { return socket.close(1003, 'Malformed message'); } if (message.type === 'heartbeat') return; if (!validateResult(message)) return socket.close(1003, 'Malformed message'); const pending = tunnel.pending.get(message.replayId); if (!pending) return; clearTimeout(pending.timeout); tunnel.pending.delete(message.replayId); pending.resolve({ status: message.status, durationMs: message.durationMs, bodyPreview: message.bodyPreview }); });
      socket.on('close', () => remove(endpointId, socket)); socket.on('error', () => remove(endpointId, socket));
      socket.send(JSON.stringify({ type: 'ready', endpointId }));
    },
    isConnected(endpointId) { return tunnels.has(endpointId) && tunnels.get(endpointId).socket.readyState === 1; },
    async replay(endpointId, captured) {
      const tunnel = tunnels.get(endpointId); if (!tunnel || tunnel.socket.readyState !== 1) throw new Error('No CLI tunnel is connected');
      const replayId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { tunnel.pending.delete(replayId); reject(new Error('Replay timed out after 10 seconds')); }, replayTimeoutMs);
        tunnel.pending.set(replayId, { resolve, reject, timeout });
        tunnel.socket.send(JSON.stringify({ type: 'replay', replayId, request: { method: captured.method, path: captured.path, query: captured.query, headers: captured.headers, rawBodyBase64: captured.rawBodyBase64 } }), (error) => { if (error) { clearTimeout(timeout); tunnel.pending.delete(replayId); reject(new Error('Tunnel disconnected')); } });
      });
    },
    heartbeat() { for (const [endpointId, tunnel] of tunnels) { if (!tunnel.alive) { tunnel.socket.terminate(); remove(endpointId, tunnel.socket); } else { tunnel.alive = false; tunnel.socket.ping(); } } },
    closeAll() { for (const tunnel of tunnels.values()) tunnel.socket.close(1001, 'Server shutting down'); },
  };
}
module.exports = { createTunnelManager, validateResult };
