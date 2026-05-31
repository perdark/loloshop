import { api } from "./api";
import type { OrderStatus } from "./types";
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
  source?: "retail" | "wholesaler"
): Promise<ProductionQueueItem[]> {
  const params: Record<string, string> = {};
  if (stage) params.stage = stage;
  if (source) params.source = source;
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
