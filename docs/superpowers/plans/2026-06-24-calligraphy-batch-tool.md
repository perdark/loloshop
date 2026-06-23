# Calligraphy Batch Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin-only tool that turns a list of student names into Arabic-calligraphy name-plate PNGs via OpenRouter (10 names per generated sheet → cropped into 10 individual plates), with a proof grid, single-name re-roll, ZIP download, and an admin-triggered "link to order" that writes the plate onto the sash order's «تطريز الوشاح من الأمام» line.

**Architecture:** New Express router/controller (`/api/calligraphy/*`, all `requireRole('admin')`) backed by a new `calligraphy_plates` table grouped by a server-generated `job_id`. Image generation goes through a new `lib/openrouter.js` (`POST /api/v1/images`, base64 PNG out). A new `lib/sheetCrop.js` (using `sharp`) slices each 10-up sheet into individual plates by horizontal ink-density valleys. Long jobs are processed one 10-name batch per request (`POST /jobs/:id/process`) so the client shows progress and re-runs resume safely. The frontend is a single admin page with three input modes (type/paste, grab-by-wholesaler, .txt upload), progress, proof grid, and download.

**Tech Stack:** Backend Express 5 + `pg` (Neon) + global `fetch` + `sharp` (crop) + `archiver` (ZIP). Frontend Next 16 App Router + React 19 + Tailwind v4, RTL Arabic, axios via `@/lib/api`.

## Global Constraints

- **Admin-only:** every `/api/calligraphy/*` endpoint is gated by `authRequired, requireRole('admin')` (mounted router-level, like `routes/admin.js`). Non-admin → 403 `{ error:'ممنوع', code:'ERR_FORBIDDEN' }`.
- **Error shape:** all errors `{ error: <Arabic msg>, code: 'ERR_*' }`. Throwable errors set `err.status` + `err.expose=true` + `err.code` so `server.js`'s handler surfaces them; validation errors return inline `res.status(4xx).json({error,code})`.
- **Key is server-side only:** `OPENROUTER_API_KEY` lives in `backend/.env`, read only in `lib/openrouter.js`. Never sent to the client, never logged.
- **Models:** default (standard) = `google/gemini-3.1-flash-image` @ `resolution:"2K"`, `aspect_ratio:"9:16"`; premium = `google/gemini-3-pro-image` @ `"4K"`. Defined once in `lib/openrouter.js` `MODELS`. If a slug 404s at the live checkpoint, fix it there only.
- **Render text = exactly as given/stored**, no auto-honorific (user decision).
- **Grab-by-wholesaler source = the sash order's `order_items.customer_text` where `label_snapshot = 'تطريز الوشاح من الأمام'`** (the "as embroidered" name). The SAME `order_item` is the link target.
- **Attach is admin-choice, never automatic, never changes order status.** "Link" only sets `order_items.customer_image_url`. (Respects the project's state-machine-single-source rule.)
- **Files:** sheets → `/uploads/calligraphy/sheets/`, plates → `/uploads/calligraphy/plates/`. Public URL via the existing `publicUrl()` convention in `lib/upload.js`.
- **Migration:** `db/migrations/043_calligraphy_plates.sql`, mirrored idempotently into `db/schema.sql`. Apply with `npm run migrate:file db/migrations/043_calligraphy_plates.sql` (run from `backend/`).
- **Verification norm (no test framework exists):** each backend task ends with `node --check <file>` + a throwaway e2e node script run against the dev server / live Neon DB (project norm). Frontend: `npx tsc --noEmit` (0 errors) + `npx eslint` (0 errors). End-to-end: live browser via `showme`.
- RTL Arabic-first admin UI (`dir="rtl"`), Tailwind v4 logical props (`ms-`/`ps-`/`start-`), warm brand tokens; admin is laptop-primary but must not h-scroll on phone.

---

## File Structure

**Backend**
- `db/migrations/043_calligraphy_plates.sql` — NEW: enums + `calligraphy_plates` table + indexes.
- `db/schema.sql` — MODIFY: mirror the enums + table (idempotent) for fresh installs.
- `backend/lib/openrouter.js` — NEW: `generateImage()` + `MODELS`. Sole reader of `OPENROUTER_API_KEY`.
- `backend/lib/sheetCrop.js` — NEW: `cropSheet(buffer, expected)` → `{ plates: Buffer[], count, expected }`.
- `backend/lib/calligraphyPrompt.js` — NEW: `buildSheetPrompt(names[])` + `buildSinglePrompt(name)`.
- `backend/lib/upload.js` — MODIFY: add `saveBufferToUploads(subdir, buffer, ext)` + `calligraphyDir` bootstrap (reuses `ROOT`/`publicUrl`).
- `backend/controllers/calligraphyController.js` — NEW: all endpoint handlers.
- `backend/routes/calligraphy.js` — NEW: admin-gated router + rate limit.
- `backend/server.js` — MODIFY: mount `/api/calligraphy`; ensure `/uploads/calligraphy/{sheets,plates}` dirs exist at boot.
- `backend/package.json` — MODIFY: add `sharp`, `archiver`.

**Frontend**
- `frontend/lib/calligraphy.ts` — NEW: typed API wrappers + types.
- `frontend/app/admin/calligraphy/page.tsx` — NEW: the admin UI.
- `frontend/components/AdminSidebar.tsx` — MODIFY: add nav link `{ href:"/admin/calligraphy", label:"الخط العربي", exact:false }`.

---

## Task 1: Migration + schema — `calligraphy_plates`

**Files:**
- Create: `db/migrations/043_calligraphy_plates.sql`
- Modify: `db/schema.sql` (append mirrored block near other CREATE TABLE statements)

**Interfaces:**
- Produces table `calligraphy_plates(id, job_id, wholesaler_id, student_id, order_item_id, source, render_text, status, model, cost_usd, sheet_path, plate_path, error, linked_at, created_by, created_at)`.
- Enums: `calligraphy_source('typed','wholesaler','txt')`, `calligraphy_status('pending','done','failed')`.

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/043_calligraphy_plates.sql
-- Admin calligraphy batch tool: one row per name-plate, grouped by job_id.
DO $$ BEGIN
  CREATE TYPE calligraphy_source AS ENUM ('typed','wholesaler','txt');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE calligraphy_status AS ENUM ('pending','done','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS calligraphy_plates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL,
  wholesaler_id UUID REFERENCES wholesalers(id) ON DELETE SET NULL,
  student_id    UUID REFERENCES students(id)    ON DELETE SET NULL,
  order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
  source        calligraphy_source NOT NULL,
  render_text   TEXT NOT NULL,
  status        calligraphy_status NOT NULL DEFAULT 'pending',
  model         TEXT,
  cost_usd      NUMERIC(10,5) NOT NULL DEFAULT 0,
  sheet_path    TEXT,
  plate_path    TEXT,
  error         TEXT,
  linked_at     TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calligraphy_job     ON calligraphy_plates(job_id);
CREATE INDEX IF NOT EXISTS idx_calligraphy_student ON calligraphy_plates(student_id);
CREATE INDEX IF NOT EXISTS idx_calligraphy_status  ON calligraphy_plates(status);
CREATE INDEX IF NOT EXISTS idx_calligraphy_orderitem ON calligraphy_plates(order_item_id);
```

- [ ] **Step 2: Mirror into `db/schema.sql`** — paste the exact same `DO $$…$$` enum guards + `CREATE TABLE IF NOT EXISTS calligraphy_plates …` + `CREATE INDEX IF NOT EXISTS …` block (idempotent). Place after the `order_items` table definition so the FK targets already exist.

- [ ] **Step 3: Apply to Neon**

Run (from `backend/`): `npm run migrate:file db/migrations/043_calligraphy_plates.sql`
Expected: `Done ✓` with no error.

- [ ] **Step 4: Verify the table exists** with the right columns

Run (from `backend/`):
```bash
node -e "require('dotenv').config(); const {query}=require('./lib/db'); query(\"select column_name,data_type from information_schema.columns where table_name='calligraphy_plates' order by ordinal_position\").then(r=>{console.table(r.rows);process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"
```
Expected: 15 columns listed incl. `job_id`, `order_item_id`, `render_text`, `status`, `cost_usd`, `plate_path`.

- [ ] **Step 5: Commit** — `git add db/migrations/043_calligraphy_plates.sql db/schema.sql && git commit -m "feat(calligraphy): 043 calligraphy_plates table"`

---

## Task 2: `lib/openrouter.js` + LIVE generation checkpoint

**Files:**
- Create: `backend/lib/openrouter.js`
- Modify: `backend/package.json` (no code dep here, but ensure `OPENROUTER_API_KEY` documented; add nothing if fetch is global)

**Interfaces:**
- Produces: `generateImage({ model, prompt, resolution?='2K', aspectRatio?='9:16' }) → Promise<{ buffer: Buffer, cost: number }>` (throws tagged errors on missing key / network / non-200 / bad shape).
- Produces: `MODELS = { standard:'google/gemini-3.1-flash-image', premium:'google/gemini-3-pro-image' }`.

- [ ] **Step 1: Write `lib/openrouter.js`**

```js
// backend/lib/openrouter.js — sole reader of OPENROUTER_API_KEY.
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/images';

const MODELS = {
  standard: 'google/gemini-3.1-flash-image', // Nano Banana 2 @ 2K — production default
  premium:  'google/gemini-3-pro-image',     // 4K — optional premium
};

function tagged(message, status, code) {
  const e = new Error(message); e.status = status; e.expose = true; e.code = code; return e;
}

async function generateImage({ model, prompt, resolution = '2K', aspectRatio = '9:16' }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw tagged('مفتاح OpenRouter غير مهيأ', 500, 'ERR_OPENROUTER_KEY');

  let resp;
  try {
    resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.PUBLIC_URL || 'https://lolo-shop96.com',
        'X-Title': 'LoloShop Calligraphy',
      },
      body: JSON.stringify({ model, prompt, resolution, aspect_ratio: aspectRatio, n: 1, output_format: 'png' }),
    });
  } catch (err) {
    console.error('OpenRouter network error:', err.message);
    throw tagged('تعذّر الاتصال بخدمة توليد الصور', 502, 'ERR_OPENROUTER_NET');
  }

  if (!resp.ok) {
    let detail = '';
    try { detail = JSON.stringify(await resp.json()); } catch { /* ignore */ }
    console.error('OpenRouter non-200:', resp.status, detail.slice(0, 500));
    throw tagged('فشل توليد صورة الخط', 502, 'ERR_OPENROUTER');
  }

  const data = await resp.json();
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) {
    console.error('OpenRouter unexpected shape:', JSON.stringify(data).slice(0, 500));
    throw tagged('استجابة غير صالحة من مولّد الصور', 502, 'ERR_OPENROUTER_SHAPE');
  }
  const cost = Number((data.usage && data.usage.cost) || 0);
  return { buffer: Buffer.from(b64, 'base64'), cost };
}

