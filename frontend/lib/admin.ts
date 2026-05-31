import { api } from "./api";
import { mapHeroSlide } from "./catalog";
import type {
  AdminAccounting,
  AdminAnalytics,
  AdminOrder,
  AdminWholesaler,
  AccountingRow,
  CreateWholesalerPayload,
  CreateWholesalerResult,
  HeroSlide,
  OrderStatus,
  StaffOrderScope,
  User,
} from "./types";

// ---------- Hero slider (home slides) ----------
export interface HeroSlidePayload {
  image_url: string;
  kicker_ar?: string | null;
  title_ar: string;
  caption_ar?: string | null;
  accent?: string | null;
  cta_label_ar?: string | null;
  cta_href?: string | null;
  sort?: number;
  active?: boolean;
}

export async function listHeroSlidesAdmin(): Promise<HeroSlide[]> {
  const { data } = await api.get<{ data: Record<string, unknown>[] }>("/catalog/hero/all");
  return (data.data || []).map(mapHeroSlide);
}

export async function createHeroSlide(payload: HeroSlidePayload): Promise<{ id: string }> {
  const { data } = await api.post<{ data: { id: string } }>("/catalog/hero", payload);
  return data.data;
}

export async function updateHeroSlide(
  id: string,
  payload: Partial<HeroSlidePayload>
): Promise<void> {
  await api.patch(`/catalog/hero/${id}`, payload);
}

export async function deleteHeroSlide(id: string): Promise<void> {
  await api.delete(`/catalog/hero/${id}`);
}

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
  source?: "retail" | "wholesaler";
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
  commission_rate: number;
  earned_commission: number;
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
    source: row.source,
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
    commissionRate: Number(row.commission_rate ?? 0),
    earnedCommission: Number(row.earned_commission ?? 0),
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
  source?: "retail" | "wholesaler" | "";
  /** Product type filter — only honoured in item mode. e.g. "sash" | "robe" | "cap" */
  type?: string;
}

export async function getAdminAnalytics(): Promise<AdminAnalytics> {
  const { data } = await api.get<ApiAnalytics>("/admin/analytics");
  return mapAnalytics(data);
}

export async function updateOrderCost(
  orderId: string,
  cost: number
): Promise<void> {
  await api.patch(`/admin/orders/${orderId}/cost`, { cost });
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
      source: filters.source || undefined,
      type: filters.type || undefined,
    },
  });
  return (data.data || []).map(mapOrder);
}

// ─── Bundle (grouped) order types ────────────────────────────────────────────

/** One component order within a bundle group */
export interface AdminBundleItem {
  order_id: string;
  product_name: string;
  product_type: string;
  status: OrderStatus;
  price: number;
  cost: number;
  profit: number;
}

/** A grouped bundle card returned by GET /admin/orders?group=bundle */
export interface AdminBundle {
  checkout_group_id: string | null;
  student_name: string;
  university_name: string | null;
  created_at: string;
  total_price: number;
  total_cost: number;
  total_profit: number;
  items: AdminBundleItem[];
}

interface ApiBundleItem {
  order_id: string;
  product_name: string;
  product_type: string;
  status: OrderStatus;
  price: number;
  cost: number;
  profit: number;
}

interface ApiBundle {
  checkout_group_id: string | null;
  student_name: string;
  university_name: string | null;
  created_at: string;
  total_price: number;
  total_cost: number;
  total_profit: number;
  items: ApiBundleItem[];
}

function mapBundle(raw: ApiBundle): AdminBundle {
  return {
    checkout_group_id: raw.checkout_group_id,
    student_name: raw.student_name,
    university_name: raw.university_name ?? null,
    created_at: raw.created_at,
    total_price: Number(raw.total_price),
    total_cost: Number(raw.total_cost),
    total_profit: Number(raw.total_profit),
    items: (raw.items || []).map((item) => ({
      order_id: item.order_id,
      product_name: item.product_name,
      product_type: item.product_type,
      status: item.status,
      price: Number(item.price),
      cost: Number(item.cost),
      profit: Number(item.profit),
    })),
  };
}

/**
 * GET /admin/orders?group=bundle
 * Returns orders grouped by checkout_group_id.
 * Ungrouped orders appear as single-item bundles (checkout_group_id null).
 */
export async function getAdminOrderBundles(
  filters: Pick<OrdersFilters, "wholesalerId" | "source" | "dateFrom" | "dateTo"> = {}
): Promise<AdminBundle[]> {
  const { data } = await api.get<{ data: { bundles: ApiBundle[] } }>("/admin/orders", {
    params: {
      group: "bundle",
      wholesaler_id: filters.wholesalerId || undefined,
      source: filters.source || undefined,
      from: filters.dateFrom || undefined,
      to: filters.dateTo || undefined,
    },
  });
  return (data.data?.bundles || []).map(mapBundle);
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
    commission_rate: payload.commissionRate ?? 0,
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

export async function updateWholesalerCommission(
  id: string,
  commissionRate: number
): Promise<void> {
  await api.patch(`/admin/wholesalers/${id}/commission`, {
    commission_rate: commissionRate,
  });
}

export interface WholesalerSashConfig {
  editable_sash_side: "left" | "right" | null;
  locked_side_design: unknown | null;
}

export async function getWholesalerSashConfig(
  id: string
): Promise<WholesalerSashConfig> {
  const { data } = await api.get<{ data: WholesalerSashConfig }>(
    `/admin/wholesalers/${id}/sash-config`
  );
  return data.data;
}

export async function updateWholesalerSashConfig(
  id: string,
  config: WholesalerSashConfig
): Promise<void> {
  await api.put(`/admin/wholesalers/${id}/sash-config`, {
    editable_sash_side: config.editable_sash_side,
    locked_side_design: config.locked_side_design,
  });
}

export async function deleteWholesaler(id: string): Promise<void> {
  await api.delete(`/admin/wholesalers/${id}`);
}

interface ApiStaffRow {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  phone_verified?: boolean;
  staff_type?: string | null;
  order_scope?: StaffOrderScope | null;
}

export interface CreateStaffPayload {
  name: string;
  phone: string;
  email?: string;
  password: string;
  staff_type?: string;
  order_scope?: StaffOrderScope;
}

export async function getAdminStaff(): Promise<User[]> {
  const { data } = await api.get<{ data: ApiStaffRow[] }>("/admin/staff");
  return (data.data || []).map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email || undefined,
    role: "staff" as const,
    staff_type: (r.staff_type as User["staff_type"]) ?? null,
    order_scope: (r.order_scope as StaffOrderScope) ?? undefined,
  }));
}

export async function updateStaffScope(
  id: string,
  order_scope: StaffOrderScope
): Promise<void> {
  await api.patch(`/admin/staff/${id}/scope`, { order_scope });
}

export async function updateStaffType(
  id: string,
  staff_type: string
): Promise<void> {
  await api.patch(`/admin/staff/${id}/type`, { staff_type });
}

export async function createStaff(payload: CreateStaffPayload): Promise<void> {
  await api.post("/admin/staff", {
    name: payload.name,
    phone: payload.phone,
    email: payload.email,
    password: payload.password,
    staff_type: payload.staff_type,
    order_scope: payload.order_scope,
  });
}

export async function resetStaffPassword(id: string, password: string): Promise<void> {
  await api.patch(`/admin/staff/${id}/password`, { password });
}

export async function deleteStaff(id: string): Promise<void> {
  await api.delete(`/admin/staff/${id}`);
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
