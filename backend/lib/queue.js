// Shared pg-boss handle. The API process uses it only to SEND; worker.js also WORKs.
// Tables live in the same Neon DB under the `pgboss` schema (auto-created on start).
const PgBoss = require('pg-boss');

const QUEUE_GENERATION = 'calligraphy-generate';
// The safety net under the batching hold (lib/calligraphyBatching.js). A held sheet is
// normally woken by its own delayed re-enqueue; this sweep exists for the case where that
// enqueue was lost — a worker restart between the hold and the send. Without it a held plate
// would sit `pending` with nobody scheduled to look at it again, which is the one way this
// feature could turn into «الخط توقف».
const QUEUE_SWEEP = 'calligraphy-sweep';

let bossPromise = null;
function getBoss() {
  if (!bossPromise) {
    // Strip sslmode/channel_binding like lib/db.js — we set ssl explicitly, and the
    // URL params otherwise trigger pg's noisy verify-full deprecation warning.
    let connectionString = process.env.DATABASE_URL || '';
    try {
      const u = new URL(connectionString);
      u.searchParams.delete('sslmode');
      u.searchParams.delete('channel_binding');
      connectionString = u.toString();
    } catch { /* leave as-is */ }
    const boss = new PgBoss({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 3, // small dedicated pool — do not starve the app pool
    });
    boss.on('error', (err) => console.error('pg-boss error:', err));
    bossPromise = boss.start().then(async () => {
      await boss.createQueue(QUEUE_GENERATION).catch(() => {}); // idempotent (exists → throws)
      await boss.createQueue(QUEUE_SWEEP).catch(() => {});
      return boss;
    });
    bossPromise.catch((err) => {
      console.error('pg-boss start failed:', err.message);
      bossPromise = null; // allow a later retry instead of caching the rejection
    });
  }
  return bossPromise;
}

// Fire-and-forget: generation must keep working even if the queue is down (the FE
// falls back to the client-driven /process loop on stall). singletonKey is a
// BEST-EFFORT dedupe (pg-boss only enforces it while a job sits in `created`) —
// true protection against double generation is structural: one worker at
// concurrency 1, and a drained job has no pending plates, so extra attempts no-op.
async function enqueueGeneration(jobId, { startAfterSeconds = 0 } = {}) {
  try {
    const boss = await getBoss();
    await boss.send(QUEUE_GENERATION, { jobId }, {
      // ⚠️ `singletonKey` ONLY dedupes while a job sits in `created`, so a delayed re-enqueue
      // for a held sheet can collide with the ticket that is still running and be dropped.
      // The sweep below is what makes that survivable; do not rely on this alone.
      singletonKey: jobId,
      ...(startAfterSeconds > 0 ? { startAfter: Math.ceil(startAfterSeconds) } : {}),
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      // Per-ATTEMPT cap; doubles as crash recovery — a killed worker's job
      // redelivers after this. Attempts that outlive it (very large jobs keep
      // draining) just spawn a no-op retry: nothing pending → instant success.
      expireInSeconds: 20 * 60,
    });
  } catch (err) {
    console.error('enqueueGeneration failed (client loop still works):', err.message);
  }
}

module.exports = { getBoss, enqueueGeneration, QUEUE_GENERATION, QUEUE_SWEEP };
