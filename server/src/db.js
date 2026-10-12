const { MongoClient } = require('mongodb');

async function connectDatabase({ mongoUri, mongoDbName }) {
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(mongoDbName);
    await Promise.all([
      db.collection('endpoints').createIndex({ endpointId: 1 }, { unique: true }),
      db.collection('capturedRequests').createIndex({ endpointId: 1, receivedAt: -1 }),
      db.collection('capturedRequests').createIndex({ endpointId: 1, sequence: 1 }, { unique: true }),
      db.collection('capturedRequests').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection('endpoints').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection('deliveryAttempts').createIndex({ endpointId: 1, eventKey: 1 }, { unique: true }),
      db.collection('deliveryAttempts').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
    return { db, close: () => client.close() };
  } catch (error) {
    await client.close().catch(() => {});
    throw new Error(`MongoDB connection failed: ${error.message}`);
  }
}

module.exports = { connectDatabase };
