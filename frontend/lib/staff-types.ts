import type { DesignApprovalStatus, OrderStatus } from "./types";

export type StaffListFilter = "all" | "review" | "printing" | "done";

export interface StaffOrder {
  id: string;
  studentId: string;
  studentName: string;
  universityName: string | null;
  department: string | null;
  productName: string;
  status: OrderStatus;
  createdAt: string;
}

export interface StaffDesign {
  id: string;
  student_name: string;
  phone: string;
  university_name: string | null;
  department: string | null;
  sash_color: string | null;
  left_canvas: unknown | null;
  right_canvas: unknown | null;
  logo_url: string | null;
  extra_image_url: string | null;
  fonts_used: string[];
  notes: string | null;
  completed: boolean;
}

/** Raw row from GET /admin/orders (API.md) — student_id TODO on backend */
interface ApiOrderRow {
  id: string;
  student_id?: string;
  student_full_name: string;
  product_name: string;
  wholesaler_name?: string | null;
  price?: number;
  cost?: number | null;
  profit?: number;
  status: OrderStatus;
  created_at: string;
  university_name?: string | null;
  department?: string | null;
}

export function mapApiOrderRow(row: ApiOrderRow): StaffOrder {
  return {
    id: row.id,
    studentId: row.student_id || row.id,
    studentName: row.student_full_name,
    universityName: row.university_name ?? null,
    department: row.department ?? null,
    productName: row.product_name,
    status: row.status,
    createdAt: row.created_at,
  };
}

// ─── Production pipeline types ────────────────────────────────────────────────

/** Row from GET /production/queue */
export interface ProductionQueueItem {
  id: string;
  status: OrderStatus;
  created_at: string;
  design_id: string | null;
  student_name: string;
  university_name: string | null;
  department: string | null;
  product_name: string;
  product_type: string;
  batch_name: string | null;
  deadline: string | null;
  approval_status: DesignApprovalStatus | null;
  rejection_reason: string | null;
  /** Populated by backend: "retail" or "wholesaler". */
  source: "retail" | "wholesaler";
  /** Populated only when source === "wholesaler". */
  wholesaler_name: string | null;
  /** Non-null when this order belongs to a multi-item checkout bundle. */
  checkout_group_id: string | null;
  /** Staff presence — who is actively working on this order (admin monitor). */
  working_staff_id?: string | null;
  working_staff_name?: string | null;
  working_since?: string | null;
}

/** One item in the `items[]` array on the production order detail */
export interface ProductionOrderItem {
  label_snapshot: string;
  price_snapshot: number;
  qty: number;
  customer_image_url: string | null;
  /** Student's typed embroidery instruction (cap/sleeve embroidery). */
  customer_text: string | null;
  group_id: string | null;
  option_id: string | null;
}

/** Sibling order in a package (cap/robe/sash bundle) */
export interface PackageOrderSibling {
  id: string;
  status: OrderStatus;
  price: number;
  product_name: string;
  product_type: string;
}

/**
 * Item in the `bundle` array on a production order detail.
 * Returned only when the order is part of a multi-item checkout group.
 * is_current=true marks the order currently being viewed.
 */
export interface BundleItem {
  id: string;
  status: OrderStatus;
  price: number;
  product_name: string;
  product_type: string;
  is_current: boolean;
}

/** Full detail from GET /production/orders/:id */
export interface ProductionOrderDetail {
  order: {
    id: string;
    status: OrderStatus;
    created_at: string;
    design_id: string | null;
    package_id: string | null;
    batch_id: string | null;
    student_id: string;
    student_name: string;
    student_phone: string;
    university_name: string | null;
    department: string | null;
    gender: string | null;
    /** Study schedule — "morning" (صباحي) or "evening" (مسائي). */
    study_type: "morning" | "evening" | null;
    /** Instagram handle (no leading @) — used by staff/admin to contact the student. */
    instagram_username: string | null;
    product_name: string;
    product_type: string;
    batch_name: string | null;
    deadline: string | null;
    /** Order source — "retail" or "wholesaler". */
    source: "retail" | "wholesaler";
    /** Wholesaler display name; null for retail orders. */
    wholesaler_name: string | null;
    /** Routing flags (batch update). */
    has_embroidery?: boolean;
    needs_pressing?: boolean;
    /** Robe tailoring measurements {shoulder_cm, robe_length_cm, sleeve_length_cm}. */
    measurements?: { shoulder_cm: number; robe_length_cm: number; sleeve_length_cm: number } | null;
    /** Final design image uploaded by admin/designer (replaces PDF). */
    final_design_url?: string | null;
    /** Staff presence — who is actively working on this order. */
    working_staff_id?: string | null;
    working_staff_name?: string | null;
    working_since?: string | null;
    /** Total order price — returned ONLY for admin + embroiderer. */
    price?: number;
  };
  design: {
    id: string;
    sash_color: string | null;
    approval_status: DesignApprovalStatus;
    rejection_reason: string | null;
    completed: boolean;
    /** Only present when can_see_design=true */
    left_canvas?: unknown | null;
    right_canvas?: unknown | null;
    logo_url?: string | null;
    extra_image_url?: string | null;
    fonts_used?: string[];
    notes?: string | null;
  } | null;
  items: ProductionOrderItem[];
  package_orders: PackageOrderSibling[] | null;
  /**
   * Full bundle context for the checkout group this order belongs to.
   * null when the order was not part of a multi-item bundle checkout.
   * Each entry has is_current=true for the order being viewed.
   * `package_orders` is a backward-compat alias — prefer `bundle`.
   */
  bundle: BundleItem[] | null;
  can_see_design: boolean;
  /** Actions the requesting user may perform on this order right now.
   *  Derived server-side from the same state machine used by POST handlers. */
  available_actions: {
    advance: { to: string; label: string } | null;
    revert: { to: string } | null;
    can_approve: boolean;
    can_reject: boolean;
  };
}

// ─── Monitor types ────────────────────────────────────────────────────────────

export interface MonitorData {
  wip: Partial<Record<OrderStatus, number>>;
  throughput: {
    actor_id: string;
    name: string;
    staff_type: string;
    actions: number;
    last_action: string | null;
  }[];
  overdue: {
    id: string;
    student_name: string;
    product_name: string;
    status: OrderStatus;
    batch_name: string | null;
    deadline: string;
  }[];
  stale: {
    id: string;
    student_name: string;
    status: OrderStatus;
    updated_at: string;
    hours_in_stage: number;
  }[];
}
