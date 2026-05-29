const router = require('express').Router();

// Curated free Arabic + English fonts (loaded via Google Fonts CSS or self-hosted in /public/fonts)
// Frontend uses these IDs to load via FontFace API into Fabric.js canvas.
// `weights`: weights that actually exist on Google Fonts — the loader requests only
//   these, and the editor disables Bold for fonts without a 700 (e.g. Great Vibes).
// Order = picker order: calligraphic/display first (name side), then naskh/body.
// `family`: the exact Google Fonts family name — used both by the FontFace loader
//   and to build a direct download URL so staff/print shops can grab the real
//   .ttf files (Google serves a zip of all weights at /download?family=...).
const FONTS = [
  { id: 'aref-ruqaa', name_ar: 'عارف الرقعة', family: 'Aref Ruqaa', script: 'arabic', style: 'ruqaa', source: 'google', weights: [400, 700] },
  { id: 'reem-kufi', name_ar: 'ريم كوفي', family: 'Reem Kufi', script: 'arabic', style: 'kufi', source: 'google', weights: [400, 700] },
  { id: 'el-messiri', name_ar: 'المسيري', family: 'El Messiri', script: 'arabic', style: 'modern', source: 'google', weights: [400, 700] },
  { id: 'amiri', name_ar: 'أميري', family: 'Amiri', script: 'arabic', style: 'naskh', source: 'google', weights: [400, 700] },
  { id: 'scheherazade-new', name_ar: 'شهرزاد', family: 'Scheherazade New', script: 'arabic', style: 'naskh', source: 'google', weights: [400, 700] },
  { id: 'noto-naskh-arabic', name_ar: 'نوتو نسخ', family: 'Noto Naskh Arabic', script: 'arabic', style: 'naskh', source: 'google', weights: [400, 700] },
  { id: 'lateef', name_ar: 'لطيف', family: 'Lateef', script: 'arabic', style: 'naskh', source: 'google', weights: [400, 700] },
  { id: 'cairo', name_ar: 'القاهرة', family: 'Cairo', script: 'arabic', style: 'modern', source: 'google', weights: [400, 700] },
  { id: 'tajawal', name_ar: 'تجوال', family: 'Tajawal', script: 'arabic', style: 'modern', source: 'google', weights: [400, 700] },
  { id: 'mada', name_ar: 'مدى', family: 'Mada', script: 'arabic', style: 'modern', source: 'google', weights: [400, 700] },
  { id: 'playfair-display', name_ar: 'Playfair', family: 'Playfair Display', script: 'latin', style: 'serif', source: 'google', weights: [400, 700] },
  { id: 'great-vibes', name_ar: 'Great Vibes', family: 'Great Vibes', script: 'latin', style: 'script', source: 'google', weights: [400] },
];

// Direct download of the real font files. For google-source fonts this is the
// Google Fonts zip (all weights). Self-hosted fonts (source !== 'google') would
// carry their own file_url; none exist yet.
function fileUrlFor(f) {
  if (f.source === 'google') {
    return `https://fonts.google.com/download?family=${encodeURIComponent(f.family)}`;
  }
  return f.file_url || null;
}

router.get('/', (req, res) => {
  res.json({ data: FONTS.map((f) => ({ ...f, file_url: fileUrlFor(f) })) });
});

module.exports = router;
