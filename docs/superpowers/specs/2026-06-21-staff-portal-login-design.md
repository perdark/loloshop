# Private staff portal login — design

**Date:** 2026-06-21 · **Status:** approved, implementing

## Problem
Staff log in today with phone + password → **WhatsApp OTP**. Some staff have **no phone**,
so they can neither be created cleanly (`users.phone` is `NOT NULL UNIQUE`) nor receive the
OTP — they're locked out entirely.

## Goal
A **private** staff login: a secret, unguessable URL where a worker **picks their name from a
list** and types a **password** — **no OTP**. Students/retail must never stumble on it. Existing
phone+OTP login stays untouched for staff who do have phones (purely additive).

## Decisions (locked with user)
- Identity = **pick name from a dropdown + password** (easiest for non-technical, phoneless staff).
- Verification = **password only, no OTP**.
- Privacy = **secret unguessable URL**, server-validated, fail-closed.

## Design

### 1. Secret URL (fail-closed)
- Page: `frontend/app/s/[key]/page.tsx`. The `[key]` path segment **is** the secret
  (e.g. `/s/e32ed299a047eec2c7ee`).
- Secret stored once in backend env: `STAFF_PORTAL_KEY`. If unset → portal is fully off (404).
- Both backend endpoints reject any request whose key ≠ env with a plain **404** (indistinguishable
  from a non-existent page; zero hint the portal exists). Rotatable via env + restart.
- Not linked from any nav, sitemap, or public page.

### 2. Backend endpoints (`/api/auth`, both key-gated)
- `GET /auth/staff-portal/members?key=…` → `[{ id, name }]` for `role='staff'` only. No phone/email.
  Wrong/missing key → 404. Rate-limited (30 / 15 min).
- `POST /auth/staff-portal-login` `{ key, staff_id, password }` → validates key, confirms `staff_id`
  is a UUID and a `role='staff'` user, bcrypt-checks password → issues JWT via `signToken`
  (**no OTP**). Rate-limited (reuse `loginLimit` 20 / 15 min). Generic Arabic errors, no enumeration.
- **Hard-restricted to `role='staff'`** (managers are staff → covered). admin/wholesaler/retail can
  never be obtained here, limiting blast radius if the key leaks.

### 3. Migration 042 — allow phoneless staff
- `ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;` — the existing `users_phone_key` UNIQUE
  constraint already permits multiple NULLs (Postgres treats NULLs as distinct), so real phones stay
  unique while phoneless staff are allowed. Mirror into `schema.sql` (`phone TEXT UNIQUE`).

### 4. Admin staff create — phone optional
- `createStaff`: treat empty/missing phone as NULL; only normalize + dup-check when a phone is given;
  password still required. Audit log records `phone: null` when absent.
- Team form (`app/staff/team/page.tsx`): phone field marked optional + hint that phoneless staff use
  the private link. Frontend `CreateStaffPayload.phone` becomes optional.

### 5. Untouched
- Existing phone + password + WhatsApp-OTP login for staff/admin with phones. Admins keep their flow.

## Security trade-off (deliberate)
Skipping OTP removes 2FA for these staff, but they have no phone so OTP is impossible anyway.
Protection = secret key (shared factor) + per-staff bcrypt password + staff-only scope + rate limiting.
The key rides in the URL path (can appear in logs/Referer) → treat it like a password; rotate via env.

## Files
- backend: `controllers/authController.js`, `routes/auth.js`, `controllers/adminController.js`,
  `.env` (+ `.env.example`); NEW `db/migrations/042_users_phone_optional.sql`; `db/schema.sql`
- frontend: NEW `app/s/[key]/page.tsx`; `lib/auth-api.ts`, `lib/admin.ts`, `lib/api.ts`,
  `app/staff/team/page.tsx`

## Coordination
Another session is editing the home `/` page (ShopCover/BrandStory/layout). No file overlap.
