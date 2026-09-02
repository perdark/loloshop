import type { OrderStatus, ProductType, StaffOrderScope, StaffType, UserRole } from "./types";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_approval: "بانتظار الموافقة",
  designing: "قيد التصميم",
  design_complete: "بانتظار التصميم",
  converting: "تحويل التصميم لتطريز",
  staff_review: "مراجعة الموظف",
  printing: "قيد الطباعة",
  embroidery: "قيد التطريز",
  pressing: "قيد الكوي",
  preparing: "قيد التجهيز",
  ready: "جاهز للاستلام",
  delivered: "تم التسليم",
  cancelled: "ملغي",
};

/**
 * The production line in the order a piece walks it — DISPLAY ORDER ONLY.
 *
 * ⚠️ This is not an access list and must never be used as one. What a staff member may SEE
 * comes from the queue response's `view_stages`, what is THEIRS from `my_stages`, and what
 * they may MOVE from each row's own `can_advance`. This array only decides the order the
 * chips are drawn in. `converting` is included because legacy orders still sit there
 * (stage-2 was removed 2026-07-15) and `delivered` because the preparer owns the done column.
 */
export const PRODUCTION_STAGE_ORDER: OrderStatus[] = [
  "design_complete",
  "converting",
  "embroidery",
  "pressing",
  "preparing",
  "ready",
  "delivered",
];

/** Staff job-type → Arabic label (production pipeline roles). */
export const STAFF_TYPE_LABELS: Record<StaffType, string> = {
  designer: "مصمم",
  digitizer: "محوّل التطريز",
  embroiderer: "تطريز",
  presser: "مكوجي",
  preparer: "مجهّز",
  manager: "مدير الإنتاج",
  tailor: "مفصل",
};

/** Study schedule (mandatory at signup). */
export const STUDY_TYPE_LABELS: Record<"morning" | "evening", string> = {
  morning: "صباحي",
  evening: "مسائي",
};

/** Salary ledger entry kind → Arabic label. */
export const SALARY_TXN_LABELS: Record<"salary_set" | "bonus" | "deduction", string> = {
  salary_set: "تحديد الراتب",
  bonus: "حافز",
  deduction: "خصم",
};

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  sash: "وشاح",
  robe: "روب",
  cap: "قبعة",
  shawl: "شال",
};

/** Shop page section headings (plural) */
export const SHOP_SECTION_TITLES: Record<ProductType, string> = {
  sash: "وشاحات",
  robe: "روبات",
  cap: "قبعات",
  shawl: "شالات",
};

export const SHOP_TYPE_ORDER: ProductType[] = ["sash", "robe", "cap", "shawl"];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "مدير",
  staff: "موظف",
  wholesaler: "ممثل جامعة",
  retail: "طالب",
  worker: "عامل ورشة",
  design_helper: "أيادي التصميم",
};

export const ORDER_SCOPE_LABELS: Record<StaffOrderScope, string> = {
  retail: "طلبات التجزئة",
  wholesaler: "طلبات الممثلين",
  both: "كل الطلبات",
};

export const ORDER_SOURCE_LABELS: Record<"retail" | "wholesaler", string> = {
  retail: "تجزئة",
  wholesaler: "ممثل",
};

/** Embroidery-zone / pleat filter keys → Arabic labels (staff queue + admin orders).
 *  Lets design/embroidery/transfer/admin show only e.g. sashes with right-side embroidery. */
export type EmbroideryZone =
  | "sash_right" | "sash_left" | "sash_back"
  | "cap_side" | "cap_top"
  | "robe_pleat" | "robe_no_pleat"
  // Merged garment-level keys — التجهيز only. MIRROR backend ORDER_ZONE_MATCH.
  | "sash_any" | "cap_any";
