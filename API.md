# LoloShop — API Contract

Base URL: `http://localhost:4000/api` (dev) — env var `NEXT_PUBLIC_API_URL`

All responses JSON. Auth via `Authorization: Bearer <jwt>` header.
Errors: `{ error: "message_ar", code: "ERR_CODE" }` with HTTP status.
Success: `{ data: ... }` or direct object.

Currency: IQD (integer). Times: ISO 8601 UTC.

---

## Auth

### POST `/auth/register`
Register retail student (not via referral) OR initial step.
```json
// req
{ "name": "محمد علي حسين", "phone": "07701234567", "email": "m@x.com", "password": "...", "role": "retail" }
// res 201
{ "data": { "user_id": "uuid", "otp_required": true, "challenge_id": "uuid" } }
```

> **OTP flows are challenge-bound.** A `challenge_id` is a secret issued only by a server
> flow that already proved something (a correct password for login, a just-created account
> for registration). Every verify endpoint is addressed **by challenge, never by phone**, so
> a caller can't choose which account it authenticates. Sending `{phone, code}` is no longer
> a login. See migration `066` / security finding LS-01.

### POST `/auth/login`
```json
// req
{ "phone": "07701234567", "password": "...", "device_token": "optional" }
// res 200 — trusted device / rep-linked student / demo phone: straight in
{ "token": "jwt...", "user": { "id": "uuid", "name": "...", "role": "admin|staff|wholesaler|retail", "phone_verified": true } }
// res 200 — otherwise: OTP sent, second factor required
{ "otp_required": true, "phone": "07701234567", "challenge_id": "uuid" }
```

### POST `/auth/login-verify`
```json
// req — no phone: the challenge determines the account
{ "challenge_id": "uuid", "code": "123456" }
// res 200
{ "token": "jwt...", "device_token": "...", "user": { "id": "uuid", "name": "...", "role": "...", "phone_verified": true } }
```

### GET `/auth/me`
Header: `Authorization: Bearer <jwt>`
```json
// res 200
{ "id": "uuid", "name": "...", "phone": "...", "email": "...", "role": "...", "phone_verified": true }
```

### PATCH `/auth/me`
Header: `Authorization: Bearer <jwt>`. Writes `students.gender` — the field `/auth/me` already
returns but that, until now, nothing could set server-side (onboarding only ever wrote it to
`localStorage`). Only succeeds for an account with a `students` row (retail); every other role
gets 404.
```json
// req
{ "gender": "male" }
// res 200
{ "data": { "gender": "male" } }
// res 400 — missing/invalid value
{ "error": "الجنس غير صالح", "code": "ERR_VALIDATION", "field": "gender" }
// res 404 — no students row for this account
{ "error": "لا يوجد ملف طالب مرتبط بهذا الحساب", "code": "ERR_NOT_FOUND" }
```

### POST `/auth/verify-otp`
Finishes **registration** only. Refuses (403) any account whose role isn't `retail`, so it
can never hand back a privileged session.
```json
// req
{ "challenge_id": "uuid", "code": "123456" }
// res 200
{ "verified": true, "token": "jwt...", "device_token": "..." }
```

### POST `/auth/resend-otp`
Re-sends the code for an **existing** challenge; phone and purpose are read from that
challenge, not from the caller. The code and expiry are refreshed **in place** — the
`challenge_id` is unchanged, so a lost response can't strand the client on a dead id.
Counts against the same per-phone hourly send budget (`429 ERR_OTP_RATE`). An already-used
or unknown challenge returns 400 rather than being revived.
```json
{ "challenge_id": "uuid" }
// res 200 — same id back
{ "sent": true, "expires_in": 300, "challenge_id": "uuid" }
```

