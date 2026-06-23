import { api } from "./api";
import { mapHeroSlide } from "./catalog";
import type { PromoConfig } from "./catalog";
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
  PackageTier,
  SalaryTransaction,
  SalaryTxnType,
  StaffActivity,
  StaffGoal,
  StaffSalary,
  StaffOrderScope,
  User,
  WholesalerPricingAddons,
} from "./types";

// ─── Promo / Discount Popup Config ───────────────────────────────────────────

export type { PromoConfig };

/** Admin-only: save the storefront promo config. */
export async function updatePromo(payload: PromoConfig): Promise<PromoConfig> {
  const { data } = await api.patch<{ data: PromoConfig }>("/admin/promo", payload);
  return data.data;
}

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
  working_staff_id?: string | null;
  working_staff_name?: string | null;
  wholesaler_approval?: WholesalerApproval | null;
  checkout_group_id?: string | null;
}

interface ApiWholesalerRow {
  id: string;
  name: string;
  phone: string;
  email?: string;
  university_name?: string | null;
  department?: string | null;
  referral_code: string;
  referral_url: string;
  student_count: number;
  pending_count: number;
  deadline: string | null;
  admin_price?: number;
  wholesaler_price?: number;
  pricing_addons?: Partial<WholesalerPricingAddons> | null;
  earned_commission: number;
  created_at?: string;
  embroidery_color?: string | null;
}

/** Defaults mirror migration 032 — used when the server omits a key. */
export const DEFAULT_PRICING_ADDONS: WholesalerPricingAddons = {
  royal_sash: 10000,
  royal_cap_when_normal_sash: 3000,
  extra_cap_embroidery: 3000,
  robe_sleeve_each: 5000,
  american_shawl: 25000,
};

function mapAddons(raw?: Partial<WholesalerPricingAddons> | null): WholesalerPricingAddons {
  return {
    royal_sash: Number(raw?.royal_sash ?? DEFAULT_PRICING_ADDONS.royal_sash),
    royal_cap_when_normal_sash: Number(
      raw?.royal_cap_when_normal_sash ?? DEFAULT_PRICING_ADDONS.royal_cap_when_normal_sash
    ),
    extra_cap_embroidery: Number(raw?.extra_cap_embroidery ?? DEFAULT_PRICING_ADDONS.extra_cap_embroidery),
    robe_sleeve_each: Number(raw?.robe_sleeve_each ?? DEFAULT_PRICING_ADDONS.robe_sleeve_each),
    american_shawl: Number(raw?.american_shawl ?? DEFAULT_PRICING_ADDONS.american_shawl),
  };
}

/** AdminOrder extended with approval state (present only for wholesaler orders). */
export type AdminOrderWithApproval = AdminOrder & {
  wholesalerApproval: WholesalerApproval | null;
  checkoutGroupId: string | null;
};

function mapOrder(row: ApiOrderRow): AdminOrderWithApproval {
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
    workingStaffName: row.working_staff_name ?? null,
    wholesalerApproval: (row.wholesaler_approval as WholesalerApproval) ?? null,
    checkoutGroupId: row.checkout_group_id ?? null,
  };
}

