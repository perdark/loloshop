// Tests for lib/shopAnalytics.js — the /admin/analytics payload.
//
// What is worth covering here is NOT "does it return numbers". It is the two ways this page can
// lie, both of which are silent and both of which the owner would act on:
//   1. Two incompatible sources merged into one figure. The payload keeps `accounts`, `reach`,
//      `installs` and `pages` in separate objects for that reason — a future "tidy-up" that
//      flattens them is exactly the regression these assertions exist to catch.
//   2. A lifetime question answered with a windowed number. `reach.by_role` asks «كم واحد من
//      حساباتنا شاف التطبيق ولو مرة»; if a `days` filter ever leaks into that query, shrinking
//      the window would silently shrink "how many students have ever opened the app".

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const analytics = require('../lib/shopAnalytics');
const { query } = require('../lib/db');

test('buildOverview keeps the four sources in separate blocks', async () => {
  const d = await analytics.buildOverview({ days: 30 });

  for (const key of ['accounts', 'growth', 'reach', 'installs', 'pages', 'since', 'live']) {
    assert.ok(key in d, `missing block: ${key}`);
  }
  // Each block must carry its own start date, or a young table renders as a flat zero and reads
  // as «nobody uses the app» — the exact misreading lib/appPresence.js's header warns about.
  for (const key of ['app_opens', 'visits', 'devices', 'users']) {
    assert.ok(key in d.since, `missing coverage date: ${key}`);
  }
  // No total that adds device rows to app_opens rows to site_visits rows.
  assert.strictEqual(typeof d.live.sessions_today, 'number');
  assert.strictEqual(typeof d.live.people_today, 'number');
  assert.ok(!('total' in d.live), 'live must not carry a combined total across sources');
});

test('reach is LIFETIME — shrinking the window cannot shrink «فتحوا ولو مرة»', async () => {
  const wide = await analytics.buildOverview({ days: 180 });
  const narrow = await analytics.buildOverview({ days: 1 });

  const byRole = (d) => Object.fromEntries(d.reach.by_role.map((r) => [r.role, r]));
  const w = byRole(wide);
  const n = byRole(narrow);

  for (const role of Object.keys(w)) {
    assert.strictEqual(
      n[role].ever_opened,
      w[role].ever_opened,
      `${role}: ever_opened moved with the window — a days filter leaked into the reach query`
    );
    assert.strictEqual(n[role].accounts, w[role].accounts, `${role}: accounts moved with the window`);
    assert.strictEqual(
      n[role].native_users,
      w[role].native_users,
      `${role}: native_users moved with the window`
    );
  }
});

test('reach never claims more openers than accounts', async () => {
  const d = await analytics.buildOverview({ days: 30 });
  for (const r of d.reach.by_role) {
    assert.ok(r.ever_opened <= r.accounts, `${r.role}: ever_opened > accounts`);
    assert.ok(r.native_users <= r.ever_opened, `${r.role}: native_users > ever_opened`);
  }
});

test('page paths collapse ids, so one product page is one row', async () => {
  const sid = `t-${crypto.randomUUID()}`;
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  // Two DIFFERENT products, plus a numeric id — all three must land on the same row.
  await query(
    `INSERT INTO site_visits (session_id, path, created_at) VALUES
       ($1, $2, NOW()), ($3, $4, NOW()), ($5, $6, NOW())`,
    [`${sid}-1`, `/product/${a}`, `${sid}-2`, `/product/${b}`, `${sid}-3`, '/product/4821']
  );
  try {
    const d = await analytics.buildOverview({ days: 1 });
    const row = d.pages.top.find((p) => p.path === '/product/:id');
    assert.ok(row, 'the three product visits did not collapse into /product/:id');
    assert.ok(row.sessions >= 3, `expected at least the 3 seeded sessions, got ${row.sessions}`);
    // The minute figure is slices × 5 and is labelled approximate for that reason.
    assert.strictEqual(row.approx_minutes, row.slices * analytics.VISIT_SLICE_MINUTES);
  } finally {
    await query(`DELETE FROM site_visits WHERE session_id LIKE $1`, [`${sid}-%`]);
  }
});

