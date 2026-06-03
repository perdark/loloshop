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
  // request host (localhost:4000 in dev).
  const base =
    process.env.NODE_ENV === 'production' && process.env.PUBLIC_URL
      ? process.env.PUBLIC_URL
      : `${req.protocol}://${req.get('host')}`;
  return `${base}/uploads/${subdir}/${filename}`;
}

module.exports = { logoUpload, imageUpload, publicUrl };
