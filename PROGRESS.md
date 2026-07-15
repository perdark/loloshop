# Progress

## 2026-07-10 — NEW «الورشة / Team B» module (bulk piecework + wage ledger, standalone)

New standalone module tracking garment **quantities** through the Syrian workshop (قص → أوفرلوك/قبعة → خياطة/تسكير) and paying workers **per piece** — separate from the Team-A order pipeline; **no auto-handoff to Team A** (deferred), `orders` untouched. Migration **060** (applied to Neon): `worker` role + 6 `workshop_*` tables. Backend `workshopController.js` + `/api/workshop` (secret-URL portal no-OTP, runs/assignments, **append-only ledger with frozen rate**, reconciliation warnings, payments/balance). Frontend: Syrian-dialect worker portal (`/w/[key]`) + worker screen (`/workshop`), admin dashboard (`/admin/workshop`: overview/runs/workers/rates) + sidebar link. Identity: workers are `users role='worker'`; ابو عبدو linked from his existing staff user (فصال screen untouched). Verified: BE e2e **22/22** on Neon + HTTP smoke (200s / key-gate) + browser (portal + admin overview + run-detail reconciliation, console clean); FE `tsc`/`eslint` 0. **Uncommitted, not deployed.** ⚠️ Set `WORKSHOP_PORTAL_KEY` in prod `.env`. Demo «(تجريبي)» data left in DB (see HANDOFF). Spec: `docs/superpowers/specs/2026-07-10-workshop-team-b-design.md`.

## 2026-07-07 — Back-nav fix · calligraphy preview+designer · money-gate · freestyle TV

Four items (uncommitted on main, not deployed — see HANDOFF for detail):
1. **Order back button** returns to origin (`?from=` + same-origin referrer fallback; open-redirect hardened) instead of always the dashboard. 6 entry points + order page.
2. **Calligraphy AI preview** now closable (overlay portaled to `document.body`); tool extracted to shared `CalligraphyTool`.
3. **Calligraphy AI opened to designers** (`/staff/calligraphy` + sidebar link; backend `requireStaffType('designer')`).
4. **Money-gate**: revenue/profit hidden by default on `/admin` + `/tv`, revealed by a disguised 🎓 + secret passphrase (stripped server-side on TV via `x-tv-reveal` header; hashed in `site_settings.money_gate`, min 8, rate-limited). **TV freestyle-redesigned** into a full-screen scene cinema (6 rotating money-free scenes + old Iraq map kept + money scene only while revealed, auto-hides 90s). Dashboard money masked + new non-money charts (orders-trend, pipeline).

Verified: FE `tsc` 0 · `eslint` 0 · BE `node --check` OK; TV + dashboard driven live in-browser; money-gate server-side confirmed (no-reveal/wrong→null, correct→figures). Passphrase `lolo2026` (change before deploy — dev+prod share the DB). Critic-reviewed; hardening fixes applied.

## 2026-07-07 — Homepage trust-first feed (above طقم التخرج الكامل)

Replaced the five stacked marketing bands (`ShopCover`, `AtelierStory`, `MilestoneStory`, `DesignProcess`) with a single Instagram-native trust scroll (`HomeTrustStory.tsx`): full-bleed opening grad photo, vertical photo feed with captions, short craft copy, soft CTA link to `#catalog`. `VipHomeBand` restyled as a feed post (square photo, caption below, no heavy card). `FullSetBand` + catalog + store location unchanged. Approval mockup: `design-mockups/trust-feed/index.html`.


- Retail robe + full-set wizard: sleeve embroidery toggles grouped under a visible **«ردن الروب»** card with larger checkboxes (الردن الأيمن / الأيسر) instead of buried per-group fieldsets.

## 2026-07-02 — Wholesaler custom order + shawl notes

- **Edit fix:** `persistFullSetOrder` now normalizes `student.phone ?? ''` so editing name-only custom orders no longer 500s on `checkout_groups.phone_primary NOT NULL`.
- **Custom order confirmation:** removed auto-approve from `quickFullSetOrder` — custom orders stay `pending` until the rep confirms from «طلبات الطلاب». FE: updated copy, redirect to pending orders, «تعديل» link + «تأكيد وإرسال للإنتاج» on pending rows.
- **Shawl notes:** migration `058_retail_shawl_notes.sql` adds optional «ملاحظات» prompts to top-level shawl products; retail product page renders notes textarea alongside optional photo for `type=shawl`; `seed-v2.js` updated for fresh installs.

Verified:
- Backend `node --check` on `fullSetOrder.js`, `wholesalerController.js`.
- Migration 058 applied to Neon.
- Frontend `npx tsc --noEmit` 0.