module.exports = { generateImage, MODELS, OPENROUTER_URL };
```

- [ ] **Step 2: `node --check`** — Run: `node --check backend/lib/openrouter.js` → Expected: no output (valid).

- [ ] **Step 3: 🔴 LIVE CHECKPOINT (needs `OPENROUTER_API_KEY` in `backend/.env`)** — real 1-name call

Run (from `backend/`):
```bash
node -e "require('dotenv').config(); const {generateImage,MODELS}=require('./lib/openrouter'); const fs=require('fs'); generateImage({model:MODELS.standard, prompt:'A single line of elegant black Arabic Thuluth calligraphy on white, broad-nib contrast, centered, no frame: محمد علي'}).then(r=>{fs.writeFileSync('/tmp/cal_test.png', r.buffer); console.log('OK bytes=',r.buffer.length,'cost=',r.cost)}).catch(e=>{console.error('FAIL',e.code,e.message);process.exit(1)})"
```
Expected: `OK bytes=<n> cost=<usd>` and `/tmp/cal_test.png` opens as a readable Arabic-calligraphy image. **If the model slug 404s** (`ERR_OPENROUTER` with a model-not-found detail in the log), correct the `MODELS.standard` slug here and re-run. **STOP and report this checkpoint to the user** (it spends real money + confirms the contract before the rest is built).

- [ ] **Step 4: Commit** — `git add backend/lib/openrouter.js && git commit -m "feat(calligraphy): openrouter image client + live-verified contract"`

---

## Task 3: `lib/sheetCrop.js` (sharp) + tune against a real sheet

**Files:**
- Create: `backend/lib/sheetCrop.js`
- Modify: `backend/package.json` (`npm install sharp`)

**Interfaces:**
- Produces: `cropSheet(buffer, expected) → Promise<{ plates: Buffer[], count: number, expected: number }>`. `plates` = PNG buffers top→bottom. When `count !== expected`, caller flags for manual review (spec §11) — `cropSheet` still returns what it found.

- [ ] **Step 1: Install sharp** — Run (from `backend/`): `npm install sharp` → Expected: added to dependencies.

- [ ] **Step 2: Write `lib/sheetCrop.js`**

```js
// backend/lib/sheetCrop.js — slice a vertical N-up calligraphy sheet into N plates
// by horizontal ink-density valleys. Pure function of the image bytes.
const sharp = require('sharp');