### POST `/auth/forgot-password-phone`
Only `retail` and `wholesaler` may reset by phone OTP (allow-list). Everyone else —
`admin`, `staff`, `worker`, `design_helper` — must be reset by an administrator or with
the server-side `npm run set-password` tool, since one intercepted WhatsApp message would
otherwise be full account takeover.
A `challenge_id` comes back for **any** number (a decoy when there's no eligible account),
so this response alone doesn't reveal registration. It is **not** a general enumeration
defence — `/auth/register` still answers that with `409 ERR_PHONE_TAKEN`.
```json
{ "phone": "07701234567" }
// res 200 (always — don't leak existence)
{ "sent": true, "challenge_id": "uuid" }
```

### POST `/auth/reset-password-phone`
```json
{ "challenge_id": "uuid", "code": "123456", "password": "newpass" }
// res 200
{ "reset": true }
// res 403 — privileged role (defence in depth alongside forgot-password-phone)
{ "error": "غير مصرح", "code": "ERR_FORBIDDEN" }
```

---

## Join (Referral)

### GET `/join/:code`
Public — returns wholesaler info for landing page.
```json
{ "wholesaler_name": "أحمد كريم", "university_hint": "جامعة بغداد", "valid": true }
```

### POST `/join/:code`
Rate limited (10/hour/IP).
```json
// req
{ "name": "محمد علي حسين", "phone": "07701234567", "email": "m@x.com", "password": "...", "university_name": "جامعة بغداد", "department": "علوم حاسوب" }
// res 201
{ "data": { "user_id": "uuid", "status": "pending_approval", "message_ar": "طلبك بانتظار موافقة الممثل" } }
```

---

## Admin (role=admin only)

### GET `/admin/analytics`
```json
{
  "totals": { "revenue": 12500000, "cost": 5000000, "profit": 7500000, "orders": 42 },
  "by_status": { "designing": 5, "design_complete": 10, "printing": 8, "delivered": 19, "cancelled": 0 },
  "daily": [{ "date": "2026-05-20", "orders": 3, "revenue": 900000 }, ...],
  "top_wholesalers": [{ "id": "uuid", "name": "أحمد", "order_count": 87 }, ...]
}
```

### GET `/admin/orders?wholesaler_id=&status=&from=&to=`
```json
{
  "data": [{
    "id": "uuid",
    "student_full_name": "محمد علي حسين",
    "product_name": "وشاح أبيض",
    "wholesaler_name": "أحمد",
    "price": 50000, "cost": 20000, "profit": 30000,
    "status": "printing",
    "created_at": "2026-05-20T10:00:00Z"
  }]
}
```

### PATCH `/admin/orders/:id/cost`
```json
// req
{ "cost": 20000 }
// res 200
{ "data": { "id": "...", "cost": 20000, "profit": 30000 } }
```

### GET `/admin/wholesalers`
```json
{
  "data": [{
    "id": "uuid",
    "name": "أحمد كريم",
    "phone": "077...",
    "referral_code": "baghdad-cs-2026",
    "referral_url": "https://loloshop.com/join/baghdad-cs-2026",
    "student_count": 87,
    "pending_count": 5,
    "deadline": "2026-06-15T00:00:00Z",
    "created_at": "..."
  }]
}
```

### POST `/admin/wholesalers`
```json
// req
{ "name": "أحمد كريم", "phone": "07701234567", "email": "a@x.com", "password": "temp123", "referral_code": "baghdad-cs-2026", "deadline": "2026-06-15" }
// res 201
{ "data": { "id": "uuid", "referral_url": "..." } }
```

### PATCH `/admin/wholesalers/:id/deadline`
```json
// req
{ "deadline": "2026-07-01" }   // OR { "extend_days": 14 }
// res 200
{ "data": { "id": "...", "deadline": "2026-07-01T00:00:00Z" } }
```

### GET `/admin/wholesalers/:id/students`
```json
{ "data": [{ "id": "uuid", "name": "...", "status": "approved", "order_status": "designing" }] }
```

### POST `/admin/students/:id/edit-exception`
Toggle `edit_exception` flag.
```json
{ "data": { "id": "...", "edit_exception": true } }
```

### GET `/admin/staff/:id/salary`
Returns salary summary for a staff member. `balance = base_salary + SUM(bonus) - SUM(deduction)`.
```json
{
  "data": {
    "user_id": "uuid",
    "base_salary": 500000,
    "balance": 550000,
    "transactions": [
      { "id": "uuid", "type": "bonus", "amount": 50000, "reason_ar": "جهد إضافي", "created_by": "uuid", "created_at": "..." },
      { "id": "uuid", "type": "salary_set", "amount": 500000, "reason_ar": null, "created_by": "uuid", "created_at": "..." }
    ]
  }
}
```

### POST `/admin/staff/:id/salary`
UPSERT base salary + record a `salary_set` transaction. Returns updated summary.
```json
// req
{ "base_salary": 500000 }
// res 200
{ "data": { "user_id": "...", "base_salary": 500000, "balance": 500000, "transactions": [...] } }
```

### POST `/admin/staff/:id/salary/bonus`
Add a bonus transaction. Returns updated summary.
```json
// req
{ "amount": 50000, "reason_ar": "جهد إضافي" }
// res 200
{ "data": { "user_id": "...", "base_salary": 500000, "balance": 550000, "transactions": [...] } }
```

### POST `/admin/staff/:id/salary/deduction`
Add a deduction transaction. Returns updated summary.
```json
// req
{ "amount": 25000, "reason_ar": "تأخر" }
// res 200
{ "data": { "user_id": "...", "base_salary": 500000, "balance": 525000, "transactions": [...] } }
```

### GET `/admin/otp-gateway`
Read-only status of the WhatsApp OTP sender device(s) — which one is currently active and
whether one has been cooled down after a failed send (see `backend/lib/otp.js`'s failover
design). Does not accept params; shape is owned by `lib/otp.js`'s `gatewayStatus()`.
```json
{
  "data": {
    "configured": 2,
    "active": "abc123…",
    "devices": [
      { "device": "abc123…", "healthy": true, "cooled_until": null, "sent": 41, "failed": 0 },
      { "device": "def456…", "healthy": true, "cooled_until": null, "sent": 0, "failed": 0 }
    ]
  }
}
```

### GET `/admin/staff/:id/activity?month=YYYY-MM`
One shared builder (`backend/lib/staffActivity.js`) behind this AND `/payroll/me/activity` below.
Returns up to 500 rows for one calendar month (default: current month, Asia/Baghdad), newest
first, from TWO sources UNIONed together: `staff_activity_log` (stage moves, `source: 'stage'`)
and `audit_log` (embroidery-zone ticks and a few other order actions, `source: 'audit'`) — the
embroiderer's actual daily work is zone ticks, which never wrote to `staff_activity_log`. A bad
`month` is a 400 `ERR_VALIDATION`, never a 500.
```json
{
  "data": [
    {
      "id": "uuid",
      "source": "audit",
      "action": "embroidery_zone",
      "from_stage": null,
      "to_stage": null,
      "zone": "sash_back",
      "created_at": "...",
      "order_id": "uuid",
      "product_name": "وشاح تخرج",
      "student_name": "محمد علي",
      "month": "2026-09"
    },
    {
      "id": "uuid",
      "source": "stage",
      "action": "advance",
      "from_stage": "embroidery",
      "to_stage": "pressing",
      "zone": null,
      "created_at": "...",
      "order_id": "uuid",
      "product_name": "وشاح تخرج",
      "student_name": "محمد علي",
      "month": "2026-09"
    }
  ],
  "meta": { "month": "2026-09" }
}
```

---

## Payroll (role=admin or staff — self-service)

### GET `/payroll/me/salary`
Staff member reads their own salary summary (same shape as admin endpoint above).

### GET `/payroll/me/activity?month=YYYY-MM`
Staff member reads their own activity log (same builder and shape as the admin endpoint above).

---

## Staff (role=staff, `requireStaffType()`)

### POST `/staff/counter-signup`
A staff member creates a student's account in person at the shop counter, no WhatsApp OTP —
the authenticated staff session is the authorisation (see `backend/controllers/counterSignupController.js`
for the full rationale). `phone_confirm` is **required**: the staff member must type the phone
twice and both must canonicalise to the same number (`7712345678` and `07712345678` match).
This is the only guard against a mistyped phone silently creating the account on a stranger's
number — a real risk here because `forgot-password-phone` later sends the reset OTP, the sole
reset credential, to whoever owns that number. `phone_verified` stays `false`: the employee
vouched for the person, not the phone.
```json
// req
{
  "name": "محمد علي حسين",
  "phone": "07701234567",
  "phone_confirm": "07701234567",
  "password": "...",
  "university_name": "جامعة ديالى",
  "department": "هندسة",
  "gender": "male",
  "study_type": "morning",
  "instagram_username": "optional"
}
// res 201
{ "data": { "user_id": "uuid", "student_id": "uuid", "name": "...", "phone": "07701234567", "otp_required": false } }
// res 400 — missing or mismatched confirm
{ "error": "رقم الهاتف غير متطابق — يرجى التأكد من الرقم مع الطالب", "code": "ERR_PHONE_MISMATCH", "field": "phone_confirm" }
// res 409 — phone already registered
{ "error": "هذا الرقم مسجّل مسبقاً باسم «...» — سجّل دخوله بدل إنشاء حساب جديد", "code": "ERR_PHONE_TAKEN", "field": "phone", "student_id": "uuid|null" }
```
The resulting account then logs in via `POST /auth/login` with password alone — no OTP
challenge — the same as a rep-linked student.

---

## Wholesaler (role=wholesaler only)

### GET `/wholesaler/dashboard`
```json
{
  "deadline": "2026-06-15T00:00:00Z",
  "student_count": 87,
  "pending_count": 5,
  "completed_designs": 60,
  "referral_url": "https://loloshop.com/join/baghdad-cs-2026"
}
```

### GET `/wholesaler/pending-students`
```json
{ "data": [{ "id": "uuid", "name": "محمد علي حسين", "phone": "077...", "email": "...", "university_name": "...", "department": "...", "created_at": "..." }] }
```

### POST `/wholesaler/approve/:studentId`
```json
{ "data": { "id": "...", "status": "approved" } }
```

### POST `/wholesaler/reject/:studentId`
```json
{ "data": { "id": "...", "status": "rejected" } }
```

### GET `/wholesaler/students?status=`
List all (not just pending).

---

## Notifications

### GET `/notifications?unread=true`
```json
{ "data": [{ "id": "uuid", "type": "student_joined", "title_ar": "...", "body_ar": "...", "link": "/wholesaler", "read": false, "created_at": "..." }] }
```

### POST `/notifications/:id/read`
```json
{ "data": { "id": "...", "read": true } }
```

---

## Products

### GET `/products?type=sash|robe`
Public — no auth.
```json
{
  "data": [{
    "id": "uuid",
    "type": "sash",
    "name_ar": "وشاح تخرج كلاسيكي",
    "description": "...",
    "base_price": 50000,
    "customizable": true,
    "variants": [
      { "id": "uuid", "color": "أبيض", "material": "ساتان", "size": "قياس واحد", "price": 50000, "image_url": null }
    ]
  }]
}
```

### GET `/products/:id`
Single product with variants.

### POST `/products` (admin only)
```json
{ "type": "sash", "name_ar": "...", "description": "...", "base_price": 50000, "customizable": true }
```

### POST `/products/:id/variants` (admin only)
```json
{ "color": "أحمر", "material": "ساتان", "size": "قياس واحد", "price": 55000, "image_url": null }
```

---

## Fonts

### GET `/fonts`
Public — list of curated free Arabic + English fonts.
```json
{
  "data": [
    { "id": "amiri", "name_ar": "أميري", "script": "arabic", "style": "naskh", "source": "google" },
    { "id": "cairo", "name_ar": "القاهرة", "script": "arabic", "style": "modern", "source": "google" }
  ]
}
```
Frontend loads each via Google Fonts CSS link, then registers in Fabric.js via FontFace API.

---

## Designs (retail role)

### GET `/designs/me`
Returns current student's design (or null).
```json
{ "data": {
  "id": "uuid",
  "sash_color": "أبيض",
  "left_canvas": { /* Fabric.js JSON */ },
  "right_canvas": { /* Fabric.js JSON */ },
  "logo_url": "https://.../uploads/logos/abc.png",
  "extra_image_url": null,
  "fonts_used": ["amiri", "cairo"],
  "notes": null,
  "completed": false,
  "completed_at": null,
  "updated_at": "..."
} }
```

### POST `/designs/save`
Idempotent — creates if none, updates if exists. Auto-creates an `orders` row with status=`designing` on first save.
Blocks if design already completed AND `students.edit_exception=false`.
```json
// req
{
  "variant_id": "uuid|null",
  "sash_color": "أبيض",
  "left_canvas": { /* Fabric.js JSON */ },
  "right_canvas": { /* Fabric.js JSON */ },
  "logo_url": "https://.../uploads/logos/abc.png",
  "extra_image_url": null,
  "fonts_used": ["amiri"],
  "notes": "optional notes to staff"
}
// res 200
{ "data": { "id": "uuid" } }
```

### POST `/designs/complete`
Marks design as confirmed, transitions order `designing` → `design_complete`. Irreversible.
```json
{ "data": { "id": "uuid", "completed": true } }
```

### POST `/designs/uploads/logo`
multipart/form-data, field name `file`. Max 5MB. PNG/JPEG/WebP/SVG.
```json
{ "data": { "url": "https://.../uploads/logos/abc123.png" } }
```

### POST `/designs/uploads/image`
multipart/form-data, field name `file`. Max 10MB. Same types as logo.
```json
{ "data": { "url": "https://.../uploads/images/xyz.jpg" } }
```

### GET `/designs/student/:studentId` (admin/staff only)
Staff view — returns design + student info for print preparation.
```json
{ "data": {
  "id": "uuid",
  "student_name": "محمد علي حسين",
  "phone": "077...",
  "university_name": "...",
  "department": "...",
  "sash_color": "أبيض",
  "left_canvas": {...},
  "right_canvas": {...},
  "logo_url": "...",
  "fonts_used": ["amiri"],
  "notes": "...",
  "completed": true
} }
```

---

## Full-Set Orders (طقم كامل) — 2026-06-12

### GET `/catalog/packages?full_set=1` (public)
Active full-set tiers (`is_full_set=true`, role `retail`), each with `products[]` = admin-chosen composition (`{id, type, name_ar}`; empty → defaults by type). Plain `/catalog/packages` now EXCLUDES full-set rows (legacy flows unchanged); admin `?all=1` sees everything. `POST/PATCH /catalog/packages` accept `is_full_set` (mutually exclusive with `is_vip` → 400).

### PUT `/catalog/packages/:id/products` (admin)
`{ product_ids: [uuid…] }` — replace the package's bundled products. Must be active, max one per product type.

### GET `/catalog/shop`
`data.full_set_packages[]` added for retail/guest audiences.

### POST `/orders/configure-full-set` (retail)
One submission → 3 linked orders (sash/robe/cap, shared `checkout_group_id`) + a `checkout_groups` intake row. Body:
```json
{
  "package_id": "uuid",
  "robe": { "selections": [{ "group_id": "", "option_id": "", "customer_text": "" }],
            "measurements": { "shoulder_cm": 48, "robe_length_cm": 115, "sleeve_length_cm": 60 } },
  "cap":  { "selections": [] },
  "sash": { "selections": [],
            "zones": { "right_text": "اسم الخريج", "left_mode": "logo_year|text|plain",
                       "left_text": "", "left_logo_url": "", "back_text": "" } },
  "delivery": { "customer_name": "", "instagram_username": "", "phone_primary": "07xxxxxxxxx",
                "phone_secondary": "", "governorate": "ديالى", "area_details": "" },
  "event_date": "YYYY-MM-DD", "notes": ""
}
```
Validation: required option groups (via `priceSelections`), measurements 25–80 / 70–190 / 30–100 cm, phones `^07\d{9}$` (Arabic digits normalized), 18-governorate whitelist, `right_text` required. Pricing: package price + option deltas (sash order carries the package price; robe/cap their own deltas). Products resolved from `package_products`, falling back to first-active-by-type. Sash → `design_complete` (embroidery); robe/cap → `preparing` unless an option needs embroidery. Idempotent re-submission: rebuilds each piece's `order_items` in place (never loses a generator-produced `plate_image_url`, see `lib/platePreservation.js`) and only matches a live (non-cancelled) prior order, so a cancelled piece is never silently revived. → `201 { data: { checkout_group_id, total, items: [{type, order_id, price}], orders: {sash, robe, cap} } }`

### PATCH `/admin/checkout-groups/:id` (admin)
Edit intake: `deposit` (واصل), `event_date`, phones, address, `customer_name`, `instagram_username`, `notes`. Audit-logged.

### Intake surfaced in
- `GET /admin/orders?group=bundle` → `bundle.intake {…}` (null for legacy cart bundles).
- `GET /production/orders/:id` → `order.intake {…}` — `deposit` only for manager/embroiderer/admin; presser receives `{ event_date }` only.
- `GET /auth/me` (retail) → adds `student { instagram_username, university_name, … }` for form prefill.

---

## Assistant («لولو» — storefront support chatbot) — 2026-08-15

OpenRouter-backed, no tool-calling: the server pre-fetches every fact the model may state with
hand-written parameterised queries (`lib/supportContext.js`) and the model only phrases them in
Iraqi Arabic. See `backend/lib/aiChat.js` for cost caps and `lib/answerGuard.js` for the outbound
safety check. All error responses `{ error: <Arabic msg>, code: 'ERR_*' }`.

### POST `/assistant/session` (public, rate-limited)
Mints a server-signed anonymous identity for a signed-out visitor. `{ sessionToken, expiresInMs }`.
The client sends this token back as `sessionToken` on `/support` so the throttle and conversation
history key on an identity nobody can forge or wear.

### POST `/assistant/support` (public — `optionalAuth`, rate-limited)
Body: `{ question, sessionToken? }` (`sessionToken` only for anonymous callers; signed-in callers
send their Bearer token instead). → `200`:
```json
{
  "answer": "...",
  "actions": [{ "id": "shop", "label": "شوف القطع", "kind": "internal|external", "href": "/shop" }],
  "emotion": "happy|love|excited|thinking",
  "mood": "wink|caring|happy|neutral",
  "reaction": "love|care|laugh|cheer|none",
  "sessionToken": "v1...."
}
```
- `actions` — at most 3 tappable chips, server-picked from a closed list (never a model-written
  URL). Absent chip set → `[]` for pure small talk.
- `emotion` — which mascot face matches the answer's TOPIC.
- `mood` — coarser register split for the character illustration: `wink` (a compliment/playful
  message), `caring` (the customer expressed sadness/tiredness), `happy` (an ordinary answered
  question or greeting), `neutral` (a guard fallback or an honest "not available").
- `reaction` — what «لولو» does on READING the customer, as opposed to what her answer is about
  (`emotion`) or the register it is written in (`mood`). Read from the customer's own words by
  `lib/reaction.js`; the client renders it as a sticker message sent just before the reply.
  `none` is the expected value for an ordinary question and is deliberately the common case — a
  reaction that fires on every turn is an animation, not a reaction. A blocked answer
  (`guardTripped`) always yields `none`.
- `sessionToken` — present only when the caller arrived without a valid one; the client must
  store it and send it back on every subsequent call.

Facts available to the model now include, besides the price book: a **product digest** (real
product names by type, best-selling first, capped ~20) so it can name/recommend actual pieces
instead of a price range, and a **universities digest** (top ~15 universities/colleges served +
total distinct count) so «تسوون لجامعتي؟» always gets a warm yes instead of «ما أعرف». The shop's
real location is **ديالى (بعقوبة)** — «مطبعة لولو شوب» on Google Maps — corrected from an earlier,
wrong «بغداد» in the prompt.

Errors: `503 ERR_AI_DISABLED` (not configured) · `400 ERR_AI_EMPTY_QUESTION` /
`ERR_AI_QUESTION_TOO_LONG` · `429 ERR_AI_TOO_FAST` (with `Retry-After` + `retryAfterSec`) ·
`503 ERR_AI_BUDGET` / `ERR_AI_ANON_BUDGET` · `502 ERR_AI_UPSTREAM` / `ERR_AI_NET` / `ERR_AI_EMPTY`
(these three carry `actions: [shopContact]` so the customer is never left at a dead end).

*(`POST /assistant/react` — the visitor tap-reaction and its `message_id` target — was removed
2026-08-15 (b). It was the wrong feature: reactions belong to «لولو», not to the visitor. It
never reached production, so nothing depends on it. See PROGRESS.md.)*

### POST `/assistant/analytics` (admin only)
Closed metric set for the admin-facing AI analytics chat — unchanged by this round of work.

---

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `ERR_AUTH` | 401 | Missing/invalid token |
| `ERR_FORBIDDEN` | 403 | Wrong role |
| `ERR_NOT_FOUND` | 404 | Resource missing |
| `ERR_VALIDATION` | 400 | Bad input |
| `ERR_RATE_LIMIT` | 429 | Too many requests |
| `ERR_INVALID_OTP` | 400 | Wrong/expired OTP |
| `ERR_INVALID_CREDENTIALS` | 401 | Wrong login |
| `ERR_PHONE_TAKEN` | 409 | Phone already registered |
| `ERR_REFERRAL_INVALID` | 404 | Bad/expired referral code |
| `ERR_DEADLINE_PASSED` | 400 | Action after deadline |
