const { loadConfig } = require('./config');
const { connectDatabase } = require('./db');
const { createApp } = require('./app');
const { attachTunnelServer } = require('./tunnel/ws-server');

async function start() {
  const config = loadConfig();
  const connection = await connectDatabase(config);
  const app = createApp({ db: connection.db, publicBaseUrl: config.publicBaseUrl, endpointRetentionDays: config.endpointRetentionDays, requestRetentionDays: config.requestRetentionDays, corsOrigins: config.corsOrigins });
  const server = app.listen(config.port, () => console.log(`HookScope listening on ${config.publicBaseUrl}`));
  server.requestTimeout = 30_000;
  server.headersTimeout = 35_000;
  server.keepAliveTimeout = 65_000;
  const detachTunnel = attachTunnelServer(server, { db: connection.db, tunnelManager: app.locals.tunnelManager });
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    detachTunnel();
    server.closeIdleConnections?.();
    const forceClose = setTimeout(() => server.closeAllConnections?.(), 5_000);
    await new Promise((resolve) => server.close(resolve));
    clearTimeout(forceClose);
    await connection.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

start().catch((error) => { console.error(error.message); process.exitCode = 1; });
