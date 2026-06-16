# HANDOFF

Rolling session handoff for whoever picks up next (human or Claude). Newest entry
on top. Keep entries short: **what changed · why · how it works · verified · open
follow-ups**. This file is auto-loaded into context via `@HANDOFF.md` in `CLAUDE.md`.

---

## 2026-06-16 (b) — Student-facing طقم form + edit pre-fill + dashboard cleanup + image lightbox

Follow-up to entry (a) below, after live testing on lolo-shop96.com. Commit `2154638`
on branch `feat/wholesaler-fullset-order` (NOT yet on main — user merges/deploys).

**What changed**
1. **Student fills the form too** (user decision: "both student + wholesaler"). A
   wholesaler-linked **approved** student logs in → the home redirect for
   `wholesaler_student` audience now sends them to **`/my-order`** (was `/package`) →
   they fill the same طقم form and confirm themselves. NEW
   `frontend/app/(student)/my-order/page.tsx`. Backend: `GET/POST /orders/rep-full-set`
   (context+create) in `orderController` (retail-role, self).
2. **Single source of truth**: extracted the order logic to NEW
   `backend/lib/fullSetOrder.js` — `persistFullSetOrder({student, body, actorUserId})`
   + `readFullSetOrder(studentId)`. BOTH the rep "fill on behalf"
   (`wholesalerController`) and the student "fill my own" (`orderController`) paths are
   now thin auth wrappers over it, so they write byte-identical orders.
3. **Bug fix — edit saved nothing**: the form opened **blank** on edit (required
   fields empty → `حفظ الطلب` blocked by validation, looked dead). Added read-back
   (`GET /wholesaler/students/:id/full-set-order` + the student context) that
   reconstructs the saved order, so the form now **pre-fills** on edit. Shared form UI
   pulled into NEW `frontend/components/wholesaler/FullSetOrderForm.tsx` (used by both
   the rep page and the student page).
4. **Wholesaler dashboard** (`app/wholesaler/page.tsx`): added a **QR code** for the
   referral link (`qrcode.react`); **removed** the "تصميم الوشاح للطلاب" (sash-side
   lock) section + its modal + dead handlers/imports; **removed الدفعة + الباقات** from
   the bottom nav (`app/wholesaler/layout.tsx`) — now just الرئيسية + الطلاب.
5. **Product photo lightbox** (`components/catalog/ProductMediaGallery.tsx`): the detail
   hero was only ever **cropped** (`object-cover`) with no enlarge. Added a
   click-to-zoom **fullscreen lightbox** showing the FULL image (`object-contain`) +
   prev/next + Esc/backdrop close. The admin's per-product `image_fit` grid choice is
   untouched.

**How it works (gotchas)**
- The home→`/my-order` redirect relies on `getShop` returning `audience ===
  'wholesaler_student'` for rep-linked students (pre-existing mechanism, confirmed live).
- `/my-order` self-guards: non-rep student → redirect to `/`; rep but not approved →
  "بانتظار موافقة الممثل"; approved → the form (pre-filled if an order exists).
- Student photo upload reuses `/designs/uploads/image` (retail role); rep uses
  `/wholesaler/uploads/image`. The shared form takes `onUploadImage` as a prop.
- Type عادي/ملكي + embroidery are still captured as `order_items` spec lines (not
  priced options); production routing + statuses are unchanged from entry (a).

**Verified**
- Backend **end-to-end on the live Neon DB**: rep create→201, rep read-back
  reconstructs measurements/type/embroidery, student context returns
  is_rep_student/approved/packages/existing, student self-create→201. All idempotent.
- `tsc` 0 errors; `eslint` clean on new files (one pre-existing warning in Cursor's
  `wholesaler/page.tsx` effect, untouched).

**Open follow-ups**
- **Live browser click-through still not done by me** — verified by backend e2e +
  types/lint. User tests on prod; needs a redeploy of this commit.
- The `(student)` layout's `StudentNav` still shows shop/cart chrome to a
  wholesaler-student on `/my-order` (the home link just bounces them back via the
  redirect). Hide nav for rep-students if it bothers them.
- `/package` is unchanged and still used by retail-from-cart; only the rep-student
  redirect target moved off it.

