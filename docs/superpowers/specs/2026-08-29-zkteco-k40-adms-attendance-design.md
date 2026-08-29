# ZKTeco K40 Pro (ADMS) becomes the only بصمة — design

**Date:** 2026-08-29
**Status:** approved in chat, not yet implemented
**Replaces:** phone-based `POST /api/staff/attendance/check-in` / `check-out`

---

## Why

بصمة today is a button on the worker's phone. Identity is their JWT; proof they are at the
shop is `verificationEvidence()` in `attendanceController.js` — IP range and/or GPS radius.
`staff_attendance_settings.verification_mode` is `'none'` on prod, and the shop coordinates are
NULL, so **nothing is verified**: any worker can stamp from home, on time, every day.

A ZKTeco K40 Pro fingerprint terminal is being installed at the shop. Standing at the sensor is
strictly stronger proof than a GPS check that was never switched on.

## Owner decisions (2026-08-29)

1. **Device only.** The phone stamp buttons are removed — not kept as a fallback.
2. **Removal is immediate**, not staged behind the integration: every worker enrols their
   finger today.
3. **Names are pushed from LoloShop down to the device**, so its screen shows the worker's
   name rather than a bare number.
4. The device reaches the internet over **Ethernet** at the shop.

### The consequence of decisions 1 + 2

Removing the phone stamp before the device can record anything would leave the shop with **no
way at all to record attendance**. Therefore:

> **The commit that removes the phone stamp MUST also ship the admin hand-entry screen
> (§6.3).** They deploy together or not at all.

Payroll and the salary ledger read `staff_attendance_records`; a day with no rows is a day
nobody was paid for correctly, and `late_minutes` is frozen at write time and never recomputed
(see the staff-schedule landmine in `HANDOFF.md`), so a gap cannot be repaired by a later
backfill of the schedule.

## What the device actually is

The QR shown on first boot — `{"ip":"192.168.1.201","port":"4370","password":"0"}` — is the
**pull** protocol (ZKTeco standalone SDK, UDP/TCP 4370). It is LAN-only and therefore useless
from the VPS at `169.58.114.255`.

**ADMS is the push half**, and it is the one we use. Configured under Menu → Comm → Cloud
Server Setting, the device makes *outbound* HTTP requests to a server address we choose. That
means:

- no port forwarding at the shop,
- no static IP at the shop,
- no always-on PC at the shop,
- the shop's router/NAT is not touched at all.

## Risks, stated before any code

**R1 — "K40 Pro" is not one firmware.** ADMS support and the exact protocol dialect vary
between builds and regions. Everything below is written against the documented ZKTeco Push SDK.
The build order (§7) therefore starts with an endpoint that logs verbatim whatever the device
sends, and the rest is written against that transcript rather than against this document.

**R2 — the proxy edit is not in this repo.** `/iclock/*` is a fixed path in firmware; it cannot
live under `/api`. Routing it is an edit to RevoArt's `supabase-caddy` on the shared 8 GB box,
which fronts a second production site. It is the LAST step, done deliberately.

**R3 — Arabic on the device screen depends on a firmware language pack.** If pushed Arabic names
render as boxes, the fallback is a Latin transliteration. Mitigated by making the pushed name an
admin-editable column, so this is a data fix and not a code change.

**R4 — HTTPS is not guaranteed.** Many K40 firmwares speak HTTP only. Unverified as of writing;
§2 covers both cases.

---

## 1. Data model

Three new tables. All three are additive; no existing column changes type.

### `attendance_devices`
One row per terminal. `serial_number` (from the `SN=` query param on every device request) is
the allowlist key — a request whose serial is not here is refused (§2.3).
Columns: `id`, `serial_number` UNIQUE, `label_ar`, `active`, `last_seen_at`, `last_ip`,
`firmware_note`, `created_at`.

### `attendance_punches`
The raw stream, append-only, **never deleted**. Every derived attendance record can be rebuilt
from this table, which is what makes the reduction rule in §3 safe to change later.
Columns: `id`, `device_sn`, `device_pin` (the number on the device, TEXT), `punched_at`
TIMESTAMPTZ, `raw_status` (the device's own 0–5 status byte), `raw_line` TEXT (the verbatim
tab-separated line), `user_id` NULL REFERENCES users, `attendance_id` NULL REFERENCES
staff_attendance_records, `received_at`, `ignored_reason`.

