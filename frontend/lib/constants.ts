import type { OrderStatus, ProductType, UserRole } from "./types";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_approval: "بانتظار الموافقة",
  designing: "قيد التصميم",
  design_complete: "اكتمل التصميم",
  staff_review: "مراجعة الموظف",
  printing: "قيد الطباعة",
  ready: "جاهز للاستلام",
  delivered: "تم التسليم",
  cancelled: "ملغي",
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

export const ORDER_STATUS_OPTIONS: OrderStatus[] = [
  "pending_approval",
  "designing",
  "design_complete",
  "staff_review",
  "printing",
  "ready",
  "delivered",
  "cancelled",
];
