// The student's stage-change notification is PAUSED (owner 2026-09-14). These tests pin both
// halves of that, because each fails in a different, silent way:
//
//   · the flag half — flipping STAGE_NOTICES_ENABLED back on is a deliberate act, so the
//     helper must write NOTHING while it is off. A `client` that throws on any query is the
//     honest way to assert "nothing was written": a count-based test would pass against a
//     helper that wrote and rolled back.
//   · the vocabulary half — when it IS turned back on it must speak the customer's three
//     words, never `STATUS_LABEL_AR`. That is the leak the قيد التنفيذ work closed on every
//     screen; a push notification cannot be un-sent, so this one is worth a red test.
//
// The third assertion is the one that catches a future "let me just add a quick notify here":
// the three writers that used to send stage words must not grow a direct INSERT back.
//
// Pure — no DB.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  notifyStageChange, customerStateAr, STAGE_NOTICES_ENABLED,
} = require('../lib/studentOrderNotices');
const { STATUS_LABEL_AR } = require('../controllers/orderController');

/** A tx client that fails the test if anyone tries to write through it. */
const forbiddenClient = {
  query() { throw new Error('notifyStageChange wrote to the DB while paused'); },
};

test('paused: notifyStageChange writes nothing and reports that it wrote nothing', async () => {
  assert.equal(STAGE_NOTICES_ENABLED, false, 'stage notices are paused by owner decision');
  for (const status of Object.keys(STATUS_LABEL_AR)) {
    const wrote = await notifyStageChange(forbiddenClient, { userId: 'u-1', status });
    assert.equal(wrote, false, `wrote a notification for ${status}`);
  }
});

test('the customer vocabulary is three words — never a production stage', () => {
  // Every in-flight stage collapses to one phrase, including any the enum gains later.
  const inFlight = [
    'designing', 'design_complete', 'converting', 'staff_review', 'printing',
    'embroidery', 'assembly', 'pressing', 'preparing', 'a_stage_invented_tomorrow',
  ];
  for (const s of inFlight) {
    assert.equal(customerStateAr(s), 'قيد التنفيذ', `${s} leaked a stage word`);
  }
  assert.equal(customerStateAr('ready'), 'جاهز للاستلام');
  assert.equal(customerStateAr('delivered'), 'تم التسليم');
  assert.equal(customerStateAr('cancelled'), 'ملغي');

  // And the internal labels the shop uses must not be reachable through this door.
  const internalOnly = ['قيد التصميم', 'قيد التطريز', 'قيد الكوي', 'قيد التجهيز', 'قيد التجميع'];
  const spoken = new Set(Object.keys(STATUS_LABEL_AR).map(customerStateAr));
  for (const word of internalOnly) {
    assert.ok(!spoken.has(word), `${word} reached the customer`);
  }
});

test('the three stage writers do not send their own status_change notification', () => {
  // ⚠️ Matching on the notification TYPE would be wrong: confirmDelivery legitimately writes
  // a 'status_change' row («تم تسليم طلبك»), and that one stays. What was removed is
  // identified by its TITLE and by the stage word in its body, so those are what is pinned.
  const files = [
    'controllers/orderController.js',      // updateStatus
    'controllers/productionController.js', // performAdvance + revert
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(
      !src.includes('تحديث حالة الطلب'),
      `${rel} sends the stage-change notification directly — route it through lib/studentOrderNotices.js`
    );
    assert.ok(
      !/INSERT INTO notifications[\s\S]{0,400}?STATUS_LABEL_AR/.test(src),
      `${rel} puts a production stage word into a notification`
    );
  }
});
