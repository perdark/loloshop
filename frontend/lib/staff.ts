import { api, apiUploadFile } from "./api";
import type {
  CreateFullSetPayload,
  FullSetExistingOrder,
  FullSetPackage,
  FullSetPricing,
} from "./wholesaler";
import type {
  OrderStatus,
  SalaryTxnType,
  StaffActivity,
  StaffAttendanceRecord,
  StaffAttendanceSettings,
  StaffGoal,
  StaffSalary,
  StudyType,
  ProductType,
  RobeMeasurements,
} from "./types";
import type { ConfigureSelectionPayload } from "./orders";
import {
  mapApiOrderRow,
  type MonitorData,
  type ProductionOrderDetail,
  type ProductionQueueItem,
  type StaffDesign,
  type StaffListFilter,
  type StaffOrder,
} from "./staff-types";

const STAFF_ACTION_STATUSES: OrderStatus[] = [
  "design_complete",
  "staff_review",
  "printing",
];

const FILTER_STATUSES: Record<StaffListFilter, OrderStatus[]> = {
  all: [...STAFF_ACTION_STATUSES, "ready", "delivered"],
  review: ["design_complete", "staff_review"],
  printing: ["printing"],
  done: ["ready", "delivered"],
};

function filterOrders(orders: StaffOrder[], filter: StaffListFilter): StaffOrder[] {
  const allowed = FILTER_STATUSES[filter];
  return orders.filter((o) => allowed.includes(o.status));
}

