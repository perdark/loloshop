// ───────────────────────────────────────────────────────────────────────────
// The notification outbox drain.
//
// `notifications` IS the queue. Thirteen call sites already INSERT into it, several from
// inside `tx()`, and this reads committed rows back out and delivers them to real phones
// through lib/push.js. Nothing in a controller has to know push exists.
//
// WHY THAT SHAPE (the full argument is in db/migrations/077_push_notifications.sql):
//   • Transaction-safe by construction. A notification written inside a transaction that
//     later rolls back is never visible here, so it can never be pushed for work that did
//     not happen.
//   • Crash-safe. A row claimed by a process that died comes back after five minutes.
//   • Zero call-site churn, so no future `INSERT INTO notifications` can forget to push.
//
// SCOPE: one drain per API process, and the shop runs ONE PM2 fork — the same assumption
// lib/memoCache.js and lib/eventBus.js already make. It is nevertheless safe under cluster
// mode: the claim is a single atomic UPDATE with FOR UPDATE SKIP LOCKED, so two drains
// split the work instead of double-sending it.
// ───────────────────────────────────────────────────────────────────────────
const { query } = require('./db');
const push = require('./push');

/** Rows per pass. Small enough that one slow provider cannot stall the loop for a minute. */
const CLAIM_LIMIT = 50;
const POLL_MS = 5_000;

/**
 * ⚠️ THE FLOOD GUARD. Only notifications younger than this are ever pushed.
 *
 * Two things depend on it. (1) Migration 077 backfills existing rows to 'skipped', but a
 * database restored from an older dump, or a column added by hand, would hand this drain the
 * shop's entire notification history with the 'pending' default — thousands of push messages
 * about orders that closed months ago, to every phone at once. (2) A push about something
 * that happened yesterday is worse than no push: the student taps it and lands on a screen
 * where nothing has changed.
 */
const FRESH_WINDOW = '15 minutes';

/** A claim older than this belonged to a process that died mid-send; take it back. */
const STUCK_AFTER = '5 minutes';

/** How often the retire sweep below runs, as a multiple of POLL_MS. 60 × 5s = 5 minutes. */
const RETIRE_EVERY_TICKS = 60;

let running = false;
let timer = null;
let ticks = 0;
let warnedUnconfigured = false;

/**
 * Retire rows that are past the freshness window without ever being sent.
 *
 * ⚠️ WITHOUT THIS THE PARTIAL INDEX GROWS FOREVER. `push_state` defaults to 'pending' and the
 * claim query only ever looks at the last 15 minutes, so every notification the drain did not
 * reach in time — every single one on a server where push is not configured at all — stays
 * 'pending' and stays in idx_notifications_push_pending permanently. The index would end up
 * indexing the whole table, which is the exact opposite of why it is partial.
 *
 * Runs whether or not push is configured, because the meaning is the same either way: too old
 * to be worth delivering. Bounded so one pass can never lock a large slice of the table.
 */
async function retireStale({ limit = 500 } = {}) {
  const { rowCount } = await query(
    `UPDATE notifications SET push_state = 'skipped'
      WHERE id IN (
        SELECT id FROM notifications
         WHERE push_state IN ('pending', 'sending')
           AND created_at < now() - INTERVAL '${FRESH_WINDOW}'
         ORDER BY created_at
         LIMIT $1
      )`,
    [limit]
  );
  // The anonymous queue (095) needs the same sweep for the same reason: its index is partial on
  // the unfinished states, so a row nobody ever drained would sit in it forever.
  const { rowCount: devices } = await query(
    `UPDATE device_notifications SET push_state = 'skipped'
      WHERE id IN (
        SELECT id FROM device_notifications
         WHERE push_state IN ('pending', 'sending')
           AND created_at < now() - INTERVAL '${FRESH_WINDOW}'
         ORDER BY created_at
         LIMIT $1
      )`,
    [limit]
  );
  return rowCount + devices;
}

/**
 * Claim → send → mark. Returns counts so a caller (or a test) can assert on a pass.
 * Never throws: a drain failure must not take the API process down.
 */