function mapWholesaler(row: ApiWholesalerRow): AdminWholesaler {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    universityName: row.university_name ?? null,
    department: row.department ?? null,
    studentCount: row.student_count,
    pendingCount: row.pending_count,
    deadline: row.deadline,
    adminPrice: Number(row.admin_price ?? 0),
    wholesalerPrice: Number(row.wholesaler_price ?? 0),
    pricingAddons: mapAddons(row.pricing_addons),
    earnedCommission: Number(row.earned_commission ?? 0),
    referralCode: row.referral_code,
    referralUrl: row.referral_url,
    createdAt: row.created_at,
    embroideryColor: row.embroidery_color ?? null,
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

// ─── Wholesaler order approval ───────────────────────────────────────────────

/** Orthogonal approval state of a wholesaler order bundle (NULL for retail). */
export type WholesalerApproval = "pending" | "approved" | "rejected";

/** Approve a wholesaler bundle (admin override, no ownership check). */
export async function approveOrderAdmin(checkoutGroupId: string): Promise<void> {
  await api.post(`/admin/orders/${checkoutGroupId}/approve`);
}

/** Reject a wholesaler bundle with a reason (admin override). */
export async function rejectOrderAdmin(
  checkoutGroupId: string,
  reason: string
): Promise<void> {
  await api.post(`/admin/orders/${checkoutGroupId}/reject`, { reason });
}

/** GET /admin/orders-pending-count → number of bundles awaiting rep approval. */
export async function getPendingApprovalCount(): Promise<number> {
  const { data } = await api.get<{ data: { pending_bundles: number } }>(
    "/admin/orders-pending-count"
  );
  return Number(data.data?.pending_bundles ?? 0);
}

// ─── Orders filters ───────────────────────────────────────────────────────────

export interface OrdersFilters {
  wholesalerId?: string;
  /** Filter to a single batch (دفعة) of a rep. */
  batchId?: string;
  status?: OrderStatus | "";
  dateFrom?: string;
  dateTo?: string;
  source?: "retail" | "wholesaler" | "";
  /** Product type filter — only honoured in item mode. e.g. "sash" | "robe" | "cap" */
  type?: string;
  /** Embroidery-zone / pleat filter key (see EMBROIDERY_ZONE_LABELS). */
  zone?: string;
  /** Wholesaler approval state filter. Only honoured on the wholesaler source. */
  approval?: WholesalerApproval | "";
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
): Promise<AdminOrderWithApproval[]> {
  const { data } = await api.get<{ data: ApiOrderRow[] }>("/admin/orders", {
    params: {
      wholesaler_id: filters.wholesalerId || undefined,
      batch_id: filters.batchId || undefined,
      status: filters.status || undefined,
      from: filters.dateFrom || undefined,
      to: filters.dateTo || undefined,
      source: filters.source || undefined,
      type: filters.type || undefined,
      zone: filters.zone || undefined,
      approval: filters.approval || undefined,
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

/** Intake data from the full-set DM form (delivery / contact / event / deposit). */
export interface BundleIntake {
  customer_name: string;
  instagram_username: string | null;
  phone_primary: string;
  phone_secondary: string | null;
  governorate: string | null;
  area_details: string | null;
  event_date: string | null;
  deposit: number;
  notes: string | null;
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
  /** Present only for full-set form bundles (null for cart/legacy bundles). */
  intake: BundleIntake | null;
  /** Wholesaler order approval state (null for retail bundles). */
  wholesalerApproval: WholesalerApproval | null;
  wholesalerRejectReason: string | null;
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
  intake?: {
    customer_name: string;
    instagram_username: string | null;
    phone_primary: string;
    phone_secondary: string | null;
    governorate: string | null;
    area_details: string | null;
    event_date: string | null;
    deposit: string | number;
    notes: string | null;
  } | null;
  wholesaler_approval?: WholesalerApproval | null;
  wholesaler_reject_reason?: string | null;
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
    intake: raw.intake
      ? {
          customer_name: raw.intake.customer_name,
          instagram_username: raw.intake.instagram_username,
          phone_primary: raw.intake.phone_primary,
          phone_secondary: raw.intake.phone_secondary,
          governorate: raw.intake.governorate,
          area_details: raw.intake.area_details,
          event_date: raw.intake.event_date,
          deposit: Number(raw.intake.deposit) || 0,
          notes: raw.intake.notes,
        }
      : null,
    wholesalerApproval: (raw.wholesaler_approval as WholesalerApproval) ?? null,
    wholesalerRejectReason: raw.wholesaler_reject_reason ?? null,
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

/** A batch (دفعة) belonging to a rep. */
export interface RepBatch {
  id: string;
  name_ar: string;
  deadline: string | null;
}
/** A rep with their batches + total order count — the «ممثلين» drill-down landing grid. */
export interface RepOverview {
  id: string;
  name: string;
  batches: RepBatch[];
  order_count: number;
}

export async function getRepsOverview(): Promise<RepOverview[]> {
  const { data } = await api.get<{ data: RepOverview[] }>("/admin/reps-overview");
  return data.data || [];
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
    university_name: payload.universityName,
    department: payload.department,
    admin_price: payload.adminPrice,
    wholesaler_price: payload.wholesalerPrice,
    pricing_addons: payload.pricingAddons,
    embroidery_color: payload.embroideryColor || undefined,
  });
  const row = data.data;
  return { id: row.id, referralUrl: row.referral_url };
}

/** Edit a wholesaler's جامعة/قسم + optional لون التطريز (inherited/per-wholesaler). */
export async function updateWholesaler(
  id: string,
  payload: { universityName: string; department: string; embroideryColor?: string }
): Promise<void> {
  await api.patch(`/admin/wholesalers/${id}`, {
    university_name: payload.universityName,
    department: payload.department,
    embroidery_color: payload.embroideryColor ?? undefined,
  });
}

export async function extendWholesalerDeadline(
  id: string,
  deadline: string
): Promise<void> {
  await api.patch(`/admin/wholesalers/${id}/deadline`, { deadline });
}

export interface WholesalerPricingPayload {
  adminPrice: number;
  wholesalerPrice: number;
  pricingAddons: WholesalerPricingAddons;
}

/** «التسعيرة»: set a rep's admin-private base price, rep/student base price + add-ons. */
export async function updateWholesalerPricing(
  id: string,
  payload: WholesalerPricingPayload
): Promise<void> {
  await api.patch(`/admin/wholesalers/${id}/pricing`, {
    admin_price: payload.adminPrice,
    wholesaler_price: payload.wholesalerPrice,
    pricing_addons: payload.pricingAddons,
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
  staff_types?: string[] | null;
  order_scope?: StaffOrderScope | null;
}

export interface CreateStaffPayload {
  name: string;
  /** Optional: staff with no phone log in via the private staff portal. */
  phone?: string;
  email?: string;
  password: string;
  /** Multi-role (Migration 029): all production roles this staff member holds. */
  staff_types?: string[];
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
    staff_types: (r.staff_types as User["staff_types"]) ?? (r.staff_type ? [r.staff_type as NonNullable<User["staff_type"]>] : []),
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
  staff_types: string[]
): Promise<void> {
  await api.patch(`/admin/staff/${id}/type`, { staff_types });
}

export async function createStaff(payload: CreateStaffPayload): Promise<void> {
  await api.post("/admin/staff", {
    name: payload.name,
    phone: payload.phone,
    email: payload.email,
    password: payload.password,
    staff_types: payload.staff_types,
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

// ─── Staff Salary ────────────────────────────────────────────────────────────

interface ApiSalaryTxn {
  id: string;
  type: SalaryTxnType;
  amount: number;
  reason_ar: string | null;
  created_at: string;
}

interface ApiStaffSalary {
  user_id: string;
  base_salary: number;
  balance: number;
  transactions: ApiSalaryTxn[];
}

function mapSalaryTxn(r: ApiSalaryTxn): SalaryTransaction {
  return {
    id: r.id,
    type: r.type,
    amount: Number(r.amount),
    reasonAr: r.reason_ar,
    createdAt: r.created_at,
  };
}

export async function getStaffSalary(userId: string): Promise<StaffSalary> {
  const { data } = await api.get<{ data: ApiStaffSalary }>(`/admin/staff/${userId}/salary`);
  return {
    userId: data.data.user_id,
    baseSalary: Number(data.data.base_salary),
    balance: Number(data.data.balance),
    transactions: (data.data.transactions || []).map(mapSalaryTxn),
  };
}

export async function setStaffSalary(userId: string, baseSalary: number): Promise<void> {
  await api.post(`/admin/staff/${userId}/salary`, { base_salary: baseSalary });
}

export async function addStaffBonus(
  userId: string,
  amount: number,
  reasonAr?: string
): Promise<void> {
  await api.post(`/admin/staff/${userId}/salary/bonus`, {
    amount,
    reason_ar: reasonAr || undefined,
  });
}

export async function addStaffDeduction(
  userId: string,
  amount: number,
  reasonAr?: string
): Promise<void> {
  await api.post(`/admin/staff/${userId}/salary/deduction`, {
    amount,
    reason_ar: reasonAr || undefined,
  });
}

// ─── Staff Activity ──────────────────────────────────────────────────────────

interface ApiStaffActivity {
  id: string;
  action: string;
  order_id: string | null;
  from_stage: string | null;
  to_stage: string | null;
  created_at: string;
}

export async function getStaffActivity(userId: string): Promise<StaffActivity[]> {
  const { data } = await api.get<{ data: ApiStaffActivity[] }>(`/admin/staff/${userId}/activity`);
  return (data.data || []).map((r) => ({
    id: r.id,
    action: r.action,
    orderId: r.order_id,
    fromStage: (r.from_stage as StaffActivity["fromStage"]) ?? null,
    toStage: (r.to_stage as StaffActivity["toStage"]) ?? null,
    createdAt: r.created_at,
  }));
}

// ─── Staff Goals (incentive targets) ─────────────────────────────────────────

interface ApiStaffGoal {
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
}

function mapStaffGoal(r: ApiStaffGoal): StaffGoal {
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

export async function getStaffGoal(userId: string): Promise<StaffGoal | null> {
  const { data } = await api.get<{ data: ApiStaffGoal | null }>(`/admin/staff/${userId}/goal`);
  return data.data ? mapStaffGoal(data.data) : null;
}

// ─── Packages (incl. VIP tier) ───────────────────────────────────────────────

export interface PackagePayload {
  name_ar: string;
  price: number;
  role?: "retail" | "wholesaler";
  image_url?: string | null;
  story_image_url?: string | null;
  /** Ordered photos that auto-rotate on the storefront card. */
  gallery?: string[];
  sort?: number;
  active?: boolean;
  is_vip?: boolean;
  /** Full graduation set (robe + cap + sash). Mutually exclusive with is_vip. */
  is_full_set?: boolean;
  description?: string | null;
  features?: string[];
  included_items?: string[];
  badge_label?: string | null;
  accent?: string | null;
}

function mapAdminPackage(raw: Record<string, unknown>): PackageTier {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String) : typeof v === "string" ? (JSON.parse(v || "[]") as string[]) : [];
  return {
    id: String(raw.id),
    nameAr: String(raw.name_ar ?? ""),
    price: Number(raw.price ?? 0),
    imageUrl: (raw.image_url as string | null) ?? null,
    storyImageUrl: (raw.story_image_url as string | null) ?? null,
    gallery: arr(raw.gallery),
    sort: Number(raw.sort ?? 0),
    active: !!raw.active,
    sashTypeOptionId: String(raw.sash_type_option_id ?? ""),
    sashTypeLabel: String(raw.sash_type_label ?? ""),
    isVip: !!raw.is_vip,
    isFullSet: !!raw.is_full_set,
    description: (raw.description as string | null) ?? null,
    features: arr(raw.features),
    includedItems: arr(raw.included_items),
    badgeLabel: (raw.badge_label as string | null) ?? null,
    accent: (raw.accent as string | null) ?? null,
    products: Array.isArray(raw.products)
      ? (raw.products as Record<string, unknown>[]).map((p) => ({
          id: String(p.id),
          type: String(p.type),
          nameAr: String(p.name_ar ?? ""),
        }))
      : [],
  };
}

/** Replace the package's bundled catalog products (one per type — robe/cap/sash). */
export async function setPackageProducts(id: string, productIds: string[]): Promise<void> {
  await api.put(`/catalog/packages/${id}/products`, { product_ids: productIds });
}

/** Admin list — all packages incl. inactive (VIP + full-set + wholesale all shown). */
export async function listAdminPackages(): Promise<PackageTier[]> {
  const { data } = await api.get<{ data: Record<string, unknown>[] }>("/catalog/packages", {
    params: { all: 1 },
  });
  return (data.data || []).map(mapAdminPackage);
}

export async function createPackage(payload: PackagePayload): Promise<{ id: string }> {
  const { data } = await api.post<{ data: { id: string } }>("/catalog/packages", payload);
  return data.data;
}

export async function updatePackage(id: string, patch: Partial<PackagePayload>): Promise<void> {
  await api.patch(`/catalog/packages/${id}`, patch);
}

export async function deletePackage(id: string): Promise<void> {
  await api.delete(`/catalog/packages/${id}`);
}

// ─── Checkout Group (intake edit) ─────────────────────────────────────────────

export interface CheckoutGroupPayload {
  deposit?: number;
  notes?: string | null;
  event_date?: string | null;
  customer_name?: string;
  instagram_username?: string | null;
  phone_primary?: string;
  phone_secondary?: string | null;
  governorate?: string | null;
  area_details?: string | null;
}

/** PATCH /admin/checkout-groups/:id — update any intake fields. Returns the updated row. */
export async function updateCheckoutGroup(
  id: string,
  payload: CheckoutGroupPayload
): Promise<BundleIntake> {
  const { data } = await api.patch<{ data: {
    id: string;
    customer_name: string;
    instagram_username: string | null;
    phone_primary: string;
    phone_secondary: string | null;
    governorate: string | null;
    area_details: string | null;
    event_date: string | null;
    deposit: string | number;
    notes: string | null;
  } }>(`/admin/checkout-groups/${id}`, payload);
  const r = data.data;
  return {
    customer_name: r.customer_name,
    instagram_username: r.instagram_username,
    phone_primary: r.phone_primary,
    phone_secondary: r.phone_secondary,
    governorate: r.governorate,
    area_details: r.area_details,
    event_date: r.event_date,
    deposit: Number(r.deposit) || 0,
    notes: r.notes,
  };
}

export async function setPackageRule(id: string, sashTypeOptionId: string): Promise<void> {
  await api.put(`/catalog/packages/${id}/rule`, { sash_type_option_id: sashTypeOptionId });
}

export async function setStaffGoal(
  userId: string,
  input: { targetCount: number; bonusAmount: number; deadline: string; titleAr?: string }
): Promise<StaffGoal | null> {
  const { data } = await api.post<{ data: ApiStaffGoal | null }>(`/admin/staff/${userId}/goal`, {
    target_count: input.targetCount,
    bonus_amount: input.bonusAmount,
    deadline: input.deadline,
    title_ar: input.titleAr || undefined,
  });
  return data.data ? mapStaffGoal(data.data) : null;
}
