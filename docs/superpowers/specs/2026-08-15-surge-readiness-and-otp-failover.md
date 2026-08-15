# Surge readiness, OTP failover, and counter signup — 2026-08-15

**Deadline: Sunday 2026-08-16.** The owner expects a large intake of students starting Sunday.

**The app is LIVE with real users.** Every rule in §0 exists because of that, and none of them
is optional.

---

## §0 — Safety rules for this session

1. **Merging to `main` IS deploying.** `.github/workflows/ci.yml:46-58` runs `scripts/deploy.sh`
   over SSH the moment the backend + frontend jobs pass. There is no separate "deploy" step to
   forget or to hold back. Nothing reaches `main` until it is verified.
2. **Back up the prod DB before the first change**, not after the first scare.
3. **Prod is read-only during investigation.** `SELECT` only. No `UPDATE`, no `DELETE`, no
   migration, until a change is explicitly approved.
4. **Add zero npm dependencies.** Both CI jobs run
   `npm audit --omit=dev --audit-level=moderate`, so a new package carrying any advisory blocks
   the deploy — including the ones we need on Sunday.
5. **One change at a time, verified before the next.** Not one big merge.
6. **Every new limit is env-tunable.** During the surge the owner must be able to change a
   number with `pm2 restart --update-env` and no deploy, no laptop, and no waiting for me.
7. **No infra migration.** There is no second server — Grand Layan runs on this same box
   (`grand/grandlayan/scripts/deploy-to-vps.sh:9`). Hardening replaces migrating.

---

## §1 — What was measured (not assumed)

Gathered 2026-08-15 from the repo and over SSH from prod `142.93.110.202`.

### The box
| Fact | Value | Meaning |
|---|---|---|
| RAM / vCPU | **2 GB / 2** | Shared with khatuna + teacher + grand-layan |
| Swap in use | **592 MB** | Memory pressure is already real |
| OOM kills | **none**; `unstable restarts: 0`; 19h uptime | Box is *stable*, but has **no headroom** |
| Postgres | 100 max conns, 9 in use, **DB is 32 MB** | Not a bottleneck |
| Uploads | **5.0 GB / 7,178 files** | See the finding below |
| Disk | 21% of 87 GB | Fine |
| DNS TTL | 839s | (Was only relevant to a migration; migration is now off) |

### Finding A — every image is served by Node, and cached by nobody
`nginx sites-available/lolo-shop96.com:52-59` proxies `/uploads/` to Express on :4000, and
`backend/server.js:64-75` answers with `express.static` + `Cache-Control: private, no-store`.

So all 5 GB of student photos, logos, calligraphy plates and catalog shots pass through **the
same single-threaded event loop that serves OTP, login and orders**, and `no-store` makes every
student re-download them on every page view.

That `express.static` has **no auth guard** — uploads are already public to anyone holding the
URL. So moving them to nginx removes no protection that exists.

### Finding B — the per-IP rate limits lock out a cohort
Iraqi carriers CGNAT: one public IP is routinely a whole cohort, not one student.

| Endpoint | Current | The control that still holds if the IP cap is raised |
|---|---|---|
| `/register`, `/resend-otp`, `/forgot-password-phone` | **5/hr/IP** (`routes/auth.js:14`) | `otp_send_events` — **5/hr per phone**, advisory-locked (`lib/otp.js:147-152`) |
| `/verify-otp`, `/login-verify` | 10/15m/IP (`:15`) | `MAX_OTP_ATTEMPTS = 5` **per challenge** (`lib/otp.js:197`) |
| `/login` | 20/15m/IP (`:13`) | `accountLoginLimit` — 10/15m **per phone**, hashed, skips successes |
| `POST /join/:code` | **10/hr/IP** (`routes/join.js:14`) | Unique-phone check + the rep approving one by one |

In every row the real protection is per-phone or per-challenge and **IP-independent**, so
raising the IP cap does not remove it.

**`POST /join/:code` sends no WhatsApp message** — `joinController.js` validates, checks
uniqueness (`:119`) and inserts (`:138`). Raising `joinLimit` therefore **cannot** increase
gateway load or ban risk. That was the only reason to fear it.

### Finding C — trust-proxy is correct
`server.js:40` (`trust proxy`) + nginx setting `X-Forwarded-For` (`:48`) means `req.ip` is the
real client IP. The limiters are per-carrier-IP, **not** one global bucket. No bug here.

---

