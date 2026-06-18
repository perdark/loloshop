import { api, apiUploadFile } from "./api";
import type { OrderStatus, SalaryTxnType, StaffActivity, StaffGoal, StaffSalary } from "./types";
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
  zone?: string
): Promise<ProductionQueueItem[]> {
  const params: Record<string, string> = {};
  if (stage) params.stage = stage;
  if (source) params.source = source;
  if (zone) params.zone = zone;
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
}

/**
 * GET /{staff,admin}/wholesalers/:id/orders — every order for the rep's students.
 * `isAdmin` picks the admin route (the staff route is requireRole('staff')).
 * Optional `zone` filters by embroidery zone (e.g. "sash_front", "cap_side").
 */
export async function getWholesalerOrders(
  wholesalerId: string,
  opts: { zone?: string; isAdmin?: boolean } = {}
): Promise<WholesalerOrderRow[]> {
  const base = opts.isAdmin ? "/admin" : "/staff";
  const { data } = await api.get<{ data: WholesalerOrderApiRow[] }>(
    `${base}/wholesalers/${wholesalerId}/orders`,
    { params: opts.zone ? { zone: opts.zone } : undefined }
  );
  return (data.data || []).map((r) => ({
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
  }));
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
