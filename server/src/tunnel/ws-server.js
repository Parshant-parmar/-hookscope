const { WebSocketServer } = require('ws');
const { hashToken, constantTimeEquals } = require('../services/endpoints');

function attachTunnelServer(server, { db, tunnelManager, logger = { warn: () => {} } }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, clientTracking: false });
  server.on('upgrade', async (request, socket, head) => {
    const match = /^\/api\/tunnels\/([A-Za-z0-9_-]{22})$/.exec(new URL(request.url, 'http://localhost').pathname);
    if (!match) return;
    try {
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization || '')?.[1];
      const endpoint = await db.collection('endpoints').findOne({ endpointId: match[1] });
      if (!endpoint || endpoint.expiresAt <= new Date() || !token || !constantTimeEquals(endpoint.viewingTokenHash, hashToken(token))) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return socket.destroy(); }
      wss.handleUpgrade(request, socket, head, (ws) => tunnelManager.connect(match[1], ws));
    } catch (_) { socket.destroy(); }
  });
  const timer = setInterval(() => tunnelManager.heartbeat(), 30_000); timer.unref();
  return () => { clearInterval(timer); tunnelManager.closeAll(); wss.close(); };
}
module.exports = { attachTunnelServer };