## §2 — Track 1: Zentramsg primary + backup  *(Sunday-critical)*

**Owner correction, 2026-08-15, and it changed the design:** round-robin is wrong. A student
who requests a resend would get code 1 from number A and code 2 from number B — which reads as
a phishing attempt at the worst possible moment. Students routinely get 2–3 codes.

**Design — one number does everything until it can't:**

1. `ZENTRAMSG_DEVICE_UUID` stays **primary**. New `ZENTRAMSG_DEVICE_UUID_2` is the **backup**,
   idle. Same `ZENTRAMSG_API_KEY` (owner confirmed: one account, two devices).
2. Every send goes to the primary. The backup is used **only** when the primary's response is
   not `accepted`.
3. **No flapping back.** If we fail over and drift back an hour later, students still see two
   numbers — just more slowly. Once the backup takes over it *stays* the sender.
4. Cool the primary down **only if the backup then succeeds** — that success is the proof the
   fault was the device and not a bad recipient number. If both fail, cool down nothing and
   return today's `{success:false}` shape. This deliberately avoids inventing an error taxonomy
   for Zentramsg's `msg`/`errors` that I cannot verify against their API.
5. `gatewayStatus()` + logs naming the device, so a ban is **visible** on Sunday, not silent.
6. Tests with a stubbed `fetch`: failover, no-flap, cooldown-only-on-proven-failure, both-down,
   and **single-device config behaves exactly as today**.

**Risk: none until the owner adds `ZENTRAMSG_DEVICE_UUID_2` to the prod `.env`.** With only the
existing var set, behaviour is unchanged.

---

## §3 — Track 2: surge limits  *(Sunday-critical)*

Raise/re-key per Finding B, every value env-tunable with today's value as the fallback.

| Endpoint | From | To | Env var |
|---|---|---|---|
| `/register`, `/resend-otp`, `/forgot-password-phone` | 5/hr | 60/hr | `OTP_IP_MAX_PER_HOUR` |
| `/verify-otp`, `/login-verify` | 10/15m | 100/15m | `OTP_VERIFY_IP_MAX` |
| `/login` | 20/15m | 100/15m | `LOGIN_IP_MAX` |
| `POST /join/:code` | 10/hr | **100/hr** | `JOIN_MAX_PER_HOUR` |

⚠️ **`joinLimit` needs an explicit owner yes.** HANDOFF records 10/hr as a deliberate owner
ruling (2026-08-07, anti-spam on the rep approval queue). The case for raising it is Finding B:
no WhatsApp exposure, each abusive signup costs a unique valid Iraqi number, and the rep
approves one at a time — against a whole cohort locked out on the biggest day of the year.
Env-tunable means it drops back to 10 in one restart if junk appears.

---

## §4 — Track 3: box hardening  *(Sunday-critical — replaces the migration)*

1. **Serve `/uploads/` from nginx** with `alias`, keeping the **same headers** (`private,
   no-store`, `nosniff`, `Content-Disposition: attachment`) and the same access. Pure
   subtraction: 5 GB of image traffic stops occupying the event loop that serves logins.
   Config-only — no deploy, `nginx -t` first, revertible in seconds.
2. **`loloshop-web`'s `max_memory_restart` is 1 GB on a 2 GB box** — it can never fire before
   the box is already thrashing. Lower it to a value that actually guards.
3. **Deferred, separate owner decision:** letting *browsers* cache uploads (`private, max-age`
   instead of `no-store`) would cut repeat load enormously on Iraqi mobile, but `no-store` was
   written so customer artwork does not linger on a shared family phone after logout. Real
   trade-off, not urgent, not bundled into item 1.

---

## §5 — Track 4: signup at the counter *(replaces the GPS idea)*

**Owner's observation:** ~50%+ of students create their account physically at the shop with
staff. **Owner's proposal:** skip the OTP when the phone's GPS says it is near the shop.

**Why the GPS mechanism cannot do this job:** the server never observes location — the client
*states* it. The request is `{"phone":"…","lat":33.749,"lng":44.618}`; there is no signature and
nothing to check those numbers against. "Skip OTP near the shop" is therefore operationally
"skip OTP for anyone who reads the API," and mock-location apps defeat even the honest path.
What that would cost, flow by flow: at **register**, anyone could squat a real person's number,
who could then never register (`joinController.js:119`); at **login** it drops the second factor
to password-only; at **reset** the OTP is the *sole* credential and must never be bypassed
(`lib/otp.js:66`).

