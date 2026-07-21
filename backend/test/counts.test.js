// Tests for lib/counts.js — the unit vocabulary that every dashboard number now
// flows through. Spec: docs/superpowers/specs/2026-07-21-counts-units-design.md
//
// These run against the dev DB (read-only: no INSERT/UPDATE/DELETE anywhere here).
// They assert INVARIANTS rather than fixed numbers, so they keep working as the
// shop's data grows.
const test = require('node:test');
const assert = require('node:assert');
const counts = require('../lib/counts');

test('pieces >= bundles >= students (a bundle holds >=1 piece; a student may order twice)', async () => {
  const s = await counts.summary(counts.buildScope());
  assert.ok(s.pieces >= s.bundles, `pieces ${s.pieces} < bundles ${s.bundles}`);
  assert.ok(s.bundles >= s.students, `bundles ${s.bundles} < students ${s.students}`);
});

test('THE CORE INVARIANT: stage funnel pieces sum EXACTLY to the piece total', async () => {
  const scope = counts.buildScope();
  const [funnel, pieces] = await Promise.all([
    counts.stageFunnel(scope),
    counts.countPieces(scope),
  ]);
  const sum = funnel.reduce((n, r) => n + r.pieces, 0);
  assert.strictEqual(sum, pieces, `funnel sums to ${sum} but there are ${pieces} pieces`);
});

test('per-stage STUDENTS is a membership count and may exceed the student total', async () => {
  // This is the bug that broke the old dashboards: bundles/students were summed
  // per stage as if they partitioned the total. They do not — a student with a
  // sash at التطريز and a cap at بانتظار التصميم belongs to BOTH rows. The test
  // documents that over-counting is EXPECTED here, so nobody "fixes" it later.
  const scope = counts.buildScope();
  const [funnel, students] = await Promise.all([
    counts.stageFunnel(scope),
    counts.countStudents(scope),
  ]);
  const sum = funnel.reduce((n, r) => n + r.students, 0);
  assert.ok(sum >= students, 'membership sum should be >= the distinct student count');
});

test('bundles in progress never exceeds total bundles', async () => {
  const scope = counts.buildScope();
  const [inProgress, bundles] = await Promise.all([
    counts.countBundlesInProgress(scope),
    counts.countBundles(scope),
  ]);
  assert.ok(inProgress <= bundles, `${inProgress} in progress > ${bundles} total`);
});

test('retail + wholesaler scopes partition the whole shop', async () => {
  const [all, retail, rep] = await Promise.all([
    counts.countPieces(counts.buildScope()),
    counts.countPieces(counts.buildScope({ source: 'retail' })),
    counts.countPieces(counts.buildScope({ source: 'wholesaler' })),
  ]);
  assert.strictEqual(retail + rep, all, `${retail} + ${rep} !== ${all}`);
});

test('buildScope parameterises its filters (no string interpolation of user input)', () => {
  const scope = counts.buildScope({ wholesalerId: "'; DROP TABLE orders; --" });
  assert.ok(scope.where.includes('$1'), 'wholesalerId must become a bound parameter');
  assert.deepStrictEqual(scope.params, ["'; DROP TABLE orders; --"]);
  assert.ok(!scope.where.includes('DROP TABLE'), 'raw input must never reach the SQL text');
});

test('cancelled rows are excluded from every count', async () => {
  const scope = counts.buildScope();
  assert.ok(scope.where.includes("status <> 'cancelled'"));
});