async function cropSheet(buffer, expected) {
  const { data, info } = await sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info; // 1 channel (greyscale)

  // Per-row average darkness (0..255); ink is dark on white.
  const rowDark = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let sum = 0; const base = y * width;
    for (let x = 0; x < width; x++) sum += 255 - data[base + x];
    rowDark[y] = sum / width;
  }
  const maxD = rowDark.reduce((m, v) => (v > m ? v : m), 0) || 1;
  const thr = maxD * 0.06; // ink-row threshold (tuned at live checkpoint)

  // Contiguous ink bands.
  let bands = [];
  let start = -1;
  for (let y = 0; y < height; y++) {
    const ink = rowDark[y] > thr;
    if (ink && start < 0) start = y;
    else if (!ink && start >= 0) { bands.push([start, y - 1]); start = -1; }
  }
  if (start >= 0) bands.push([start, height - 1]);

  // Drop noise bands shorter than 1.5% of height.
  const minH = Math.max(2, Math.round(height * 0.015));
  bands = bands.filter(([a, b]) => b - a + 1 >= minH);

  // If more bands than expected, merge the pairs separated by the smallest gaps
  // (handles floated ornaments / diacritics that split a line).
  while (expected > 0 && bands.length > expected) {
    let gi = -1, gmin = Infinity;
    for (let i = 0; i < bands.length - 1; i++) {
      const gap = bands[i + 1][0] - bands[i][1];
      if (gap < gmin) { gmin = gap; gi = i; }
    }
    if (gi < 0) break;
    bands[gi] = [bands[gi][0], bands[gi + 1][1]];
    bands.splice(gi + 1, 1);
  }

  // Extract each band with small vertical padding.
  const pad = Math.round(height * 0.012);
  const plates = [];
  for (const [a, b] of bands) {
    const top = Math.max(0, a - pad);
    const bot = Math.min(height, b + 1 + pad);
    const h = bot - top;
    if (h <= 0) continue;
    const out = await sharp(buffer).extract({ left: 0, top, width, height: h })
      .png().toBuffer();
    plates.push(out);
  }
  return { plates, count: plates.length, expected };
}

module.exports = { cropSheet };
```

- [ ] **Step 3: `node --check`** — Run: `node --check backend/lib/sheetCrop.js` → Expected: no output.

- [ ] **Step 4: 🔴 TUNE CHECKPOINT — crop a real multi-name sheet**

Generate a real 10-name sheet (reuses Task 2 + Task 4's prompt) and crop it:
```bash
node -e "require('dotenv').config(); const {generateImage,MODELS}=require('./lib/openrouter'); const {buildSheetPrompt}=require('./lib/calligraphyPrompt'); const {cropSheet}=require('./lib/sheetCrop'); const fs=require('fs'); const names=['محمد علي','فاطمة حسن','أحمد كريم','زينب صالح','يوسف خالد','مريم عادل','عمر فاروق','سارة وليد','حسين جابر','نور الهدى']; (async()=>{const {buffer}=await generateImage({model:MODELS.standard,prompt:buildSheetPrompt(names)}); fs.writeFileSync('/tmp/sheet.png',buffer); const {plates,count}=await cropSheet(buffer,10); console.log('expected 10 got',count); plates.forEach((p,i)=>fs.writeFileSync('/tmp/plate_'+i+'.png',p));})().catch(e=>{console.error(e);process.exit(1)})"
```
Expected: `expected 10 got 10`, and `/tmp/plate_0..9.png` each contain exactly one name top→bottom matching input order. **If count ≠ 10:** adjust `thr` (0.04–0.10) and the merge/noise thresholds, re-run until 10/10 on a couple of sheets. Report the result. (This is the spec's highest-risk step.)

- [ ] **Step 5: Commit** — `git add backend/lib/sheetCrop.js backend/package.json backend/package-lock.json && git commit -m "feat(calligraphy): sheet→plates ink-projection crop (tuned)"`

---

## Task 4: `lib/calligraphyPrompt.js`

**Files:**
- Create: `backend/lib/calligraphyPrompt.js`

**Interfaces:**
- Produces: `buildSheetPrompt(names: string[]) → string`, `buildSinglePrompt(name: string) → string`.

- [ ] **Step 1: Write `lib/calligraphyPrompt.js`** (the spec §7 "decorated vertical-list Thuluth" prompt)

```js
// backend/lib/calligraphyPrompt.js — the tested calligraphy prompt builders.
const STYLE = [
  'Elegant Arabic Thuluth calligraphy, pure black ink on a clean solid white background.',
  'Broad-nib pen with strong thick/thin contrast, masterful diacritics, balanced spacing.',
  'Small floated decorative ornaments around the words. No underlines, no quotation marks,',
  'no frames, no borders, no boxes, no numbering, no Latin text, no watermark.',
].join(' ');

function buildSheetPrompt(names) {
  const list = names.map((n) => `- ${n}`).join('\n');
  return [
    STYLE,
    `Write each of the following ${names.length} Arabic names as its own separate centered line,`,
    'stacked vertically top to bottom, evenly spaced with clear blank gaps between lines so each',
    'name can be cropped out individually. Spell each name EXACTLY as written, do not add or remove',
    'any letters or words:',
    list,
  ].join('\n');
}

function buildSinglePrompt(name) {
  return [
    STYLE,
    'Write the following single Arabic name as one centered line. Spell it EXACTLY as written,',
    `do not add or remove any letters or words: ${name}`,
  ].join('\n');
}

