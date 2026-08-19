// LoloShop queue worker (PM2 app `loloshop-worker`). Consumes calligraphy generation
// jobs so the admin/design-team browser no longer has to stay open driving the loop.
require('dotenv').config();
const { getBoss, QUEUE_GENERATION } = require('./lib/queue');
const { processNextBatch } = require('./lib/calligraphyEngine');

// Drains one calligraphy job: batch after batch (≤10 names each) until nothing is
// pending. A failed batch (OpenRouter error, or zero progress while work remains)
// throws so pg-boss retries with backoff — plates keep their pending/failed statuses
// and the resumed attempt picks up exactly where it stopped.
async function handleGeneration(jobId) {
  for (;;) {
    const out = await processNextBatch(jobId, null);
    if (out.error) throw new Error(`${out.error.code}: ${out.error.message}`);
    const d = out.data;
    console.log(`[worker] job ${jobId}: +${d.processed} blank=${d.blank || 0} done=${d.done} failed=${d.failed} remaining=${d.remaining}`);
    if (d.remaining <= 0) return;
    // A batch whose bands all came back EMPTY made progress even though `processed` is 0:
    // those rows are `failed` now, not pending, so the loop cannot spin on them. Retrying
    // here would just buy another sheet for names a designer has to reroll by hand anyway.
    if (d.processed === 0 && !d.blank) throw new Error('batch made no progress — retrying later');
  }
}

(async () => {
  const boss = await getBoss();
  await boss.work(QUEUE_GENERATION, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await handleGeneration(job.data.jobId);
  });
  console.log('loloshop-worker up — consuming', QUEUE_GENERATION);
})().catch((err) => {
  console.error('worker boot failed:', err);
  process.exit(1);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