## 2026-07-02 — Retail cap/robe form improvements

- Removed generic retail cap photo group «صورة القبعة» (migration 050 superseded).
- Cap «القبعة من الجانب» / «القبعة من الأعلى»: when student picks «بكتابة», text is required and reference photo is optional.
- Robe «ردن الروب» single-select replaced with optional left/right sleeve toggles (+5,000 د.ع each) with required text + optional photo per checked sleeve.
- محيط الصدر is now optional on retail product page and retail full-set wizard (range-checked when provided).
- Migration `057_retail_cap_robe_form.sql` + `seed-full-set.js` updated for fresh installs.

Verified:
- Backend `node --check` on `orderController.js`, `seed-full-set.js`.
- Frontend `npx tsc --noEmit` 0.

## 2026-06-29 — Staff attendance separated from salary

- Separated «بصمة الموظف» from salary: staff now have an independent `/staff/attendance` page/link, while `/staff/me` is salary/activity only.
- `/staff` now shows only the compact attendance button for all staff role dashboards; the full attendance card stays on `/staff/attendance`.
- Attendance check-in no longer creates salary deduction transactions, and salary summaries ignore older attendance-sourced transactions.
- Added admin-controlled per-staff exemption via `/admin/attendance`: each employee can be marked «مطلوبة» or «معفى» from attendance.
- Applied migration `054_attendance_exemptions.sql` to the configured database.

Verified:
- Backend syntax checks for touched controllers/routes.
- Frontend `npm run lint`.
- Frontend `npx tsc --noEmit`.
- Verified `staff_attendance_user_settings.attendance_required` exists in DB.
- Browser-smoked `/staff` after clearing the PWA service worker cache: only the compact attendance button appears before «مراجعة التصاميم».

## 2026-06-29 — Google Play readiness pages + PWA shell

- Added public Arabic policy pages for Google Play review: `/privacy`, `/terms`, and `/delete-account`.
- Linked `/privacy` and `/terms` from the shared public/student footer, with `/delete-account` linked from the privacy policy page for Google Play account-deletion access.
- Added a reusable legal page layout and included the policy routes in the public sitemap.
- Added PWA registration, `public/sw.js`, and `public/offline.html` so the app has an install/offline fallback shell.
- Expanded `manifest.json` with `scope`, portrait orientation, and store categories.
- Added `/.well-known/assetlinks.json` as an env-driven Next route for Trusted Web Activity verification.
- Added `frontend/.env.example` entries for `NEXT_PUBLIC_API_URL`, `ANDROID_PACKAGE_NAME`, and `ANDROID_SHA256_CERT_FINGERPRINTS`; updated frontend `.gitignore` so the example file can be committed.

Verified:
- Frontend `npm run lint`.
- Frontend `npm run build`.

Open:
- After creating/uploading the Android App Bundle in Play Console, copy the Play App Signing SHA-256 into `ANDROID_SHA256_CERT_FINGERPRINTS` and redeploy so `https://lolo-shop96.com/.well-known/assetlinks.json` returns the real Digital Asset Links JSON instead of 404.
- Still need Android/TWA wrapper generation with Bubblewrap, Play Console store listing assets, Data safety form, reviewer test access, and closed testing if the account requires it.

## 2026-06-29 — Staff attendance, payroll removal, admin custom orders

- Added staff attendance / «بصمة الموظفين» model and APIs: admin-controlled shift times, grace minutes, per-minute late deduction, network/location verification settings, staff check-in/check-out, attendance records, and override support.
- Added per-staff attendance overrides so each employee can have a custom arrival/departure time, grace window, and per-minute deduction while others keep the default schedule.
- Initially connected late attendance markers to payroll ledger entries; superseded above by the attendance/salary separation.
- Added admin removal for manual «حافز» and «خصم» transactions.
- Added admin custom order creation using the existing full-set order form/persistence, with optional wholesaler attachment.
- Added frontend pages/entry points for `/admin/attendance`, `/admin/custom-order`, and staff self-service attendance on `/staff/me`.

Verified:
- Applied migration `052_staff_attendance.sql` to the configured database.
- Applied migration `053_staff_attendance_user_settings.sql` to the configured database.
- Backend smoke script passed for attendance check-in, manual salary transaction removal, and admin custom order creation (temporary data cleaned up).
- Backend smoke script passed for per-staff attendance override: default 9:00, staff override 10:00, check-in record used 10:00.
- Backend syntax checks for touched controllers/routes.
- Frontend `npm run lint`.
- Frontend `npx tsc --noEmit`.

Open:
- Browser smoke test still needed for staff check-in/out, admin attendance settings, payroll transaction removal, and admin custom order creation.
