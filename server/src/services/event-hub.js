function createEventHub() {
  const clients = new Map();
  return {
    subscribe(endpointId, client) {
      const set = clients.get(endpointId) || new Set(); set.add(client); clients.set(endpointId, set);
      return () => { set.delete(client); if (set.size === 0) clients.delete(endpointId); };
    },
    publish(endpointId, request) {
      for (const client of clients.get(endpointId) || []) client.send(request);
    },
  };
}
module.exports = { createEventHub };
