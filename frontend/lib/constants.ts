import type { OrderStatus, ProductType, StaffOrderScope, StaffType, UserRole } from "./types";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_approval: "بانتظار الموافقة",
  designing: "قيد التصميم",
  design_complete: "اكتمل التصميم",
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
  embroiderer: "تطريز",
  presser: "مكوجي",
  preparer: "مجهّز",
  manager: "مدير الإنتاج",
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

export const ORDER_STATUS_OPTIONS: OrderStatus[] = [
  "pending_approval",
  "designing",
  "design_complete",
  "staff_review",
  "printing",
  "embroidery",
  "pressing",
  "preparing",
  "ready",
  "delivered",
  "cancelled",
];
