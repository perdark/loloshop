import { api } from "./api";
import type { OrderStatus } from "./types";
import {
  mapApiOrderRow,
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
