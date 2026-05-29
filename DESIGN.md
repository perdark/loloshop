---
name: LoloShop
description: A premium graduation fashion house — paper, ink, and earned orange.
colors:
  orange-ink: "#c2410c"
  orange: "#f47b42"
  orange-light: "#ffa07a"
  paper: "#faf4ea"
  surface: "#fffdfa"
  surface-sink: "#f5f0e6"
  ink: "#1a1a1a"
  ink-soft: "#33302b"
  muted: "#8a8377"
  line: "#e3ddd0"
typography:
  display:
    fontFamily: "var(--font-playfair), var(--font-amiri), serif"
    fontSize: "clamp(2.25rem, 6vw, 5.5rem)"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "var(--font-amiri), serif"
    fontSize: "clamp(1.5rem, 3.5vw, 2.5rem)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "normal"
  title:
    fontFamily: "var(--font-cairo), sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "var(--font-cairo), sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "normal"
  label:
    fontFamily: "var(--font-cairo), sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.02em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "20px"
  pill: "9999px"
spacing:
  xs: "8px"
  sm: "16px"
  md: "24px"
  lg: "48px"
  xl: "96px"
components:
  button-primary:
    backgroundColor: "{colors.orange-ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    padding: "14px 32px"
  button-primary-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "14px 32px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
---

# Design System: LoloShop

## 1. Overview

**Creative North Star: "The Graduation Lookbook"**

LoloShop is a graduation fashion house that happens to sell online, not an ecommerce store that happens to look nice. The whole system behaves like a printed lookbook for a once-in-a-lifetime milestone: a warm paper canvas, ink-black type set with intent, product photographed as art and given room to breathe. Browsing should feel like turning pages, not scrolling a catalog of identical tiles. The emotional register is pride, elegance, anticipation, and the weight of the moment, delivered calm and composed rather than loud or salesy.

This system explicitly rejects the Shopify-style stacked-section page, the card-grid monotony of repeated icon+heading+text tiles, scrim-over-photo product cards, gradient text, glassmorphism-everywhere, urgency marketing, and the generic AI/startup gloss. It also rejects the currently shipped LoloShop look — cream-flooded, orange-heavy — which is being deliberately replaced. Arabic comes first at every breakpoint (`dir="rtl"` `lang="ar"`), and the Arabic type is treated as the craft, not an afterthought.

**Key Characteristics:**
- Paper + ink carry the page; burnt orange is a rare spark (≤10% of any screen).
- Type-led composition with generous negative space, not boxed cards everywhere.
- Amiri at display scale for calligraphic, couture Arabic headings.
- Flat by default; depth from warm tonal layering, not drop shadows.
- Mobile-first and RTL-true; phone is the primary canvas for students and wholesalers.

## 2. Colors

A neutral-luxury foundation of warm paper and ink, with a single disciplined burnt-orange accent. Tints are mixed in OKLCH with low chroma pulled toward the orange hue; never default-tinted toward generic warmth.

### Primary
- **Burnt Orange** (`#c2410c`): The earned accent. Primary CTAs, the one number that matters, active states, focus rings, key links. This is the emotional/action peak color, never a background wash.

### Secondary
- **Brand Orange** (`#f47b42`): The logo mark and large brand fills only (hero flourish, badge fields). Warmer and lighter than the burnt accent; reserved for identity moments, not interactive text.
- **Soft Orange** (`#ffa07a`): Gradient terminus and hover-glow tints only. Decorative, used sparingly.

### Neutral
- **Warm Paper** (`#faf4ea`): The page canvas. Every screen sits on this; it is the "paper" of the lookbook.
- **Surface** (`#fffdfa`): Raised surfaces — cards, sheets, inputs. A near-white half a step above paper.
- **Surface Sink** (`#f5f0e6`): Recessed/alt sections and section banding, a half step below paper for tonal depth.
- **Ink** (`#1a1a1a`): Primary text, dark surfaces, headings.
- **Soft Ink** (`#33302b`): Body and secondary text. The default reading color on paper.
- **Muted** (`#8a8377`): Labels, captions, metadata, placeholder text at large/label sizes only.
- **Line** (`#e3ddd0`): Hairline borders and dividers, warm-tinted, never gray-cold.

### Named Rules
**The Earned Orange Rule.** Burnt orange appears on ≤10% of any screen and only at action or emotional peaks. Ink and paper carry everything else. Its rarity is the power; flood it and the brand dies.

**The Body-Is-Soft-Ink Rule.** Body copy is Soft Ink (`#33302b`) on paper, never Muted (`#8a8377`). Muted clears AA only at label/large sizes; using it for body text fails contrast. When in doubt, darken toward ink.

## 3. Typography

**Display Font:** Playfair Display (Latin) + Amiri (Arabic display), with `serif` fallback
**Body Font:** Cairo (Arabic + Latin UI), with `sans-serif` fallback
**Script Font:** Great Vibes — the "lolo shop" wordmark ONLY

**Character:** A serif/sans contrast pairing: high-contrast couture serifs for display (Playfair for Latin, Amiri for Arabic calligraphic headings) against the calm humanist Cairo for everything you actually read. Hierarchy comes from scale and weight contrast (≥1.25 ratio between steps), not from many sizes.

### Hierarchy
- **Display** (600, `clamp(2.25rem, 6vw, 5.5rem)`, lh 1.02, tracking -0.02em): Hero and page-defining headings. Amiri at this scale for Arabic couture confidence; Playfair for Latin.
- **Headline** (700 Amiri, `clamp(1.5rem, 3.5vw, 2.5rem)`, lh 1.15): Section and product titles in Arabic.
- **Title** (600 Cairo, 1.25rem, lh 1.3): Card titles, sub-section labels, dense UI headers.
- **Body** (400 Cairo, 1rem, lh 1.7): Reading copy, descriptions. Cap measure at 65–75ch; Soft Ink on paper.
- **Label** (600 Cairo, 0.8125rem, tracking 0.02em): Captions, metadata, form labels, chips. Sentence case.

