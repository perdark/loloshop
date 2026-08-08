// Pins the ONE thing routes/join.js shouts about: `/representatives` must be registered
// ABOVE `/:code`.
//
// WHY THIS DESERVES A TEST. Express 5 matches in registration order, so moving the directory
// route one line down makes `/:code` swallow it — `getReferral` runs with code =
// "representatives", finds no wholesaler, and answers 404 «الرابط غير صالح». Nothing throws,
// no log line appears, and the symptom («ادخل مع ممثلك» shows an empty list) looks exactly
// like a data problem. A reviewer reordering routes alphabetically would ship it.
//
// The third test builds a DELIBERATELY mis-ordered router and asserts the swallow actually
// happens — otherwise the two tests above could pass for reasons unrelated to route order and
// this file would be a comment that runs.
//
// No database: lib/db and the controller are both stubbed in require.cache before the router
// is loaded, so this is a pure routing test that runs anywhere in milliseconds.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');

/** Replace a module with a fake BEFORE anything requires it for real. */
function stubModule(request, exports) {
  const filename = require.resolve(request);
  require.cache[filename] = {
    id: filename,
    filename,
    path: path.dirname(filename),
    loaded: true,
    exports,
    children: [],
    paths: [],
  };
}

// Order matters: joinController → lib/db would otherwise open a real pg Pool at import time.
stubModule('../lib/db', {
  query: async () => ({ rows: [], rowCount: 0 }),
  tx: async () => ({}),
});

stubModule('../controllers/joinController', {
  getRepresentatives: (req, res) => res.json({ handler: 'getRepresentatives' }),
  getReferral: (req, res) => res.json({ handler: 'getReferral', code: req.params.code }),
  joinReferral: (req, res) => res.status(201).json({ handler: 'joinReferral' }),
});

const express = require('express');
const joinRouter = require('../routes/join');
const c = require('../controllers/joinController');

async function withRouter(router, fn) {
  const app = express();
  app.use(express.json());
  app.use('/api/join', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /join/representatives reaches the directory, not the :code handler', async () => {
  const body = await withRouter(joinRouter, async (base) => {
    const res = await fetch(`${base}/api/join/representatives`);
    assert.strictEqual(res.status, 200);
    return res.json();
  });
  assert.strictEqual(
    body.handler,
    'getRepresentatives',
    'the directory route was swallowed by /:code — check the registration order in routes/join.js'
  );
});

test('GET /join/<code> still reaches the referral handler', async () => {
  const body = await withRouter(joinRouter, async (base) => {
    const res = await fetch(`${base}/api/join/damascus-medicine`);
    return res.json();
  });
  assert.strictEqual(body.handler, 'getReferral');
  assert.strictEqual(body.code, 'damascus-medicine');
});

test('the mis-ordered router really does swallow it (so the test above means something)', async () => {
  const broken = express.Router();
  broken.get('/:code', c.getReferral);
  broken.get('/representatives', c.getRepresentatives); // one line too late
  const body = await withRouter(broken, async (base) => {
    const res = await fetch(`${base}/api/join/representatives`);
    return res.json();
  });
  assert.strictEqual(body.handler, 'getReferral');
  assert.strictEqual(
    body.code,
    'representatives',
    'Express 5 matched /:code first — this is exactly the regression the order guards against'
  );
});
