// In-process TTL cache. Valid ONLY while the API runs as a single PM2 fork process —
// if PM2 cluster mode ever lands, replace with a shared store (Redis).
const MAX_ENTRIES = 500;
const store = new Map(); // key -> { value, expiresAt }  (Map preserves insertion order)

function get(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) { store.delete(key); return undefined; }
  return hit.value;
}

function set(key, value, ttlMs) {
  if (store.has(key)) store.delete(key); // re-insert to refresh recency order
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (store.size > MAX_ENTRIES) {
    store.delete(store.keys().next().value); // evict oldest insertion
  }
}

function del(prefix) {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}

async function wrap(key, ttlMs, fn) {
  const hit = get(key);
  if (hit !== undefined) return hit;
  const value = await fn();
  if (value !== undefined) set(key, value, ttlMs);
  return value;
}

module.exports = { get, set, del, wrap };
