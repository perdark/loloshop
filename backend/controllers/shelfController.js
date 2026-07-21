'use strict';
// رف التجهيز — HTTP layer. All logic lives in lib/shelf.js; this file only translates
// requests, maps ShelfError → the repo's {error, code} convention, and nothing else.
// Route-level requireStaffType('presser','preparer') handles authorization (it auto-passes
// manager + admin), so there are no permission checks here.
const shelf = require('../lib/shelf');

function sendShelfError(res, err) {
  if (err instanceof shelf.ShelfError) {
    return res.status(err.status).json({ error: err.messageAr, code: err.code });
  }
  throw err;
}

async function getBoard(req, res) {
  const data = await shelf.buildBoard();
  res.json({ data });
}

async function place(req, res) {
  const { order_id: orderId, shelf_code: shelfCode, slot_index: slotIndex } = req.body || {};
  if (!orderId) {
    return res.status(400).json({ error: 'لم تُحدد القطعة', code: 'ERR_VALIDATION' });
  }
  try {
    // Omitting shelf_code/slot_index accepts the suggestion (D3).
    const target = shelfCode && slotIndex ? { shelf_code: shelfCode, slot_index: slotIndex } : {};
    const data = await shelf.placePiece(orderId, req.user, target);
    res.json({ data });
  } catch (err) {
    return sendShelfError(res, err);
  }
}

async function collect(req, res) {
  const { order_id: orderId } = req.body || {};
  if (!orderId) {
    return res.status(400).json({ error: 'لم تُحدد القطعة', code: 'ERR_VALIDATION' });
  }
  try {
    const data = await shelf.collectPiece(orderId, req.user);
    res.json({ data });
  } catch (err) {
    return sendShelfError(res, err);
  }
}

async function closeSet(req, res) {
  const { set_key: setKey } = req.body || {};
  if (!setKey) {
    return res.status(400).json({ error: 'لم يُحدد الطرد', code: 'ERR_VALIDATION' });
  }
  try {
    const data = await shelf.closeSet(setKey, req.user);
    res.json({ data });
  } catch (err) {
    return sendShelfError(res, err);
  }
}

async function releasePlacement(req, res) {
  await shelf.releaseForOrder(req.params.orderId);
  res.json({ data: { released: true } });
}

// Config editing (manager/admin only via requireStaffType()). Shrinking a section below
// an OPEN bin would orphan a shelved piece, so it is refused by name.
async function patchSection(req, res) {
  const id = Number(req.params.id);
  const { slot_count: slotCount, max_per_slot: maxPerSlot } = req.body || {};

  const sections = await shelf.loadSections();
  const section = sections.find((s) => s.id === id);
  if (!section) {
    return res.status(404).json({ error: 'القسم غير موجود', code: 'ERR_NOT_FOUND' });
  }

  const nextCount = slotCount == null ? section.slot_count : Number(slotCount);
  if (!Number.isInteger(nextCount) || nextCount < 0) {
    return res.status(400).json({ error: 'عدد الخانات غير صالح', code: 'ERR_VALIDATION' });
  }

  if (nextCount < section.slot_count) {
    // Highest OPEN bin inside this section's current range.
    const openBins = await shelf.loadOpenBins();
    const blocking = openBins
      .filter(
        (b) =>
          b.shelf_code === section.shelf_code &&
          b.slot_index >= section.slot_from &&
          b.slot_index <= section.slot_to
      )
      .map((b) => b.slot_index - section.slot_from + 1) // position WITHIN the section
      .filter((pos) => pos > nextCount)
      .sort((a, b) => b - a)[0];
    if (blocking) {
      const code = shelf.slotCode(section.shelf_code, section.slot_from + blocking - 1);
      return res.status(409).json({
        error: `${code} مشغولة — فرّغها أولاً`,
        code: 'ERR_SLOT_OCCUPIED',
      });
    }
  }

  const nextMax =
    maxPerSlot === undefined
      ? section.max_per_slot
      : maxPerSlot === null || maxPerSlot === ''
        ? null
        : Number(maxPerSlot);
  if (nextMax != null && (!Number.isInteger(nextMax) || nextMax < 1)) {
    return res.status(400).json({ error: 'الحد الأقصى غير صالح', code: 'ERR_VALIDATION' });
  }

  const { query } = require('../lib/db');
  await query('UPDATE shelf_sections SET slot_count = $2, max_per_slot = $3 WHERE id = $1', [
    id,
    nextCount,
    nextMax,
  ]);
  res.json({ data: { id, slot_count: nextCount, max_per_slot: nextMax } });
}

module.exports = { getBoard, place, collect, closeSet, releasePlacement, patchSection };