export async function getStaffOrders(
  filter: StaffListFilter = "all"
): Promise<StaffOrder[]> {
  const statuses =
    filter === "all"
      ? FILTER_STATUSES.all
      : FILTER_STATUSES[filter];

  const batches = await Promise.all(
    statuses.map(async (status) => {
      const { data } = await api.get<{
        data: Parameters<typeof mapApiOrderRow>[0][];
      }>("/orders", { params: { status } });
      return (data.data || []).map(mapApiOrderRow);
    })
  );

  const byId = new Map<string, StaffOrder>();
  batches.flat().forEach((o) => byId.set(o.id, o));

  return filterOrders([...byId.values()], filter).sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function getStaffOrderById(
  orderId: string
): Promise<StaffOrder | null> {
  const orders = await getStaffOrders("all");
  return orders.find((o) => o.id === orderId) ?? null;
}

export async function getDesignByStudent(
  studentId: string
): Promise<StaffDesign> {
  const { data } = await api.get<{ data: StaffDesign }>(
    `/designs/student/${studentId}`
  );
  return data.data;
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus
): Promise<void> {
  await api.patch(`/orders/${orderId}/status`, { status });
}

export { FILTER_STATUSES, STAFF_ACTION_STATUSES };

// ─── Production pipeline API wrappers ─────────────────────────────────────────

/**
 * GET /production/queue?stage=<optional>&source=<optional>
 * Server auto-scopes to the calling staff member's stage;
 * pass `stage` explicitly to filter (manager/admin only).
 * `source` is only honoured by the backend for manager/admin/both-scope staff.
 */
export async function getQueue(
  stage?: OrderStatus,
  source?: "retail" | "wholesaler",
  zone?: string,
  station?: boolean
): Promise<ProductionQueueItem[]> {
  const params: Record<string, string> = {};
  if (stage) params.stage = stage;
  if (source) params.source = source;
  if (zone) params.zone = zone;
  if (station) params.station = "1"; // enrich rows with zones / advance grants (station console)
  const { data } = await api.get<{ data: ProductionQueueItem[] }>("/production/queue", {
    params: Object.keys(params).length ? params : undefined,
  });
  return data.data ?? [];
}

/**
 * GET /production/orders/:id
 * Returns the projected detail respecting the caller's staff_type
 * (presser sees no canvas; can_see_design=false).
 */
export async function getProductionOrder(id: string): Promise<ProductionOrderDetail> {
  const { data } = await api.get<{ data: ProductionOrderDetail }>(
    `/production/orders/${id}`
  );
  return data.data;
}

export async function deleteProductionOrder(id: string): Promise<number> {
  const { data } = await api.delete<{ data: { deleted: number } }>(`/production/orders/${id}`);
  return data.data.deleted;
}

// ─── Admin/مدير الإنتاج order editing (/api/production, manager+admin) ────────

export interface StudentSearchHit {
  id: string;
  name: string;
  phone: string | null;
  university_name: string | null;
  wholesaler_id: string | null;
  rep_name: string | null;
  /** Needed by the single-piece retail form: option groups are gender-scoped. */
  gender: "male" | "female";
  has_full_set: boolean;
  /** true → rep-linked or admin-created name-only → the طقم form.
   *  false → self-registered تجزئة student → the single-piece retail form. The two
   *  server guards are exact complements, so this flag picks the ONLY form that works. */
  full_set_eligible: boolean;
}

export async function searchProductionStudents(q: string): Promise<StudentSearchHit[]> {
  const { data } = await api.get<{ data: StudentSearchHit[] }>("/production/students-search", {
    params: { q },
  });
  return data.data ?? [];
}

export interface StudentFullSetContext {
  existing: FullSetExistingOrder | null;
  pricing: FullSetPricing | null;
}

/** Read-back used by the custom-order picker so a picked student's طقم pre-fills. */
export async function getStudentFullSetContext(studentId: string): Promise<StudentFullSetContext> {
  const { data } = await api.get<{ data: StudentFullSetContext }>(
    `/production/students/${studentId}/full-set-order`
  );
  return data.data;
}

export interface OrderEditStudent {
  id: string;
  name: string;
  phone: string | null;
  gender: "male" | "female";
  instagram_username: string | null;
  university_name: string | null;
  department: string | null;
  study_type: StudyType | null;
  wholesaler_id: string | null;
  rep_name: string | null;
}

export interface OrderEditGroup {
  id: string;
  customer_name: string;
  instagram_username: string | null;
  phone_primary: string;
  phone_secondary: string | null;
  notes: string | null;
}

export interface OrderEditContext {
  student: OrderEditStudent;
  group: OrderEditGroup | null;
  existing: FullSetExistingOrder | null;
  pricing: FullSetPricing | null;
  can_edit_full_set: boolean;
  edit_mode: "full_set" | "retail" | "limited";
  /** The order's own typed spec lines (e.g. «تطريز الوشاح» → «احمد») — editable via
   *  the limited (quick) editor when `can_edit_full_set` is false (retail orders). */
  editable_items: { id: string; label: string; text: string }[];
  retail_order: RetailOrderEditSnapshot | null;
}

/** A sibling product this piece may be re-pointed at («وشاح الفراشة» → «وشاح ملكي»).
 *  Same family + same type only, and never one the student already holds a live piece of. */
export interface ProductSwapCandidate {
  id: string;
  name_ar: string;
  image_url: string | null;
  retail_price: number;
}

export interface RetailOrderEditSnapshot {
  id: string;
  product_id: string;
  product_parent_id: string | null;
  swap_candidates: ProductSwapCandidate[];
  product_type: ProductType;
  product_name: string;
  status: OrderStatus;
  /** Backend-owned: is «أرجع الطلب إلى بانتظار التصميم» meaningful at this stage? */
  can_force_rework: boolean;
  price: number;
  cost: number;
  measurements: RobeMeasurements | null;
  has_embroidery: boolean;
  needs_pressing: boolean;
  tailor_status: "pending" | "done";
  quantity: number;
  selections: Array<{
    group_id: string;
    option_id: string;
    qty: number;
    customer_text: string | null;
    customer_image_url: string | null;
  }>;
}

export async function getOrderEditContext(orderId: string): Promise<OrderEditContext> {
  const { data } = await api.get<{ data: OrderEditContext }>(
    `/production/orders/${orderId}/edit-context`
  );
  return data.data;
}

export interface StudentInfoPayload {
  name?: string;
  instagram_username?: string;
  phone_primary?: string;
  phone_secondary?: string;
  university_name?: string;
  department?: string;
  /** "" clears it back to NULL. */
  study_type?: StudyType | "";
}

export async function saveStudentFullSetOrder(
  studentId: string,
  payload: CreateFullSetPayload & { student_info?: StudentInfoPayload }
): Promise<{ total: number; packageName: string }> {
  const { data } = await api.post<{ data: { total: number; package_name: string } }>(
    `/production/students/${studentId}/full-set-order`,
    payload
  );
  return { total: data.data.total, packageName: data.data.package_name };
}

export interface QuickEditPayload {
  items?: { item_id: string; customer_text: string }[];
  student?: {
    name?: string;
    instagram_username?: string;
    university_name?: string;
    department?: string;
    /** "" clears it back to NULL. */
    study_type?: StudyType | "";
  };
  group?: { phone_primary?: string; phone_secondary?: string; notes?: string };
}

export async function patchOrderDetails(orderId: string, body: QuickEditPayload): Promise<void> {
  await api.patch(`/production/orders/${orderId}/details`, body);
}

export interface SaveRetailOrderResult {
  id: string;
  oldPrice: number;
  /** What the selections re-price to — reported even when the price was frozen. */
  newPrice: number;
  priceDifference: number;
  /** What was actually written to the order (equals oldPrice when keepPrice was set). */
  priceApplied: number;
  priceKept: boolean;
  productChanged: boolean;
  productId: string;
  productName: string;
  cost: number;
  profit: number;
  status: OrderStatus;
  designRework: boolean;
  tailorReopened: boolean;
}

export async function saveRetailOrderConfiguration(
  orderId: string,
  body: {
    selections: ConfigureSelectionPayload[];
    /** Same-family sibling to move the piece onto. Omit to keep the current product. */
    product_id?: string;
    /** Freeze orders.price at its current value (an agreed price the admin already quoted). */
    keep_price?: boolean;
    /** Explicitly send the piece back to «بانتظار التصميم» for rework. */
    force_design_rework?: boolean;
    measurements?: RobeMeasurements;
    student?: {
      name?: string;
      instagram_username?: string;
      university_name?: string;
      department?: string;
      study_type?: StudyType | "";
    };
    group?: { phone_primary?: string; phone_secondary?: string };
  }
): Promise<SaveRetailOrderResult> {
  const { data } = await api.put<{
    data: {
      id: string;
      old_price: number;
      new_price: number;
      price_difference: number;
      price_applied: number;
      price_kept: boolean;
      product_changed: boolean;
      product_id: string;
      product_name: string;
      cost: number;
      profit: number;
      status: OrderStatus;
      design_rework: boolean;
      tailor_reopened: boolean;
    };
  }>(`/production/orders/${orderId}/retail-configuration`, body);
  return {
    id: data.data.id,
    oldPrice: Number(data.data.old_price),
    newPrice: Number(data.data.new_price),
    priceDifference: Number(data.data.price_difference),
    priceApplied: Number(data.data.price_applied),
    priceKept: Boolean(data.data.price_kept),
    productChanged: Boolean(data.data.product_changed),
    productId: data.data.product_id,
    productName: data.data.product_name,
    cost: Number(data.data.cost),
    profit: Number(data.data.profit),
    status: data.data.status,
    designRework: Boolean(data.data.design_rework),
    tailorReopened: Boolean(data.data.tailor_reopened),
  };
}

/** One piece of a «طلب مخصص» — a catalog product plus the student's choices on it. */
export interface RetailOrderPiecePayload {
  product_id: string;
  selections: ConfigureSelectionPayload[];
  measurements?: RobeMeasurements;
}

/** The student block when «طلب مخصص» is creating an independent (بدون ممثل) student.
 *  name/phone/gender are REQUIRED server-side: the phone is what makes this a تجزئة
 *  student the retail edit path owns for life, and gender decides which option groups
 *  exist at all. */
export interface NewRetailStudentPayload {
  name: string;
  phone: string;
  gender: "male" | "female";
  instagram_username?: string;
  university_name?: string;
  department?: string;
  study_type?: "morning" | "evening";
}

export interface RetailOrderDeliveryPayload {
  customer_name?: string;
  instagram_username?: string;
  phone_primary?: string;
  phone_secondary?: string;
  governorate?: string;
  area_details?: string;
  event_date?: string;
  notes?: string;
}

export interface CreatedRetailOrder {
  id: string;
  product_id: string;
  product_name: string;
  price: number;
  status: OrderStatus;
}

/** «طلب مخصص» priced at the retail book — one brand-new bundle holding every piece.
 *  Pass `student_id` for an existing تجزئة student, or `student` to create an independent
 *  one. The complement of `saveStudentFullSetOrder`: exactly one of the two works for any
 *  given student (see `StudentSearchHit.full_set_eligible`). */
export async function createRetailOrders(body: {
  student_id?: string;
  student?: NewRetailStudentPayload;
  pieces: RetailOrderPiecePayload[];
  group?: RetailOrderDeliveryPayload;
}): Promise<{
  studentId: string;
  checkoutGroupId: string;
  orders: CreatedRetailOrder[];
  total: number;
}> {
  const { data } = await api.post<{
    data: {
      student_id: string;
      checkout_group_id: string;
      orders: CreatedRetailOrder[];
      total: number;
    };
  }>(`/production/retail-orders`, body);
  return {
    studentId: data.data.student_id,
    checkoutGroupId: data.data.checkout_group_id,
    orders: data.data.orders,
    total: Number(data.data.total),
  };
}

export async function uploadProductionImage(file: File): Promise<string> {
  const res = (await apiUploadFile("/production/uploads/image", file)) as {
    data: { url: string };
  };
  return res.data.url;
}

// ─── «طلب مخصص» for مدير الإنتاج (/api/staff/custom-order, manager-only) ──────

export interface CustomOrderConfigWholesaler {
  id: string;
  name: string;
  universityName: string | null;
  department: string | null;
  pricing: FullSetPricing;
}

export interface CustomOrderConfig {
  packages: FullSetPackage[];
  pricing: FullSetPricing | null;
  wholesalers: CustomOrderConfigWholesaler[];
}

export interface CustomOrderPayload extends CreateFullSetPayload {
  /** طالب جديد mode — required when student_id absent. */
  student_name?: string;
  /** طالب موجود mode — takes precedence over student_name. */
  student_id?: string | null;
  wholesaler_id?: string | null;
}

export async function getStaffCustomOrderConfig(): Promise<CustomOrderConfig> {
  const { data } = await api.get<{
    data: {
      packages: FullSetPackage[];
      pricing: FullSetPricing | null;
      wholesalers: {
        id: string;
        name: string;
        university_name: string | null;
        department: string | null;
        pricing: FullSetPricing;
      }[];
    };
  }>("/staff/custom-order/config");
  return {
    packages: data.data.packages || [],
    pricing: data.data.pricing ?? null,
    wholesalers: (data.data.wholesalers || []).map((w) => ({
      id: w.id,
      name: w.name,
      universityName: w.university_name,
      department: w.department,
      pricing: w.pricing,
    })),
  };
}

export async function createStaffCustomOrder(
  payload: CustomOrderPayload
): Promise<{ studentId: string; total: number; packageName: string }> {
  const { data } = await api.post<{
    data: { student_id: string; total: number; package_name: string };
  }>("/staff/custom-order", payload);
  return {
    studentId: data.data.student_id,
    total: data.data.total,
    packageName: data.data.package_name,
  };
}

export async function uploadStaffCustomOrderImage(file: File): Promise<string> {
  const res = (await apiUploadFile("/staff/custom-order/uploads/image", file)) as {
    data: { url: string };
  };
  return res.data.url;
}

export async function searchStaffCustomOrderStudents(q: string): Promise<StudentSearchHit[]> {
  const { data } = await api.get<{ data: StudentSearchHit[] }>(
    "/staff/custom-order/students-search",
    { params: { q } }
  );
  return data.data ?? [];
}

/**
 * POST /production/orders/:id/advance
 * Advances the order to the next pipeline stage.
 * Returns the updated {id, status}.
 */
export async function advanceOrder(id: string): Promise<{ id: string; status: OrderStatus }> {
  const { data } = await api.post<{ data: { id: string; status: OrderStatus } }>(
    `/production/orders/${id}/advance`
  );
  return data.data;
}

/**
 * POST /production/orders/:id/embroidery-zone
 * Embroiderer (or manager/admin) marks one embroidery zone done/undone.
 * When the last present zone becomes done the order auto-advances
 * (advanced=true, status = the new pipeline status).
 */
export async function markEmbroideryZone(id: string, zone: string, done: boolean) {
  const { data } = await api.post(`/production/orders/${id}/embroidery-zone`, { zone, done });
  return data.data as {
    zones: { key: string; label: string; done: boolean }[];
    advanced: boolean;
    status: string;
  };
}

export interface ZoneBulkResult {
  done: number;
  advanced: number;
  skipped: number;
  results: {
    order_id: string;
    zone: string;
    ok: boolean;
    advanced?: boolean;
    status?: string;
    reason?: string;
  }[];
}

/**
 * POST /production/embroidery-zone-bulk — «عرض بالقطع» batch mode: tick ONE zone across
 * many pieces (all يمين, then all يسار…). Completed pieces auto-advance server-side.
 */
export async function markEmbroideryZoneBulk(
  items: { order_id: string; zone: string }[]
): Promise<ZoneBulkResult> {
  const { data } = await api.post<{ data: ZoneBulkResult }>(
    "/production/embroidery-zone-bulk",
    { items }
  );
  return data.data;
}

// ─── Wholesaler order-working console (one rep's students' orders) ─────────────

/** One order in the rep-scoped orders console (GET /{staff,admin}/wholesalers/:id/orders). */
export interface WholesalerOrderRow {
  id: string;
  studentId: string;
  studentName: string;
  productName: string;
  productType: "sash" | "robe" | "cap" | "shawl" | string;
  status: OrderStatus;
  statusLabel: string;
  isDone: boolean;
  batchName: string | null;
  deadline: string | null;
  /** Backend-computed: may THIS staff advance it? Single source of truth — drives the checkbox. */
  canAdvance: boolean;
  nextStatus: OrderStatus | null;
  nextLabel: string | null;
  adminAmount: number | null;
  wholesalerAmount: number | null;
}

export interface WholesalerAccountLine {
  label: string;
  qty: number;
  studentAmount: number;
  adminAmount: number;
  representativeProfit: number;
  kind: "saved" | "adjustment";
}

export interface WholesalerAccountSummary {
  scope: "approved_non_cancelled";
  inventory: {
    sashRoyal: number;
    sashNormal: number;
    capRoyal: number;
    capNormal: number;
  };
  money: {
    studentTotal: number;
    adminTotal: number;
    representativeProfit: number;
    lines: WholesalerAccountLine[];
  };
}

interface WholesalerOrderApiRow {
  id: string;
  student_id: string;
  student_name: string;
  product_name: string;
  product_type: string;
  status: OrderStatus;
  status_label: string;
  is_done: boolean;
  batch_name: string | null;
  deadline: string | null;
  can_advance: boolean;
  next_status: OrderStatus | null;
  next_label: string | null;
  admin_amount: number | null;
  wholesaler_amount: number | null;
}

interface WholesalerAccountSummaryApi {
  scope: "approved_non_cancelled";
  confirmed_inventory: {
    sash_royal: number;
    sash_normal: number;
    cap_royal: number;
    cap_normal: number;
  };
  money: {
    student_total: number;
    admin_total: number;
    representative_profit: number;
    lines: Array<{
      label: string;
      qty: number;
      student_amount: number;
      admin_amount: number;
      representative_profit: number;
      kind: "saved" | "adjustment";
    }>;
  };
}

/**
 * GET /{staff,admin}/wholesalers/:id/orders — every order for the rep's students.
 * `isAdmin` picks the admin route (the staff route is requireRole('staff')).
 * Optional `zone` filters by embroidery zone (e.g. "sash_front", "cap_side").
 */
export async function getWholesalerOrders(
  wholesalerId: string,
  opts: { zone?: string; isAdmin?: boolean } = {}
): Promise<{ orders: WholesalerOrderRow[]; summary: WholesalerAccountSummary | null }> {
  const base = opts.isAdmin ? "/admin" : "/staff";
  const { data } = await api.get<{
    data: WholesalerOrderApiRow[];
    summary: WholesalerAccountSummaryApi | null;
  }>(
    `${base}/wholesalers/${wholesalerId}/orders`,
    { params: opts.zone ? { zone: opts.zone } : undefined }
  );
  const orders = (data.data || []).map((r) => ({
    id: r.id,
    studentId: r.student_id,
    studentName: r.student_name,
    productName: r.product_name,
    productType: r.product_type,
    status: r.status,
    statusLabel: r.status_label,
    isDone: Boolean(r.is_done),
    batchName: r.batch_name,
    deadline: r.deadline,
    canAdvance: Boolean(r.can_advance),
    nextStatus: r.next_status,
    nextLabel: r.next_label,
    adminAmount: r.admin_amount == null ? null : Number(r.admin_amount),
    wholesalerAmount: r.wholesaler_amount == null ? null : Number(r.wholesaler_amount),
  }));
  const raw = data.summary;
  return {
    orders,
    summary: raw
      ? {
          scope: raw.scope,
          inventory: {
            sashRoyal: Number(raw.confirmed_inventory.sash_royal || 0),
            sashNormal: Number(raw.confirmed_inventory.sash_normal || 0),
            capRoyal: Number(raw.confirmed_inventory.cap_royal || 0),
            capNormal: Number(raw.confirmed_inventory.cap_normal || 0),
          },
          money: {
            studentTotal: Number(raw.money.student_total || 0),
            adminTotal: Number(raw.money.admin_total || 0),
            representativeProfit: Number(raw.money.representative_profit || 0),
            lines: (raw.money.lines || []).map((line) => ({
              label: line.label,
              qty: Number(line.qty || 0),
              studentAmount: Number(line.student_amount || 0),
              adminAmount: Number(line.admin_amount || 0),
              representativeProfit: Number(line.representative_profit || 0),
              kind: line.kind,
            })),
          },
        }
      : null,
  };
}

export interface BulkAdvanceResult {
  advanced: number;
  skipped: number;
  results: { id: string; ok: boolean; status?: OrderStatus; reason?: string }[];
}

/** POST /production/advance-bulk — advance many orders one stage. Skips any the caller can't move. */
export async function advanceBulk(ids: string[]): Promise<BulkAdvanceResult> {
  const { data } = await api.post<{ data: BulkAdvanceResult }>(
    "/production/advance-bulk",
    { ids }
  );
  return data.data;
}

// ─── «الفصال» (tailor) parallel track — RETAIL-only, independent of the pipeline ──

/**
 * One order in ابو عبدو's parallel tailoring console (GET /production/tailor-queue).
 * Local to this module by design — lib/types.ts is owned by another agent.
 * `status`/`statusLabel` are the PIPELINE status for context only; the tailor track
 * lives entirely in `tailorStatus` and never moves `status`.
 */
export interface TailorOrderRow {
  id: string;
  studentId: string;
  studentName: string;
  productName: string;
  productType: "sash" | "robe" | "cap" | "shawl" | string;
  /** Pipeline status — DISPLAY ONLY (shows where the order is in production). */
  status: OrderStatus;
  statusLabel: string;
  tailorStatus: "pending" | "done";
  tailorDoneAt: string | null;
  createdAt: string;
  batchName: string | null;
  deadline: string | null;
}

interface TailorOrderApiRow {
  id: string;
  student_id: string;
  student_name: string;
  product_name: string;
  product_type: string;
  status: OrderStatus;
  status_label: string;
  tailor_status: "pending" | "done";
  tailor_done_at: string | null;
  created_at: string;
  batch_name: string | null;
  deadline: string | null;
}

function mapTailorRow(r: TailorOrderApiRow): TailorOrderRow {
  return {
    id: r.id,
    studentId: r.student_id,
    studentName: r.student_name,
    productName: r.product_name,
    productType: r.product_type,
    status: r.status,
    statusLabel: r.status_label,
    tailorStatus: r.tailor_status,
    tailorDoneAt: r.tailor_done_at,
    createdAt: r.created_at,
    batchName: r.batch_name,
    deadline: r.deadline,
  };
}

/** GET /production/tailor-queue?done=0|1 — retail orders for the مفصل. `done` → finished. */
export async function getTailorQueue(done = false): Promise<TailorOrderRow[]> {
  const { data } = await api.get<{ data: TailorOrderApiRow[] }>("/production/tailor-queue", {
    params: done ? { done: 1 } : undefined,
  });
  return (data.data || []).map(mapTailorRow);
}

/** POST /production/orders/:id/tailor-complete — mark this order's tailoring done (idempotent). */
export async function tailorComplete(id: string): Promise<{ id: string; tailor_status: string }> {
  const { data } = await api.post<{ data: { id: string; tailor_status: string } }>(
    `/production/orders/${id}/tailor-complete`
  );
  return data.data;
}

/** POST /production/orders/:id/tailor-reopen — undo a mistaken completion (back to pending). */
export async function tailorReopen(id: string): Promise<{ id: string; tailor_status: string }> {
  const { data } = await api.post<{ data: { id: string; tailor_status: string } }>(
    `/production/orders/${id}/tailor-reopen`
  );
  return data.data;
}

export interface TailorBulkResult {
  done: number;
  skipped: number;
  results: { id: string; ok: boolean; reason?: string }[];
}

/** POST /production/tailor-complete-bulk — mark many done. Skips any non-retail/forbidden. */
export async function tailorCompleteBulk(ids: string[]): Promise<TailorBulkResult> {
  const { data } = await api.post<{ data: TailorBulkResult }>(
    "/production/tailor-complete-bulk",
    { ids }
  );
  return data.data;
}

export interface TailorSummary {
  pending: number;
  done: number;
  total: number;
}

/** GET /production/tailor-summary — parallel-progress counts over retail orders. */
export async function getTailorSummary(): Promise<TailorSummary> {
  const { data } = await api.get<{ data: TailorSummary }>("/production/tailor-summary");
  return data.data;
}

export interface DeliveryConfirmPayload {
  delivery_method: "delivery" | "pickup";
  recipient_name: string;
  delivery_address?: string;
  delivery_phone?: string;
  delivery_notes?: string;
}

/** Confirm hand-off of a «جاهز» order: records method (توصيل/استلام)، المستلم، العنوان/الرقم. */
export async function confirmDelivery(
  id: string,
  payload: DeliveryConfirmPayload
): Promise<{ id: string; status: OrderStatus }> {
  const { data } = await api.post<{ data: { id: string; status: OrderStatus } }>(
    `/production/orders/${id}/deliver`,
    payload
  );
  return data.data;
}

/**
 * POST /production/designs/:id/approve
 * Designer / manager only.
 */
export async function approveDesign(
  designId: string
): Promise<{ id: string; approval_status: string; advanced: boolean }> {
  const { data } = await api.post<{
    data: { id: string; approval_status: string; advanced: boolean };
  }>(`/production/designs/${designId}/approve`);
  return data.data;
}

/**
 * POST /production/designs/:id/reject
 * Designer / manager only. `reason` is required.
 */
export async function rejectDesign(
  designId: string,
  reason: string
): Promise<{ id: string; approval_status: string }> {
  const { data } = await api.post<{
    data: { id: string; approval_status: string };
  }>(`/production/designs/${designId}/reject`, { reason });
  return data.data;
}

/**
 * POST /production/orders/:id/revert
 * Revert/reopen an order to the previous stage.
 */
export async function revertOrder(id: string): Promise<{ id: string; status: string }> {
  const { data } = await api.post<{ data: { id: string; status: string } }>(
    `/production/orders/${id}/revert`
  );
  return data.data;
}

/**
 * POST /production/orders/:id/return-to-customer
 * «إرجاع للطالب» — hand an early-stage RETAIL order back to the student to edit + resubmit.
 * The order leaves the production queue/orders list until the student resubmits.
 */
export async function returnOrderToCustomer(
  id: string,
  reason?: string
): Promise<{ id: string; status: string; returned_to_customer: boolean }> {
  const { data } = await api.post<{
    data: { id: string; status: string; returned_to_customer: boolean };
  }>(`/production/orders/${id}/return-to-customer`, { reason: reason ?? "" });
  return data.data;
}

/**
 * POST /production/orders/:id/claim
 * Mark the current staff member as actively working on this order (presence).
 */
export interface ClaimResult {
  claimed: boolean;
  working_staff_id: string;
  working_staff_name: string | null;
}
export async function claimOrder(id: string): Promise<ClaimResult> {
  const { data } = await api.post<{ data: ClaimResult }>(
    `/production/orders/${id}/claim`
  );
  return data.data;
}

/**
 * POST /production/orders/:id/release
 * Release the presence claim on the order.
 */
export async function releaseOrder(id: string): Promise<void> {
  await api.post(`/production/orders/${id}/release`);
}

/**
 * POST /production/orders/:id/final-design
 * Upload the final design image (admin + designer only). Multipart, field "file".
 * Returns the updated order with final_design_url.
 */
export async function uploadFinalDesign(
  id: string,
  file: File
): Promise<{ url: string }> {
  // Use apiUploadFile so axios sets the multipart boundary automatically — setting
  // Content-Type: multipart/form-data manually (no boundary) makes multer drop the file.
  // Backend responds { data: { url } } — absolute /uploads URL.
  const data = (await apiUploadFile(
    `/production/orders/${id}/final-design`,
    file
  )) as { data: { url: string } };
  return data.data;
}

/**
 * GET /production/completed
 * Returns orders the current staff member has completed.
 */
export async function getCompleted(): Promise<import("./staff-types").ProductionQueueItem[]> {
  const { data } = await api.get<{ data: import("./staff-types").ProductionQueueItem[] }>(
    "/production/completed"
  );
  return data.data ?? [];
}

/**
 * GET /production/monitor
 * Manager / admin only — WIP counts, throughput, overdue, stale.
 */
export async function getMonitor(
  source?: "retail" | "wholesaler"
): Promise<MonitorData> {
  const { data } = await api.get<{ data: MonitorData }>("/production/monitor", {
    params: source ? { source } : undefined,
  });
  return data.data;
}

// ─── Staff self-service payroll + activity (GET /payroll/me/*) ─────────────────

/** An activity row enriched with product/student names for the staff self view. */
export interface MyActivityRow extends StaffActivity {
  productName: string | null;
  studentName: string | null;
}

/** GET /payroll/me/salary — the logged-in staff member's own salary + ledger. */
export async function getMySalary(): Promise<StaffSalary> {
  const { data } = await api.get<{
    data: {
      user_id: string;
      base_salary: number;
      balance: number;
      transactions: { id: string; type: SalaryTxnType; amount: number; reason_ar: string | null; created_at: string }[];
    };
  }>("/payroll/me/salary");
  const d = data.data;
  return {
    userId: d.user_id,
    baseSalary: Number(d.base_salary) || 0,
    balance: Number(d.balance) || 0,
    transactions: (d.transactions ?? []).map((t) => ({
      id: t.id,
      type: t.type,
      amount: Number(t.amount) || 0,
      reasonAr: t.reason_ar,
      createdAt: t.created_at,
    })),
  };
}

/** GET /payroll/me/goal — the logged-in staff member's current incentive goal + progress. */
export async function getMyGoal(): Promise<StaffGoal | null> {
  const { data } = await api.get<{
    data: {
      id: string;
      user_id: string;
      title_ar: string | null;
      target_count: number;
      bonus_amount: number;
      deadline: string;
      progress: number;
      achieved: boolean;
      awarded: boolean;
      awarded_at: string | null;
      expired: boolean;
      created_at: string;
    } | null;
  }>("/payroll/me/goal");
  const r = data.data;
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    titleAr: r.title_ar,
    targetCount: r.target_count,
    bonusAmount: Number(r.bonus_amount),
    deadline: r.deadline,
    progress: r.progress,
    achieved: r.achieved,
    awarded: r.awarded,
    awardedAt: r.awarded_at,
    expired: r.expired,
    createdAt: r.created_at,
  };
}

