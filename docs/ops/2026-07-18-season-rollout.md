# Season rollout — manual steps (run in this order, after the code deploy)

Owner-approved scope 2026-07-18: rate limits are deliberately UNCHANGED (owner decision).
**Emergency valve if a referral wave gets 429-blocked live:** raise `max` in
`backend/routes/join.js` (joinLimit/lookupLimit) and `backend/routes/auth.js`
(loginLimit) on the VPS + `pm2 reload loloshop-api` — takes minutes.

## 1. Nginx serves /uploads directly (VPS)

Add inside the server block of the loloshop site config (BEFORE the `/` proxy location):

    location /uploads/ {
        alias /var/www/loloshop/uploads/;
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
        add_header Content-Disposition attachment;
        add_header X-Content-Type-Options nosniff;
    }

Then: `nginx -t && systemctl reload nginx`
Verify: `curl -sI https://lolo-shop96.com/uploads/<any-existing-file> | grep -i cache-control`
(Express keeps serving /uploads as fallback — this only offloads it from Node.)

## 2. PM2 (VPS)

    pm2 install pm2-logrotate
    pm2 reload ecosystem.config.js --update-env   # picks up loloshop-worker + new memory caps
    pm2 save

Verify: `pm2 ls` shows **loloshop-api**, **loloshop-web**, **loloshop-worker** all online.
The worker consumes `calligraphy-generate` pg-boss jobs (schema `pgboss` on the shared
Neon DB — already created). If the worker is down, generation jobs WAIT in Postgres and
the calligraphy UI falls back to browser-driven generation after ~2 min of no progress.

## 3. Uptime monitoring (developer-only — deliberately NO admin surface)

UptimeRobot (or any free uptime service): HTTP monitor on
`https://lolo-shop96.com/api/health`, 1–5 min interval, alert contact = **developer's
email/Telegram only**. Nothing is shown to admin/staff accounts, per owner decision.

## 4. Post-deploy smoke

- `/api/health` → `ok:true`.
- Storefront loads; prices correct as anonymous AND as a rep-linked student
  (cache is keyed per audience/role — a mix-up would show retail prices to reps).
- Admin edits a product name → storefront shows it immediately (invalidation hook).
- Admin edits a rep's التسعيرة → rep's طقم form shows the new base immediately.
- Generate 2 calligraphy names → progress advances with NO /process calls in the
  network panel; plates finish even if the tab is closed mid-generation.
- `pm2 logs loloshop-api | grep "SLOW QUERY"` — note any offenders (>500ms queries).

## 5. Known accepted risks (owner-signed)

- Rate limits unchanged: a 1000-student referral wave behind carrier CGNAT can be
  throttled to ~10 joins/hour per carrier IP. Emergency valve above.
- In-process cache: TTLs ≤120s; money/settlement and approval-status reads are never
  cached. If PM2 cluster mode is ever enabled, memoCache + eventBus must move to a
  shared store first (comments in `backend/lib/memoCache.js` / `lib/eventBus.js`).
