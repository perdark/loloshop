const router = require('express').Router();

// Curated free Arabic + English fonts (loaded via Google Fonts CSS or self-hosted in /public/fonts)
// Frontend uses these IDs to load via FontFace API into Fabric.js canvas.
const FONTS = [
  { id: 'amiri', name_ar: 'أميري', script: 'arabic', style: 'naskh', source: 'google' },
  { id: 'cairo', name_ar: 'القاهرة', script: 'arabic', style: 'modern', source: 'google' },
  { id: 'reem-kufi', name_ar: 'ريم كوفي', script: 'arabic', style: 'kufi', source: 'google' },
  { id: 'aref-ruqaa', name_ar: 'عارف الرقعة', script: 'arabic', style: 'ruqaa', source: 'google' },
  { id: 'lateef', name_ar: 'لطيف', script: 'arabic', style: 'naskh', source: 'google' },
  { id: 'scheherazade-new', name_ar: 'شهرزاد', script: 'arabic', style: 'naskh', source: 'google' },
  { id: 'noto-naskh-arabic', name_ar: 'نوتو نسخ', script: 'arabic', style: 'naskh', source: 'google' },
  { id: 'tajawal', name_ar: 'تجوال', script: 'arabic', style: 'modern', source: 'google' },
  { id: 'el-messiri', name_ar: 'المسيري', script: 'arabic', style: 'modern', source: 'google' },
  { id: 'mada', name_ar: 'مدى', script: 'arabic', style: 'modern', source: 'google' },
  { id: 'playfair-display', name_ar: 'Playfair', script: 'latin', style: 'serif', source: 'google' },
  { id: 'great-vibes', name_ar: 'Great Vibes', script: 'latin', style: 'script', source: 'google' },
];

router.get('/', (req, res) => {
  res.json({ data: FONTS });
});

module.exports = router;
