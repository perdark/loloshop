// LoloShop queue worker (PM2 app `loloshop-worker`). Consumes calligraphy generation
// jobs so the admin/design-team browser no longer has to stay open driving the loop.
require('dotenv').config();
const { getBoss, QUEUE_GENERATION } = require('./lib/queue');
const { processNextBatch } = require('./lib/calligraphyEngine');
const staffReport = require('./lib/staffReportJob');
const calligSweep = require('./lib/calligraphySweep');
const { enqueueGeneration } = require('./lib/queue');

// Drains one calligraphy job: batch after batch (≤10 names each) until nothing is
// pending. A failed batch (OpenRouter error, or zero progress while work remains)
// throws so pg-boss retries with backoff — plates keep their pending/failed statuses
// and the resumed attempt picks up exactly where it stopped.
async function handleGeneration(jobId) {
  for (;;) {
    const out = await processNextBatch(jobId, null);
    if (out.error) throw new Error(`${out.error.code}: ${out.error.message}`);
    const d = out.data;
    // ⚠️ A HOLD IS NOT A STALL — CHECK IT BEFORE THE «no progress» THROW BELOW.
    // An under-full sheet is deliberately not bought yet (lib/calligraphyBatching.js), and it
    // also reports `processed === 0` with work remaining. Throwing would spend the two
    // pg-boss retries in ~90s and then ABANDON the plates, which is the one outcome this
    // feature must never produce. Return quietly instead and book a wake-up for the moment
    // the window closes; lib/calligraphySweep.js covers the case where that send is lost.
    if (d.held) {
      console.log(`[worker] job ${jobId}: holding ${d.held_count} name(s) for ${d.held_seconds}s`);
      await enqueueGeneration(jobId, { startAfterSeconds: d.held_seconds + 5 });
      return;
    }
    console.log(`[worker] job ${jobId}: +${d.processed} done=${d.done} failed=${d.failed} remaining=${d.remaining}`);
    if (d.remaining <= 0) return;
    if (d.processed === 0) throw new Error('batch made no progress — retrying later');
  }
}

(async () => {
  const boss = await getBoss();
  await boss.work(QUEUE_GENERATION, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await handleGeneration(job.data.jobId);
  });

  // The nightly «تقرير الموظفين» push (2026-08-21). Registered inside its own try/catch on
  // purpose: a scheduling failure must never stop this worker consuming calligraphy jobs,
  // which is what students are actually waiting on. A missed report is a missed report; a
  // dead worker is a stalled shop.
  try {
    await staffReport.register(boss);
  } catch (err) {
    console.error('staff report schedule failed (calligraphy unaffected):', err.message);
  }

  // The batching sweep. Same isolation as the report above and for a stronger reason: if this
  // fails to register, held plates lose their safety net, so the failure must be LOUD in the
  // log rather than taking the worker down with it.
  try {
    await calligSweep.register(boss);
  } catch (err) {
    console.error('⚠️ calligraphy sweep schedule FAILED — held plates rely only on their own '
      + 'delayed re-enqueue until this is fixed:', err.message);
  }

  console.log('loloshop-worker up — consuming', QUEUE_GENERATION);
})().catch((err) => {
  console.error('worker boot failed:', err);
  process.exit(1);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