test('growth counts orders, never their money', async () => {
  const d = await analytics.buildOverview({ days: 30 });
  for (const w of d.growth.orders_by_week) {
    assert.deepStrictEqual(
      Object.keys(w).sort(),
      ['orders', 'students', 'week'],
      'a money column reached the growth block — that vocabulary belongs to lib/counts.js'
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// MIGRATION 110 — app-vs-browser for visitors with no account
//
// This is the gate's scoreboard: after «التطبيق فقط» is switched on, `site_visits.platform` is
// the ONLY place a visitor without an account reveals what they are holding (app_opens.user_id
// is NOT NULL by design). Two ways to break it, both silent:
//   · fold NULL into 'web' — 34k rows written before the column existed would become a claim
//     nobody measured, and the "browser traffic collapsed" the gate is judged on would be fake;
//   · reject an unrecognised platform instead of storing NULL — a tracking endpoint that can
//     fail is worse than a gap, and the caller is a fire-and-forget beacon.

const { visit } = require('../controllers/trackController');

/** Minimal req/res doubles — the controller only ever reads body and answers 204. */
function drive(body) {
  return new Promise((resolve) => {
    const res = { status: () => ({ end: () => resolve() }) };
    visit({ body }, res);
  });
}

test('the visit beacon stores a known platform and NULLs an unknown one', async () => {
  const tag = `t-${crypto.randomUUID()}`;
  await drive({ session_id: `${tag}-a`, path: '/get-app', platform: 'ios' });
  await drive({ session_id: `${tag}-b`, path: '/get-app', platform: 'web' });
  // A visitor can send anything — it must be dropped to NULL, never 400, never stored raw.
  await drive({ session_id: `${tag}-c`, path: '/get-app', platform: 'nintendo' });
  await drive({ session_id: `${tag}-d`, path: '/get-app' });

  try {
    const { rows } = await query(
      `SELECT session_id, platform FROM site_visits WHERE session_id LIKE $1 ORDER BY session_id`,
      [`${tag}-%`]
    );
    assert.strictEqual(rows.length, 4, 'a visit was refused instead of recorded');
    assert.deepStrictEqual(
      rows.map((r) => r.platform),
      ['ios', 'web', null, null],
      'unknown and missing platforms must both store NULL'
    );
  } finally {
    await query(`DELETE FROM site_visits WHERE session_id LIKE $1`, [`${tag}-%`]);
  }
});

test('the platform split keeps «غير معروف» out of «متصفح»', async () => {
  const tag = `t-${crypto.randomUUID()}`;
  await query(
    `INSERT INTO site_visits (session_id, path, platform, created_at) VALUES
       ($1,'/get-app','ios',NOW()), ($2,'/get-app','web',NOW()), ($3,'/get-app',NULL,NOW())`,
    [`${tag}-1`, `${tag}-2`, `${tag}-3`]
  );
  try {
    const d = await analytics.buildOverview({ days: 1 });
    const by = Object.fromEntries(d.pages.by_platform.map((p) => [p.platform, p.sessions]));
    assert.ok((by.ios || 0) >= 1, 'the ios visit did not reach the split');
    assert.ok((by.web || 0) >= 1, 'the web visit did not reach the split');
    assert.ok(
      (by.unknown || 0) >= 1,
      'a NULL-platform visit was folded away — it must stay its own bucket'
    );
    // The weekly trend carries the same three buckets, and they must not double-count.
    const wk = d.pages.sessions_by_week.at(-1);
    assert.ok(wk.native + wk.web + wk.unknown <= wk.sessions + 2, 'weekly buckets overlap');
  } finally {
    await query(`DELETE FROM site_visits WHERE session_id LIKE $1`, [`${tag}-%`]);
  }
});
