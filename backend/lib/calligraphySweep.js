'use strict';

/**
 * The safety net under the batching hold (lib/calligraphyBatching.js).
 *
 * A held sheet is normally woken by its own delayed re-enqueue in worker.js. That is one
 * message in one queue, and `singletonKey` only dedupes while a job sits in `created` — so a
 * worker restart, or a collision with the ticket that is still draining, can swallow it. A
 * held plate whose wake-up was lost stays `pending` forever with nobody scheduled to look at
 * it again, and the symptom on the floor is «الخط توقف» with nothing in any log.
 *
 * So once a minute this asks the only question that matters: **is there a pending plate older
 * than the hold window?** If yes, its job is enqueued. It does not decide anything — the hold
 * rule stays in ONE place, in the engine, and this just makes sure someone knocks on the door.
 * Re-running it is free: a job with nothing pending drains instantly to a no-op, which is the
 * same property the 2026-08-28 outage fix relies on.
 */
const { query } = require('./db');
const { enqueueGeneration } = require('./queue');
const { holdMinutes } = require('./calligraphyBatching');

const QUEUE_SWEEP = 'calligraphy-sweep';
const CRON = '* * * * *';
/** Never wake more than this many jobs in one pass — a backlog should drain over minutes,
 *  not arrive as fifty simultaneous paid images. */
const MAX_PER_SWEEP = 5;

/** Jobs holding a pending plate that has already waited out the window. */
async function overdueJobs(minutes = holdMinutes()) {
  // A zero window means holding is switched off; nothing can be overdue because nothing waits.
  if (minutes === 0) return [];
  const { rows } = await query(
    `SELECT job_id, min(created_at) AS oldest, count(*)::int AS pending
       FROM calligraphy_plates
      WHERE status = 'pending'
      GROUP BY job_id
     HAVING min(created_at) <= now() - ($1 || ' minutes')::interval
      ORDER BY min(created_at)
      LIMIT $2`,
    [String(minutes), MAX_PER_SWEEP]
  );
  return rows;
}

async function runSweep() {
  const jobs = await overdueJobs();
  for (const j of jobs) await enqueueGeneration(j.job_id);
  if (jobs.length) {
    console.log(`[callig-sweep] woke ${jobs.length} held job(s):`,
      jobs.map((j) => `${j.job_id}(${j.pending})`).join(' '));
  }
  return jobs.length;
}

async function register(boss) {
  await boss.createQueue(QUEUE_SWEEP).catch(() => {}); // idempotent (exists → throws)
  await boss.schedule(QUEUE_SWEEP, CRON, {});
  await boss.work(QUEUE_SWEEP, { batchSize: 1 }, async () => { await runSweep(); });
  console.log(`[callig-sweep] scheduled ${CRON} (hold ${holdMinutes()}m)`);
}

module.exports = { runSweep, overdueJobs, register, QUEUE_SWEEP, CRON, MAX_PER_SWEEP };
