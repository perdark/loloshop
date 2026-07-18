const test = require('node:test');
const assert = require('node:assert');
const memoCache = require('../lib/memoCache');

test('set/get within TTL', () => {
  memoCache.set('a:1', { x: 1 }, 1000);
  assert.deepStrictEqual(memoCache.get('a:1'), { x: 1 });
});

test('get after TTL expiry returns undefined', async () => {
  memoCache.set('a:2', 'v', 10);
  await new Promise((r) => setTimeout(r, 25));
  assert.strictEqual(memoCache.get('a:2'), undefined);
});

test('del(prefix) removes only matching keys', () => {
  memoCache.set('cat:x', 1, 5000);
  memoCache.set('cat:y', 2, 5000);
  memoCache.set('join:z', 3, 5000);
  memoCache.del('cat:');
  assert.strictEqual(memoCache.get('cat:x'), undefined);
  assert.strictEqual(memoCache.get('cat:y'), undefined);
  assert.strictEqual(memoCache.get('join:z'), 3);
});

test('wrap caches the fn result and skips the second call', async () => {
  let calls = 0;
  const fn = async () => { calls += 1; return 'r'; };
  assert.strictEqual(await memoCache.wrap('w:1', 1000, fn), 'r');
  assert.strictEqual(await memoCache.wrap('w:1', 1000, fn), 'r');
  assert.strictEqual(calls, 1);
});

test('bounded: oldest entries evicted past MAX_ENTRIES', () => {
  for (let i = 0; i < 600; i++) memoCache.set(`b:${i}`, i, 60000);
  assert.strictEqual(memoCache.get('b:0'), undefined);   // evicted
  assert.strictEqual(memoCache.get('b:599'), 599);        // newest kept
});