**The stronger anchor is already in the owner's own description: the staff member standing
there.** Authenticated, accountable, and looking at the student's face.

**Design:** a logged-in staff member creates the student's account at the counter →
`phone_verified = TRUE`, no OTP sent. **This pattern already exists in this codebase** —
`adminController.js:344` creates a wholesaler with `phone_verified = TRUE` and no OTP on the
authority of an admin session; `createStaff` does the same. This extends an established,
already-trusted pattern rather than inventing a location check.

What it buys over the GPS version:
- Cannot be abused remotely — needs staff credentials, not two numbers anyone can type.
- **Auditable:** every counter-created account records *which* staff member vouched.
- **Removes the WhatsApp message for ~50% of signups** — a larger cut to ban risk than the
  second device provides.
- **Still works while the gateway is banned**, the outage that currently dead-ends all signup.

**GPS keeps a role — as evidence, never as permission:** record the staff device's location on
each counter signup, so accounts appearing from someone's house at 2am are visible.

**Step 0 before designing further: measure the real percentage.** The owner said "50% or more";
that number should come from the database, not an estimate. Needs one read-only prod query
splitting student accounts and orders into rep-linked vs walk-in retail. Interrupted before it
ran; it is the first thing to do in this track.

Needs a migration (who vouched) + a counter screen → **design properly, do not rush before
Sunday.**

---

## §6 — Track 5: finish the client

Ranked, after the Sunday work lands:

1. **Merge `fix/admin-presence-panel`** — closes the last 2 of the eleven bugs. 275/275 tests,
   but **never opened in a browser**. Needs one browser pass on three surfaces before merging,
   because merging deploys it.
2. **«لولو» the AI assistant** — `fix/ai-assistant-money` is correct but parked; merging ships
   the whole assistant. Owner call, not a code question.
3. **The reroll geometry ratchet** — `calligraphyController.js:472`; ink height is monotone
   non-increasing and cannot recover. Needs migration 081.
4. **`configureOrder` / `configureFullSet` plate loss** — same defect class already fixed in
   `lib/fullSetOrder.js`; refuted on reachability, not on safety.
5. Smaller: 12 `next/image unoptimized` files · drop `jspdf` · wire `gender` to the DB ·
   the «لبسوا تصاميمنا» caption.

**⚠️ Time-boxed and unrelated to Sunday: `DEMO_LOGIN_EXPIRES_AT` expires 2026-08-21.** Past that
date the App Store reviewer's login hits the OTP wall and the submission fails.

---

## §7 — SCOPE CHANGE, 2026-08-15: finish the client TODAY

**Owner ruling:** today is the last LoloShop working day. Scope is no longer "survive Sunday" —
it is **everything, items 1–7 below, ~6h** (~4.5h with subagents on the mechanical parts).

**«لولو» the AI assistant moved to LAST and changed shape.** Owner: *"i want it but it is still
bad and need a lot of edits so let's finish everything and work on it because i have a new idea
for it."* So item 7 is **not** a merge — it is a rework session driven by an idea the owner has
not described yet. Do not merge `fix/ai-assistant-money` as a shipping step; it is the starting
point for that rework. **Ask the owner for the idea before touching it.**

### The 7 items

| # | Item | Est. | State |
|---|---|---|---|
| 1 | Zentramsg primary+backup failover (§2) | 30m | **Written. 7/8 tests pass, 1 failing, undiagnosed.** |
| 2 | Surge rate limits (§3) | 20m | Not started |
| 3 | Merge `fix/admin-presence-panel` — closes the **last 2 of 11 bugs**; needs a browser pass on 3 surfaces first | 40m | Branch ready, never opened in a browser |
| 4 | Counter signup — staff creates a student account, no OTP (§5) | 90m | Designed, not started. Needs a migration. |
| 5 | Mechanical sweep: `unoptimized` images · «لبسوا تصاميمنا» caption · drop `jspdf` · wire `gender` to DB | 45m | **3 of 4 DONE** (subagent). `gender` wiring still open. |
| 6 | Reroll ink-shrink ratchet — needs **migration 081** | 60m | Not started |
| 7 | «لولو» rework — **owner's new idea, not yet described** | ? | Blocked on the owner |

### Already done this session