`UNIQUE (device_sn, device_pin, punched_at)` — this is the idempotency guarantee. A device that
re-uploads its buffer after a network failure produces zero duplicate stamps.

### `staff_device_pins`
The identity map. Columns: `user_id` REFERENCES users UNIQUE, `pin` INTEGER UNIQUE CHECK
(1..65534), `pushed_name` TEXT (what we send to the device screen — admin-editable, see R3),
`push_state` (`pending` | `sent` | `confirmed` | `failed`), `enrolled_at`, `created_at`.

PINs are allocated from the low end of the free range so workers type short numbers.

## 2. Transport — device to us

### 2.1 Endpoints
A new `backend/routes/iclock.js`, mounted at the **root** of the Express app (not under `/api`;
the path is fixed in firmware).

| Route | Purpose |
|---|---|
| `GET /iclock/cdata?SN=…&options=all` | Handshake. We reply with the device's operating config: timezone, upload interval, realtime flag. |
| `POST /iclock/cdata?SN=…&table=ATTLOG` | The punches. Body is tab-separated plain text, one punch per line. |
| `GET /iclock/getrequest?SN=…` | The device polling for commands. This is our channel for pushing names (§4). |
| `POST /iclock/devicecmd` | The device reporting whether a command succeeded. |

### 2.2 Body parsing
These bodies are `text/plain`, not JSON. `express.json()` (`server.js:62`) will not parse them
and must not try. `express.text({ type: '*/*' })` is applied **on the iclock router only** —
mounting it globally would change how every other route in the app reads its body.

### 2.3 Authentication
**The ADMS protocol has no authentication.** There is no token to check. The guards are:

- **Serial allowlist** — `SN=` must match an `active` row in `attendance_devices`.
- **A dedicated rate limiter** on the router, separate from the app's existing limiters.
- **Unknown serial gets `200` with an empty body, not `403`.** Some firmware retries a 4xx
  forever, turning a misconfigured device into a self-inflicted flood. The request is dropped
  server-side and logged.

The exposure this leaves is bounded: a forged punch can create a stamp that an admin can see
and void. It cannot read data, and it cannot touch money — lateness deductions are displayed,
never posted to `staff_salary_transactions` (see the two-ledgers landmine in `HANDOFF.md`).

### 2.4 HTTP vs HTTPS
To be settled by reading the device's Cloud Server screen (R4).
- If it speaks HTTPS to a domain: `https://lolo-shop96.com/iclock/*` through the existing Caddy.
  Nothing new is exposed.
- If HTTP only: an HTTP-only path for `/iclock/*` in Caddy. Punches then cross the shop's
  internet in plaintext. The content is a device serial, a PIN number and a timestamp — no
  credentials, no personal data beyond "worker 7 touched the sensor at 09:04".
- If it accepts an IP only: `169.58.114.255` is baked into hardware, and a future server move
  means walking to the device. Record it in `HANDOFF.md` if this is where we land.

## 3. Punch stream to attendance record

The device emits many punches per day. `staff_attendance_records` keeps its existing shape —
one row per `(user_id, work_date)`, one `check_in_at`, one `check_out_at`. That shape is what
payroll, the break ledger and the monthly summary all read, and it does not change.

**The reduction rule**, applied per punch:

1. Resolve the punch's shift with `lib/staffSchedule.resolveStamp()` — the single source for
   weekday hours, holidays and the after-midnight rule, per its landmine. **It is called with
   the punch's own timestamp, never with `now`.**
2. If no record exists for that `(user_id, shift.date)`: insert one, freezing
   `expected_start_time`, `expected_end_time`, `grace_minutes`, `late_minutes` and
   `deduction_amount` exactly as `checkIn` does today.
3. If a record exists: move `check_out_at` forward to this punch. Never move it backward.

So the first punch of a shift is the check-in and the last is the check-out, without depending
on the worker pressing a function key to declare which is which — on a K40 nobody does.

