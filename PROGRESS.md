# Progress

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
- Linked late attendance deductions to the existing payroll ledger with soft-delete/source tracking.
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
