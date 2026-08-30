# Verified copy + numbers — LoloShop (**re-pulled from production 2026-08-25**)

**Nothing in a reel may contradict this file, and nothing may be invented.**
Every number below was read off `lolo-shop96.com/api/catalog/shop` on 2026-08-25.

⚠️ **The 2026-08-22 version of this file was already wrong when it was written.** The
discount round was ENDED on prod that same day (batch `12198690…`, 51 retail prices
restored **+5,000 each**) and this file was pulled *before* that ran — so it recorded
the discounted prices as if they were the real ones. Every price here except قبعات and
قبعة ملكة was understated by exactly 5,000, and all four compositions had those numbers
baked in. A reel built on the old file advertises prices **below what the shop charges**.

**Re-verify before every render — it is one command, and prices move:**
```bash
curl -s https://lolo-shop96.com/api/catalog/shop \
 | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];\
[print(k,len(v),min(p['base_price'] for p in v)) for k,v in d['by_type'].items()];\
print('graduates',d['graduates'])"
```

## Brand
- Name: **لولو شوب** / Lolo Shop · Instagram **@lolo_shop96** · site **lolo-shop96.com**
- App: iOS `apps.apple.com/app/id6793976053` · Android `com.loloshop96.app`
- What it is: graduation sashes (أوشحة), robes (روبات), caps (قبعات), shawls (شالات)
  for Iraqi universities. Own workshop in **ديالى / بعقوبة**. **Cash on delivery only.**
- Register (PRODUCT.md): **couture, cinematic, composed.** Pride, elegance, anticipation.
  Calm and confident, never loud or salesy. No urgency marketing, no startup gloss.

## Numbers (live)
| number | meaning |
|---|---|
| ٢٬١٠١ | طالب وطالبة سجّلوا معنا (home hero) — **was ٢٬٠١٧ on 08-22; it grows, re-read it** |
| ٥٤ | total models in /shop (11+21+5+17 — unchanged since 08-22) |
| ١١ | وشاحات · from **٢٠٬٠٠٠ د.ع** *(file said ١٥٬٠٠٠)* |
| ٢١ | روبات · from **٢٥٬٠٠٠ د.ع** *(file said ٢٠٬٠٠٠ — لولو answers ٢٥٬٠٠٠ live, and لولو is right)* |
| ٥ | قبعات · from **١٠٬٠٠٠ د.ع** *(unchanged)* |
| ١٧ | شالات · **٣٠٬٠٠٠ د.ع** *(file said ٢٥٬٠٠٠)* |

Full sets (6): طقم ميلانو ١٥٠٬٠٠٠ · طقم كولد ١٤٥٬٠٠٠ · طقم أصالة ١٤٠٬٠٠٠ ·
طقم روز ١٤٠٬٠٠٠ · طقم اريج ١٣٥٬٠٠٠ · طقم سارة ١٣٥٬٠٠٠ د.ع.

Products with photos in `assets/` — **all re-read 2026-08-25**: وشاح مثلث ملكي **٣٠٬٠٠٠**
(`p-sash-royal.jpg`) · وشاح الفراشة **٣٠٬٠٠٠** (`p-sash-butterfly.jpg`) · وشاح عدل
**٢٠٬٠٠٠** (`p-sash-plain.jpg`) · روب فصال امريكي زم **٤٠٬٠٠٠** (`p-robe-am.jpg`) ·
قبعة ملكة **١٥٬٠٠٠** (`p-cap-queen.jpg`, the only one that did not move).
Use `٬` (U+066C) as the thousands mark and Arabic-Indic digits, exactly like the app.

## Copy that exists on the live site — reuse it, do not paraphrase into something new
- «أوشحة وروبات وقبعات بأسماء الطلاب وكلياتهم — للطالب الواحد أو للدفعة كاملة.
   نخيطها بورشتنا ونسلّمها قبل موعد الحفل.»
- «دفعتك كلها تقدر تطلب سوية» · «طالب وطالبة سجّلوا معنا»
- «الاسم والكلية مطرّزين بالخيط · مخيوط بورشتنا · الدفع نقداً عند التسليم»
- «افضل اللحظات تطرز من اصحاب الخبرة»
- **ليش لولو شوب؟** (the four rows, verbatim)
  1. **الاسم مطرّز بالخيط** — بالخط العربي، مو طباعة تنمسح بعد غسلة.
  2. **نخيطه بورشتنا** — إحنا اللي نفصّل ونطرّز، مو وسيط يشتري ويبيع.
  3. **محل حقيقي بديالى** — تعال شوف القماش بعينك قبل الطلب.
  4. **الدفع نقداً عند التسليم** — ما تدفع ولا دينار هسه.
- Lolo, the in-app assistant: «هلا! آني لولو» · «اسألني عن الأسعار، طلبك، أو ممثل جامعتك
  — أردّ عليك خلال ثواني.» · «متواجدة الآن»
- Store listing: «صمّم وشاح وروب تخرّجك الفاخر مع لولو شوب — أزياء التخرّج للجامعات العراقية»

## CTA — the point of all three reels
«حمّل تطبيق لولو شوب» · «دوّر على «لولو شوب» بمتجر التطبيقات» · App Store + Google Play.

## Assets
`assets/` — fonts (Amiri, Cairo, Playfair, Great Vibes), `logo.png` (900×1000, cropped
tight), `app-icon.png` (512), five product cutouts `p-*.jpg` (600w), photography
`ph-*.jpg`: onboarding-hero (model in an embroidered robe, 1080×1920), grad-moments-1/2
(real cohort photos), grad-diyala, grad-crowd-hero, look-boutique (**the actual shop
interior with the lolo sign** — this is the «محل حقيقي بديالى» proof shot),
look-english-red, look-pharmacy-blue, detail-flatlay, detail-pedestal (blue sash with
Arabic embroidery on a plinth — the best product still), gown-sash.

`app/` — real screens of the live app captured at iPhone 17 Pro Max size (440×894 pt,
700px wide jpgs): home, shop, product, product-opts, why, lolo, vip, package, cart.
`strip-shop.jpg` / `strip-home.jpg` are 2400 CSS px tall strips of the same pages with
the fixed chrome hidden, for scrolling inside the device under `chrome-header.jpg`
(104px) and `chrome-tabbar.jpg` (112px).
