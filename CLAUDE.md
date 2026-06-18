# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Latest handoff (read first)
The most recent session handoff — what was just changed, how it works, and open
follow-ups. Read it before starting any work. It is auto-loaded via this import:
@HANDOFF.md

## Commands
Backend (`backend/`):
- `npm run dev` — Express API w/ nodemon on :4000
- `npm start` — production (PM2 runs this)
- `npm run migrate` — `node migrate.js`: applies `db/schema.sql` (idempotent) via `pg` Pool, with Neon cold-start retry. NOT psql.
- `npm run migrate:file <path>` — apply a single numbered migration from `db/migrations/00N_*.sql`.
- `npm run seed` / `npm run seed:v2` — seed data (`seed.js` / `seed-v2.js`).

Frontend (`frontend/`):
- `npm run dev` — Next.js on :3000
- `npm run build` / `npm start` — prod build/serve
- `npm run lint` — ESLint (`eslint-config-next`)

No test suite exists. No root-level scripts — run commands inside `backend/` or `frontend/`.

## IMPORTANT version facts (override training data)
- **Next.js 16** + **React 19** (App Router) — NOT Next 14. Read `frontend/AGENTS.md`: APIs/conventions differ from training data; consult `node_modules/next/dist/docs/` before writing Next code.
- **Express 5** (breaking changes vs 4: async error handling, routing).
- **Tailwind v4** — config via `@theme` in `app/globals.css`, not `tailwind.config`.
- **Fabric.js v6** for the sash designer.
- DB is **PostgreSQL via Neon** in dev (not local VPS disk as older spec implies). `lib/db.js` forces IPv4 + SSL for Neon hosts.

## Architecture
Two separate apps, no shared package. Frontend talks to backend over HTTP.

**Backend** (`backend/`) — classic Express layering:
- `server.js` mounts routers under `/api/*` (auth, join, admin, orders, batches, staff, wholesaler, notifications, products, catalog, designs, fonts). Hardened with `helmet` + `express-rate-limit`.
- `routes/*` → `controllers/*` (logic) → `lib/db.js` (`query` + `tx` transaction helper, use `tx` for order creation; both retry Neon cold-start failures).
- `middleware/auth.js`: `authRequired` (JWT Bearer → loads `req.user` from DB), `requireRole(...roles)`, `optionalAuth` (token optional → anon allowed, used by public catalog/configurator for retail pricing), `signToken`. JWT carries `{sub, role, name}`; passwords hashed with `bcrypt`.
- `lib/`: `otp.js` (Zentramsg WhatsApp OTP), `email.js` (nodemailer SMTP), `upload.js` (multer → `/uploads/{logos,images,fonts}`).
- All error responses: `{ error: <Arabic msg>, code: 'ERR_*' }`. Uploads served static at `/uploads`.

**Frontend** (`frontend/`) — App Router, route folders by role:
- `app/{admin,staff,wholesaler}/` role areas + `design/` (Fabric designer), plus auth flows (`login`, `join/[code]`, `forgot-password`, `reset-password/[token]`, `verify-otp`).
- `lib/api.ts`: single axios instance, injects `Bearer` from `localStorage`, auto-`logout()` on 401 (except login/join). Use `getApiErrorMessage` for surfacing Arabic API errors.
- `lib/{admin,wholesaler,staff,auth-api,designer}.ts`: typed API wrappers per domain. `lib/mocks/*` exist where frontend predates real endpoints — verify field shapes against backend (see PROGRESS.md note re: admin field mismatch).
- `components/ui/*` shared primitives, `components/designer/*` Fabric canvas pieces.

## Workflow files
- `PLAN.md` — features broken into self-contained tasks; read before starting a feature.
- `PROGRESS.md` — what's done/next; **update after every task**.
- `API.md` — endpoint reference. `open.md` — answered open questions.
- `PRODUCT.md` — product/catalog model. `DESIGN.md` — design-system/brand spec (see also `.impeccable.md`).

## What is LoloShop?
An e-commerce + design platform for graduation sashes (أوشحة تخرج) and graduation robes (روبات تخرج).
Students design their own sash online, wholesalers manage groups of students, admins track orders and profits.
Brand: @loloshop96 on Instagram.

