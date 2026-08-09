const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const {
  validateUploadedImage,
  validateUploadedArtwork,
} = require('../lib/upload');

// Guards the image-weight fix from 2026-08-01. Measured on prod that day: catalog photos
// were 4-6 MB PNGs (1856x2304) served raw to phones. These assert the shrink actually
// happens, that it never changes a format a downstream tool could fail to open, and that
// the artwork path stays byte-exact.

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'loloshop-upload-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

/** Build a PHOTO-like image, not a noise field.
 *
 *  This distinction is load-bearing. A first attempt used pure random pixels; that is
 *  incompressible, so the JPEG came out LARGER than the PNG and the "never grow the file"
 *  guard correctly declined to re-encode — the test failed while the code was right.
 *  Real photographs have spatial correlation, which is exactly what JPEG exploits, so the
 *  fixture is smooth gradients plus fine sensor-style grain. That reproduces the measured
 *  prod ratio closely (real photo 6.0 MB -> 184 KB; this fixture 10.5 MB -> 271 KB).
 *  Seeded, so any failure is reproducible. */
async function makePhoto(name, { width, height, alpha = false }) {
  const channels = alpha ? 4 : 3;
  const buf = Buffer.allocUnsafe(width * height * channels);
  let seed = 12345;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const wave = Math.sin(x / 140) * Math.cos(y / 190);
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const grain = (((seed >> 16) & 0xff) / 255) * 18 - 9;
      buf[i] = Math.max(0, Math.min(255, 128 + 90 * wave + x / 22 + grain));
      buf[i + 1] = Math.max(0, Math.min(255, 110 + 70 * Math.sin(y / 240) + grain));
      buf[i + 2] = Math.max(0, Math.min(255, 96 + 80 * Math.cos((x + y) / 300) + grain));
      if (alpha) buf[i + 3] = 128; // uniformly semi-transparent
    }
  }
  const file = path.join(TMP, name);
  await sharp(buf, { raw: { width, height, channels } })
    .png({ compressionLevel: 9 })
    .toFile(file);
  return file;
}

/** Drive the middleware the way Express does and hand back the mutated req.file. */
function run(middleware, file) {
  const stat = fs.statSync(file);
  const req = {
    file: {
      path: file,
      filename: path.basename(file),
      mimetype: 'image/png',
      size: stat.size,
    },
  };
  return new Promise((resolve, reject) => {
    middleware(req, {}, (err) => (err ? reject(err) : resolve(req.file)));
  });
}

test('a multi-megabyte opaque PNG is shrunk hard and becomes a JPEG', async () => {
  const src = await makePhoto('photo.png', { width: 1856, height: 2304 });
  const before = fs.statSync(src).size;
  assert.ok(before > 500 * 1024, `fixture must exceed the threshold, got ${before}`);

  const out = await run(validateUploadedImage, src);

  assert.strictEqual(out.mimetype, 'image/jpeg');
  assert.ok(out.filename.endsWith('.jpg'), `expected .jpg, got ${out.filename}`);
  assert.ok(out.size < before / 2, `expected <50% of ${before}, got ${out.size}`);
  // req.file.size must track the file actually on disk — controllers publish this.
  assert.strictEqual(out.size, fs.statSync(out.path).size);
  // The original extension must not be left behind as an orphan.
  assert.ok(!fs.existsSync(src), 'the source .png should have been removed');

  const meta = await sharp(out.path).metadata();
  assert.strictEqual(meta.format, 'jpeg');
  assert.ok(Math.max(meta.width, meta.height) <= 2000, `long edge ${meta.width}x${meta.height}`);
});

test('transparency is preserved — an alpha PNG stays a PNG', async () => {
  const src = await makePhoto('logo.png', { width: 2400, height: 1200, alpha: true });
  const out = await run(validateUploadedImage, src);

  assert.strictEqual(out.mimetype, 'image/png');
  assert.ok(out.filename.endsWith('.png'));
  const meta = await sharp(out.path).metadata();
  assert.strictEqual(meta.format, 'png');
  assert.strictEqual(meta.hasAlpha, true, 'alpha must survive — JPEG would blacken it');
  assert.ok(Math.max(meta.width, meta.height) <= 2000);
});

test('a small image is passed through byte-for-byte', async () => {
  const src = await makePhoto('small.png', { width: 120, height: 120 });
  const before = fs.readFileSync(src);
  assert.ok(before.length <= 500 * 1024);

  const out = await run(validateUploadedImage, src);

  assert.strictEqual(out.path, src);
  assert.strictEqual(out.mimetype, 'image/png');
  assert.deepStrictEqual(fs.readFileSync(out.path), before, 'must not be touched at all');
});

test('the artwork validator never re-encodes, even a huge file', async () => {
  const src = await makePhoto('artwork.png', { width: 1856, height: 2304 });
  const before = fs.readFileSync(src);

  const out = await run(validateUploadedArtwork, src);

  assert.strictEqual(out.path, src);
  assert.strictEqual(out.mimetype, 'image/png');
  assert.deepStrictEqual(fs.readFileSync(out.path), before, 'embroidery artwork must stay pixel-exact');
});

test('an image the re-encode cannot improve is left alone, not made worse', async () => {
  // Pure noise is incompressible, so JPEG comes out bigger than the source PNG. The
  // upload must keep the smaller original rather than "optimise" it into a larger file.
  // 1600px squared lands the PNG at ~618 KB (over the 500 KB threshold, so the re-encode
  // is genuinely attempted) while its JPEG blows up to ~1.6 MB — the exact case the guard
  // exists for.
  const width = 1600;
  const height = 1600;
  const buf = Buffer.allocUnsafe(width * height * 3);
  let seed = 999;
  for (let i = 0; i < buf.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    // High bits — this LCG's low bits are barely random and PNG compresses them away,
    // which would leave the fixture under the threshold and skip the path under test.
    buf[i] = (seed >> 16) & 0xff;
  }
  const src = path.join(TMP, 'noise.png');
  await sharp(buf, { raw: { width, height, channels: 3 } }).png().toFile(src);
  const before = fs.readFileSync(src);
  assert.ok(before.length > 500 * 1024, 'fixture must clear the threshold');

  const out = await run(validateUploadedImage, src);

  assert.strictEqual(out.path, src);
  assert.deepStrictEqual(fs.readFileSync(out.path), before);
  // A stray .tmp left behind would slowly fill the uploads volume.
  assert.deepStrictEqual(
    fs.readdirSync(TMP).filter((f) => f.endsWith('.tmp')),
    []
  );
});

test('a file whose bytes do not match its declared type is still rejected', async () => {
  const src = await makePhoto('liar.png', { width: 900, height: 900 });
  const stat = fs.statSync(src);
  const req = { file: { path: src, filename: 'liar.png', mimetype: 'image/jpeg', size: stat.size } };

  await assert.rejects(
    () => new Promise((res, rej) => validateUploadedImage(req, {}, (e) => (e ? rej(e) : res()))),
    /ملف الصورة لا يطابق نوعه/
  );
  assert.ok(!fs.existsSync(src), 'a rejected upload must be deleted');
});
