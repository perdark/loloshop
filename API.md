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
{ "data": { "user_id": "uuid", "otp_required": true } }
```

### POST `/auth/login`
```json
// req
{ "phone": "07701234567", "password": "..." }
// res 200
{ "token": "jwt...", "user": { "id": "uuid", "name": "...", "role": "admin|staff|wholesaler|retail", "phone_verified": true } }
```

### GET `/auth/me`
Header: `Authorization: Bearer <jwt>`
```json
// res 200
{ "id": "uuid", "name": "...", "phone": "...", "email": "...", "role": "...", "phone_verified": true }
```

### POST `/auth/verify-otp`
```json
// req
{ "phone": "07701234567", "code": "123456" }
// res 200
{ "verified": true, "token": "jwt..." }
```

### POST `/auth/resend-otp`
```json
{ "phone": "07701234567" }
// res 200
{ "sent": true, "expires_in": 300 }
```

### POST `/auth/forgot-password`
```json
{ "email": "m@x.com" }
// res 200 (always — don't leak existence)
{ "sent": true }
```

### POST `/auth/reset-password`
```json
{ "token": "...", "password": "newpass" }
// res 200
{ "reset": true }
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

### GET `/admin/staff/:id/activity`
Returns up to 200 most recent activity log entries for the staff member.
```json
{
  "data": [
    {
      "id": "uuid",
      "action": "advance_stage",
      "from_stage": "staff_review",
      "to_stage": "printing",
      "created_at": "...",
      "order_id": "uuid",
      "product_name": "وشاح تخرج",
      "student_name": "محمد علي"
    }
  ]
}
```

---

## Payroll (role=admin or staff — self-service)

### GET `/payroll/me/salary`
Staff member reads their own salary summary (same shape as admin endpoint above).

### GET `/payroll/me/activity`
Staff member reads their own activity log (same shape as admin endpoint above).

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
Validation: required option groups (via `priceSelections`), measurements 25–80 / 70–190 / 30–100 cm, phones `^07\d{9}$` (Arabic digits normalized), 18-governorate whitelist, `right_text` required. Pricing: package price + option deltas (sash order carries the package price; robe/cap their own deltas). Products resolved from `package_products`, falling back to first-active-by-type. Sash → `design_complete` (embroidery); robe/cap → `preparing` unless an option needs embroidery. Idempotent re-submission. → `201 { data: { checkout_group_id, total, items: [{type, order_id, price}], orders: {sash, robe, cap} } }`

### PATCH `/admin/checkout-groups/:id` (admin)
Edit intake: `deposit` (واصل), `event_date`, phones, address, `customer_name`, `instagram_username`, `notes`. Audit-logged.

### Intake surfaced in
- `GET /admin/orders?group=bundle` → `bundle.intake {…}` (null for legacy cart bundles).
- `GET /production/orders/:id` → `order.intake {…}` — `deposit` only for manager/embroiderer/admin; presser receives `{ event_date }` only.
- `GET /auth/me` (retail) → adds `student { instagram_username, university_name, … }` for form prefill.

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
