const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const sharp = require('sharp');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const ROOT = path.join(__dirname, '..', '..', 'uploads');

function makeStorage(subdir) {
  const dir = path.join(ROOT, subdir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      // Never preserve an attacker-controlled extension. Multer's MIME value is
      // also client supplied, but the strict MIME/extension pair in imageFilter
      // prevents obvious HTML/script uploads and this keeps the served suffix
      // aligned with the accepted media type.
      const ext = IMAGE_TYPES.get(String(file.mimetype).toLowerCase())?.[0] || '.bin';
      const name = crypto.randomBytes(16).toString('hex') + ext;
      cb(null, name);
    },
  });
}

// SVG intentionally excluded — it can carry inline <script> (stored-XSS if ever
// rendered inline). Raster formats only for customer/logo uploads.
const IMAGE_TYPES = new Map([
  ['image/png', ['.png']],
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['image/jpg', ['.jpg', '.jpeg']],
  ['image/webp', ['.webp']],
  ['image/heic', ['.heic']],
  ['image/heif', ['.heif']],
]);

function imageFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const allowedExtensions = IMAGE_TYPES.get(String(file.mimetype).toLowerCase());
  if (allowedExtensions?.includes(ext)) {
    cb(null, true);
    return;
  }
  cb(new Error('نوع الملف غير مدعوم (PNG, JPG, WEBP)'));
}

function uploadValidationError(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'ERR_INVALID_IMAGE';
  err.expose = true;
  return err;
}

// File extensions and multipart MIME values are caller-controlled. After Multer writes
// the bounded file, make libvips parse its real header and enforce the expected format and
// pixel count. Invalid files are removed before any controller can publish their URL.
async function validateUploadedImage(req, _res, next) {
  if (!req.file?.path) return next();
  try {
    const metadata = await sharp(req.file.path, { limitInputPixels: 40_000_000 }).metadata();
    const expected = {
      'image/png': 'png',
      'image/jpeg': 'jpeg',
      'image/jpg': 'jpeg',
      'image/webp': 'webp',
      'image/heic': 'heif',
      'image/heif': 'heif',
    }[String(req.file.mimetype).toLowerCase()];
    if (!expected || metadata.format !== expected || !metadata.width || !metadata.height) {
      throw uploadValidationError('ملف الصورة لا يطابق نوعه');
    }
    next();
  } catch (err) {
    try { await fs.promises.unlink(req.file.path); } catch { /* already gone */ }
    next(err?.expose ? err : uploadValidationError('ملف الصورة غير صالح'));
  }
}

// Bound authenticated storage abuse as well as individual file size. Account-based keys
// also stop simple IP rotation; the IP fallback only applies if a route is mis-ordered.
const imageUploadLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`,
});

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

// Resolve a /uploads/... public URL to an absolute disk path, or null.
function absFromUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(String(url), 'http://local.invalid');
    if (!parsed.pathname.startsWith('/uploads/')) return null;
    const relative = decodeURIComponent(parsed.pathname.slice('/uploads/'.length));
    if (!relative || relative.includes('\0')) return null;
    const resolved = path.resolve(ROOT, relative);
    // `path.join(ROOT, "../../backend/.env")` escapes ROOT. Resolve first and require
    // the result to remain below the upload directory before archive/read callers use it.
    if (!resolved.startsWith(`${path.resolve(ROOT)}${path.sep}`)) return null;
    return resolved;
  } catch {
    return null;
  }
}

module.exports = {
  logoUpload,
  imageUpload,
  imageUploadLimit,
  validateUploadedImage,
  publicUrl,
  saveBufferToUploads,
  absFromUrl,
};