- ✅ **Prod DB backed up** — `/var/backups/loloshop/predeploy-20260815-1638.dump` (3.6 MB).
- ✅ **`/uploads` moved to nginx — LIVE ON PROD AND VERIFIED.** Response is byte-identical
  (same SHA256, same content-length, all four headers), missing files still 404, path traversal
  refused, `logos/` and `images/` both 200. Rollback: copy back
  `/root/nginx-loloshop-backup-20260815-1641.conf` and `systemctl reload nginx`.
  Repo's `nginx-ssl.conf` updated too, so a future re-copy cannot silently revert it.
- ✅ **Walk-in measurement** (§5 step 0), read-only: **1,684 students, 39.1% walk-in all-time —
  but 65.6% in August**, up from 35.2% (Jul) and 27.5% (Jun). ⚠️ `wholesaler_id IS NULL` means
  "no rep", which includes self-service retail as well as people at the counter, so 65.6% is the
  **ceiling** of the counter-signup opportunity, not a proven floor. It is enough to justify
  item 4.
- ✅ **Frontend sweep** (subagent, local + uncommitted): 8 `unoptimized` props removed — each
  `src` traced to a server URL, none reachable by `blob:`/`data:`; caption now «طالب وطالبة
  سجّلوا معنا»; `jspdf` removed, 21 packages out of the lockfile (takes the dompurify chain out
  of the `npm audit` deploy gate). `tsc --noEmit` clean, lint 0 errors.

### ❌ Dropped, deliberately — do not reinstate without new evidence

**The PM2 `max_memory_restart` change (was §4.2).** `loloshop-web` sits at **35.8 MB** against a
1 GB cap, with no OOM kills, `unstable restarts: 0`, and 19h clean uptime. Lowering the cap
cannot help a leak that is not happening, but it **can** restart the web process at peak load
and drop students mid-signup. That trades a hypothetical for a real new failure mode on the day
we are protecting. Leave it; watch it instead.

### Execution rule (unchanged and load-bearing)

**Parallel in writing, strictly serial in shipping.** Subagents may write code concurrently, but
merges happen one at a time with verification between, because merging to `main` auto-deploys to
a live app. Never run concurrent agents that merge.

**No new Claude sessions** — the laptop is 8 GB and the owner's own hardware rule is one session
at a time. Subagents (in-process) are fine.

---

## §7b — HANDOFF TO THE NEXT SESSION (written 2026-08-15, mid-work)

**Read this first. The owner is switching sessions to work with Fable 5.**

### What is LIVE on prod right now

**Exactly one thing:** `/uploads` is served by nginx instead of Node (§4.1). Verified: same
SHA256, same content-length, same four headers, 404s still 404, traversal refused.
**Rollback:** `cp /root/nginx-loloshop-backup-20260815-1641.conf
/etc/nginx/sites-available/lolo-shop96.com && systemctl reload nginx`.
⚠️ One honest correction to an earlier claim of "byte-identical": helmet's
`Cross-Origin-Resource-Policy: cross-origin` header no longer rides `/uploads` responses,
because helmet runs in Express and Express is no longer in that path. Same-origin use is
unaffected; **verify images still render inside the Capacitor apps** before trusting it fully.

### What is UNCOMMITTED on branch `fix/otp-failover-and-surge` (off `main`)

Nothing is pushed. **A push to `main` auto-deploys**, so none of this has reached users.

| Item | Files | Gate |
|---|---|---|
| 1 — OTP failover | `backend/lib/otp.js`, `backend/test/otpGatewayFailover.test.js` | 8/8 new tests pass |
| 2 — surge limits | `backend/routes/auth.js`, `backend/routes/join.js` | in the 274/274 run |
| 4 — counter signup | `backend/controllers/counterSignupController.js`, `backend/routes/staff.js`, `backend/controllers/authController.js`, `db/migrations/081_counter_signup.sql`, `db/schema.sql`, `backend/test/counterSignup.test.js` | 9/9 new tests pass |
| 5 — frontend sweep | 7 `frontend/` files + `package.json`/`package-lock.json` | tsc clean, lint 0 errors |
| — | `nginx-ssl.conf` (mirrors the live change so a re-copy cannot revert it) | applied + verified |

**Full backend suite: 274/274** (266 on `main` + 8 failover). The 9 counter-signup tests were
added after that run — **re-run `node --test test/` from `backend/` before merging anything.**

⚠️ **Migration 081 is applied to the DEV database only.** Prod gets it via
`scripts/deploy.sh` → `npm run migrate` on the deploy that carries item 4.

