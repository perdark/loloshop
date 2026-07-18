const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..', 'uploads');

function makeStorage(subdir) {
  const dir = path.join(ROOT, subdir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = crypto.randomBytes(16).toString('hex') + ext;
      cb(null, name);
    },
  });
}

// SVG intentionally excluded — it can carry inline <script> (stored-XSS if ever
// rendered inline). Raster formats only for customer/logo uploads.
const IMAGE_TYPES = /^image\/(png|jpe?g|webp|heic|heif)$/i;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif']);

function imageFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (IMAGE_TYPES.test(file.mimetype) || IMAGE_EXT.has(ext)) {
    cb(null, true);
    return;
  }
  cb(new Error('نوع الملف غير مدعوم (PNG, JPG, WEBP)'));
}

const logoUpload = multer({
  storage: makeStorage('logos'),
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

const imageUpload = multer({
  storage: makeStorage('images'),
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

function publicUrl(req, subdir, filename) {
  // In dev, files live on THIS host's disk — using a prod PUBLIC_URL would hand
  // back a 404 link. Only trust PUBLIC_URL in production; otherwise echo the
  // request host (localhost:4000 in dev). `req` may be null when called from the
  // queue worker (no HTTP request) — fall back to PUBLIC_URL/localhost.
  const base =
    process.env.NODE_ENV === 'production' && process.env.PUBLIC_URL
      ? process.env.PUBLIC_URL
      : req
        ? `${req.protocol}://${req.get('host')}`
        : process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`;
  return `${base}/uploads/${subdir}/${filename}`;
}

// Save a raw Buffer (e.g. a generated PNG) under /uploads/<subdir>/ and return its public URL.
function saveBufferToUploads(req, subdir, buffer, ext = 'png') {
  const dir = path.join(ROOT, subdir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = crypto.randomBytes(16).toString('hex') + '.' + ext;
  const absPath = path.join(dir, filename);
  fs.writeFileSync(absPath, buffer);
  return { filename, url: publicUrl(req, subdir, filename), absPath };
}

// Resolve a /uploads/... public URL (or bare path) to an absolute disk path, or null.
function absFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/\/uploads\/(.+)$/);
  if (!m) return null;
  return path.join(ROOT, m[1]);
}

module.exports = { logoUpload, imageUpload, publicUrl, saveBufferToUploads, absFromUrl };
