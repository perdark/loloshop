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
  | "robe_pleat" | "robe_no_pleat";
export const EMBROIDERY_ZONE_LABELS: Record<EmbroideryZone, string> = {
  sash_right: "وشاح — تطريز يمين",
  sash_left: "وشاح — تطريز يسار",
  sash_back: "وشاح — تطريز خلف",
  cap_side: "قبعة — تطريز جانب",
  cap_top: "قبعة — تطريز أعلى",
  robe_pleat: "روب — بكسرات",
  robe_no_pleat: "روب — بدون كسرات",
};
export const EMBROIDERY_ZONE_ORDER: EmbroideryZone[] = [
  "sash_right", "sash_left", "sash_back", "cap_side", "cap_top", "robe_pleat", "robe_no_pleat",
];

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