**Files touched**
- NEW: `backend/lib/fullSetOrder.js`, `frontend/app/(student)/my-order/page.tsx`,
  `frontend/components/wholesaler/FullSetOrderForm.tsx`
- `backend/controllers/{wholesalerController,orderController}.js`,
  `backend/routes/{wholesaler,orders}.js`
- `frontend/app/(student)/page.tsx`, `frontend/app/wholesaler/{layout,page}.tsx`,
  `frontend/app/wholesaler/students/[studentId]/order/page.tsx`,
  `frontend/components/catalog/ProductMediaGallery.tsx`, `frontend/lib/wholesaler.ts`,
  `frontend/package.json` (+ qrcode.react)

---

## 2026-06-16 (a) — Wholesaler full-set order entry (WhatsApp intake form digitized)

**What changed**
- Reps can now enter a student's full طقم order **in-app** instead of over WhatsApp.
- Backend (additive — the retail `configureFullSet` path is untouched):
  `backend/controllers/wholesalerController.js` gains `fullSetPackages`,
  `getStudent`, `createFullSetOrder`, `uploadImage`; wired in
  `backend/routes/wholesaler.js`:
  - `GET  /api/wholesaler/full-set-packages`
  - `GET  /api/wholesaler/students/:studentId`
  - `POST /api/wholesaler/students/:studentId/full-set-order`
  - `POST /api/wholesaler/uploads/image`
- Frontend: NEW `frontend/app/wholesaler/students/[studentId]/order/page.tsx`
  (the form), `lib/wholesaler.ts` wrappers, and an "إضافة طلب / تعديل الطلب"
  button on each **approved** student in `app/wholesaler/students`.

**Why**
- Decided with the user this session: reps' students never browse the shop/cart;
  the rep follows the WhatsApp form and orders the **package**. Sash & cap type are
  only عادي/ملكي. Embroidery is free text (the name) + an optional photo, plus a note.
  Account model = **registered students only** (rep fills the order for a student
  who already joined via the referral link & was approved).

**How it works (important for future edits)**
- The WhatsApp form ≈ the retail full-set order, so `createFullSetOrder` **mirrors
  `configureFullSet`'s pipeline**: 3 linked orders (sash/robe/cap) under one
  `checkout_group`, package price on the sash (robe/cap = 0), auto-attach to the
  rep's latest batch, **idempotent upsert** (one active order per student+product —
  respects `uq_orders_student_product_nodesign`; re-submit UPDATEs, never duplicates).
- **No schema migration.** Measurements → `orders.measurements` JSON
  (`{shoulder_cm, robe_length_cm, sleeve_length_cm}`). Types (نوع الوشاح/القبعة =
  عادي/ملكي) and the 4 embroidery zones → `order_items` **spec lines**
  (`label_snapshot` + `customer_text` + optional `customer_image_url`), NOT priced
  options — the cap has no عادي/ملكي option group, so type is captured as a
  manufacturing label staff read. Note → `checkout_groups.notes` + each `orders.notes`.
- Production routing = same rules as the retail full set: an embroidered piece
  enters at `design_complete`, a plain piece at `preparing`. **Order-status logic
  stays backend-only** (see state-machine memory) — the new path invents no statuses.
- Photo upload is wholesaler-scoped (`/wholesaler/uploads/image`, `imageUpload`
  multer) because `/designs/uploads/image` is `requireRole('retail')`.

**Verified**
- Backend **end-to-end against the live Neon DB**: ran the real controller AND real
  HTTP (signed rep JWT) — `GET` endpoints 200, `POST` 201 returning the same
  order/checkout-group IDs on re-submit (idempotency proven), bad measurement &
  missing type → 400 with the right Arabic errors. Confirmed the 3 orders carry
  correct price/status/measurements and the spec lines (نوع الوشاح=ملكي, تطريز
  الوشاح من الأمام="المحلل احمد سمير", تطريز القبعة من الجانب="احمد").
- `tsc --noEmit` 0 errors · `eslint` 0 errors/warnings on the new files.