async function drainOnce({ limit = CLAIM_LIMIT } = {}) {
  const empty = { claimed: 0, sent: 0, skipped: 0, failed: 0, dropped: 0 };
  const reachable = push.configured();
  if (!reachable.android && !reachable.ios) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.log('push: no FCM/APNs credentials — notifications stay in-app only');
    }
    // Deliberately does NOT claim or mark anything. Rows stay 'pending' and the freshness
    // window above means switching credentials on later delivers the last 15 minutes, not
    // the backlog.
    return empty;
  }

  // One atomic claim. FOR UPDATE SKIP LOCKED so a second process (or a second pass that
  // overlaps a slow one) takes different rows rather than the same ones.
  // The two INTERVALs are interpolated because Postgres will not take an interval literal as a
  // bind parameter without a cast; both are module constants declared above, never input.
  // `pushed_at` doubles as the claim timestamp — that is what STUCK_AFTER measures.
  const { rows: claimed } = await query(
    `UPDATE notifications SET push_state = 'sending', pushed_at = now()
      WHERE id IN (
        SELECT id FROM notifications
         WHERE push_state IN ('pending', 'sending')
           AND created_at > now() - INTERVAL '${FRESH_WINDOW}'
           AND (push_state = 'pending' OR pushed_at < now() - INTERVAL '${STUCK_AFTER}')
         ORDER BY created_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, user_id, type, title_ar, body_ar, link`,
    [limit]
  );
  if (!claimed.length) return empty;

  const userIds = [...new Set(claimed.map((r) => r.user_id))];
  const { rows: devices } = await query(
    `SELECT id, user_id, token, platform FROM device_tokens WHERE user_id = ANY($1::uuid[])`,
    [userIds]
  );
  const byUser = new Map();
  for (const d of devices) {
    // Skip a platform this process has no credentials for, so an iOS-only device on a
    // server with only FCM configured is 'skipped' rather than counted as a failure.
    if (!reachable[d.platform]) continue;
    const list = byUser.get(d.user_id);
    if (list) list.push(d);
    else byUser.set(d.user_id, [d]);
  }

  const sent = [];
  const failed = [];
  const skipped = [];
  const deadTokens = new Set();

  for (const row of claimed) {
    const targets = byUser.get(row.user_id) || [];
    // No app installed, or no permission granted. Not a failure — the in-app list still
    // has the notification, which is exactly what happened before push existed.
    if (!targets.length) {
      skipped.push(row.id);
      continue;
    }
    const message = {
      id: row.id,
      title: row.title_ar,
      body: row.body_ar,
      link: row.link,
      type: row.type,
    };
    const results = await Promise.all(targets.map((d) => push.sendToDevice(d, message)));
    let anyOk = false;
    results.forEach((result, i) => {
      if (result.ok) anyOk = true;
      else if (result.dead) deadTokens.add(targets[i].token);
    });
    // One phone reached is a delivered notification; the student's other, uninstalled
    // handset must not mark it failed.
    (anyOk ? sent : failed).push(row.id);
  }

  const mark = async (ids, state) => {
    if (!ids.length) return;
    await query(
      `UPDATE notifications SET push_state = $2, pushed_at = now() WHERE id = ANY($1::uuid[])`,
      [ids, state]
    );
  };
  await mark(sent, 'sent');
  await mark(skipped, 'skipped');
  // 'failed', not back to 'pending': the provider refused it and retrying the same payload
  // to the same token produces the same refusal. Real transient outages are covered by the
  // claim never being marked at all when this process dies.
  await mark(failed, 'failed');

  let dropped = 0;
  if (deadTokens.size) {
    // The ONLY place a device row is deleted. `dead` is set exclusively by an explicit
    // provider verdict (FCM 404/403, APNs 410/BadDeviceToken) — never by a timeout or a 5xx,
    // which would quietly unsubscribe every phone during an FCM outage.
    const { rowCount } = await query(`DELETE FROM device_tokens WHERE token = ANY($1::text[])`, [
      [...deadTokens],
    ]);
    dropped = rowCount;
  }

  return { claimed: claimed.length, sent: sent.length, skipped: skipped.length, failed: failed.length, dropped };
}

/**
 * The anonymous pass (migration 095): one push per `device_notifications` row.
 *
 * ⚠️ IT IS A SEPARATE PASS, NOT A WIDENING OF THE ONE ABOVE, and the two must not be folded
 * together. The user pass fans ONE notification out to ALL of that person's handsets and marks
 * it sent if ANY of them took it — «one phone reached is a delivered notification». Here the
 * row IS the handset: there is no person to satisfy, no other device to fall back to, and a
 * failure means exactly one refusal. Same states, same freshness window, same dead-token
 * cleanup, different unit.
 *
 * A device that signs in between the queue write and the drain is skipped on purpose: the join
 * requires `user_id IS NULL`, so its owner will be reached through the user queue instead and
 * a promoted handset never gets the message twice.
 */