module.exports = { buildSheetPrompt, buildSinglePrompt };
```

- [ ] **Step 2: `node --check`** — Run: `node --check backend/lib/calligraphyPrompt.js` → Expected: no output. (Already exercised live in Task 3 Step 4.)

- [ ] **Step 3: Commit** — `git add backend/lib/calligraphyPrompt.js && git commit -m "feat(calligraphy): prompt builders"`

---

## Task 5: `lib/upload.js` — buffer save helper + dir bootstrap

**Files:**
- Modify: `backend/lib/upload.js` (add helper + export); `backend/server.js` (ensure dirs at boot — done in Task 6)

**Interfaces:**
- Produces: `saveBufferToUploads(req, subdir, buffer, ext) → { filename, url, absPath }` where `subdir` e.g. `'calligraphy/sheets'`, `ext` e.g. `'png'`. Reuses the existing `ROOT` + `publicUrl` + `crypto` filename pattern.

- [ ] **Step 1: Read `backend/lib/upload.js`** to match its `ROOT`, `crypto`, `publicUrl` exactly (they exist per recon).

- [ ] **Step 2: Add the helper** (place near `publicUrl`, reuse the same `path`/`fs`/`crypto` already required at the top)

```js
// Save a raw Buffer (e.g. a generated PNG) under /uploads/<subdir>/ and return its public URL.
function saveBufferToUploads(req, subdir, buffer, ext = 'png') {
  const dir = path.join(ROOT, subdir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = crypto.randomBytes(16).toString('hex') + '.' + ext;
  const absPath = path.join(dir, filename);
  fs.writeFileSync(absPath, buffer);
  return { filename, url: publicUrl(req, subdir, filename), absPath };
}
```

- [ ] **Step 3: Export it** — add `saveBufferToUploads` to `module.exports` alongside the existing exports.

- [ ] **Step 4: `node --check`** — Run: `node --check backend/lib/upload.js` → Expected: no output.

- [ ] **Step 5: Commit** — `git add backend/lib/upload.js && git commit -m "feat(calligraphy): saveBufferToUploads helper"`

---

## Task 6: Controller + routes + server mount (the API)

**Files:**
- Create: `backend/controllers/calligraphyController.js`
- Create: `backend/routes/calligraphy.js`
- Modify: `backend/server.js` (mount router; mkdir `/uploads/calligraphy/{sheets,plates}` at boot)
- Modify: `backend/package.json` (`npm install archiver`)

**Interfaces (HTTP, all admin-gated):**
- `GET  /api/calligraphy/wholesalers` → `{ data:[{ id, name, student_count }] }`
- `GET  /api/calligraphy/wholesalers/:id/names` → `{ data:[{ student_id, student_name, order_item_id, render_text, plate_id|null, plate_status|null, plate_path|null, linked: bool }] }`
- `POST /api/calligraphy/jobs` body `{ source, model?, wholesaler_id?, items:[{render_text, student_id?, order_item_id?}] }` → `{ data:{ job_id, total, plates:[plate] } }` (creates pending rows; dedups; NO generation yet)
- `POST /api/calligraphy/jobs/:jobId/process` → processes next ≤10 pending → `{ data:{ processed, done, failed, remaining, total, job_cost, plates:[updated batch] } }`
- `GET  /api/calligraphy/jobs/:jobId` → `{ data:{ job_id, total, done, failed, pending, job_cost, plates:[plate] } }`
- `POST /api/calligraphy/plates/:id/reroll` → `{ data: plate }` (single 1-name call; new plate_path; cost added)
- `POST /api/calligraphy/plates/:id/link` → `{ data:{ ok:true, order_item_id, url } }` (sets `order_items.customer_image_url`; sets `linked_at`; 400 if no `order_item_id`)
- `GET  /api/calligraphy/jobs/:jobId/download?sheets=0|1` → streams `application/zip`

`plate` shape returned to FE: `{ id, render_text, status, plate_path, sheet_path, student_id, order_item_id, linked, cost_usd, error }`.

- [ ] **Step 1: Install archiver** — Run (from `backend/`): `npm install archiver` → Expected: added.

- [ ] **Step 2: Write `controllers/calligraphyController.js`**

```js
// backend/controllers/calligraphyController.js
const crypto = require('crypto');
const archiver = require('archiver');
const { query } = require('../lib/db');
const { generateImage, MODELS } = require('../lib/openrouter');
const { cropSheet } = require('../lib/sheetCrop');
const { buildSheetPrompt, buildSinglePrompt } = require('../lib/calligraphyPrompt');
const { saveBufferToUploads } = require('../lib/upload');

const FRONT_LABEL = 'تطريز الوشاح من الأمام';
const BATCH = 10;

function bad(res, msg, code = 'ERR_VALIDATION', status = 400) {
  return res.status(status).json({ error: msg, code });
}
function pickModel(model) {
  return model === 'premium' ? MODELS.premium : MODELS.standard;
}
function toPlate(r) {
  return {
    id: r.id, render_text: r.render_text, status: r.status,
    plate_path: r.plate_path, sheet_path: r.sheet_path,
    student_id: r.student_id, order_item_id: r.order_item_id,
    linked: !!r.linked_at, cost_usd: Number(r.cost_usd || 0), error: r.error,
  };
}

// GET /wholesalers — pickers
async function listWholesalers(req, res) {
  const { rows } = await query(
    `SELECT w.id, u.name, COUNT(s.id)::int AS student_count
       FROM wholesalers w JOIN users u ON u.id = w.user_id
       LEFT JOIN students s ON s.wholesaler_id = w.id
      GROUP BY w.id, u.name ORDER BY u.name`);
  res.json({ data: rows });
}

// GET /wholesalers/:id/names — grab list from the sash front-embroidery line
async function wholesalerNames(req, res) {
  const { id } = req.params;
  const { rows } = await query(
    `SELECT s.id AS student_id, u.name AS student_name,
            oi.id AS order_item_id, oi.customer_text AS render_text,
            cp.id AS plate_id, cp.status AS plate_status, cp.plate_path, cp.linked_at
       FROM students s
       JOIN users u   ON u.id = s.user_id
       JOIN orders o  ON o.student_id = s.id AND o.status::text <> 'cancelled'
       JOIN products p ON p.id = o.product_id AND p.type = 'sash'
       JOIN order_items oi ON oi.order_id = o.id AND oi.label_snapshot = $2
       LEFT JOIN LATERAL (
            SELECT id, status, plate_path, linked_at FROM calligraphy_plates c
             WHERE c.order_item_id = oi.id ORDER BY created_at DESC LIMIT 1
       ) cp ON TRUE
      WHERE s.wholesaler_id = $1 AND COALESCE(oi.customer_text,'') <> ''
      ORDER BY u.name`, [id, FRONT_LABEL]);
  res.json({ data: rows.map((r) => ({
    student_id: r.student_id, student_name: r.student_name,
    order_item_id: r.order_item_id, render_text: r.render_text,
    plate_id: r.plate_id, plate_status: r.plate_status,
    plate_path: r.plate_path, linked: !!r.linked_at,
  })) });
}

// POST /jobs — create pending rows (dedup), no generation yet
async function createJob(req, res) {
  const { source, wholesaler_id = null, model = 'standard' } = req.body || {};
  let items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
  if (!['typed', 'wholesaler', 'txt'].includes(source)) return bad(res, 'مصدر غير صالح');
  items = items
    .map((it) => ({
      render_text: String((it && it.render_text) || '').trim(),
      student_id: (it && it.student_id) || null,
      order_item_id: (it && it.order_item_id) || null,
    }))
    .filter((it) => it.render_text);
  if (!items.length) return bad(res, 'لا توجد أسماء صالحة');
  if (items.length > 1000) return bad(res, 'الحد الأقصى 1000 اسم لكل مهمة');

  // Dedup: wholesaler → by order_item_id; typed/txt → by exact render_text.
  const seen = new Set();
  items = items.filter((it) => {
    const key = source === 'wholesaler' ? (it.order_item_id || it.render_text) : it.render_text;
    if (seen.has(key)) return false; seen.add(key); return true;
  });

  const jobId = crypto.randomUUID();
  const out = [];
  for (const it of items) {
    const { rows } = await query(
      `INSERT INTO calligraphy_plates (job_id, wholesaler_id, student_id, order_item_id, source, render_text, status, model, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8) RETURNING *`,
      [jobId, wholesaler_id, it.student_id, it.order_item_id, source, it.render_text, pickModel(model), req.user.id]);
    out.push(toPlate(rows[0]));
  }
  res.status(201).json({ data: { job_id: jobId, total: out.length, plates: out } });
}

async function jobCost(jobId) {
  const { rows } = await query(`SELECT COALESCE(SUM(cost_usd),0) AS c FROM calligraphy_plates WHERE job_id=$1`, [jobId]);
  return Number(rows[0].c || 0);
}
async function jobCounts(jobId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int total,
            COUNT(*) FILTER (WHERE status='done')::int done,
            COUNT(*) FILTER (WHERE status='failed')::int failed,
            COUNT(*) FILTER (WHERE status='pending')::int pending
       FROM calligraphy_plates WHERE job_id=$1`, [jobId]);
  return rows[0];
}

// POST /jobs/:jobId/process — next batch of <=10 pending
async function processNext(req, res) {
  const { jobId } = req.params;
  const { rows: batch } = await query(
    `SELECT * FROM calligraphy_plates WHERE job_id=$1 AND status='pending' ORDER BY created_at LIMIT $2`,
    [jobId, BATCH]);
  if (!batch.length) {
    const c = await jobCounts(jobId);
    return res.json({ data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId), plates: [] } });
  }
  const model = batch[0].model || MODELS.standard;
  const names = batch.map((b) => b.render_text);

  let gen;
  try {
    gen = await generateImage({ model, prompt: buildSheetPrompt(names) });
  } catch (err) {
    // mark this batch failed (no charge persisted), surface error
    await query(`UPDATE calligraphy_plates SET status='failed', error=$2 WHERE id = ANY($1)`,
      [batch.map((b) => b.id), err.code || 'ERR_OPENROUTER']);
    const c = await jobCounts(jobId);
    return res.status(err.status || 502).json({ error: err.message || 'فشل التوليد', code: err.code || 'ERR_OPENROUTER',
      data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId), plates: [] } });
  }

  const sheet = saveBufferToUploads(req, 'calligraphy/sheets', gen.buffer, 'png');
  const perCost = batch.length ? gen.cost / batch.length : 0;

  let plates;
  try {
    const cropped = await cropSheet(gen.buffer, batch.length);
    plates = cropped.plates;
    if (cropped.count !== batch.length) {
      // spec §11: don't mis-slice — flag whole batch for manual review, keep the sheet
      await query(
        `UPDATE calligraphy_plates SET status='failed', model=$2, cost_usd=$3, sheet_path=$4,
                error=$5 WHERE id = ANY($1)`,
        [batch.map((b) => b.id), model, perCost, sheet.url,
         `crop mismatch: expected ${batch.length}, got ${cropped.count}`]);
      const c = await jobCounts(jobId);
      return res.json({ data: { processed: 0, ...c, remaining: c.pending, job_cost: await jobCost(jobId),
        review: true, plates: [] } });
    }
  } catch (err) {
    console.error('crop failed:', err.message);
    await query(`UPDATE calligraphy_plates SET status='failed', sheet_path=$2, error='crop error' WHERE id = ANY($1)`,
      [batch.map((b) => b.id), sheet.url]);
    return res.status(500).json({ error: 'فشل تقطيع الورقة', code: 'ERR_CROP' });
  }

  const updated = [];
  for (let i = 0; i < batch.length; i++) {
    const plate = saveBufferToUploads(req, 'calligraphy/plates', plates[i], 'png');
    const { rows } = await query(
      `UPDATE calligraphy_plates SET status='done', model=$2, cost_usd=$3, sheet_path=$4, plate_path=$5, error=NULL
        WHERE id=$1 RETURNING *`,
      [batch[i].id, model, perCost, sheet.url, plate.url]);
    updated.push(toPlate(rows[0]));
  }
  const c = await jobCounts(jobId);
  res.json({ data: { processed: updated.length, ...c, remaining: c.pending, job_cost: await jobCost(jobId), plates: updated } });
}

// GET /jobs/:jobId
async function getJob(req, res) {
  const { jobId } = req.params;
  const { rows } = await query(`SELECT * FROM calligraphy_plates WHERE job_id=$1 ORDER BY created_at`, [jobId]);
  if (!rows.length) return bad(res, 'المهمة غير موجودة', 'ERR_NOT_FOUND', 404);
  const c = await jobCounts(jobId);
  res.json({ data: { job_id: jobId, ...c, job_cost: await jobCost(jobId), plates: rows.map(toPlate) } });
}

// POST /plates/:id/reroll
async function reroll(req, res) {
  const { id } = req.params;
  const { rows: pr } = await query(`SELECT * FROM calligraphy_plates WHERE id=$1`, [id]);
  if (!pr.length) return bad(res, 'الصورة غير موجودة', 'ERR_NOT_FOUND', 404);
  const p = pr[0];
  const model = p.model || MODELS.standard;
  let gen;
  try { gen = await generateImage({ model, prompt: buildSinglePrompt(p.render_text) }); }
  catch (err) { return res.status(err.status || 502).json({ error: err.message, code: err.code || 'ERR_OPENROUTER' }); }
  // single-name image: trim to one band (expected 1); fall back to full image
  let plateBuf = gen.buffer;
  try { const { plates } = await cropSheet(gen.buffer, 1); if (plates[0]) plateBuf = plates[0]; } catch { /* keep full */ }
  const plate = saveBufferToUploads(req, 'calligraphy/plates', plateBuf, 'png');
  const { rows } = await query(
    `UPDATE calligraphy_plates SET status='done', plate_path=$2, cost_usd = cost_usd + $3, error=NULL,
            linked_at = NULL WHERE id=$1 RETURNING *`,
    [id, plate.url, Number(gen.cost || 0)]);
  res.json({ data: toPlate(rows[0]) });
}

// POST /plates/:id/link — write plate onto the order_item's customer_image_url
async function linkToOrder(req, res) {
  const { id } = req.params;
  const { rows: pr } = await query(`SELECT * FROM calligraphy_plates WHERE id=$1`, [id]);
  if (!pr.length) return bad(res, 'الصورة غير موجودة', 'ERR_NOT_FOUND', 404);
  const p = pr[0];
  if (!p.order_item_id) return bad(res, 'لا يوجد طلب مرتبط بهذه الصورة');
  if (!p.plate_path || p.status !== 'done') return bad(res, 'الصورة غير جاهزة بعد');
  const upd = await query(`UPDATE order_items SET customer_image_url=$2 WHERE id=$1 RETURNING id`, [p.order_item_id, p.plate_path]);
  if (!upd.rows.length) return bad(res, 'بند الطلب غير موجود', 'ERR_NOT_FOUND', 404);
  await query(`UPDATE calligraphy_plates SET linked_at = NOW() WHERE id=$1`, [id]);
  res.json({ data: { ok: true, order_item_id: p.order_item_id, url: p.plate_path } });
}

// GET /jobs/:jobId/download
async function downloadZip(req, res) {
  const { jobId } = req.params;
  const includeSheets = String(req.query.sheets || '0') === '1';
  const { rows } = await query(
    `SELECT render_text, plate_path, sheet_path FROM calligraphy_plates
      WHERE job_id=$1 AND status='done' AND plate_path IS NOT NULL ORDER BY created_at`, [jobId]);
  if (!rows.length) return bad(res, 'لا توجد صور جاهزة للتنزيل', 'ERR_NOT_FOUND', 404);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="calligraphy-${jobId.slice(0, 8)}.zip"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (e) => { console.error('zip error', e); try { res.status(500).end(); } catch {} });
  archive.pipe(res);
  const { absFromUrl } = require('../lib/upload');
  const used = new Set();
  for (const r of rows) {
    const safe = (r.render_text || 'name').replace(/[\/\\:*?"<>|]+/g, '_').slice(0, 40);
    let name = `${safe}.png`; let n = 2;
    while (used.has(name)) name = `${safe}-${n++}.png`;
    used.add(name);
    const abs = absFromUrl(r.plate_path);
    if (abs) archive.file(abs, { name });
    if (includeSheets && r.sheet_path) { const s = absFromUrl(r.sheet_path); if (s) archive.file(s, { name: `sheets/${safe}-sheet.png` }); }
  }
  archive.finalize();
}

module.exports = { listWholesalers, wholesalerNames, createJob, processNext, getJob, reroll, linkToOrder, downloadZip };
```

- [ ] **Step 3: Add `absFromUrl` to `lib/upload.js`** (used by the ZIP streamer to resolve a stored public URL back to a disk path)

```js
// Resolve a /uploads/... public URL (or bare path) to an absolute disk path, or null.
function absFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/\/uploads\/(.+)$/);
  if (!m) return null;
  return path.join(ROOT, m[1]);
}
```
Add `absFromUrl` to `module.exports`.

- [ ] **Step 4: Write `routes/calligraphy.js`**

```js
// backend/routes/calligraphy.js
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { authRequired, requireRole } = require('../middleware/auth');
const c = require('../controllers/calligraphyController');

router.use(authRequired, requireRole('admin'));

// generation is the expensive path — cap it
const genLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 120 });

router.get('/wholesalers', c.listWholesalers);
router.get('/wholesalers/:id/names', c.wholesalerNames);
router.post('/jobs', c.createJob);
router.post('/jobs/:jobId/process', genLimit, c.processNext);
router.get('/jobs/:jobId', c.getJob);
router.get('/jobs/:jobId/download', c.downloadZip);
router.post('/plates/:id/reroll', genLimit, c.reroll);
router.post('/plates/:id/link', c.linkToOrder);

module.exports = router;
```

- [ ] **Step 5: Mount in `server.js`** — add alongside the other `app.use('/api/...', require('./routes/...'))` lines:
```js
app.use('/api/calligraphy', require('./routes/calligraphy'));
```
And near the existing uploads setup (where dirs are ensured), ensure the calligraphy dirs at boot:
```js
const fs = require('fs'); const path = require('path');
['calligraphy/sheets', 'calligraphy/plates'].forEach((d) => {
  const p = path.join(__dirname, '..', 'uploads', d);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});
```
(If `fs`/`path` are already required at the top of `server.js`, don't redeclare — reuse them.)

- [ ] **Step 6: `node --check` all new/edited backend files**
Run: `node --check backend/controllers/calligraphyController.js && node --check backend/routes/calligraphy.js && node --check backend/lib/upload.js && node --check backend/server.js`
Expected: no output.

- [ ] **Step 7: Backend e2e (live)** — with dev server up and a real admin JWT, exercise the flow:
  1. `GET /api/calligraphy/wholesalers` → 200 list.
  2. `POST /api/calligraphy/jobs` `{source:'typed', items:[{render_text:'محمد علي'},{render_text:'فاطمة حسن'}]}` → 201 `job_id` + 2 pending plates.
  3. `POST /api/calligraphy/jobs/:id/process` → 200, `done:2`, plates have `plate_path`; open the URLs → valid single-name PNGs.
  4. `GET /api/calligraphy/jobs/:id` → totals + `job_cost > 0`.
  5. Non-admin token on any route → 403. (Acceptance §12.5)
  6. Grab: pick a wholesaler with a sash front-embroidery line → `names` returns it → create job with `order_item_id` → process → `POST /plates/:id/link` → confirm `order_items.customer_image_url` now = plate URL.
Expected: all green. Capture output.

- [ ] **Step 8: Commit** — `git add backend/controllers/calligraphyController.js backend/routes/calligraphy.js backend/server.js backend/lib/upload.js backend/package.json backend/package-lock.json && git commit -m "feat(calligraphy): jobs/process/reroll/link/zip API (admin)"`

---

## Task 7: Frontend API wrappers + types — `lib/calligraphy.ts`

**Files:**
- Create: `frontend/lib/calligraphy.ts`

**Interfaces:**
- Produces typed wrappers: `getCalWholesalers()`, `getCalNames(id)`, `createCalJob(body)`, `processCalJob(jobId)`, `getCalJob(jobId)`, `rerollPlate(id)`, `linkPlate(id)`, `calDownloadUrl(jobId, sheets)`, `absUrl(path)`. Types: `CalPlate`, `CalJob`, `CalGrabRow`, `CalWholesaler`.

- [ ] **Step 1: Read `frontend/lib/api.ts` + `frontend/lib/admin.ts`** to match the axios + wrapper conventions.

- [ ] **Step 2: Write `lib/calligraphy.ts`**

```ts
import { api } from "@/lib/api";

export type CalSource = "typed" | "wholesaler" | "txt";
export interface CalPlate {
  id: string; render_text: string; status: "pending" | "done" | "failed";
  plate_path: string | null; sheet_path: string | null;
  student_id: string | null; order_item_id: string | null;
  linked: boolean; cost_usd: number; error: string | null;
}
export interface CalJob {
  job_id: string; total: number; done: number; failed: number; pending: number;
  job_cost: number; plates: CalPlate[];
}
export interface CalProcess {
  processed: number; total: number; done: number; failed: number; pending: number;
  remaining: number; job_cost: number; review?: boolean; plates: CalPlate[];
}
export interface CalWholesaler { id: string; name: string; student_count: number; }
export interface CalGrabRow {
  student_id: string; student_name: string; order_item_id: string; render_text: string;
  plate_id: string | null; plate_status: string | null; plate_path: string | null; linked: boolean;
}
export interface CreateJobItem { render_text: string; student_id?: string | null; order_item_id?: string | null; }
export interface CreateJobBody { source: CalSource; model?: "standard" | "premium"; wholesaler_id?: string | null; items: CreateJobItem[]; }

const API_BASE = (process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:4000");
// stored plate_path is already an absolute public URL; absUrl is a guard for relative paths.
export function absUrl(p: string | null): string { if (!p) return ""; return p.startsWith("http") ? p : `${API_BASE}${p}`; }

export async function getCalWholesalers() { const { data } = await api.get<{ data: CalWholesaler[] }>("/calligraphy/wholesalers"); return data.data; }
export async function getCalNames(id: string) { const { data } = await api.get<{ data: CalGrabRow[] }>(`/calligraphy/wholesalers/${id}/names`); return data.data; }
export async function createCalJob(body: CreateJobBody) { const { data } = await api.post<{ data: CalJob }>("/calligraphy/jobs", body); return data.data; }
export async function processCalJob(jobId: string) { const { data } = await api.post<{ data: CalProcess }>(`/calligraphy/jobs/${jobId}/process`); return data.data; }
export async function getCalJob(jobId: string) { const { data } = await api.get<{ data: CalJob }>(`/calligraphy/jobs/${jobId}`); return data.data; }
export async function rerollPlate(id: string) { const { data } = await api.post<{ data: CalPlate }>(`/calligraphy/plates/${id}/reroll`); return data.data; }
export async function linkPlate(id: string) { const { data } = await api.post<{ data: { ok: boolean } }>(`/calligraphy/plates/${id}/link`); return data.data; }
export function calDownloadUrl(jobId: string, sheets = false) { return `${API_BASE}/api/calligraphy/jobs/${jobId}/download${sheets ? "?sheets=1" : ""}`; }
```

- [ ] **Step 3: `tsc`** — Run (from `frontend/`): `npx tsc --noEmit` → Expected: 0 errors.

- [ ] **Step 4: Commit** — `git add frontend/lib/calligraphy.ts && git commit -m "feat(calligraphy): frontend api wrappers + types"`

---

## Task 8: Admin page + nav — `app/admin/calligraphy/page.tsx`

**Files:**
- Create: `frontend/app/admin/calligraphy/page.tsx`
- Modify: `frontend/components/AdminSidebar.tsx` (add nav link)

**Interfaces:**
- Consumes everything from `lib/calligraphy.ts`. Renders under the admin layout (already admin-gated per recon).

UI requirements (one client component):
- **Mode tabs:** «كتابة/لصق» (textarea, one name per line) · «حسب الممثل» (wholesaler `<select>` → fetch names → checkbox list with status badges + "توليد المتبقي (N)") · «رفع ملف .txt» (`<input type=file accept=.txt>` → read lines client-side).
- **Model toggle:** عادي (standard) / فاخر (premium) — default عادي.
- **Generate:** create job → loop `processCalJob` until `remaining===0` (or a failed/`review` batch), updating a progress bar `done/total` + running `job_cost` (show `$` to 2 dp). Disable controls while running; allow it to resume (re-click) since done rows are skipped.
- **Proof grid:** each plate as a card: the cropped PNG (`<img src={absUrl(plate.plate_path)}>`), its `render_text`, status pill, and actions: «إعادة التوليد» (reroll), «تنزيل» (single — `<a download>` the plate url), and «ربط بالطلب» (link — only when `order_item_id` present; show «مرتبط ✓» when `linked`). Failed plates show the Arabic error + a retry (reroll).
- **Download all:** button → `window.location = calDownloadUrl(jobId)` ; secondary «مع الأوراق» → `calDownloadUrl(jobId, true)`.
- RTL, warm brand tokens, mobile-safe (no h-scroll), uses `PageHeader`, `Button`, toast (`getApiErrorMessage`).

- [ ] **Step 1: Read** `frontend/app/admin/wholesalers/page.tsx` (pattern) + `frontend/components/ui/PageHeader`, `Button`, and how toasts/`getApiErrorMessage` are imported.

- [ ] **Step 2: Add the nav link** in `frontend/components/AdminSidebar.tsx` `navItems` array:
```ts
{ href: "/admin/calligraphy", label: "الخط العربي", exact: false },
```

- [ ] **Step 3: Write `app/admin/calligraphy/page.tsx`** — `"use client"`, implementing the UI above. Key generate loop:
```ts
async function runJob(body: CreateJobBody) {
  setRunning(true);
  try {
    const job = await createCalJob(body);
    setJobId(job.job_id); setPlates(job.plates); setTotal(job.total);
    let remaining = job.total;
    while (remaining > 0) {
      const r = await processCalJob(job.job_id);
      setDone(r.done); setCost(r.job_cost);
      // merge updated plates by id
      setPlates((prev) => prev.map((p) => r.plates.find((u) => u.id === p.id) || p));
      if (r.review) { toast.error("تعذّر تقطيع إحدى الأوراق — راجِعها يدويًا"); }
      if (r.processed === 0 && r.remaining > 0) break; // a batch failed; stop the loop
      remaining = r.remaining;
    }
    // refresh full job to capture all final states
    const full = await getCalJob(job.job_id); setPlates(full.plates); setDone(full.done); setCost(full.job_cost);
  } catch (e) { toast.error(getApiErrorMessage(e, "فشل التوليد")); }
  finally { setRunning(false); }
}
```
(Implement the three input modes building `items` accordingly: typed/txt → `[{render_text}]` per non-empty line; wholesaler → selected rows → `[{render_text, student_id, order_item_id}]` with `source:'wholesaler', wholesaler_id`.)

- [ ] **Step 4: `tsc` + `eslint`** — Run (from `frontend/`): `npx tsc --noEmit && npx eslint app/admin/calligraphy/page.tsx lib/calligraphy.ts components/AdminSidebar.tsx` → Expected: 0 errors.

- [ ] **Step 5: Commit** — `git add frontend/app/admin/calligraphy/page.tsx frontend/components/AdminSidebar.tsx && git commit -m "feat(calligraphy): admin UI — modes, generate+progress, proof grid, link, download"`

---

## Task 9: End-to-end verify (live browser) + acceptance pass

**Files:** none (verification only)

- [ ] **Step 1: Ensure dev servers up** (backend :4000 nodemon, frontend :3000) and `OPENROUTER_API_KEY` set in `backend/.env`.
- [ ] **Step 2: `showme`-style pass** — log in as admin, open `/admin/calligraphy`:
  - **Typed mode:** paste 23 names → expect 3 sheets (10/10/3) → 23 cropped plates each matching its line (Acceptance §12.1). Progress bar 0→23, cost shown.
  - **Grab mode:** pick a wholesaler → names load from «تطريز الوشاح من الأمام» → generate remaining → link one plate → reload the staff/admin order view → the name line now shows the calligraphy image. (Acceptance §12.2 + the user's "link to order".)
  - **Re-roll:** click reroll on one plate → only that plate's image changes; `job_cost` increments (§12.3).
  - **Download:** ZIP opens with one PNG per name, named by render_text.
  - **Console clean**, no h-scroll at 390px.
- [ ] **Step 3: Gates** — `npx tsc --noEmit` 0 · `npx eslint` 0 · `node --check` on all backend files 0. (Skip `next build` if dev server holds `.next`, per project norm; run before deploy.)
- [ ] **Step 4: Update docs** — append a HANDOFF.md entry (what/why/how/verified/follow-ups) and tick PROGRESS.md.
- [ ] **Step 5: Final commit** — `git commit -am "docs(calligraphy): handoff + progress"`.

---

## Self-Review (against the spec)

- §3 in-scope: admin UI ✓ (T8), 3 input modes ✓ (T8), OpenRouter gen 10/sheet ✓ (T2/T6), dedup+progress ✓ (T6 createJob/process), crop→plates ✓ (T3/T6), proof+re-roll ✓ (T6/T8), ZIP ✓ (T6/T8), `calligraphy_plates` ✓ (T1).
- §5 data model: all columns present; **added** `job_id`, `order_item_id`, `error`, `linked_at`, `created_by` (justified: progress grouping, link target, error surfacing, link state, audit). Dedup by student is implemented as dedup by `order_item_id` for grab (tighter — same student's front-embroidery line) and exact `render_text` for typed/txt — matches §5 intent.
- §6 render text: exactly as stored ✓; grab source = «تطريز الوشاح من الأمام» `customer_text` (user override of the spec's `full_name_third`) ✓.
- §7 generation: `POST /api/v1/images`, `{model,prompt,resolution:'2K',aspect_ratio:'9:16'}`, `usage.cost` stored as cost/10 ✓.
- §8 crop: row-projection valleys, map top→bottom to input order, store `plate_path`; deliver plates + sheet ✓.
- §9 proof+reroll: grid + single-name re-roll, never re-roll the whole sheet ✓.
- §10 download: server-side ZIP stream ✓.
- §11 errors: non-200 → batch failed, no double-charge (cost only persisted on `done`); crop count ≠ expected → flag for manual review (`review:true`), sheet kept; missing key → clean Arabic error, never client-exposed ✓.
- §12 acceptance tests 1–5: covered in T6 Step 7 + T9 Step 2.
- §13 open items: all resolved by the user (render-as-stored · plates+sheet+admin-choice link · grab from front-embroidery line).
