# LoloShop — PLAN.md

## Status: the eleven build phases are DONE

The original phase-by-phase task breakdown (Phases 1–11, foundation → batches/accounting) is
**shipped** and has moved verbatim to **`docs/PLAN-archive.md`**. Nothing was deleted. Read it when
you need to know what a task was originally told *not* to do — those `Don't:` lines are constraints
the shipped code still honours.

**New work does not get added to this file.** It goes through a spec in
`docs/superpowers/specs/`, then `HANDOFF.md` records the outcome.

What stays here is the **domain model** below: it is no longer a plan, it is a description of the
system that exists — every entity named in it is a real table in `db/schema.sql`, verified
2026-08-05.

---

## PRODUCT & PRICING MODEL (v2) — admin-managed

**Golden rule:** *Anything the user can mention/pick, the admin can add / edit / remove* — including
its label, price, whether it's required or optional, and whether it shows an illustrative image.
All of it is DB-driven, not hardcoded.

### Entities
Line numbers are into `db/schema.sql`.

- **products** (`:227`) — `sash` | `robe` | `cap` | `shawl`. Has `base_price` (IQD) +
  `gender_restriction` (null | `male` | `female`).
- **option_groups** (`:390`) — a configurable field on a product: `product_id`, `name_ar`,
  `input_type` (`single_select` | `toggle` | `counter`), `sort`, `required`, `has_image`, `hint_ar`,
  `image_url`, `max_select`, `gender_restriction`.
- **options** (`:408`) — a value inside a group: `group_id`, `label_ar`, `price_delta`, `image_url`,
  `active`.
- **Role pricing** — `option_price_roles` (`:421`) + `product_price_roles` (`:428`) override
  `price_delta` / `base_price` per role (`wholesaler` vs `retail`); fall back to base when no role
  row. Canonical test: shawl = 20,000 wholesaler / 30,000 retail.
- **packages** (`:460`) + **package_rules** (`:471`) + **package_products** (`:960`) —
  wholesaler/rep students only. Bundle = robe + sash + cap. **Tier is driven by the sash type, but
  the cap swaps independently** (royal sash + normal cap is allowed, and vice versa). Retail
  students buy à la carte — no packages.
- **batches / دفعات** (`:447`) — `name_ar` (e.g. «طب عام 2026»), `wholesaler_id`, `deadline`. Orders
  belong to a batch (rep students) or are independent (retail). Drives countdown + totals.
- **order_items** (`:499`) — snapshot of each chosen option **and its price at order time**, so the
  breakdown is immutable and auditable.
- **students.gender** (`:216`) — exists, and gender-restricted options depend on it. ⚠️ Onboarding
  currently writes gender to `localStorage` only; see the landmine in `HANDOFF.md`.

### Per-product field map (initial seed — all admin-editable after)
**ROBE (روب)** — `base_price` per fabric starts 25,000 or 35,000 and rises with fabric + tailoring;
that rise is baked into the fabric option's price.
- Fabric type (`single_select`, required, image) — 4 fabrics.
- Sleeve embroidery / ردان (`counter`, max 2, image) — **+5,000 per embroidered sleeve**.
- Pleat / كسرة (`toggle`, no image, price delta) — yes/no.

**CAP (قبعة)** — `base_price` fixed **20,000** (embroidery does NOT change price).
- Shape / شكل (`single_select`, no image) — عادية | مثلثة.
- Embroidery position / تطريز — من الجانب | من الأعلى. Admin uploads the explanatory image.

**SASH (وشاح)** — `base_price` fixed **30,000**.
- Type / نوع الوشاح (`single_select`, required, image required) — مثلث | مثلث صغير | مثلث حاد |
  ملكي خماسي | عادي | منحني.
- Color / لون (`single_select`, optional, image) — ماروني + common colors.
- Frame / إطار (`toggle`, **+5,000**). Back design / من الخلف (`toggle`, optional).
- **Designer link:** the Fabric.js sash designer is reached from the sash product page (student
  configures options → opens designer → returns).

**SHAWL — شال أمريكي** (`gender_restriction = female`) — wholesaler 20,000, retail 30,000.

### Pricing rules
- Every price shows a **transparent breakdown**: `base_price` + each add-on line («إطار +5000»,
  «تطريز ردن +5000» …) = total. Never show a total without the itemisation.
- **The server recomputes the total** — client-sent prices are never trusted.
- Rep + admin get a **batch view**: deadline countdown, each student (الاسم الثنائي) + their total,
  and the batch grand total.
- Admin also sees independent retail orders, plus profit/loss (price − admin-entered cost) per order
  and in aggregate. **Cost and profit are never exposed to wholesaler or student.**

---

## Notes
- All deadlines are stored in UTC, displayed in Iraq time (UTC+3)
- All amounts in Iraqi Dinar (IQD)
- Arabic is primary language for all student/wholesaler UI
- English can appear in admin/staff UI
- Payments are **cash only** — there is no payment gateway and no payment UI

---

*Shipped build phases → `docs/PLAN-archive.md`. Session history → `docs/HANDOFF-archive.md`.*