/** GET /payroll/me/activity — the logged-in staff member's own activity log. */
export async function getMyActivity(): Promise<MyActivityRow[]> {
  const { data } = await api.get<{
    data: {
      id: string;
      action: string;
      from_stage: string | null;
      to_stage: string | null;
      created_at: string;
      order_id: string | null;
      product_name: string | null;
      student_name: string | null;
    }[];
  }>("/payroll/me/activity");
  return (data.data ?? []).map((r) => ({
    id: r.id,
    action: r.action,
    orderId: r.order_id,
    fromStage: (r.from_stage as OrderStatus | null) ?? null,
    toStage: (r.to_stage as OrderStatus | null) ?? null,
    createdAt: r.created_at,
    productName: r.product_name,
    studentName: r.student_name,
  }));
}

interface ApiAttendanceSettings {
  start_time: string;
  end_time: string;
  grace_minutes: number;
  deduction_per_minute: number;
  attendance_required?: boolean;
  verification_mode: StaffAttendanceSettings["verificationMode"];
  allowed_ip_ranges: string[];
  shop_latitude: number | null;
  shop_longitude: number | null;
  shop_radius_meters: number;
  timezone: string;
}

interface ApiAttendanceRecord {
  id: string;
  user_id: string;
  staff_name: string | null;
  work_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  expected_start_time: string;
  expected_end_time: string;
  grace_minutes: number;
  late_minutes: number;
  deduction_amount: number;
  deduction_transaction_id: string | null;
  verification_mode: StaffAttendanceRecord["verificationMode"];
  network_ok: boolean;
  location_ok: boolean;
  verified: boolean;
  check_in_ip: string | null;
  check_out_ip: string | null;
  latitude: number | null;
  longitude: number | null;
  location_accuracy_meters: number | null;
  distance_meters: number | null;
  status: StaffAttendanceRecord["status"];
  admin_note_ar: string | null;
  note_ar: string | null;
  worked_minutes: number;
  scheduled_minutes: number;
  overtime_minutes: number;
  open_too_long: boolean;
  overridden_by: string | null;
  overridden_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapAttendanceSettings(r: ApiAttendanceSettings): StaffAttendanceSettings {
  return {
    startTime: r.start_time,
    endTime: r.end_time,
    graceMinutes: Number(r.grace_minutes),
    deductionPerMinute: Number(r.deduction_per_minute),
    attendanceRequired: r.attendance_required !== false,
    verificationMode: r.verification_mode,
    allowedIpRanges: r.allowed_ip_ranges || [],
    shopLatitude: r.shop_latitude == null ? null : Number(r.shop_latitude),
    shopLongitude: r.shop_longitude == null ? null : Number(r.shop_longitude),
    shopRadiusMeters: Number(r.shop_radius_meters),
    timezone: r.timezone,
  };
}

function mapAttendanceRecord(r: ApiAttendanceRecord | null): StaffAttendanceRecord | null {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    staffName: r.staff_name,
    workDate: r.work_date,
    checkInAt: r.check_in_at,
    checkOutAt: r.check_out_at,
    expectedStartTime: r.expected_start_time,
    expectedEndTime: r.expected_end_time,
    graceMinutes: Number(r.grace_minutes),
    lateMinutes: Number(r.late_minutes),
    deductionAmount: Number(r.deduction_amount),
    deductionTransactionId: r.deduction_transaction_id,
    verificationMode: r.verification_mode,
    networkOk: Boolean(r.network_ok),
    locationOk: Boolean(r.location_ok),
    verified: Boolean(r.verified),
    checkInIp: r.check_in_ip,
    checkOutIp: r.check_out_ip,
    latitude: r.latitude == null ? null : Number(r.latitude),
    longitude: r.longitude == null ? null : Number(r.longitude),
    locationAccuracyMeters:
      r.location_accuracy_meters == null ? null : Number(r.location_accuracy_meters),
    distanceMeters: r.distance_meters == null ? null : Number(r.distance_meters),
    status: r.status,
    adminNoteAr: r.admin_note_ar,
    noteAr: r.note_ar,
    workedMinutes: Number(r.worked_minutes) || 0,
    scheduledMinutes: Number(r.scheduled_minutes) || 0,
    overtimeMinutes: Number(r.overtime_minutes) || 0,
    openTooLong: Boolean(r.open_too_long),
    overriddenBy: r.overridden_by,
    overriddenAt: r.overridden_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface MyAttendanceToday {
  settings: StaffAttendanceSettings;
  record: StaffAttendanceRecord | null;
}

export interface AttendanceLocationPayload {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export function getBrowserAttendanceLocation(): Promise<AttendanceLocationPayload | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });
}

export async function getMyAttendanceToday(): Promise<MyAttendanceToday> {
  const { data } = await api.get<{
    data: { settings: ApiAttendanceSettings; record: ApiAttendanceRecord | null };
  }>("/staff/attendance/today");
  return {
    settings: mapAttendanceSettings(data.data.settings),
    record: mapAttendanceRecord(data.data.record),
  };
}

export async function checkInAttendance(
  location: AttendanceLocationPayload | null
): Promise<MyAttendanceToday> {
  const { data } = await api.post<{
    data: { settings: ApiAttendanceSettings; record: ApiAttendanceRecord | null };
  }>("/staff/attendance/check-in", { location });
  return {
    settings: mapAttendanceSettings(data.data.settings),
    record: mapAttendanceRecord(data.data.record),
  };
}

export async function checkOutAttendance(
  location: AttendanceLocationPayload | null
): Promise<MyAttendanceToday> {
  const { data } = await api.post<{
    data: { settings: ApiAttendanceSettings; record: ApiAttendanceRecord | null };
  }>("/staff/attendance/check-out", { location });
  return {
    settings: mapAttendanceSettings(data.data.settings),
    record: mapAttendanceRecord(data.data.record),
  };
}
