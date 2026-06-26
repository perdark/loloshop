# Auth: trusted-device login + OTP ban-hardening + prod security

**Date:** 2026-06-26
**Branch:** `feat/auth-trusted-device-ban-hardening`
**Status:** approved (user chose: trusted-device 90d, 30-day session, fixes-first, official-API deferred)

## Problem (root cause)

Login depends on a WhatsApp OTP **on every login** via an **unofficial** gateway
(Zentramsg = WhatsApp-Web automation). The sender number keeps getting **banned by
Meta**, taking down login for *all* users. Two sender numbers have already been banned.
Investigation found the bans are driven by the app's own behavior, not bad luck:

1. **No phone validation** → the app blasts WhatsApp messages to invalid/garbage numbers
   (`03`, `010`, `0771`, `07788888` seen in prod logs). Sending to non-existent numbers is
   the #1 spambot signal Meta bans for.
2. **Per-number OTP cap was disabled** (gated on `NODE_ENV==='production'`, but prod ran
   `development`). Now fixed at the env level (NODE_ENV flipped to production 2026-06-26).
3. **OTP on every login** → high volume of identical-template messages.
4. **Freshly-linked device immediately bulk-sends** → fast new-device ban.

Plus prod ran `NODE_ENV=development` + `ALLOW_PROD_MASTER_OTP=true` (rate-limit off, codes
in logs, master-OTP backdoor armed).

## Goals

- Returning user on a known device logs in with **phone + password only, zero WhatsApp**.
- OTP used **only** for: signup (verify phone once), password reset, and **first** login on a
  new device. Never blasted to invalid numbers.
- Stop the sender-number bans by cutting volume + rejecting invalid recipients.
- Lock down prod security.

## Non-goals (deferred)

- Migrating to the official **WhatsApp Cloud API** (Meta). Documented as the permanent cure if
  bans continue after these fixes; not in this work.
- SMS / email OTP fallback channels.
- Changing signup/reset UX beyond adding validation.

## Design

### Pillar A — Trusted-device login

**New table `trusted_devices`** (migration `048`):

| column        | type                     | notes                                  |
|---------------|--------------------------|----------------------------------------|
| id            | uuid pk default          |                                        |
| user_id       | uuid not null fk users   | on delete cascade                      |
| token_hash    | text not null            | sha-256 of the random device token     |
| user_agent    | text                     | for the user's device list (future)    |
| created_at    | timestamptz default now  |                                        |
| last_used_at  | timestamptz              | bumped on each OTP-skipped login        |
| expires_at    | timestamptz not null     | now() + 90 days                        |

Index on `(user_id)` and `(token_hash)`. Schema.sql mirrored.

**Flow changes (`authController` + `routes/auth.js`):**

1. `POST /auth/login {phone, password, device_token?}`
   - Validate phone (Pillar B). Verify password (unchanged). Wrong → 401.
   - **If `device_token` is present AND `sha256(token)` matches a non-expired `trusted_devices`
     row for THIS user** → skip OTP: bump `last_used_at`, `signToken`, return `{ token, user }`.
   - Else → `createOtp(phone,'login')`, return `{ otp_required:true, phone }` (unchanged).
2. `POST /auth/login-verify {phone, code}` (and the parallel `postVerifyOtp` for signup)
   - On OTP success, after `signToken`: generate `device_token = crypto.randomBytes(32).hex`,
     insert `trusted_devices(user_id, sha256(device_token), user_agent, expires_at=now+90d)`,
     return `{ token, user, device_token }`.
3. **Password reset** (`resetPasswordPhone`, `resetPassword`) → `DELETE FROM trusted_devices
   WHERE user_id = $1` (a leaked device can't outlive a password change).

Helper module **`lib/trustedDevice.js`**: `issueDeviceToken(userId, userAgent)`,
`isTrustedDevice(userId, token)`, `revokeUserDevices(userId)`. Keeps `authController` thin.

**Frontend (`lib/auth-api.ts`, login/register pages):**
- Store `device_token` in `localStorage` (`loloshop_device_token`) when returned from
  `login-verify` / `verify-otp`.
- Send it as `device_token` on every `POST /auth/login`.
- Logout clears the JWT but **keeps** `device_token` (device stays trusted).

**Session:** `JWT_EXPIRES_IN` → **30d** (was 7d) on prod `.env` (no code change; default in
`signToken` stays `7d` for safety, prod overrides via env). Trusted-device skips OTP for 90d.

### Pillar B — Ban-prevention (4 fixes)

1. **`isValidIqMobile(phone)`** in `lib/otp.js` = `/^07\d{9}$/` (canonical 11-digit local form,
   post-normalize). Exported.
2. **Reject invalid phone BEFORE any send** in `register`, `login`, `joinReferral`,
   `forgotPasswordPhone`, `resendOtp` → 400 «رقم هاتف غير صحيح» (`ERR_INVALID_PHONE`). For
   `login`/`forgot` keep the no-enumeration behavior where it already exists.
3. **Hard recipient guard inside `createOtp` + `sendViaZentramsg`** — never POST to Zentramsg
   unless the number passes `isValidIqMobile` and `toIntlDigits()` yields `^964\d{10}$`.
   Defense-in-depth: no code path can ever blast an invalid number again.
4. **Per-phone cap always enforced** — remove the `if (NODE_ENV==='production')` gate in
   `createOtp` so the 5/hour-per-phone cap runs regardless of env (belt-and-suspenders even if
   env is misconfigured again).

Login OTP volume drops to ~zero via Pillar A.

### Pillar C — Prod security hardening

On prod `/var/www/loloshop/backend/.env` (NODE_ENV already flipped 2026-06-26):
- **Remove `ALLOW_PROD_MASTER_OTP=true`** (and confirm no `DEV_MASTER_OTP`).
- Set `JWT_EXPIRES_IN=30d`.
- `pm2 restart loloshop-api`.

Staff keep their password-only `/s/<key>` portal, so no one loses access when the master-OTP
path is gone.

## Verification

**Backend e2e on Neon (a temp throwaway user, cleaned up):**
- login with a valid `device_token` → 200 + token, **no** `otp_required`, no Zentramsg call.
- login without token → `otp_required:true`; `login-verify` returns a `device_token`; reusing it
  skips OTP.
- invalid phones (`03`, `010`, `07788888`) → 400 `ERR_INVALID_PHONE`, **0** Zentramsg calls.
- 6th OTP request within an hour → 429 `ERR_OTP_RATE`.
- password reset → trusted devices for that user deleted (next login needs OTP).
- expired device row (set expires_at in past) → login needs OTP.

**Gates:** FE `tsc` 0 · `eslint` 0 · BE `node --check` 0. Migration applied + verified on Neon.

**Live (prod, after deploy):** first login OTPs + stores token; second login same browser →
no OTP; an invalid number never reaches WhatsApp (watch logs for absence of bad `ids`).

## Rollout

1. Migration `048_trusted_devices.sql` → Neon.
2. Backend + frontend changes on the branch; gates green; backend e2e.
3. Deploy: pull on VPS, `npm run build` (frontend), update prod `.env`
   (`JWT_EXPIRES_IN=30d`, remove `ALLOW_PROD_MASTER_OTP`), `pm2 restart`.
4. Live smoke test (first login → OTP + trusted; second → no OTP).

## Future option (if bans continue)

Migrate OTP delivery to the **official WhatsApp Business Cloud API** (Meta): unbannable, but
needs a Meta Business account + verification + pre-approved message templates + per-conversation
billing. The `sendViaZentramsg` seam in `lib/otp.js` is the single swap point.
