// ───────────────────────────────────────────────────────────────────────────
// Tiny in-process Server-Sent-Events hub.
//
// Any controller calls publish({...}) to push a JSON event to every connected
// staff/admin browser (presence changes, order status moves, new orders). The
// SSE route (routes/production.js → events) registers each client's response
// stream here.
//
// SCOPE: in-memory, single process. Fine for the current single PM2 instance /
// dev nodemon. If the API is ever scaled to multiple workers, swap this for a
// shared bus (Postgres LISTEN/NOTIFY or Redis pub/sub) — the publish()/addClient
// surface stays the same.
// ───────────────────────────────────────────────────────────────────────────

/** @type {Set<import('http').ServerResponse>} */
const clients = new Set();

function addClient(res) {
  clients.add(res);
  return () => clients.delete(res);
}

function publish(event) {
  if (!clients.size) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

// Comment ping every 25s keeps proxies/load-balancers from closing idle streams.
function ping() {
  for (const res of clients) {
    try {
      res.write(': ping\n\n');
    } catch {
      clients.delete(res);
    }
  }
}
setInterval(ping, 25_000).unref();

module.exports = { addClient, publish };