### Named Rules
**The Calligraphy-Is-Craft Rule.** Arabic display headings use Amiri at large scale with calligraphic confidence. Do not shrink Arabic headings to sans defaults; the Arabic type carries the heritage-meets-couture feeling.

**The Script-Is-Logo-Only Rule.** Great Vibes is reserved exclusively for the "lolo shop" wordmark. Never set headings, labels, or body in script.

## 4. Elevation

Flat by default. Depth is built from warm tonal layering — Surface Sink (`#f5f0e6`) → Paper (`#faf4ea`) → Surface (`#fffdfa`) — not from drop shadows. Surfaces are flat at rest; shadow appears only as a response to state (hover lift, floating sheet, focus). This keeps the lookbook feeling printed rather than like floating SaaS cards. Shadows, when used, are soft and ink-toned, never orange-tinted or heavy.

### Shadow Vocabulary
- **Soft** (`box-shadow: 0 1px 2px rgba(26,26,26,0.04), 0 1px 3px rgba(26,26,26,0.06)`): Resting hairline lift for inputs and quiet containers, when a border alone is not enough.
- **Float** (`box-shadow: 0 8px 24px -10px rgba(26,26,26,0.16), 0 2px 8px -4px rgba(26,26,26,0.08)`): Hover lift on interactive cards and floating sheets/menus.

### Named Rules
**The Flat-By-Default Rule.** A surface earns a shadow only by changing state. If a card has a resting drop shadow for decoration, remove it and lean on tone and border instead.

**The Ink-Not-Orange Shadow Rule.** Shadows are tinted with ink alpha, never orange. The shipped orange-tinted `--shadow-card`/`--shadow-pop` are legacy; soften to ink.

## 5. Components

### Buttons
- **Shape:** Fully rounded pill (`9999px`).
- **Primary:** Burnt Orange fill (`#c2410c`) with Surface text, padding `14px 32px`. The single decisive action on a screen.
- **Hover / Focus:** Hover deepens to Ink (`#1a1a1a`); focus shows a 2px Burnt Orange outline with offset. Transition ~180ms ease-out.
- **Ghost / Secondary:** Surface background with Ink text and a `#e3ddd0` hairline border; used for secondary actions so primary stays singular.

### Chips / Tags
- **Style:** Surface or Paper background, Soft Ink text, `#e3ddd0` hairline, pill radius. Selected state fills Burnt Orange with Surface text.
- **State:** One selected chip max in single-select filters; rely on fill, not border weight, to show selection.

### Cards / Containers
- **Corner Style:** Large soft radius (`20px`) for feature/product containers; `12px` for dense UI.
- **Background:** Surface (`#fffdfa`) on Paper; band recessed sections in Surface Sink (`#f5f0e6`).
- **Shadow Strategy:** Flat at rest (see Elevation); Float shadow on hover only.
- **Border:** Optional `#e3ddd0` hairline; never a colored side-stripe.
- **Internal Padding:** 24px (`spacing.md`) standard.

### Inputs / Fields
- **Style:** Surface background, `#e3ddd0` hairline border, `12px` radius, padding `12px 16px`, Ink text.
- **Focus:** Border shifts to Burnt Orange with a soft 2px ring; no glow flood.
- **Error / Disabled:** Error border + Soft Ink message text (no all-red flood); disabled drops to Surface Sink with Muted text.

### Navigation
- **Style:** Quiet — Paper/Surface background, Ink wordmark in script, Cairo nav labels. Default Soft Ink; hover Ink; active Burnt Orange. Mobile: bottom or sheet nav for phone-first student/wholesaler flows, ≥44px tap targets.

### The Sash Designer (signature)
The Fabric.js customization canvas is the soul of the product and must feel premium and tactile: a calm Surface stage on Paper, ink chrome, controls that feel like a tailoring table rather than a toolbar. Orange marks only the active tool/selection. This is the screen people remember; give it the most craft.

## 6. Do's and Don'ts

### Do:
- **Do** keep burnt orange (`#c2410c`) to ≤10% of any screen — CTAs, active state, the one number that matters.
- **Do** set body copy in Soft Ink (`#33302b`) on Warm Paper, and verify ≥4.5:1 contrast (≥3:1 for large text).
- **Do** build depth from tonal layering (Sink → Paper → Surface); add shadow only on state change.
- **Do** set Arabic display headings in Amiri at large scale with calligraphic confidence.
- **Do** give product imagery room — big photos, negative space, captions below; turning pages, not tiles.
- **Do** keep tap targets ≥44px and the layout RTL-true at every breakpoint.
- **Do** provide a `prefers-reduced-motion` alternative for every animation.

### Don't:
- **Don't** use the currently shipped LoloShop design (cream-flooded, orange-heavy) as reference; it is being replaced.
- **Don't** stack Shopify-style sections or repeat identical icon+heading+text card grids.
- **Don't** put scrims over product photos to force a "designed" look — caption below the image instead.
- **Don't** use gradient text or the banned `.text-gradient-brand`; emphasize with weight and size in solid ink/orange.
- **Don't** use glassmorphism as a default, or any colored side-stripe border >1px.
- **Don't** set body text in Muted (`#8a8377`) — it fails AA at body size; that's a label/large-text color only.
- **Don't** tint shadows orange; keep them ink-toned and soft.
- **Don't** set the warm paper as a near-white you call "cream" and then flood orange on top; orange is earned, not ambient.
