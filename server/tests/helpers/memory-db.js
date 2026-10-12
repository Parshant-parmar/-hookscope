let nextId = 1;
class MemoryCursor {
  constructor(items) { this.items = items; }
  sort(spec) { const [key, direction] = Object.entries(spec)[0]; this.items.sort((a, b) => (a[key] > b[key] ? direction : a[key] < b[key] ? -direction : 0)); return this; }
  limit(n) { this.items = this.items.slice(0, n); return this; }
  async toArray() { return this.items.map((item) => ({ ...item })); }
}
class MemoryCollection {
  constructor(uniqueEndpoint = false) { this.items = []; this.uniqueEndpoint = uniqueEndpoint; }
  async insertOne(doc) { const item = { ...doc, _id: String(nextId++) }; if (this.uniqueEndpoint && this.items.some((i) => i.endpointId === item.endpointId && item.endpointId)) { const e = new Error('duplicate'); e.code = 11000; throw e; } this.items.push(item); return { insertedId: item._id }; }
  matches(item, query) { return Object.entries(query).every(([key, value]) => { if (value && typeof value === 'object' && '$gt' in value) return item[key] > value.$gt; if (value && typeof value === 'object' && '$in' in value) return value.$in.includes(item[key]); return item[key] === value; }); }
  async findOne(query) { const found = this.items.find((item) => this.matches(item, query)); return found ? { ...found } : null; }
  async findOneAndUpdate(query, update, options = {}) { let item = this.items.find((candidate) => this.matches(candidate, query)); if (!item && options.upsert) { item = { ...query, _id: String(nextId++) }; if (update.$setOnInsert) Object.assign(item, update.$setOnInsert); this.items.push(item); } if (!item) return null; if (update.$inc) Object.entries(update.$inc).forEach(([key, value]) => { item[key] = (item[key] || 0) + value; }); if (update.$set) Object.assign(item, update.$set); return { ...item }; }
  async deleteOne(query) { const index = this.items.findIndex((item) => this.matches(item, query)); if (index >= 0) this.items.splice(index, 1); }
  async deleteMany(query) { this.items = this.items.filter((item) => !this.matches(item, query)); }
  find(query) { return new MemoryCursor(this.items.filter((item) => this.matches(item, query))); }
  async createIndex() { return 'index'; }
}
class MemoryDb { constructor() { this.collections = new Map(); } collection(name) { if (!this.collections.has(name)) this.collections.set(name, new MemoryCollection(name === 'endpoints')); return this.collections.get(name); } }
module.exports = { MemoryDb };
