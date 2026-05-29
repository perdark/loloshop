# LoloShop — Copilot / Cursor instructions

Premium graduation fashion brand (gowns, caps, custom sashes), Arabic-first RTL, mobile-first. Next.js 16 + React 19 + Tailwind v4. Do **not** use the current/shipped website design as reference — it is being deliberately replaced. Source of truth for design direction is `.impeccable.md` at repo root; this section mirrors it.

## Design Context

### Users
- **Students (retail, 16–25)** — phone-only. Premium emotional core: design a custom graduation sash, browse gowns/caps. Care about style, memories, elegance, looking premium.
- **Wholesalers (ممثل جامعة)** — phone-only. Manage 100+ students, approvals, deadlines. Want speed and confidence.
- **Staff (موظف)** — iPad-first. View orders + completed design files/attachments.
- **Admin (مدير)** — laptop-first. Profits, costs, orders, wholesaler control. Dense data.
- **Language:** Arabic-only, `dir="rtl"` `lang="ar"`. Mobile-first for student + wholesaler always.

### Brand Personality
Three words: **couture, cinematic, composed.** Feel like a premium graduation *fashion house*, not an ecommerce store. Emotion: pride, elegance, anticipation, milestone weight. Calm and confident, never loud or salesy. No urgency-marketing, no stacked "Shopify sections", no startup gloss.

### Aesthetic Direction
- **Theme: Light editorial.** Warm paper canvas, ink type, generous negative space — print fashion catalog / lookbook, not a dashboard.
- **Palette — neutral-luxury foundation, orange as rare spark:**
  - Canvas: `#FAF4EA` warm paper; surfaces `#FFFDFA` → `#F5F0E6`.
  - Ink: `#1A1A1A`, soft `#33302B`, muted `#8A8377`.
  - Accent (rare, action/emotion peaks only): burnt orange `#C2410C`; brand fill `#F47B42` for large fills/logo mark only.
  - Lead with ink + paper + warm neutrals; orange ≤10% visual weight. Use OKLCH for tints, reduce chroma toward extremes, tint neutrals toward warm orange hue (very low chroma).
- **Type (wired, keep):** Arabic UI/body **Cairo**; Arabic display/calligraphy **Amiri**; Latin display **Playfair Display**; logo/flourish **Great Vibes** (logo only). Use Amiri at display sizes for couture Arabic headings. Fewer sizes, more contrast (≥1.25 ratio), fluid clamp on headings.
- **Anti-references (hard):** no Shopify-style stacked sections, no card-grid monotony, no startup/trendy aesthetic, no generic AI-slop, no current LoloShop design. **No gradient text** (shipped `.text-gradient-brand` is banned — use solid ink/orange + weight). No glassmorphism-everywhere, no >1px colored side-stripe accents.

### Scope (everything, prioritized)
1. **Student storefront + sash customization** — signature moment, heaviest craft (home, shop, product, designer, sizes).
2. Wholesaler (phone-first, fast, on-brand).
3. Staff (iPad) + Admin (laptop) — editorial restraint on dense/data UI; legibility & density win, but type/color/space stay on-system.

### Design Principles
1. **Lookbook, not storefront.** Product as art: big imagery, negative space, type-led. Browsing feels like turning pages, not scrolling identical cards.
2. **Orange is earned.** Ink + warm paper carry the page; burnt orange only at emotional/action peaks. Rarity = power.
3. **Arabic type is the craft.** Amiri at display scale, calligraphic confidence — heritage-meets-couture.
4. **The sash designer is the soul.** Customization must feel premium and tactile — the thing people remember.
5. **Restraint scales to data.** Admin/staff dashboards stay on the system but prioritize legibility/density.
6. **Mobile-first, RTL-true at every breakpoint.** Tap targets ≥44px, no h-scroll, never amputate features on phone.
