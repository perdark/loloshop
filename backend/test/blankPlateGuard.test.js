// The «white photo» guard.
//
// The design team downloaded plates that opened as blank white images. The cause was not the
// download: lib/sheetCrop.js accepted any slice whose BAND COUNT matched what the engine asked
// for, and a sheet the model drew FEWER names on still slices into exactly `expected` bands —
// the ones that land in the empty gaps trim down to pure white slivers. Count matched, so the
// engine saved them `status='done'` and auto-linked them onto the order line.
//
// These tests build sheets whose name count is known, so "8 names cropped into 10 bands" is
// reproducible without paying a generator. No database — sheetCrop and hasInk are pure
// functions of image bytes.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { cropSheet } = require('../lib/sheetCrop');
const { hasInk } = require('../lib/imageFx');

const W = 1024;
const H = 1024;

/** A white sheet carrying `n` evenly spaced black bars — one bar stands in for one name. */
async function sheetWith(n) {
  const bandH = 70;
  const slab = H / n;
  const bars = [];
  for (let i = 0; i < n; i++) {
    const top = Math.round(i * slab + (slab - bandH) / 2);
    bars.push(`<rect x="180" y="${top}" width="${W - 360}" height="${bandH}" fill="black"/>`);
  }
  return sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<rect width="${W}" height="${H}" fill="white"/>${bars.join('')}</svg>`
  )).png().toBuffer();
}

const blankPng = (w, h) => sharp({
  create: { width: w, height: h, channels: 3, background: '#ffffff' },
}).png().toBuffer();

// ---------------------------------------------------------------------------
// hasInk — the primitive every guard is built on
// ---------------------------------------------------------------------------
test('hasInk: a pure white rectangle carries no ink', async () => {
  assert.equal(await hasInk(await blankPng(1024, 9)), false);
  assert.equal(await hasInk(await blankPng(1024, 120)), false);
});

test('hasInk: a band with a name on it does', async () => {
  const { plates } = await cropSheet(await sheetWith(1), 1);
  assert.equal(await hasInk(plates[0]), true);
});

test('hasInk: undecodable bytes are not called blank — a decode quirk must never discard a paid plate', async () => {
  assert.equal(await hasInk(Buffer.from('not an image')), true);
});

// ---------------------------------------------------------------------------
// cropSheet — the count is not the whole test
// ---------------------------------------------------------------------------
test('a sheet with every name drawn crops to no blank bands', async () => {
  const res = await cropSheet(await sheetWith(10), 10);
  assert.equal(res.count, 10);
  assert.equal(res.blank, 0, 'a correct sheet must not be flagged — false positives cost a paid regeneration');
  assert.deepEqual(res.blankIndexes, []);
});

test('THE BUG: 8 names cropped into 10 bands still returns 10 — and now says 2 are empty', async () => {
  const res = await cropSheet(await sheetWith(8), 10);
  // The count check the engine used to rely on passes here. That is the whole point.
  assert.equal(res.count, 10);
  assert.equal(res.blank, 2);
  // Every reported index is genuinely blank, and every unreported one genuinely is not.
  for (let i = 0; i < res.plates.length; i++) {
    assert.equal(
      await hasInk(res.plates[i]), !res.blankIndexes.includes(i),
      `band ${i}: blankIndexes disagrees with the pixels`
    );
  }
});

test('the count of empty bands tracks how many names the model skipped', async () => {
  for (const [drawn, expected, blank] of [[9, 10, 1], [6, 10, 4], [5, 6, 1]]) {
    const res = await cropSheet(await sheetWith(drawn), expected);
    assert.equal(res.count, expected, `drawn=${drawn}: count`);
    assert.equal(res.blank, blank, `drawn=${drawn}: blank bands`);
  }
});

test('a single-name reroll image crops to one band with ink in it', async () => {
  const res = await cropSheet(await sheetWith(1), 1);
  assert.equal(res.count, 1);
  assert.equal(res.blank, 0);
});