### What a Fable 5 review found that is NOT yet fixed

Ranked. The first two are the ones that bite.

1. **[SECURITY — must fix before item 4 ships] A typo'd phone at the counter creates a
   stranger-owned account-takeover path.** OTP-verified registration cannot produce this (a
   mistyped number simply never receives the code). Counter signup has no such check, so a
   fat-fingered digit means `forgot-password-phone` later sends the reset OTP — *the sole
   credential for reset* — to whoever really owns that number, handing them the student's
   account, photos and orders. **Fix: phone double-entry on the counter screen** (and consider
   requiring a matching `phone_confirm` server-side so the API cannot be used without it).
2. **[SCOPE — swap these] Item 6 is the WRONG calligraphy bug.** The plan scheduled the reroll
   *ratchet* (cosmetic: costs letter height, converges, needs a migration) and dropped the
   `configureOrder` / `configureFullSet` **plate loss** (`orderController.js:630`, `:1140`) —
   the identical defect class that already destroyed 459 plates in prod, refuted only on
   *reachability* and never on safety, and fixable by copying the shipped `lib/fullSetOrder.js`
   pattern with **no migration**. Ship the data-destruction guard; drop the ratchet.
3. **`gatewayStatus()` is exported and wired to nothing.** §2.5 promised a ban would be visible
   on Sunday; as it stands that means tailing PM2 logs over SSH, which will not happen
   mid-surge. Needs an admin endpoint or a dashboard chip.
4. **Failover detection gap, worth writing down rather than coding around:** it triggers only
   on API-level rejection. A banned device that still *accepts* messages into a queue and never
   delivers them looks healthy forever. The manual answer is to swap the two env UUIDs, or set
   `OTP_DEGRADED_UNTIL`. Also: failover state is in-memory, so every deploy resets to the
   banned primary for one failed POST, and `DEVICE_COOLDOWN_MS` is hardcoded (violates §0.6 —
   should be env-tunable).
5. **§3's table under-reports what it raises:** `reset-password-phone` shares `verifyLimit` and
   `staff-portal-login` shares `loginLimit`, so six endpoints changed, not four. Per-challenge
   and per-account guards still hold, so impact is low — but the spec should say six.
6. **`OTP_DEGRADED_UNTIL` already exists as the Sunday break-glass** if the gateway is banned
   and item 4 is not finished. One env edit + `pm2 restart`. This is the documented fallback.

### ⭐ The protected item — do not cut this

**An owner closeout sheet, in Arabic, one page.** Every *code* omission here is recoverable by a
future dev reading `HANDOFF.md`. The **owner-action traps are not**, and two fail silently:

1. **Both app stores sit APPROVED BUT UNPUBLISHED** until a human presses publish — Android
   because «النشر المُدار» is on, iOS because it is set to manual release. Nothing will ever
   remind them.
2. **`DEMO_LOGIN_EXPIRES_AT` dies 2026-08-21**, six days out; past it the App Store reviewer
   login hits the WhatsApp wall and the submission fails.
3. Coordinates at `/admin/attendance` **before** moving `verification_mode` off `'none'`.
4. **8 of 10 تجزئة piece rates still pay the wholesale wage** — a live payroll error.
5. TestFlight install + notification grant (needs an iPhone; zero iOS device tokens exist).
6. Play Data Safety + Apple privacy labels; rotate `STAFF_PORTAL_KEY`; 12 university-name rows;
   an off-site DB copy.
7. The new env vars: `ZENTRAMSG_DEVICE_UUID_2`, and the four surge limits
   (`OTP_IP_MAX_PER_HOUR`, `OTP_VERIFY_IP_MAX`, `LOGIN_IP_MAX`, `JOIN_MAX_PER_HOUR`) with their
   rollback values.

## §8 — Open decisions

| # | Decision | State |
|---|---|---|
| 1 | Raise `joinLimit` 10 → 100/hr? (§3) | ✅ **Owner approved 2026-08-15** |
| 2 | Counter signup instead of GPS? (§5) | ✅ **Resolved by measurement** — 65.6% of August signups have no rep, so it is worth building. Owner was unsure; the data decided it. |
| 3 | Let browsers cache uploads, accepting artwork lingering on a shared phone? (§4.3) | ⏳ Owner: *"if we have a time let's do it"* — approved, low priority |
| 4 | **What is the new idea for «لولو»?** | ❌ **BLOCKING item 7. Owner has not described it.** |
