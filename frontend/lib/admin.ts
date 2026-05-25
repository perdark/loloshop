import { api } from "./api";
import type {
  AdminAccounting,
  AdminAnalytics,
  AdminOrder,
  AdminWholesaler,
  AccountingRow,
  CreateWholesalerPayload,
  CreateWholesalerResult,
  OrderStatus,
} from "./types";

interface ApiAnalytics {
  totals: {
    revenue: number;
    cost: number;
    profit: number;
    orders: number;
  };
  by_status: Record<string, number>;
  daily: { date: string; orders: number; revenue: number }[];
  top_wholesalers: { id: string; name: string; order_count: number }[];
}

interface ApiOrderRow {
  id: string;
  student_id: string;
  student_full_name: string;
  university_name: string | null;
  department: string | null;
  product_name: string;
  wholesaler_name: string | null;
  price: number;
  cost: number | null;
  profit: number | null;
  status: OrderStatus;
  created_at: string;
}

interface ApiWholesalerRow {
  id: string;
  name: string;
  phone: string;
  email?: string;
  referral_code: string;
  referral_url: string;
  student_count: number;
  pending_count: number;
  deadline: string | null;
  created_at?: string;
}

function mapOrder(row: ApiOrderRow): AdminOrder {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_full_name,
    universityName: row.university_name,
    department: row.department,
    productName: row.product_name,
    wholesalerName: row.wholesaler_name,
    price: row.price,
    cost: row.cost,
    profit: row.profit,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapWholesaler(row: ApiWholesalerRow): AdminWholesaler {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    studentCount: row.student_count,
    pendingCount: row.pending_count,
    deadline: row.deadline,
    referralCode: row.referral_code,
    referralUrl: row.referral_url,
    createdAt: row.created_at,
  };
}

function mapAnalytics(raw: ApiAnalytics): AdminAnalytics {
  return {
    totalRevenue: Number(raw.totals.revenue),
    totalCost: Number(raw.totals.cost),
    totalProfit: Number(raw.totals.profit),
    orderCount: Number(raw.totals.orders),
    ordersByStatus: raw.by_status,
    dailyOrders: raw.daily.map((d) => ({
      date: String(d.date).slice(0, 10),
      count: d.orders,
      revenue: Number(d.revenue),
    })),
    topWholesalers: raw.top_wholesalers.map((w) => ({
      id: w.id,
      name: w.name,
      orderCount: w.order_count,
    })),
  };
}

export interface OrdersFilters {
  wholesalerId?: string;
  status?: OrderStatus | "";
  dateFrom?: string;
  dateTo?: string;
}

export async function getAdminAnalytics(): Promise<AdminAnalytics> {
  const { data } = await api.get<ApiAnalytics>("/admin/analytics");
  return mapAnalytics(data);
}

export async function getAdminOrders(
  filters: OrdersFilters = {}
): Promise<AdminOrder[]> {
  const { data } = await api.get<{ data: ApiOrderRow[] }>("/admin/orders", {
    params: {
      wholesaler_id: filters.wholesalerId || undefined,
      status: filters.status || undefined,
      from: filters.dateFrom || undefined,
      to: filters.dateTo || undefined,
    },
  });
  return (data.data || []).map(mapOrder);
}

export async function getAdminWholesalers(): Promise<AdminWholesaler[]> {
  const { data } = await api.get<{ data: ApiWholesalerRow[] }>(
    "/admin/wholesalers"
  );
  return (data.data || []).map(mapWholesaler);
}

export async function createWholesaler(
  payload: CreateWholesalerPayload
): Promise<CreateWholesalerResult> {
  const { data } = await api.post<{
    data: { id: string; referral_url: string };
  }>("/admin/wholesalers", {
    name: payload.name,
    phone: payload.phone,
    email: payload.email,
    password: payload.password,
    referral_code: payload.referralCode,
    deadline: payload.deadline,
  });
  const row = data.data;
  return { id: row.id, referralUrl: row.referral_url };
}

export async function extendWholesalerDeadline(
  id: string,
  deadline: string
): Promise<void> {
  await api.patch(`/admin/wholesalers/${id}/deadline`, { deadline });
}

interface ApiAccounting {
  totals: {
    revenue: number;
    cost: number;
    profit: number;
    orders: number;
  };
  by_batch: {
    id: string;
    name_ar: string;
    wholesaler_name: string | null;
    revenue: number;
    cost: number;
    profit: number;
    orders: number;
  }[];
  by_wholesaler: {
    id: string;
    wholesaler_name: string;
    revenue: number;
    cost: number;
    profit: number;
    orders: number;
  }[];
  independent_retail: {
    revenue: number;
    cost: number;
    profit: number;
    orders: number;
  };
}

function mapAccountingRow(
  label: string,
  raw: {
    revenue: number;
    cost: number;
    profit: number;
    orders: number;
  },
  id?: string
): AccountingRow {
  return {
    id,
    label,
    revenue: Number(raw.revenue),
    cost: Number(raw.cost),
    profit: Number(raw.profit),
    orders: Number(raw.orders),
  };
}

export async function getAdminAccounting(): Promise<AdminAccounting> {
  const { data } = await api.get<ApiAccounting>("/admin/accounting");
  return {
    totals: {
      revenue: Number(data.totals.revenue),
      cost: Number(data.totals.cost),
      profit: Number(data.totals.profit),
      orders: Number(data.totals.orders),
    },
    byBatch: data.by_batch.map((b) =>
      mapAccountingRow(
        `${b.name_ar}${b.wholesaler_name ? ` — ${b.wholesaler_name}` : ""}`,
        b,
        b.id
      )
    ),
    byWholesaler: data.by_wholesaler.map((w) =>
      mapAccountingRow(w.wholesaler_name, w, w.id)
    ),
    independentRetail: mapAccountingRow(
      "طلبات تجزئة (مستقل)",
      data.independent_retail
    ),
  };
}
