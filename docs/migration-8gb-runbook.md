# Migration runbook — LoloShop → new 8 GB VPS (2026-08-15, cutover at 00:00)

Old box: `142.93.110.202` (2 GB, shared with khatuna + teacher + grand-layan).
New box: `<NEW_IP>` — fill in when provisioned. **LoloShop only moves; everything else
stays on the old box.**

The whole reason this is safe to do the night before a marketing push: the old box keeps
running untouched until the DNS flip, and DNS can be flipped straight back (TTL ~14 min).

---

## Phase 0 — BEFORE midnight (no impact on prod, do as early as possible)

1. **Provision** the 8 GB droplet, same region as the old box (keeps rsync fast and latency
   identical). Ubuntu 24.04. Add the laptop's SSH key AND the existing CI deploy public key
   (the one matching the `SERVER_SSH_KEY` GitHub secret) to `root`/deploy user —
   **reusing the same keypair means the cutover only changes the `SERVER_HOST` secret.**
2. **Install the stack** (match versions to the old box):
   - Node 20.x (old box runs Node 20 — check `node -v` there), npm, PM2 (`npm i -g pm2`)
   - PostgreSQL **17** (prod DB is LOCAL postgres on the VPS — not Neon; Neon is dev only)
   - nginx, git, certbot
3. **Clone the repo** to `/var/www/loloshop` (same path — `deploy.sh` and the CI script
   hardcode it). `npm ci` in `backend/` and `frontend/` to warm the caches.
4. **Copy the untracked state** from the old box (all invisible to git, all required):
   - `backend/.env` — **verbatim**. `JWT_SECRET` must not change or all 1,141 accounts are
     logged out. Also carries Zentramsg keys, `DEMO_LOGIN_*`, `APNS_*` paths.
   - `frontend/.env.local` — carries `ANDROID_SHA256_CERT_FINGERPRINTS`, `IOS_TEAM_ID`
     (the deep-link manifests are generated from these), `NEXT_PUBLIC_*` build-time vars,
     `STAFF_PORTAL_KEY` etc.
   - `/etc/loloshop/` — `AuthKey_72D98R3MFC.p8` + `fcm-service-account.json`.
     ⚠️ The `.p8` downloads from Apple exactly once; treat as irreplaceable
     (laptop backup: `~/Desktop/_private/loloshop-credentials/`).
   - `ecosystem.config.js` if it is not in the repo (check!), and the PM2 process list
     shape (`pm2 ls` on old box: `loloshop-api`, `loloshop-web`).
   - nginx site: `/etc/nginx/sites-available/lolo-shop96.com` (includes TODAY'S
     `/uploads` alias change — the repo mirror `nginx-ssl.conf` has it too).
   - `/etc/letsencrypt/` (whole dir) — copying the certs avoids a cert gap at cutover;
     renewals keep working since certbot state rides along.
5. **Pre-sync the uploads** (5 GB / 7,178 files — this is the slow part, do it NOW):
   `rsync -a old:/var/www/loloshop/uploads/ /var/www/loloshop/uploads/`
   A second delta rsync at cutover takes seconds.
6. **Restore a DB snapshot for rehearsal**: `pg_dump -Fc` from old → `pg_restore` on new
   (DB is ~32 MB, takes seconds). Create the same DB name/user/password as `backend/.env`
   expects.
7. **Boot everything on the new box** (PM2 api + web, nginx) and smoke-test WITHOUT DNS:
   from the laptop: `curl -k --resolve lolo-shop96.com:443:<NEW_IP> https://lolo-shop96.com/`
   — home page renders, `/api/...` answers, an image under `/uploads/...` serves from
   nginx, and BOTH manifests return 200 `application/json` with zero redirects:
   `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association`, on apex
   **and** `www` (Digital Asset Links does not follow redirects — a 301 here silently
   breaks `/join/` deep links).
8. Optional but smart: **drop the DNS TTL** on the A records to 300 now, so the flip
   propagates in minutes.

## Phase 1 — cutover (00:00, ~10 minutes of write-freeze, site stays readable)

1. On the OLD box: `pm2 stop loloshop-api` — freezes writes (web stays up; students see
   the site, API calls fail for a few minutes at the quietest hour).
2. Final data sync: `pg_dump -Fc` old → `pg_restore --clean` new, then delta
   `rsync -a uploads/`.
3. On the NEW box: restart api (`pm2 restart loloshop-api`), sanity-check the
   `--resolve` curls again (login via demo phone, one catalog page, one upload image).
4. **Flip DNS**: `lolo-shop96.com` + `www` A records → `<NEW_IP>`.
5. Verify from the laptop (and a phone on mobile data once TTL passes): HTTPS, login,
   images, both `.well-known` manifests, `/admin` gateway chip.
6. Leave the OLD box exactly as it is (api stopped, web up) — it is the rollback:
   flipping DNS back restores yesterday's world in ~15 min.

## Phase 2 — deploy today's code (after DNS flip)

1. GitHub → repo secrets → set `SERVER_HOST=<NEW_IP>` (user/key/port unchanged if the
   same deploy key was installed).
2. `git push origin main` from the laptop — CI runs backend + frontend jobs, then
   `deploy.sh` on the NEW box: `git reset --hard origin/main`, `npm ci`, **`npm run
   migrate` (applies migration 081 — counter-signup column)**, `next build`, PM2 reload.
3. Post-deploy verification on prod:
   - `/admin` shows the gateway chip + «يعمل الآن» panel
   - staff sidebar shows «تسجيل طالب في المحل» for a manager
   - `/staff/queue` search finds an التطريز text
   - one real OTP send still works (register a throwaway or use resend on a test account)
   - `push.configured()` still `{"android":true,"ios":true}` (APNs key path valid on new box)
4. Add `ZENTRAMSG_DEVICE_UUID_2` to the new box's `backend/.env` + restart — arms the
   backup WhatsApp device for Sunday.

## Rollback at any point

DNS back to `142.93.110.202` + `pm2 start loloshop-api` on the old box. Nothing on the
old box is modified by this runbook, so rollback is always available until the old box is
retired. Retire it no earlier than a full quiet day after the flip.

## Explicitly NOT part of tonight

- Grand Layan / khatuna / teacher — stay on the old box, untouched.
- The «browsers may cache uploads» decision (§4.3 of the 2026-08-15 spec) — separate call.
- Any change to `joinLimit`-class values — they rode today's code.