async function drainDevicesOnce({ limit = CLAIM_LIMIT } = {}) {
  const empty = { claimed: 0, sent: 0, skipped: 0, failed: 0, dropped: 0 };
  const reachable = push.configured();
  if (!reachable.android && !reachable.ios) return empty;

  const { rows: claimed } = await query(
    `UPDATE device_notifications SET push_state = 'sending', pushed_at = now()
      WHERE id IN (
        SELECT id FROM device_notifications
         WHERE push_state IN ('pending', 'sending')
           AND created_at > now() - INTERVAL '${FRESH_WINDOW}'
           AND (push_state = 'pending' OR pushed_at < now() - INTERVAL '${STUCK_AFTER}')
         ORDER BY created_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, device_id, type, title_ar, body_ar, link`,
    [limit]
  );
  if (!claimed.length) return empty;

  const deviceIds = [...new Set(claimed.map((r) => r.device_id))];
  const { rows: devices } = await query(
    `SELECT id, user_id, token, platform FROM device_tokens
      WHERE id = ANY($1::uuid[]) AND user_id IS NULL`,
    [deviceIds]
  );
  const byId = new Map(devices.map((d) => [d.id, d]));

  const sent = [];
  const failed = [];
  const skipped = [];
  const deadTokens = new Set();

  for (const row of claimed) {
    const device = byId.get(row.device_id);
    // Gone, or no longer anonymous, or a platform this process has no credentials for. None of
    // those is a failure — nothing was refused, there was simply nothing to send to.
    if (!device || !reachable[device.platform]) {
      skipped.push(row.id);
      continue;
    }
    const result = await push.sendToDevice(device, {
      id: row.id,
      title: row.title_ar,
      body: row.body_ar,
      link: row.link,
      type: row.type,
    });
    if (result.ok) sent.push(row.id);
    else {
      if (result.dead) deadTokens.add(device.token);
      failed.push(row.id);
    }
  }

  const mark = async (ids, state) => {
    if (!ids.length) return;
    await query(
      `UPDATE device_notifications SET push_state = $2, pushed_at = now() WHERE id = ANY($1::uuid[])`,
      [ids, state]
    );
  };
  await mark(sent, 'sent');
  await mark(skipped, 'skipped');
  await mark(failed, 'failed');

  let dropped = 0;
  if (deadTokens.size) {
    // Same rule as the user pass: only an explicit provider verdict deletes a device row.
    // `device_notifications.device_id` is ON DELETE CASCADE, so the rows just marked 'failed'
    // for that token go with it — which is correct, they can never be delivered.
    const { rowCount } = await query(`DELETE FROM device_tokens WHERE token = ANY($1::text[])`, [
      [...deadTokens],
    ]);
    dropped = rowCount;
  }

  return { claimed: claimed.length, sent: sent.length, skipped: skipped.length, failed: failed.length, dropped };
}

async function tick() {
  if (running) return; // a slow provider must not stack passes on top of each other
  running = true;
  try {
    const users = await drainOnce();
    const anon = await drainDevicesOnce();
    const out = {
      sent: users.sent + anon.sent,
      failed: users.failed + anon.failed,
      skipped: users.skipped + anon.skipped,
      dropped: users.dropped + anon.dropped,
    };
    if (out.sent || out.failed || out.dropped) {
      console.log(
        `push: sent=${out.sent} failed=${out.failed} skipped=${out.skipped} dropped_tokens=${out.dropped}` +
          (anon.claimed ? ` (anon: sent=${anon.sent} failed=${anon.failed})` : '')
      );
    }
    if (ticks++ % RETIRE_EVERY_TICKS === 0) await retireStale();
  } catch (err) {
    console.error('push: drain failed —', err.message);
  } finally {
    running = false;
  }
}

/** Starts the poll loop. Idempotent; `unref` so it never holds the process open on SIGTERM. */
function start() {
  if (timer) return;
  timer = setInterval(tick, POLL_MS);
  timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { drainOnce, drainDevicesOnce, retireStale, start, stop, POLL_MS, FRESH_WINDOW };