**Why the punch timestamp and not `now`.** The device buffers punches while the shop's internet
is down and dumps them hours later. Lateness must be measured from when the finger touched the
sensor. Today's `checkIn` hardcodes `now`; this is the one substantive change inside the
existing controller, and it is the defect most likely to be reintroduced by a later tidy-up.

**Unknown PIN.** A punch whose `device_pin` has no `staff_device_pins` row is stored with
`user_id = NULL` and surfaced in the admin panel (§6.2). It creates no attendance record. This
path exists even though we push names, because a finger can be enrolled directly at the device.

## 4. Identity — pushing names to the device

Fingerprint *templates* are enrolled at the device and are never sent to us. What we push is the
user record the template attaches to, so the screen greets a name instead of a number.

Flow:
1. Admin assigns a worker a PIN (or accepts the auto-allocated one). Row written with
   `push_state = 'pending'`.
2. Next time that device calls `GET /iclock/getrequest`, we answer with a queued
   `DATA UPDATE USERINFO PIN=…\tName=…\tPri=0\tGrp=1` command → `push_state = 'sent'`.
3. The device reports the result to `POST /iclock/devicecmd` → `confirmed` or `failed`.
4. The worker enrols their finger against that PIN at the device.

Deactivating a worker queues the matching delete command.

## 5. What deliberately does not change

- **Breaks (الخروج المؤقت)** stay a request/approve flow in the app. The K40 has no reliable
  way to mark a punch as a break, and `lib/attendanceBreak.js` is the only writer of an
  attendance salary transaction — putting the device near it would put the device near money.
- **Schedule, holidays, lateness math, payroll** — untouched. `lib/staffSchedule.js` stays the
  one and only resolver.
- **`verificationEvidence()`, GPS and IP-range code** stay in the file but go dormant. Standing
  at the sensor replaces them. They are not deleted, because `verification_mode` is still a
  column other code reads.

## 6. Surfaces

### 6.1 Worker — `/staff/me`
The stamp buttons come off `StaffAttendanceCard.tsx` and `StaffAttendancePanel.tsx`. Today's
record stays, read-only, with the existing wording that lateness is shown but not deducted.
The API returns `403 ERR_ATTENDANCE_DEVICE_ONLY` with an Arabic message on the old endpoints —
already-installed app shells will keep calling them until their WebView reloads.

### 6.2 Admin — `/admin/attendance`, new tab «جهاز البصمة»
- Devices: serial, last seen, last IP, active toggle.
- PIN map: worker ↔ PIN, pushed name, push state.
- Unmapped punches: PIN, time, "assign to موظف" — resolving one re-runs §3 for that punch.

### 6.3 Admin — hand-entered stamp (**ships with the removal, §"consequence" above**)
`overrideRecord` can only edit a row that already exists; it cannot create one. A dead device,
a worker off-site, or a finger that will not read all need a way to create the row. Admin-only,
written with a flag marking it manual and the admin's id, so a hand-entered day is
distinguishable from a device-recorded one forever.

## 7. Build order

1. **Logging endpoint + serial allowlist.** Point the device at it and read what it actually
   sends (R1). Everything after this is written against that transcript.
2. Migration: the three tables in §1.
3. Reduction logic (§3) in a new `backend/lib/attendanceDevice.js`, with tests.
4. Command queue + name push (§4).
5. Admin panel (§6.2) and hand-entry (§6.3).
6. Frontend removal (§6.1) — same commit as step 5's hand-entry.
7. Caddy route on the box (R2), last.

## 8. Testing

`backend/test/` follows the existing pattern — run from `backend/` as `node --test test/*.test.js`.

Cases that must be covered, each of which is a way this feature silently breaks:
- A buffered upload arriving hours late computes lateness from the punch time, not arrival.
- A device re-uploading its whole buffer creates no duplicate stamps.
- Two punches in one shift produce one record with the later one as checkout.
- A punch at 00:10 on الجمعة's shift files under Friday, not Saturday (the midnight rule).
- A punch on a holiday records zero lateness.
- A punch from an unmapped PIN creates no attendance record and appears in the unmapped list.
- A punch from an unknown serial is dropped and answered `200`.
- Assigning an unmapped punch to a worker produces the record it would have produced live.
