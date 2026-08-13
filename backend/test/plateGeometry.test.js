// Tests for matchPlateGeometry — «does a rerolled plate still fit the slot the old one had».
//
// A batch plate is a band sliced out of a 10-name sheet: wide, short, letters small inside the
// strip. A reroll used to be a single name on its own canvas — nearly square, letters filling
// the frame — so the replacement arrived at a visibly different scale from the nine plates it
// was generated beside. These fixtures are that mismatch, drawn with sharp so the test needs
// no network and no model: a wide short reference, a big square replacement.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { matchPlateGeometry } = require('../lib/imageFx');

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

/** A white plate of `w`×`h` with one centred black block of `iw`×`ih` standing in for ink. */
async function plate(w, h, iw, ih) {
  const ink = await sharp({
    create: { width: iw, height: ih, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: WHITE } })
    .composite([{ input: ink, gravity: 'center' }])
    .png()
    .toBuffer();
}

/** Height of the ink after trimming the white margins — the thing that must match. */
async function inkHeight(buffer) {
  const { info } = await sharp(buffer)
    .trim({ background: '#ffffff', threshold: 10 })
    .toBuffer({ resolveWithObject: true });
  return info.height;
}

test('the rerolled plate takes the canvas size of the plate it replaces', async () => {
  const reference = await plate(800, 100, 400, 40);   // a real sheet band
  const regenerated = await plate(600, 600, 300, 300); // a single-name generation
  const out = await matchPlateGeometry(regenerated, reference);
  const meta = await sharp(out).metadata();
  assert.strictEqual(meta.width, 800);
  assert.strictEqual(meta.height, 100);
});

test('the rerolled plate takes the ink HEIGHT of the plate it replaces', async () => {
  const reference = await plate(800, 100, 400, 40);
  const regenerated = await plate(600, 600, 300, 300);
  const out = await matchPlateGeometry(regenerated, reference);
  // Anchoring on height (not width) is the point: embroidery scale is letter height.
  assert.ok(Math.abs((await inkHeight(out)) - 40) <= 2, 'ink height should land on the reference');
});

test('a name WIDER than the reference is fitted inside instead of overflowing', async () => {
  const reference = await plate(800, 100, 400, 40);
  // Ink 20× wider than tall — scaling it to 40px tall would need 1600px of width.
  const regenerated = await plate(2000, 200, 1800, 90);
  const out = await matchPlateGeometry(regenerated, reference);
  const meta = await sharp(out).metadata();
  assert.strictEqual(meta.width, 800);
  assert.strictEqual(meta.height, 100);
  // Width-constrained, so the ink ends SHORTER than the reference — never clipped.
  assert.ok((await inkHeight(out)) <= 40);
});

test('an unreadable reference returns the new plate untouched rather than throwing', async () => {
  const regenerated = await plate(600, 600, 300, 300);
  const out = await matchPlateGeometry(regenerated, Buffer.from('not an image'));
  assert.ok(out.equals(regenerated), 'a paid generation is never lost to framing cosmetics');
});

test('a blank reference (no ink to measure) returns the new plate untouched', async () => {
  const regenerated = await plate(600, 600, 300, 300);
  const blank = await sharp({ create: { width: 800, height: 100, channels: 3, background: WHITE } })
    .png().toBuffer();
  const out = await matchPlateGeometry(regenerated, blank);
  assert.ok(out.equals(regenerated));
});