## Stack
- **Frontend:** Next.js 16 (App Router) + React 19 + Tailwind v4 (see version facts above)
- **Backend:** Node.js + Express 5
- **Database:** PostgreSQL (Neon in dev)
- **Canvas Editor:** Fabric.js v6 (sash flat 2D designer)
- **Hosting:** VPS — Nginx + PM2
- **Storage:** Local VPS disk (`/uploads`)
- **Auth:** JWT + email/phone + OTP (Zentramsg WhatsApp)
- **Payments:** CASH ONLY — no payment gateway
- **PWA:** Enabled (installable on phones)

## Roles
| Role | Arabic | Who |
|------|--------|-----|
| admin | مدير | Full control — uses laptop + phone |
| staff | موظف | View orders + design files — uses iPad + phone |
| wholesaler | ممثل جامعة | Manages 100+ students — phone first |
| retail | طالب عادي | Designs sash, browses products — phone first |

## Device Priority
- Admin → Laptop primary, mobile secondary
- Staff → iPad primary, phone secondary
- Wholesaler → Phone ONLY
- Retail (students) → Phone ONLY
- **Build mobile-first for wholesaler + retail screens always.**

## Design Language (from real product photos)
- Sash colors: white, light gray, dark green, black (and more)
- Right side of sash: university name, department, logo, year (Arabic)
- Left side: student name in Arabic calligraphy
- Cap: custom embroidery
- Aesthetic: luxury fashion, elegant, modern couture, Arabic-first, warm tones
- **Brand identity (official PNG — `frontend/brand-tokens.css` is source of truth):**
  - Primary: **warm orange** — gradient `#FFB100 → #FFA07A`, logo circle `#F47B42`
  - Ink: black `#1A1A1A` / `#333333`
  - Backgrounds: creamy off-white `#FAEBD7`, card `#FFF8F0`; soft accents peach `#FFDAB9`, blush `#FFE4E1`
  - Neutrals: `#E0E0E0` / `#BDBDBD`
  - NOT navy/green/gold (older spec was wrong — superseded by real identity)
- Logo: "lolo shop" script + "96" serif, in an orange circle (@loloshop96)
- Fonts: logo/flourish → script (Great Vibes); Latin headings → Playfair Display; Arabic → Amiri (display) + Cairo (UI)
- NEVER use generic purple gradients or Inter font

## Key Features (do NOT skip any)
1. **Sash Designer** — Fabric.js v6 flat 2D canvas (NOT Three.js/3D — see Key Decisions), student draws/writes on sash interactively
2. **Referral Link System** — each wholesaler gets unique link from admin
3. **Student Approval** — wholesaler approves each student one by one (prevent link leaks)
4. **Deadline System** — wholesaler has deadline, admin can extend, staff design for uncompleted orders
5. **Admin Dashboard** — profits, losses, orders with full name + price + profit + cost per order
6. **Wholesaler Control** — admin sets deadline per wholesaler
7. **Staff View** — see completed designs with all attachments (fonts, logos, images)

## Rules for Claude Code
- Always use `dir="rtl"` and `lang="ar"` for Arabic pages
- Mobile-first CSS for all student/wholesaler pages
- All prices and payments are CASH — no payment UI needed
- Keep components small and reusable
- PostgreSQL — use transactions for order creation
- Never hardcode Arabic text as English
- After finishing any task → update PROGRESS.md immediately
- Read PLAN.md before starting any new feature

## Key Decisions
- **No 3D** — sash shown as flat left/right panels, student clicks each side to edit
- **University logo** — student uploads from device themselves
- **Deadline** — specific date set by admin (e.g. April 15), not countdown days
- **Language** — Arabic only (no English mode for now)
- **Domain** — TBD, add later
```
loloshop/
├── CLAUDE.md          ← this file
├── PLAN.md            ← all features broken into tasks
├── PROGRESS.md        ← what's done, what's next
├── frontend/          ← Next.js app
│   ├── app/
│   ├── components/
│   └── public/
├── backend/           ← Express API
│   ├── routes/
│   ├── controllers/
│   ├── models/
│   └── middleware/
└── db/
    └── schema.sql
```