export const EMBROIDERY_ZONE_LABELS: Record<EmbroideryZone, string> = {
  sash_right: "وشاح — تطريز يمين",
  sash_left: "وشاح — تطريز يسار",
  sash_back: "وشاح — تطريز خلف",
  cap_side: "قبعة — تطريز جانب",
  cap_top: "قبعة — تطريز أعلى",
  robe_pleat: "روب — بكسرات",
  robe_no_pleat: "روب — بدون كسرات",
  // Merged garment-level chips (التجهيز). No «— تطريز يمين» suffix on purpose: the whole
  // point is that the preparer sees a GARMENT, not an embroidery position.
  sash_any: "وشاح",
  cap_any: "قبعة",
};
export const EMBROIDERY_ZONE_ORDER: EmbroideryZone[] = [
  "sash_right", "sash_left", "sash_back", "cap_side", "cap_top", "robe_pleat", "robe_no_pleat",
];
/** ⚠️ قائمة الإنتاج's piece filter for المكوجي + المجهز — the GARMENT, not the position.
 *
 *  Every key above is a predicate over `order_items.label_snapshot`, so it can only ever
 *  list a piece that CARRIES embroidery. A plain شال امريكي carries none (its two lines are
 *  «السعر الأساسي» and «صورة الشال: شال», and migration 096 marks that picker
 *  `is_embroidery = FALSE`), so no zone chip can reach one — measured on the dev DB: 0 of
 *  600 شال orders in the line match ANY chip on that page. `products.type` is the only
 *  handle every piece has. Same ruling PrepConsole's GARMENT_ORDER already carries.
 *
 *  This REPLACES the `PREPARER_ZONE_ORDER` chip set (owner 2026-08-14: «sash_any, cap_any,
 *  robe_pleat, robe_no_pleat»). That decision's surviving half is the روب pair below —
 *  بكسرات/بدون كسرات is a garment SPEC the preparer genuinely picks by (86 vs 116 pieces on
 *  the live queue, measured then), and it is the one thing `product_type` cannot say. Its
 *  other half, `sash_any`/`cap_any`, is gone: both are in ZONE_NEEDS_CONTENT, so they listed
 *  only pieces that CARRY embroidery and hid a plain وشاح عدل the same way they hid the شال.
 *  وشاح and قبعة are garment chips now and reach every piece. */
export const GARMENT_FILTER_ORDER: ProductType[] = ["sash", "robe", "cap", "shawl"];
export const GARMENT_VIEW_ZONE_ORDER: EmbroideryZone[] = ["robe_pleat", "robe_no_pleat"];

/** Wholesaler full-set (طقم) embroidery zones — match the label set persisted by
 *  backend/lib/fullSetOrder.js. Used by the rep-scoped orders console so an embroiderer
 *  can batch by zone ("10 وشاح أمام، ثم 10 قبعات…"). Distinct from the retail zones above. */
export type FullSetZone =
  | "sash_front" | "sash_back"
  | "cap_side" | "cap_top"
  | "robe_sleeve_right" | "robe_sleeve_left"
  | "american_shawl";
export const FULLSET_ZONE_LABELS: Record<FullSetZone, string> = {
  sash_front: "وشاح — أمام",
  sash_back: "وشاح — خلف",
  cap_side: "قبعة — جانب",
  cap_top: "قبعة — أعلى",
  robe_sleeve_right: "روب — ردن أيمن",
  robe_sleeve_left: "روب — ردن أيسر",
  american_shawl: "شال أمريكي",
};
export const FULLSET_ZONE_ORDER: FullSetZone[] = [
  "sash_front", "sash_back", "cap_side", "cap_top", "robe_sleeve_right", "robe_sleeve_left", "american_shawl",
];

export const ORDER_STATUS_OPTIONS: OrderStatus[] = [
  "pending_approval",
  "designing",
  "design_complete",
  "converting",
  "staff_review",
  "printing",
  "embroidery",
  "pressing",
  "preparing",
  "ready",
  "delivered",
  "cancelled",
];

// Password policy — MIRRORS backend/lib/password.js. Keep the two in sync; the backend is
// the one that actually enforces it, these only give the user a message before they submit.
// Customers (students) get a lower bar than privileged accounts on purpose — see the
// backend file for the reasoning.
export const PASSWORD_MIN_CUSTOMER = 8;
export const PASSWORD_MIN_PRIVILEGED = 8;

/** The shop's public contact channels.
 *
 *  Plain constants, not env vars: both are printed on the shop's own Instagram and belong in
 *  the client bundle anyway, and a NEXT_PUBLIC_* var would be inlined at build time — so a
 *  change would need a rebuild rather than an edit. Kept here so there is ONE place to change
 *  the number; the sizes page previously carried `https://wa.me/964`, a country code with no
 *  number behind it, which rendered a button that opened WhatsApp at nothing. */
export const SHOP_WHATSAPP = "9647723078729";
export const SHOP_WHATSAPP_URL = `https://wa.me/${SHOP_WHATSAPP}`;
export const SHOP_INSTAGRAM_URL = "https://instagram.com/lolo_shop96";
