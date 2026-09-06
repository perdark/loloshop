# Staff UI on phones — what is actually wrong (2026-09-02)

Owner, verbatim: «الui كذلك مو متناسق وية كل التلفونات ويحتاج مرات فراغات او غير امور».

This is Track 5's «measure» half (plan `2026-09-02-five-floor-edits.md`, Task 5.2). It is a
**code read, not a screenshot pass** — no 390px viewport exists on this laptop — so every
finding below is a class, a token or a line number you can grep. Where a pixel number appears it
is arithmetic over the Tailwind classes, shown so you can redo it.

Who this is for: المطرّز, المكوجي, المجهز on ~360px Androids, one hand, standing. Screens read:
`/staff` (StationConsole · PrepConsole · QueueView · MonitorDashboard), the StudentSheet,
`/staff/queue`, `/staff/orders/[id]`, `/staff/team`, `/staff/me`, `/staff/attendance`,
`/staff/shelf`, the rep console, `/admin/attendance`, and the calligraphy tool (now the
embroiderer's, Track 2A). Assessment ran as two isolated passes: this read, and the impeccable
detector (Appendix B).

---

## The verdict, in one paragraph

The real problem is **not** that the phone is too small. It is that every station screen puts
~500–650px of controls *above* the first thing the worker came to tap, that the app's
navigation is a desktop sidebar folded into a hamburger while the student and rep areas already
have thumb-zone bottom bars, and that the working text size is 12px. Underneath those three,
the «مو متناسق» is real and mechanical: three card paddings, four spacing rhythms, two colour
systems (one of them raw hex on the shelf screens), five ad-hoc success/warning palettes, two
digit systems on one screen, and font weights that were never loaded. Fix the first three by
subtracting, not adding; fix the rest with tokens and one sweep.

---

## 1 · The job starts below the fold  — P0

Take the embroiderer's home (`/staff` → `StationConsole`, kind `embroidery`) on a 360×640
Android (Capacitor, no URL bar; ~600px usable after the status bar). Vertical cost before the
first student row, read off the classes:

| Block | Source | Classes | px |
|---|---|---|---|
| Sticky header | `app/staff/layout.tsx:31` | `py-3` + `h-11` button | 68 |
| Main padding | `layout.tsx:65` | `p-4` | 16 |
| AttendanceReminder | `AttendanceReminder.tsx` + `page.tsx` `mb-4` | `min-h-11` + 16 | 60 |
| PageHeader | `components/ui/PageHeader.tsx:22,33` | h1 `text-2xl` (30) + subtitle (24) + `gap-3` + action `min-h-11` (44) + `pb-5` + `mb-6` | 154 |
| View toggle | `StationConsole.tsx:751` | `p-1` + `min-h-11`, then `space-y-5` | 72 |
| Filter card | `StationConsole.tsx:784` | `p-3.5` + Input `min-h-12` (+ source row `min-h-10` + rep Select `min-h-11` when shown) | 76–184 |
| Stage chips | `StationConsole.tsx:855` | `min-h-11` + `pb-1` + `space-y-5` | 68 |
| **First student row begins at** | | | **514–622** |

The row itself is `min-h-16` (64). Worst case the first student is entirely off-screen; best
case one row shows. `PrepConsole` (`:451`) is the same stack. `QueueView` (designer/digitizer
home, `app/staff/page.tsx`) is worse: PageHeader + search + tab switcher + source pill +
StageChips + a **wrapping** row of seven zone chips (`min-h-9`, 2–3 rows at 360px) before the
grid. `/staff/queue` adds a KPI strip and a bordered chip rail on top of its toolbar.

Five of those blocks are not the worker's job:

- **«تحديث»** in every PageHeader action slot. The consoles poll every 15s (`usePolling`) and
  reload on SSE (`useProductionEvents`). The button costs 44px + 12px gap on every phone and
  answers a question the screen already answers itself.
- **The PageHeader subtitle** («طلبات جاهزة للتطريز») restates the title.
- **The view toggle** («عرض بالطلب / عرض بالقطع») is a mode the worker sets once a day; it is
  the tallest control on the screen every time.
- **The filter card** (search + source + rep) is opened for maybe one student in twenty, and it
  is permanently expanded, in a bordered card, with `surface-card` shadow.
- **AttendanceReminder** is a 44px link that says «بصمة الدخول مسجّلة» all day after 9:00.

**Do this** (one shared header for the three consoles + QueueView):

1. A `StationHeader` component: one line, `min-h-11`, title in `font-display-ar text-xl` with
   the live count inline («التطريز · ٤٢»), and **no** subtitle, **no** refresh button. Put the
   search behind a 44px icon on that line that expands the field in place. Source/rep filters
   go into a «تصفية» bottom sheet (reuse `Modal` — it already does safe areas correctly).
2. Stage chips become the **first** row under the header. They are the actual navigation.
3. View toggle moves into the same «تصفية» sheet as a segmented row, and the worker's last choice
   stays persisted (it already is, `sessionStorage`).
4. AttendanceReminder renders only in its two *actionable* states (not punched in · on break)
   and as a one-line `min-h-9` strip inside the header band, not a card in the flow. Punched-in
   and quiet → nothing.
5. Drop `pb-28` from the three roots (`StationConsole.tsx:739`, `PrepConsole.tsx:451`, rep
   console `:164`); pad only when the bulk bar is actually mounted (the bar is ~68px, the
   padding is 112).

Target, same arithmetic: header 68 + 16 + chips 48 + 12 = **first row at ~144px**, four rows
visible above the fold instead of zero or one.

---

## 2 · Nothing lives in the thumb zone  — P0

`app/staff/layout.tsx` has no bottom navigation. `app/(student)/layout.tsx` and
`app/wholesaler/layout.tsx` both do (grep `safe-area-inset-bottom`), so staff is the only
phone-first role area whose primary destinations — مرحلتي · المراحل · البصمة · راتبي — are behind a
hamburger (`StaffSidebar.tsx`, drawer `w-64`), top-right, the hardest reach on a 6-inch phone
held in the right hand. That is the anti-pattern the design KB names first for phones (AP-06,
L-08, AR-11).

The order page has the same shape one level down: `app/staff/orders/[orderId]/page.tsx:1754`
renders the primary action block (`sm:hidden`) **at the top**, under the header; the worker
scrolls 2,700 lines of sections down to read the piece and back up to complete it. The desktop
version (`:2388`) is a side card, which is fine on a laptop.

**Do this:**

1. `StaffBottomNav` in `app/staff/layout.tsx`, `lg:hidden`, `fixed inset-x-0 bottom-0`,
   `pb-[env(safe-area-inset-bottom)]`, four 44px tabs derived from the same `getNavLinks` the
   sidebar uses: **مرحلتي** (the home queue) · **المراحل** (opens the stage list as a sheet, or
   `/staff/queue`) · **البصمة** · **راتبي**. Managers/admin get المتابعة · الطلبات · الممثلون ·
   الموظفون. Everything else stays in the drawer, which is what a drawer is for.
2. `<main>` gets `pb-[calc(3.5rem+env(safe-area-inset-bottom))]` on phone instead of
   `safe-bottom`, so content clears the bar (the globals.css note on double-padding applies).
3. Order page on phone: move the `sm:hidden` action block into a `fixed bottom-0` bar with the
   same safe-area padding — primary action full width, secondary actions behind a «⋯» sheet.
   The bulk bar in `StationConsole.tsx:1118` is the visual model, so one bar component serves
   both.

---

## 3 · The working text is 12px  — P1

Counts across `app/staff`, `components/staff`, `app/admin/attendance`:

| Class | Size | Occurrences | Where it hurts |
|---|---|---|---|
| `text-xs` | 12px / lh 1.33 | 225 | every list row's second line, every chip label, every `Button size="sm"` (`Button.tsx:60`) |
| `text-[11px]` | 11px | 45 | queue mobile card rows 2–3 (`queue/page.tsx:450–484`), MyMonthPanel hints, status pills |
| `text-[10px]` | 10px | 25 | count badges in every chip, «متأخر» pills, ShelfConsole slot labels |
| `text-[9px]` `text-[8px]` | 9 / 8px | 3 + 1 | `ShelfMap.tsx:40,130`, `PlaceSheet.tsx:175`; `ShelfMap.tsx:85` |

The Arabic floor is 15px for body, 16 preferred (VP-11, AR-03: Arabic has no x-height and reads
~2px smaller than Latin at the same size). Cairo at 12px with Tailwind's 1.33 line-height clips
the ascender/descender stack the script needs (AR-01 asks 1.7–1.9).

One of these is a **functional** defect, not taste: `StudentSheet.tsx` renders the stitch text
the embroiderer must read as
`<p className="mt-0.5 truncate text-xs text-ink-soft" title={z.text}>` — 12px, one line,
truncated, with the full text only in a hover tooltip that does not exist on touch. The
preparer's copy of the same field (`PieceSpec.tsx`) is `text-[13.5px] font-bold
whitespace-pre-wrap` — the right answer, already in the codebase.

**Do this:**

1. In `@theme` (`app/globals.css`), override the two small steps for Arabic rather than
   touching 224 call sites: `--text-xs: 0.8125rem` (13px), `--text-xs--line-height: 1.6`,
   `--text-sm: 0.9375rem` (15px), `--text-sm--line-height: 1.6`. This is a Tailwind v4 theme
   override; every existing class moves at once and nothing else in the app changes shape by
   more than 1–2px.
2. Then a sweep that deletes `text-[10px]`, `text-[11px]`, `text-[9px]`, `text-[8px]` in the
   staff tree — counts become `text-xs tabular-nums`, the shelf map labels become `text-xs`.
3. `StudentSheet.tsx` zone text: `whitespace-pre-wrap text-sm font-semibold text-ink`, no
   `truncate`, no `title`. Same for the student row's second line in the three consoles when it
   carries `zone.text`.
4. `Button` `sm` size: `text-sm`, never `text-xs`, on a 44px control.

---

## 4 · Two fixed bars and the sheet ignore the home indicator  — P1

`grep -n safe-area components/staff/station/*.tsx 'app/staff/wholesalers/[wholesalerId]/students/page.tsx'`
returns nothing. `viewportFit: "cover"` is set (`app/layout.tsx:111`), so on an iPhone:

- `StationConsole.tsx:1118` bulk bar (`fixed inset-x-0 bottom-0 px-4 py-3`) — the primary
  «إكمال N قطعة» button sits under the home indicator.
- Rep console `:614` — same bar, same defect.
- `StudentSheet.tsx:133` — `items-end`, sheet `max-h-[92vh]`, footer `px-4 py-3`; the «إنهاء
  كل القطع» button المجهز presses is flush against the bottom edge. Also `92vh` should be
  `92dvh` in a WebView.
- Same shape, same omission: `PlaceSheet.tsx:76`, `ShelfConsole.tsx:448` (slot sheet) and
  `:546` (the `bottom-6` toast), `DesignGallery.tsx:110`. The census (Appendix B, grep 10) is
  exact: of eight bottom-anchored surfaces in the staff tree, **none** pads the inset; only the
  header does.

`components/ui/Modal.tsx` already does this right
(`pb-[max(1rem,env(safe-area-inset-bottom))]`); copy its line. Both bars also carry
`backdrop-blur` on a `bg-surface/95` — `layout.tsx:30`'s own comment removed blur from the
header for low-end Android; the bars should match (`bg-surface`, no blur).

---

## 5 · Tap targets under 44px  — P1

The primitives are right (`Button` all sizes `min-h-11`, `Input` `min-h-12`, sidebar links
`min-h-11`). The leaks are hand-rolled chips:

| Class | Where | Count |
|---|---|---|
| `min-h-9` (36px) | `app/staff/page.tsx` tab switcher, `SourceFilterControl`, the 7 zone-filter chips; MyMonthPanel toggle; CalligraphyTool sticky bar chips/search (`:1559,1574,1590`) | 8 + 4 |
| `min-h-10` (40px) | `StationConsole.tsx` zone/type chips (`:960`), source buttons; `PrepConsole` source + garment chips | 5 |
| `min-h-8` (32px) | `app/staff/page.tsx` «+ حافز / − خصم» in the throughput table; CalligraphyTool `:2058,2074` | 4 |
| `h-9` fixed (36px) | `layout.tsx:60` «لوحة التحكم» header link; `orders/[orderId]/page.tsx:1139`; `app/staff/page.tsx:692`; `team/page.tsx:782` | 4 |
| `h-7 w-7` box inside `min-h-11` hit area | `StudentSheet.tsx:336` zone checkbox | fine — hit area is 44 |
| `w-14` × row | `StationConsole.tsx` pieces-view checkbox column | fine |

Chip spacing is `gap-1.5` (6px) on the zone filter and `gap-2` (8px) elsewhere; 8 is the floor
(VP-16). Rule for the sweep: every `<button>` in the staff tree is `min-h-11`; a chip row is
`gap-2`.

---

## 6 · «مو متناسق» — the eight leaks, each one grep-able  — P1/P2

**6a · Two colour systems.** `components/staff/shelf/` (`ShelfConsole` 50 · `PlaceSheet` 18 ·
`ShelfMap` 17 raw hex values) is painted in the *old* palette — `#FFF8F0` cards, `#F47B42`
fills, `#639a7b` / `#256347` greens, `#9f382d` red, `#211f1b` shelf — while every other staff
screen is on `bg-surface #fffdfa` / `text-orange-ink #c2410c` / `text-danger`. The presser sees
`PlaceSheet` after every الكوي completion, so the palette jump happens dozens of times a day.
Replace with tokens; where a token is missing (success, the dark shelf backdrop), add it to
`@theme` rather than keeping the hex. Note for whoever does it: `frontend/brand-tokens.css`
(named in CLAUDE.md as the source of truth) **does not exist in the tree** — the tokens live in
`app/globals.css:5–42` `@theme`. Of the 135 hex occurrences, 54 already have an exact token
(`#f47b42`, `#1a1a1a`, `#6b6356`, `#ffdab9`, `#ffe4e1`); the rest are near-misses
(`#ded6c8` vs `--color-line #e3ddd0`, `#9f382d` vs `--color-danger #a3372a`) — i.e. a second,
slightly different palette, which is what the eye reads as «مو متناسق».

**6b · Five success/warning palettes and one blue.** Semantic colour is unsystematised — the
staff tree uses `emerald-*` 58×, `amber-*` 76×, `green-*` 11×, `red-*` 14×, and `sky-*` 21×:

- `sky-50/200/300/500/800` in `CalligraphyTool.tsx:171,1874,1991` is **blue**, the one hue the
  brand forbids, and that tool is now the embroiderer's daily screen.
- `emerald` (cold, chroma ~0.17) sits inside a warm-paper palette; `OrderCard.tsx` explicitly
  refuses «raw amber/blue/emerald/red» and uses tokens — the rest of the tree did not follow.
- Add `--color-success` (a warm olive-green, e.g. `#4f7a5a`, chroma ≤0.10) and
  `--color-warning` (`--color-orange-ink` already is one) to `@theme`, plus `-soft` tints, then
  replace. «الطقم مكتمل», «بالوقت», «تم الفصال ✓», «✓ تحقق» all become `text-success` /
  `bg-success/10`.

**6c · Two digit systems on one screen.** `toArabicDigits` is used in three files
(`PrepConsole`, `StudentSheet`, the order page) and Latin digits everywhere else. On the
preparer's screen the garment chip says «الكل ٤٠» (`PrepConsole.tsx:548`) and the row under it
says «3 قطعة» (`:598`); the sheet's nav says «١ من ٥» while its header says «3 قطعة بانتظار
العمل». AR-06: pick one. Recommendation: **Latin digits everywhere in the staff area** (they
match the K40, the order numbers, the phone keypad and `formatIQD`); delete the three
`toArabicDigits` calls.

**6d · Spacing is off-scale and unaligned.** `space-y-2.5` (10px) ×13, `space-y-1.5` (6px) ×7,
`space-y-5` (20px) ×10, `p-3.5` / `py-3.5` (14px) on the filter cards and student rows. The
scale is 4/8/12/16/24 (VP-06); none of 6, 10, 14, 20 are on it, and that is exactly the
«يحتاج مرات فراغات» feeling — gaps that are neither clearly inside a group nor clearly between
groups (VP-07). Contract for the sweep: section rhythm `space-y-4` on phone, list rhythm
`space-y-2`, row padding `px-4 py-3`, card padding one value.

**6e · Three card paddings.** `rounded-2xl border border-line bg-surface p-4` ×17, `…p-5` ×20,
`…p-6` ×1, `…p-2` ×1, plus `surface-card p-3.5` and the queue's mobile card `p-3`. On a 360px
screen `p-5` inside `p-4` main leaves 288px of content width; `p-4` leaves 296. Pick **`p-4`**
for every card on phone (`lg:p-5` if desktop wants air) — this alone removes most of the
«different phones» look, because it is the padding that changes from card to card, not the
phone.

**6f · Two back controls on the order page.** `orders/[orderId]/page.tsx:1690` renders a
text back link, then `:1714` passes `backHref` to `PageHeader`, which renders a second,
bordered back button 40px below it. Keep the PageHeader one; delete the first.

**6g · Chip strips show a scrollbar.** `globals.css:427–437` styles `*::-webkit-scrollbar
{ height: 9px }`. A styled scrollbar in a Chromium WebView is a classic always-visible one, not
an overlay — which is why two strips already opt out with `[&::-webkit-scrollbar]:hidden`
(`PrepConsole.tsx:531`, rep console `:495`) and four do not: `StageChips.tsx:102`,
`StationConsole.tsx:855` and `:960`, `queue/page.tsx:328`. Either scope the scrollbar rule to
`@media (pointer: fine)` or add the hide to a shared `chip-strip` class and use it in all six.

**6h · Tracking on Arabic and weights that do not exist.** `StaffSidebar.tsx` «المراحل» kicker is
`text-[11px] uppercase tracking-wide`; `queue/page.tsx:1441` table head is `uppercase
tracking-wider`. Letter-spacing tears a connected script (AR-02); `uppercase` does nothing in
Arabic and signals a Latin template. Separately, `app/layout.tsx:17,23` loads Cairo 400–700 and
Amiri 400/700 only; the shelf files use `font-black` / `font-extrabold` 16× (synthesised or
snapped to 700 — never what was designed) and `font-display font-semibold` asks Amiri for a 600
it does not have. Delete `tracking-*` and `uppercase` from Arabic text; cap staff weights at
`font-bold`.

---

## 7 · `/admin/attendance` on a phone  — P1 (admin only)

Four `<table>`s inside `overflow-x-auto`, all of which pan sideways at 360px:

| Table | Line | Columns | Phone behaviour |
|---|---|---|---|
| إعدادات البصمة لكل موظف | `:488–496` | 9, five of them `<Input min-h-12>` | ~1,400px wide; each row is a form. **The worst one**, and the one the plan mislabelled as the day table. |
| الخروج المؤقت (balances) | `:685–690` | 6 | pans |
| break log | `:736–743` | 8 | pans |
| تفاصيل اليوم المحدد | `:920–929` | **10** | pans; this is Task 1.3's target |
| تقويم الحضور | `:858–863` | `grid-cols-7 gap-2`, cells `min-h-24 p-2` | (296 − 40 card − 48 gaps) / 7 ≈ **30px** cells holding `text-[11px]` sentences («لا توجد بصمات») — unreadable and mostly wrapping |

The plan already turns the day table into cards (Task 1.3). Do the same shape for the other
three: one row → one `p-4` card with name + two or three facts + a single «تعديل» that opens the
per-worker form in a `Modal`. The calendar on phone becomes a 7-column strip of **dots**
(present / late / open) with the numbers below the grid for the selected day, not inside each
cell. Keep the tables behind `hidden md:block` for the laptop — the admin has one.

---

## 8 · `/staff/team` — eight controls per worker  — P2

Each `article` (`team/page.tsx:802–890`) shows, always expanded: avatar, name, phone, email,
role chips, then a `flex-wrap` of 4–5 `RoleChips` + a scope `<select>` + «تغيير كلمة المرور» +
«حذف», then the salary toggle. Seven workers × ~8 controls. It is admin/manager only and mostly
laptop, so P2 — but it is the screen the plan's Task 4.4 opens to managers on phones. On
`max-md`: name + roles as text, one «⋯» that opens the controls in a sheet; the salary panel
stays as the one expandable.

---

## 9 · Minor, still worth the sweep  — P3

- `PageLoader` (`Spinner.tsx`) is a centred spinner on every route mount; the consoles have
  skeletons already — use them as the Suspense fallback too (AP-07).
- `StatCard` value is `text-[2rem]` (32px) in `p-5`; the monitor's 6-card grid is
  `grid-cols-2` on phone → 3 rows of 100px+ before «يعمل الآن». Drop to `text-2xl` and
  `grid-cols-3`.
- `.section-heading::after` hairline is a desktop flourish; on phone it is a 1px line
  competing with card borders 8px below. `sm:` it.
- `/staff/me` shows two large money figures with different meanings (statement `net`,
  `text-4xl`; `الرصيد الحالي`, `text-2xl` in warm-veil). Both stay (two ledgers by design), but
  only one is the boss — demote the balance tile to plain `bg-surface`.
- Calligraphy tool: 2,541 lines designed for the designer's laptop; the sticky bar (`:1537`)
  packs 3 chips + a select + a `w-40` search on one row at `min-h-9`. Now that the embroiderer
  opens it on a phone, the same «one line + filter sheet» header from §1 applies. Separate task;
  do not fold it into the sweep.

---

## What is right and should not be touched

- The station model itself — students → sheet → pieces, zone ticks, the pieces view with a
  bulk bar — is the correct phone flow. Every finding above is about the chrome around it.
- Stage chips as navigation (`StageChips`, `mine` / `viewStages` from the backend) — keep the
  logic; only the strip's scrollbar and text size change.
- `Button`, `Input`, `Select`, `Modal` — the primitives are phone-correct. The leaks are where
  screens bypassed them.
- `AttendanceReminder` being a link, not a button (workshop report 2026-08-05). It moves; it
  does not become tappable-by-accident again.
- The brand: orange-ink for actions, ink on paper, Amiri/Cairo. Nothing here asks for a new
  look.
- «التفاصيل» in each PieceCard, «السابق/التالي» in the sheet, the iOS zoom guard, `.safe-top`
  on the header — all correct.

---

## The batch (Task 5.2) — order of work

1. **Tokens first** (`app/globals.css @theme`): `--text-xs`/`--text-sm` + line-heights;
   `--color-success` + tint; a `.chip-strip` utility (flex, gap-2, overflow-x-auto, scrollbar
   hidden, `pb-1`). Half an hour, no screen changes yet.
2. **`StaffBottomNav`** + `<main>` padding in `app/staff/layout.tsx`. One file, ~80 lines.
3. **`StationHeader`** and the «تصفية» sheet; wire into `StationConsole`, `PrepConsole`,
   `QueueView`. Delete the refresh buttons, subtitles, `pb-28`.
4. **Bars and sheet**: safe-area padding on the two bulk bars and `StudentSheet`'s footer; drop
   `backdrop-blur`; `dvh`. Order page mobile actions → bottom bar.
5. **Mechanical sweep** (send to a subagent, fresh context): the greps in Appendix A, one commit.
6. **Attendance tables → cards** rides Track 1's Task 1.3 branch, not this one.

Then phase 9 on a real phone — this document cannot replace that; it can only make sure the
phone pass finds nothing that was readable in the code.

---

## Appendix A · Acceptance, as greps (run from `frontend/`)

```bash
# 1. no sub-12px text in the staff tree
grep -rnE "text-\[(8|9|10|11)px\]" app/staff components/staff app/admin/attendance   # expect 0
# 2. no tap target under 44
grep -rnE "\bmin-h-(7|8|9|10)\b" app/staff components/staff                          # expect 0
# 3. every fixed bottom bar and bottom sheet pads the home indicator
grep -rlE "fixed inset-x-0 bottom-0|items-end" app/staff components/staff | xargs grep -L "safe-area-inset-bottom"   # expect empty
# 4. one card padding on phone
grep -rhoE "rounded-2xl border border-line bg-surface p-[0-9.]+" app/staff components/staff | sort | uniq -c   # one line
# 5. no raw hex, no forbidden hue, no cold semantic palette
grep -rnE "#[0-9a-fA-F]{6}\b" components/staff app/staff | grep -v "#25D366\|#128C7E"   # expect 0 (WhatsApp green is allowed)
grep -rnE "\b(bg|text|border|ring)-(sky|blue|indigo|violet|purple|emerald|green|amber|red)-" app/staff components/staff components/calligraphy   # expect 0
# 6. one digit system
grep -rn "toArabicDigits" app/staff components/staff                                   # expect 0
# 7. no tracking / uppercase on Arabic
grep -rnE "tracking-(wide|wider|widest)|uppercase" app/staff components/staff           # expect 0
# 8. no weight the fonts do not ship
grep -rnE "font-(black|extrabold)" app/staff components/staff                          # expect 0
# 9. chip strips share one utility
grep -rn "overflow-x-auto" app/staff components/staff | grep -v "chip-strip\|hidden md:block\|hidden sm:block"   # expect 0
# 10. staff has a bottom nav like the other two phone areas
grep -c "safe-area-inset-bottom" app/staff/layout.tsx 'app/(student)/layout.tsx' app/wholesaler/layout.tsx   # all ≥ 1
```

Plus the fold arithmetic from §1 redone on `StationConsole` after step 3: first row must start
under 200px.

## Appendix B · Deterministic scan (Assessment B, run in isolation)

`impeccable/scripts/detect.mjs --json` over `app/staff` (20 files), `components/staff` (27),
`app/admin/attendance` (1): **exit 0, `[]`, all three** — zero findings across the 47 rules.
Validated, not assumed: `.tsx` is scannable, no ignore config exists, and a positive-control file
with `from-purple-500` / Inter / 9px text fired exactly the expected rules. What that proves is
narrow: the static detector reads CSS files and inline styles for size/spacing/contrast and
**does not evaluate Tailwind utility classes**, so its silence on `text-[10px]` or `min-h-9` is
a coverage gap, not a pass. The greps are the evidence on those axes.

The census agrees with the read above and sharpens four numbers:

| Axis | Count in the three targets |
|---|---|
| `text-xs` / `text-[11px]` / `text-[10px]` / `text-[9px]` tokens | 225 / 45 / 25 / 3 (= 298) |
| Physical-direction Tailwind classes (`ml-` `mr-` `pl-` `pr-` `left-` `right-` `rounded-l/r`) | **0** — the RTL discipline is real; the only hits are 2× `text-right` on tables under `dir="rtl"` (renders as start), plus 3 string literals |
| Fixed heights under 44px on interactive elements | `h-9` ×4, `min-h-9` ×8, `min-h-10` ×5, `min-h-8` ×2 |
| Bottom-anchored surfaces (`fixed … bottom-0/6`, `items-end` sheets) without `safe-area-inset-bottom` | 8 of 8 |
| Off-token hue classes | emerald/green 60, amber 25, **no blue in these three targets** (the 21× `sky-*` are in `components/calligraphy`, outside the scan) |
| Inline hex | 135, of which 85 in `components/staff/shelf/` and 4 WhatsApp greens on the order page |
| Files with zero responsive prefix | 24 of 48 |
| Spacing steps in use | 0.5 · 1 · 1.5 · 2 · 2.5 · 3 · 3.5 · 4 · 5 · 6 · 10 (11 steps; the scale has 5 under 32px) |

Browser overlay: skipped — no dev server was running and the harness cannot resize Chrome on
this machine, which is the constraint this whole document is written around.