**Test fixture (for live browser testing)**
- A test rep + approved student were created in dev (none existed before — the DB had
  **zero wholesalers**). Rep login: phone **`07700000001`**, password **`test1234`**,
  OTP **`111111`** (dev master code). Approved student: **"احمد سمير"**
  (referral code `TESTREP`). Open الطلاب → احمد سمير → "تعديل الطلب".

**Open follow-ups**
- **Live in-browser click-through not yet done** — servers were down and disk is at
  92%; verified by real backend e2e + types/lint only. Run `showme` or just log in as
  the test rep to drive it.
- Type عادي/ملكي is captured as a spec label only — it does NOT swap the sash/cap
  sub-product or change price. If reps later need ملكي to pick a different product or
  price, wire `sash_type`/`cap_type` → product/option selection in `createFullSetOrder`.
- Robe `فصال` is measurements-only (no قماش/ردن/لون choices like the retail form). Add
  fields to the form + payload if reps need them.

**Files touched**
- `backend/controllers/wholesalerController.js`, `backend/routes/wholesaler.js`
- `frontend/app/wholesaler/students/[studentId]/order/page.tsx` (new)
- `frontend/app/wholesaler/students/page.tsx`, `frontend/lib/wholesaler.ts`
- `PROGRESS.md`

---

## 2026-06-14 — Sash designer: زخارف vector ornament library (42 ornaments)

**What changed**
- NEW `frontend/lib/ornaments.ts` — a library of **42 vector ornaments** in 7
  Arabic categories (محترف-الخط style): نجوم · شمسيات · فواصل · زوايا · إطارات · ورود · رموز.
- Wired a **categorized ornament picker** (category chips + 4-col thumbnail grid)
  into the shared `frontend/components/designer/Whiteboard.tsx`.
- Renamed the old quick-glyph row label from "زخرفة" → "رموز" (the 10 Unicode
  glyphs are kept as a quick-symbols row; the rich library is the new section).
- Logged in `PROGRESS.md`.

**Why**
- "زخارف" used to be a single line of 10 Unicode glyphs added as `IText`. User
  asked for "a lot of زخارف like محترف الخط app".

**How it works (important for future edits)**
- Each ornament is a self-contained SVG string using the color token `__C__`.
  `ornamentDataUrl(svg, color)` substitutes the chosen thread color and returns a
  `data:image/svg+xml,…` URL.
- `Whiteboard.addOrnament(svg)` adds it as a normal **`FabricImage`** from that
  data URL — freely movable/scalable/rotatable, colored to the current text color
  **at insert time**.
- Because it serializes as a standard image with an inline `src`, it round-trips
  through **both order paths** and every renderer with **zero pipeline changes**
  (same mechanism as the existing logo/photo upload):
  - `/design` page → `TextEditor` → `Whiteboard`
  - product page → `SashSideLockEditor` → `TextEditor` → `Whiteboard`
  - customer preview, staff viewer, print export all go through
    `lib/render-sash-panel.ts` `loadFromJSON`, which reconstructs the image.
- Geometric ornaments (stars/medallions) are generated procedurally for perfect
  symmetry; flourishes/florals are hand-authored and mirrored.
- Removed the 6-point hexagram (reads as a Star of David — wrong audience),
  replaced with a 6-point sparkle star.

**Verified**
- `tsc --noEmit`: 0 errors · `eslint` on changed files: 0 warnings.
- Headless-Chrome contact sheet of all 42 data-URL thumbnails — every ornament
  renders, no tofu, no broken images.

**Open follow-ups**
- Live end-to-end click-through in the running app (add → save → see in
  preview/staff) **not yet done** — verified by render + types/lint only.
- Color is **insert-time only** (embroidery = one thread). To change an ornament's
  color you re-add it with a different color selected. Live recolor of an existing
  ornament image would need either (a) storing the SVG template on the object and
  regenerating `src` on color change, or (b) switching ornaments to Fabric vector
  groups (recolorable via group fill, but heavier JSON / more enliven edge cases).
- Want more ornaments? Add entries to the category arrays in `lib/ornaments.ts`;
  the picker and all renderers pick them up automatically.

**Files touched**
- `frontend/lib/ornaments.ts` (new)
- `frontend/components/designer/Whiteboard.tsx`
- `PROGRESS.md`
