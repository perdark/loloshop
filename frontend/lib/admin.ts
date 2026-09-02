import { api, apiUploadFile } from "./api";
import { mapHeroSlide } from "./catalog";
import type { MaintenanceConfig, PromoConfig } from "./catalog";
import type { CreateFullSetPayload, FullSetPackage, FullSetPricing } from "./wholesaler";
import type {
  AdminAccounting,
  AdminAnalytics,
  AdminMoney,
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
  StaffAttendanceRecord,
  StaffAttendanceSettings,
  StaffAttendanceUserSetting,
  StaffBreak,
  StaffBreakBalanceRow,
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

// ─── «إنهاء الخصومات» — ending a discount round ──────────────────────────────
// A price can live in two places (see the backend's lib/discountRestore.js): the product's own
// base_price, or a per-role row. `scope` names which cell each number came from.

export type DiscountScope = "product" | "retail" | "wholesaler";

export interface DiscountCell {
  scope: DiscountScope;
  current_price: number;
  compare_at_price: number;
  delta: number;
  /** The storefront would draw a «خصم ٪N» badge for this audience. */
  discounted: boolean;
}

export interface DiscountProduct {
  id: string;
  name_ar: string;
  type: string;
  active: boolean;
  compare_at_price: number;
  cells: DiscountCell[];
}

export interface DiscountReport {
  products: DiscountProduct[];
  summary: {
    products: number;
    discounted_cells: number;
    /** Set only when every discounted cell moved by the SAME amount. */
    uniform_delta: number | null;
  };
  promo: {
    configured: boolean;
    active: boolean;
    deadline: string | null;
    live: boolean;
  };
}

export interface EndDiscountsPayload {
  products: {
    id: string;
    /** Echoed back so the server can refuse if the data moved since it was displayed. */
    expected_compare_at_price: number;
    /** Empty = clear «السعر قبل الخصم» only, leave every price untouched. */
    scopes: DiscountScope[];
  }[];
  deactivate_promo?: boolean;
  note?: string;
}

export interface EndDiscountsResult {
  batch_id: string;
  products_cleared: number;
  prices_restored: number;
  written: { product_id: string; scope: DiscountScope; from: number; to: number }[];
}

/** Admin-only, read-only: which products carry a «السعر قبل الخصم» and what it did. */
export async function getDiscountReport(): Promise<DiscountReport> {
  const { data } = await api.get<{ data: DiscountReport }>("/admin/discounts");
  return data.data;
}

/** Admin-only: put the selected prices back and clear the old-price field. */
export async function endDiscounts(
  payload: EndDiscountsPayload
): Promise<EndDiscountsResult> {
  const { data } = await api.post<{ data: EndDiscountsResult }>(
    "/admin/discounts/end",
    payload
  );
  return data.data;
}

// ─── «ابدأ الخصومات» — starting a discount round ─────────────────────────────
// The mirror of the block above (backend: lib/discountRound.js). A round sets
// `compare_at_price` to the price a student pays right now, then lowers the selected cells by a
// fixed amount — exactly the shape ending a round reverses.

export interface DiscountCandidateCell {
  scope: DiscountScope;
  current_price: number;
}

export interface DiscountCandidate {
  id: string;
  name_ar: string;
  type: string;
  active: boolean;
  /** Already carries a «السعر قبل الخصم» — a new round on it is refused, not skipped. */
  already_discounted: boolean;
  compare_at_price: number | null;
  /** The EFFECTIVE retail price: the retail row when there is one, else the product's base. */
  retail_price_now: number;
  cells: DiscountCandidateCell[];
  /** Ticked by default: the cell that IS the retail price. Never سعر الجملة. */
  default_scopes: DiscountScope[];
}

export interface DiscountCandidates {
  products: DiscountCandidate[];
  summary: { products: number; available: number; already_discounted: number };
  promo: DiscountReport["promo"];
}

export interface StartDiscountsPayload {
  /** IQD off every selected cell. */
  amount: number;
  products: {
    id: string;
    /** Echoed back so the server can refuse if a price moved since it was displayed. */
    expected_price: number;
    scopes: DiscountScope[];
  }[];
  activate_promo?: boolean;
  note?: string;
}

export interface StartDiscountsResult {
  batch_id: string;
  amount: number;
  products_discounted: number;
  prices_lowered: number;
  written: {
    product_id: string;
    product_name: string;
    scope: DiscountScope;
    from: number;
    to: number;
  }[];
}

/** Admin-only, read-only: every active product a round could be applied to. */
export async function getDiscountCandidates(): Promise<DiscountCandidates> {
  const { data } = await api.get<{ data: DiscountCandidates }>("/admin/discounts/candidates");
  return data.data;
}

/** Admin-only: lower the selected prices and stamp today's price as «السعر قبل الخصم». */
export async function startDiscounts(
  payload: StartDiscountsPayload
): Promise<StartDiscountsResult> {
  const { data } = await api.post<{ data: StartDiscountsResult }>(
    "/admin/discounts/start",
    payload
  );
  return data.data;
}

// ─── إحصائيات التطبيق ────────────────────────────────────────────────────────
// ⚠️ `devices` and `usage` measure DIFFERENT things and are never summed. A device row needs an
// install AND a signed-in session AND the notification prompt granted, so it is a FLOOR on
// installs; `usage` is real opens, but only since migration 087 deployed. See the backend's
// lib/appPresence.js.

export type AppPlatform = "android" | "ios";

export interface AppDeviceCounts {
  devices: number;
  new_7d: number;
  active_7d: number;
  active_30d: number;
}

export interface AppStats {
  window_days: number;
  today: string;
  devices: {
    by_platform: Record<AppPlatform, AppDeviceCounts>;
    trend: { day: string; platform: string; devices: number }[];
    total: number;
    /** Distinct people, not devices — one person can carry a phone and a tablet. */
    people: number;
  };
  usage: {
    daily: { day: string; platform: string; opens: number; users: number }[];
    by_role: { role: string; users: number; opens: number }[];
    active_users: number;
    today_users: number;
    today_opens: number;
    /** NULL until the first ping ever lands — the page says «القياس بدأ يوم …» instead of
     *  drawing an empty chart that reads as "nobody opens the app". */
    tracking_since: string | null;
    /** Which app build each person is on. «أقدم من ٢٦ آب» = a client too old to report it. */
    by_version: { platform: string; app_version: string; users: number }[];
  };
  /**
   * Devices that REFUSED to register for push, with the reason the OS gave (migration 090).
   * Empty is the goal — a row here is the answer to «ليش ما يوصل إشعار».
   */
  register_errors: {
    platform: string | null;
    app_version: string | null;
    message: string | null;
    hits: number;
    newest: string;
  }[];
}

/** Admin-only: app usage and registered devices, both platforms. */
export async function getAppStats(days = 30): Promise<AppStats> {
  const { data } = await api.get<{ data: AppStats }>("/admin/app-stats", { params: { days } });
  return data.data;
}

// ─── «إرسال إشعار» — an admin-composed push ──────────────────────────────────
// ⚠️ It cannot be recalled. The server refuses external links, refuses «الكل» unless the
// recipient count is typed back, and records every send. See backend/lib/pushBroadcast.js.

// ⚠️ `devices` IS «الكل» PLUS THE PHONES WITH NO ACCOUNT (migration 095), and it is the only
// audience whose reach is not a number of people. See PushReach.anon_devices.
export type PushAudienceKind =
  | "all"
  | "devices"
  | "role"
  | "university"
  | "wholesaler"
  | "user";

export interface PushAudience {
  kind: PushAudienceKind;
  value?: string;
}

export interface PushReach {
  people: number;
  /** People who could receive an actual PUSH. The rest still get the in-app bell. */
  devices: number;
  /**
   * Installed handsets with NO account behind them (migration 095). 0 for every audience
   * except «كل الأجهزة».
   *
   * ⚠️ NOT ADDABLE TO `people`. Nobody knows how many humans are behind those phones, and they
   * have no in-app bell to fall back on — a push they miss is simply gone.
   */
  anon_devices: number;
  label: string;
}

export interface SendPushPayload {
  audience: PushAudience;
  /**
   * A promotional message. ⚠️ Narrows the audience to accounts that opted into «العروض» —
   * Apple 4.5.4 forbids promotional push to anyone who did not. Never set it on an order
   * update, and never leave it off on an offer.
   */
  marketing?: boolean;
  title_ar: string;
  body_ar?: string;
  /** Must be a relative in-app path from the server's allowlist. */
  link?: string;
  /** Required for «الكل» and «كل الأجهزة»: the recipient count, typed back. */
  confirmed_count?: number;
}

export interface SendPushResult {
  broadcast_id: string;
  people: number;
  devices: number;
  /** How many of `devices` were accountless handsets. */
  anon_devices?: number;
  label: string;
}

export interface PushBroadcastRow {
  id: string;
  sent_at: string;
  audience_kind: PushAudienceKind;
  audience_value: string | null;
  title_ar: string;
  body_ar: string | null;
  link: string | null;
  people: number;
  devices: number;
  marketing: boolean;
  admin_name: string | null;
}

/** Admin-only, read-only: how far a message would reach, before it can be sent. */
export async function getPushReach(
  audience: PushAudience,
  marketing = false
): Promise<PushReach> {
  const { data } = await api.get<{ data: PushReach }>("/admin/push/audience", {
    params: { kind: audience.kind, value: audience.value, marketing },
  });
  return data.data;
}

/** Admin-only: send it. There is no unsend. */
export async function sendPush(payload: SendPushPayload): Promise<SendPushResult> {
  const { data } = await api.post<{ data: SendPushResult }>("/admin/push", payload);
  return data.data;
}

/** Admin-only: the last 20 human-sent pushes. */
export async function getPushHistory(): Promise<PushBroadcastRow[]> {
  const { data } = await api.get<{ data: { broadcasts: PushBroadcastRow[] } }>(
    "/admin/push/history"
  );
  return data.data.broadcasts;
}

export type { MaintenanceConfig };

/** Admin-only: toggle/save the maintenance-mode flag. */
export async function updateMaintenance(
  payload: MaintenanceConfig
): Promise<MaintenanceConfig> {
  const { data } = await api.patch<{ data: MaintenanceConfig }>(
    "/admin/maintenance",
    payload
  );
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

/** Permanently delete the complete linked order/package containing this order. */
export async function deleteAdminOrder(id: string): Promise<number> {
  const { data } = await api.delete<{ data: { deleted: number } }>(`/admin/orders/${id}`);
  return data.data.deleted;
}

/** Live storefront visitors — distinct sessions now (30 min) / today / all-time. */
export interface VisitorStats {
  now: number;
  today: number;
  total: number;
}
export async function getVisitorStats(): Promise<VisitorStats> {
  const { data } = await api.get<{ data: VisitorStats }>("/admin/visitors");
  return data.data;
}

interface ApiMoney {
  shop_income: number;
  rep_margin: number;
  rep_admin_share: number;
  rep_gross: number;
  retail_revenue: number;
  retail_cost: number;
  gross_collected: number;
  retail_pieces: number;
  retail_pieces_costed: number;
  orders: number;
}

interface ApiAnalytics {
  /** The settled money split — see backend/lib/counts.js. Replaced the old
   *  revenue/cost/profit triple, which reported the REPS' margin as the shop's profit. */
  money: ApiMoney;
  by_status: Record<string, number>;
  /** Stage funnel in BOTH units, split by workability. `pieces` sums to the piece total;
   *  `students` is a MEMBERSHIP count (a student with pieces in two stages appears in both
   *  rows) and deliberately does NOT sum. `workable + awaiting_rep + returned = pieces`.
   *  See backend/lib/counts.js. */
  funnel: {
    stage: string;
    pieces: number;
    students: number;
    workable: number;
    awaiting_rep: number;
    returned: number;
  }[];
  headline: { pieces: number; bundles: number; students: number; in_progress: number };
  rank: {
    key: string; label: string; next_label: string | null; next_at: number | null;
    to_next: number; progress: number; total: number;
    ladder: { key: string; label: string; min: number }[];
  };
  daily: {
    date: string;
    orders: number;
    billable_orders: number;
    revenue: number;
    shop_income: number;
  }[];
  top_wholesalers: { id: string; name: string; order_count: number }[];
}

function mapMoney(raw: ApiMoney): AdminMoney {
  return {
    shopIncome: Number(raw?.shop_income ?? 0),
    repMargin: Number(raw?.rep_margin ?? 0),
    repAdminShare: Number(raw?.rep_admin_share ?? 0),
    repGross: Number(raw?.rep_gross ?? 0),
    retailRevenue: Number(raw?.retail_revenue ?? 0),
    retailCost: Number(raw?.retail_cost ?? 0),
    grossCollected: Number(raw?.gross_collected ?? 0),
    retailPieces: Number(raw?.retail_pieces ?? 0),
    retailPiecesCosted: Number(raw?.retail_pieces_costed ?? 0),
    orders: Number(raw?.orders ?? 0),
  };
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
  calculation?: ApiMoneyCalculation;
}

export interface MoneyCalculationLine {
  label: string;
  price: number;
  adminPrice: number;
  qty: number;
}

export interface MoneyCalculation {
  lines: MoneyCalculationLine[];
  linePriceTotal: number;
  lineAdminTotal: number;
  priceAdjustment: number;
  costAdjustment: number;
}

interface ApiMoneyCalculation {
  lines?: { label: string; price: number; admin_price: number; qty: number }[];
  line_price_total: number;
  line_admin_total: number;
  price_adjustment: number;
  cost_adjustment: number;
}

function mapMoneyCalculation(raw?: ApiMoneyCalculation): MoneyCalculation | undefined {
  if (!raw) return undefined;
  return {
    lines: (raw.lines || []).map((line) => ({
      label: line.label,
      price: Number(line.price),
      adminPrice: Number(line.admin_price),
      qty: Number(line.qty),
    })),
    linePriceTotal: Number(raw.line_price_total),
    lineAdminTotal: Number(raw.line_admin_total),
    priceAdjustment: Number(raw.price_adjustment),
    costAdjustment: Number(raw.cost_adjustment),
  };
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
  royal_sash: { admin: 15000, selling: 15000 },
  royal_cap_when_normal_sash: { admin: 3000, selling: 3000 },
  extra_cap_embroidery: { admin: 3000, selling: 3000 },
  robe_sleeve_each: { admin: 5000, selling: 5000 },
  american_shawl: { admin: 20000, selling: 25000 },
  piece_sash_normal: { admin: 20000, selling: 20000 },
  piece_sash_royal: { admin: 25000, selling: 25000 },
  piece_cap_normal: { admin: 15000, selling: 15000 },
  piece_cap_royal: { admin: 20000, selling: 20000 },
  piece_robe_normal: { admin: 25000, selling: 25000 },
  piece_robe_royal: { admin: 25000, selling: 25000 },
};

function mapAddons(raw?: Partial<WholesalerPricingAddons> | null): WholesalerPricingAddons {
  const result = {} as WholesalerPricingAddons;
  for (const key of Object.keys(DEFAULT_PRICING_ADDONS) as (keyof WholesalerPricingAddons)[]) {
    const value = raw?.[key] as unknown;
    const legacy = Number(value);
    const pair = value && typeof value === "object" ? value as { admin?: number; selling?: number } : null;
    result[key] = {
      admin: Number(pair?.admin ?? (Number.isFinite(legacy) ? legacy : DEFAULT_PRICING_ADDONS[key].admin)),
      selling: Number(pair?.selling ?? (Number.isFinite(legacy) ? legacy : DEFAULT_PRICING_ADDONS[key].selling)),
    };
  }
  return result;
}

/** AdminOrder extended with approval state (present only for wholesaler orders). */
export type AdminOrderWithApproval = AdminOrder & {
  wholesalerApproval: WholesalerApproval | null;
  checkoutGroupId: string | null;
  calculation?: MoneyCalculation;
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
    calculation: mapMoneyCalculation(row.calculation),
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
    money: mapMoney(raw.money),
    ordersByStatus: raw.by_status,
    funnel: (raw.funnel ?? []).map((f) => ({
      stage: f.stage,
      pieces: Number(f.pieces),
      students: Number(f.students),
      workable: Number(f.workable ?? 0),
      awaitingRep: Number(f.awaiting_rep ?? 0),
      returned: Number(f.returned ?? 0),
    })),
    headline: {
      pieces: Number(raw.headline?.pieces ?? 0),
      bundles: Number(raw.headline?.bundles ?? 0),
      students: Number(raw.headline?.students ?? 0),
      inProgress: Number(raw.headline?.in_progress ?? 0),
    },
    rank: {
      key: raw.rank?.key ?? "start",
      label: raw.rank?.label ?? "",
      nextLabel: raw.rank?.next_label ?? null,
      nextAt: raw.rank?.next_at ?? null,
      toNext: Number(raw.rank?.to_next ?? 0),
      progress: Number(raw.rank?.progress ?? 0),
      total: Number(raw.rank?.total ?? 0),
      ladder: (raw.rank?.ladder ?? []).map((r) => ({ key: r.key, label: r.label, min: r.min })),
    },
    dailyOrders: raw.daily.map((d) => ({
      date: String(d.date).slice(0, 10),
      count: Number(d.orders),
      billableCount: Number(d.billable_orders ?? 0),
      revenue: Number(d.revenue),
      shopIncome: Number(d.shop_income ?? 0),
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
  const pageSize = 200;
  const baseParams = {
    wholesaler_id: filters.wholesalerId || undefined,
    batch_id: filters.batchId || undefined,
    status: filters.status || undefined,
    from: filters.dateFrom || undefined,
    to: filters.dateTo || undefined,
    source: filters.source || undefined,
    type: filters.type || undefined,
    zone: filters.zone || undefined,
    approval: filters.approval || undefined,
    limit: pageSize,
  };
  const first = await api.get<{ data: ApiOrderRow[]; total: number }>("/admin/orders", {
    params: { ...baseParams, offset: 0 },
  });
  const total = Number(first.data.total || 0);
  const requests: Promise<{ data: { data: ApiOrderRow[] } }>[] = [];
  for (let offset = pageSize; offset < total; offset += pageSize) {
    requests.push(api.get("/admin/orders", { params: { ...baseParams, offset } }));
  }
  const rest = await Promise.all(requests);
  const rows = [
    ...(first.data.data || []),
    ...rest.flatMap((response) => response.data.data || []),
  ];
  return rows.map(mapOrder);
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
  calculation?: MoneyCalculation;
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
  calculation?: ApiMoneyCalculation;
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
      calculation: mapMoneyCalculation(item.calculation),
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
  filters: Pick<OrdersFilters, "wholesalerId" | "batchId" | "source" | "dateFrom" | "dateTo" | "approval"> = {}
): Promise<AdminBundle[]> {
  const { data } = await api.get<{ data: { bundles: ApiBundle[] } }>("/admin/orders", {
    params: {
      group: "bundle",
      wholesaler_id: filters.wholesalerId || undefined,
      batch_id: filters.batchId || undefined,
      source: filters.source || undefined,
      from: filters.dateFrom || undefined,
      to: filters.dateTo || undefined,
      approval: filters.approval || undefined,
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

/** Every accounting bucket now carries what the SHOP took and what the REP kept, side by
 *  side, instead of one `profit` column that meant a different thing in each bucket. */
interface ApiAccountingRow {
  shop_income: number;
  rep_margin: number;
  revenue: number;
  cost: number;
  orders: number;
}

interface ApiAccounting {
  totals: ApiMoney;
  by_batch: (ApiAccountingRow & {
    id: string;
    name_ar: string;
    wholesaler_name: string | null;
  })[];
  by_wholesaler: (ApiAccountingRow & { id: string; wholesaler_name: string })[];
  independent_retail: ApiAccountingRow;
}

function mapAccountingRow(
  label: string,
  raw: ApiAccountingRow,
  id?: string
): AccountingRow {
  return {
    id,
    label,
    shopIncome: Number(raw.shop_income ?? 0),
    repMargin: Number(raw.rep_margin ?? 0),
    revenue: Number(raw.revenue),
    cost: Number(raw.cost),
    orders: Number(raw.orders),
  };
}

export async function getAdminAccounting(): Promise<AdminAccounting> {
  const { data } = await api.get<ApiAccounting>("/admin/accounting");
  return {
    totals: mapMoney(data.totals),
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
  source_type?: string;
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
    sourceType: r.source_type,
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

export async function removeStaffSalaryTransaction(
  userId: string,
  txnId: string,
  reasonAr?: string
): Promise<StaffSalary> {
  const { data } = await api.delete<{ data: ApiStaffSalary }>(
    `/admin/staff/${userId}/salary/transactions/${txnId}`,
    { data: { reason_ar: reasonAr || undefined } }
  );
  return {
    userId: data.data.user_id,
    baseSalary: Number(data.data.base_salary),
    balance: Number(data.data.balance),
    transactions: (data.data.transactions || []).map(mapSalaryTxn),
  };
}

// ─── Staff Attendance / بصمة الموظفين ─────────────────────────────────────────

interface ApiAttendanceSettings {
  start_time: string;
  end_time: string;
  grace_minutes: number;
  deduction_per_minute: number;
  verification_mode: StaffAttendanceSettings["verificationMode"];
  allowed_ip_ranges: string[];
  shop_latitude: number | null;
  shop_longitude: number | null;
  shop_radius_meters: number;
  timezone: string;
  updated_at?: string | null;
  is_user_override?: boolean;
  attendance_required?: boolean;
  break_monthly_minutes?: number;
}

interface ApiAttendanceUserSetting {
  user_id: string;
  staff_name: string | null;
  start_time: string | null;
  end_time: string | null;
  grace_minutes: number | null;
  deduction_per_minute: number | null;
  attendance_required: boolean;
  break_monthly_minutes: number | null;
  has_override: boolean;
  updated_at: string | null;
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
  present_minutes?: number;
  break_minutes?: number;
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
    verificationMode: r.verification_mode,
    allowedIpRanges: r.allowed_ip_ranges || [],
    shopLatitude: r.shop_latitude == null ? null : Number(r.shop_latitude),
    shopLongitude: r.shop_longitude == null ? null : Number(r.shop_longitude),
    shopRadiusMeters: Number(r.shop_radius_meters),
    timezone: r.timezone,
    updatedAt: r.updated_at ?? null,
    isUserOverride: Boolean(r.is_user_override),
    attendanceRequired: r.attendance_required !== false,
    breakMonthlyMinutes: Number(r.break_monthly_minutes ?? 0),
  };
}

function mapAttendanceUserSetting(r: ApiAttendanceUserSetting): StaffAttendanceUserSetting {
  return {
    userId: r.user_id,
    staffName: r.staff_name,
    startTime: r.start_time,
    endTime: r.end_time,
    graceMinutes: r.grace_minutes == null ? null : Number(r.grace_minutes),
    deductionPerMinute: r.deduction_per_minute == null ? null : Number(r.deduction_per_minute),
    attendanceRequired: r.attendance_required !== false,
    breakMonthlyMinutes:
      r.break_monthly_minutes == null ? null : Number(r.break_monthly_minutes),
    hasOverride: Boolean(r.has_override),
    updatedAt: r.updated_at,
  };
}

function mapAttendanceRecord(r: ApiAttendanceRecord): StaffAttendanceRecord {
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
    presentMinutes: Number(r.present_minutes ?? r.worked_minutes) || 0,
    breakMinutes: Number(r.break_minutes ?? 0) || 0,
    scheduledMinutes: Number(r.scheduled_minutes) || 0,
    overtimeMinutes: Number(r.overtime_minutes) || 0,
    openTooLong: Boolean(r.open_too_long),
    overriddenBy: r.overridden_by,
    overriddenAt: r.overridden_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getAttendanceSettings(): Promise<StaffAttendanceSettings> {
  const { data } = await api.get<{ data: ApiAttendanceSettings }>("/admin/attendance/settings");
  return mapAttendanceSettings(data.data);
}

export async function updateAttendanceSettings(
  input: StaffAttendanceSettings
): Promise<StaffAttendanceSettings> {
  const { data } = await api.patch<{ data: ApiAttendanceSettings }>("/admin/attendance/settings", {
    start_time: input.startTime,
    end_time: input.endTime,
    grace_minutes: input.graceMinutes,
    deduction_per_minute: input.deductionPerMinute,
    verification_mode: input.verificationMode,
    allowed_ip_ranges: input.allowedIpRanges,
    shop_latitude: input.shopLatitude,
    shop_longitude: input.shopLongitude,
    shop_radius_meters: input.shopRadiusMeters,
    break_monthly_minutes: input.breakMonthlyMinutes,
  });
  return mapAttendanceSettings(data.data);
}

export async function getAttendanceRecords(params?: {
  date?: string;
  userId?: string;
}): Promise<StaffAttendanceRecord[]> {
  const { data } = await api.get<{ data: ApiAttendanceRecord[] }>("/admin/attendance/records", {
    params: { date: params?.date, user_id: params?.userId },
  });
  return (data.data || []).map(mapAttendanceRecord);
}

export interface AttendanceCalendarTotals {
  staffCount: number;
  presentCount: number;
  lateCount: number;
  openCount: number;
  openTooLongCount: number;
  workedMinutes: number;
  overtimeMinutes: number;
}

export interface AttendanceCalendarDay {
  date: string;
  records: StaffAttendanceRecord[];
  totals: AttendanceCalendarTotals;
}

interface ApiAttendanceCalendarDay {
  date: string;
  records: ApiAttendanceRecord[];
  totals: {
    staff_count: number;
    present_count: number;
    late_count: number;
    open_count: number;
    open_too_long_count: number;
    worked_minutes: number;
    overtime_minutes: number;
  };
}

export async function getAttendanceCalendar(params: {
  from: string;
  to: string;
  userId?: string;
}): Promise<AttendanceCalendarDay[]> {
  const { data } = await api.get<{
    data: { from: string; to: string; days: ApiAttendanceCalendarDay[] };
  }>("/admin/attendance/calendar", {
    params: { from: params.from, to: params.to, user_id: params.userId },
  });
  return (data.data.days || []).map((day) => ({
    date: day.date,
    records: (day.records || []).map(mapAttendanceRecord),
    totals: {
      staffCount: Number(day.totals.staff_count) || 0,
      presentCount: Number(day.totals.present_count) || 0,
      lateCount: Number(day.totals.late_count) || 0,
      openCount: Number(day.totals.open_count) || 0,
      openTooLongCount: Number(day.totals.open_too_long_count) || 0,
      workedMinutes: Number(day.totals.worked_minutes) || 0,
      overtimeMinutes: Number(day.totals.overtime_minutes) || 0,
    },
  }));
}

export async function overrideAttendanceRecord(
  id: string,
  input: { lateMinutes?: number; deductionAmount?: number; noteAr?: string }
): Promise<StaffAttendanceRecord> {
  const { data } = await api.patch<{ data: ApiAttendanceRecord }>(
    `/admin/attendance/records/${id}/override`,
    {
      late_minutes: input.lateMinutes,
      deduction_amount: input.deductionAmount,
      note_ar: input.noteAr || undefined,
    }
  );
  return mapAttendanceRecord(data.data);
}

export async function getAttendanceUserSettings(): Promise<StaffAttendanceUserSetting[]> {
  const { data } = await api.get<{ data: ApiAttendanceUserSetting[] }>(
    "/admin/attendance/staff-settings"
  );
  return (data.data || []).map(mapAttendanceUserSetting);
}

export async function setAttendanceUserSettings(
  userId: string,
  input: {
    startTime: string;
    endTime: string;
    graceMinutes: number;
    deductionPerMinute: number;
    attendanceRequired: boolean;
    /** null = inherit the shop-wide الخروج المؤقت allowance */
    breakMonthlyMinutes?: number | null;
  }
): Promise<StaffAttendanceUserSetting> {
  const { data } = await api.put<{ data: ApiAttendanceUserSetting }>(
    `/admin/attendance/staff-settings/${userId}`,
    {
      start_time: input.startTime,
      end_time: input.endTime,
      grace_minutes: input.graceMinutes,
      deduction_per_minute: input.deductionPerMinute,
      attendance_required: input.attendanceRequired,
      break_monthly_minutes: input.breakMonthlyMinutes ?? null,
    }
  );
  return mapAttendanceUserSetting(data.data);
}

export async function deleteAttendanceUserSettings(userId: string): Promise<void> {
  await api.delete(`/admin/attendance/staff-settings/${userId}`);
}

// ─── جدول الدوام الأسبوعي + الإجازات (migration 093) ─────────────────────────────────────

/** ⚠️ `weekday` is POSTGRES EXTRACT(DOW) numbering — 0 = الأحد … 6 = السبت, so الجمعة is 5. */
export interface ScheduleDay {
  weekday: number;
  label_ar: string;
  start_time: string;
  end_time: string;
  is_off: boolean;
  crosses_midnight: boolean;
}

export interface Holiday {
  work_date: string;
  label_ar: string;
}

export async function getStaffSchedule(): Promise<{ week: ScheduleDay[]; holidays: Holiday[] }> {
  const { data } = await api.get<{ data: { week: ScheduleDay[]; holidays: Holiday[] } }>(
    "/admin/attendance/schedule"
  );
  return data.data;
}

/**
 * The WHOLE week in one request — the server refuses anything but seven days. Seven rows are
 * one decision («شنو دوام المحل»), and a half-applied week is the shape where الجمعة is right
 * and السبت is still wrong, which is the bug the table exists to end.
 */
export async function saveStaffSchedule(days: ScheduleDay[]): Promise<ScheduleDay[]> {
  const { data } = await api.put<{ data: { week: ScheduleDay[] } }>(
    "/admin/attendance/schedule",
    {
      days: days.map((d) => ({
        weekday: d.weekday,
        start_time: d.start_time,
        end_time: d.end_time,
        is_off: d.is_off,
      })),
    }
  );
  return data.data.week;
}

export async function addHoliday(workDate: string, labelAr: string): Promise<Holiday> {
  const { data } = await api.post<{ data: Holiday }>("/admin/attendance/holidays", {
    work_date: workDate,
    label_ar: labelAr,
  });
  return data.data;
}

export async function deleteHoliday(workDate: string): Promise<void> {
  await api.delete(`/admin/attendance/holidays/${workDate}`);
}

// ─── جهاز البصمة (ZKTeco K40 عبر ADMS) — migration 094 ────────────────────────────────────

export type DevicePushState = "pending" | "sent" | "confirmed" | "failed";

export const DEVICE_PUSH_STATE_AR: Record<DevicePushState, string> = {
  pending: "بالانتظار",
  sent: "انرسل",
  confirmed: "تأكد",
  failed: "فشل",
};

export interface AttendanceDevice {
  serial_number: string;
  label_ar: string;
  active: boolean;
  /** null = «لم يتصل بعد» — the device has never dialled in. */
  last_seen_at: string | null;
  last_ip: string | null;
  firmware_note: string | null;
  created_at: string;
  today_punches: number;
  queued_commands: number;
}

export interface StaffDevicePin {
  user_id: string;
  staff_name: string;
  pin: number | null;
  pushed_name: string | null;
  push_state: DevicePushState | null;
  enrolled_at: string | null;
  punch_count: number;
}

/** A number that has punched but belongs to nobody yet — «أرقام جهاز بلا اسم». */
export interface UnmappedPin {
  device_pin: string;
  punch_count: number;
  first_seen_at: string;
  last_seen_at: string;
  first_device_ts: string;
  last_device_ts: string;
  device_sn: string | null;
  mapped_user_id: string | null;
  mapped_staff_name: string | null;
}

export interface PunchReject {
  id: number;
  device_sn: string | null;
  raw_line: string | null;
  reason: string;
  at: string;
}

/** What the replay did when a pin was linked. `created` is «كم يوم ظهر للموظف». */
export interface PinLinkMeta {
  replayed: number;
  derived: { created: number; extended: number; moved_in: number; ignored: number; unmapped: number };
  queued: number;
}

export async function getAttendanceDevices(): Promise<AttendanceDevice[]> {
  const { data } = await api.get<{ data: AttendanceDevice[] }>("/admin/attendance/devices");
  return data.data || [];
}

export async function registerAttendanceDevice(
  serialNumber: string,
  labelAr?: string
): Promise<AttendanceDevice> {
  const { data } = await api.post<{ data: AttendanceDevice }>("/admin/attendance/devices", {
    serial_number: serialNumber,
    label_ar: labelAr,
  });
  return data.data;
}

export async function updateAttendanceDevice(
  serialNumber: string,
  patch: { labelAr?: string; active?: boolean; firmwareNote?: string | null }
): Promise<AttendanceDevice> {
  const { data } = await api.patch<{ data: AttendanceDevice }>(
    `/admin/attendance/devices/${encodeURIComponent(serialNumber)}`,
    {
      label_ar: patch.labelAr,
      active: patch.active,
      firmware_note: patch.firmwareNote,
    }
  );
  return data.data;
}

export async function getDevicePins(): Promise<StaffDevicePin[]> {
  const { data } = await api.get<{ data: StaffDevicePin[] }>("/admin/attendance/pins");
  return data.data || [];
}

/**
 * Set a pin, or leave `pin` undefined to let the server allocate the lowest free number —
 * an admin standing next to the device should not have to remember what is already in it.
 */
export async function setDevicePin(
  userId: string,
  input: { pin?: number | null; pushedName?: string } = {}
): Promise<{ row: StaffDevicePin; meta: PinLinkMeta }> {
  const { data } = await api.put<{ data: StaffDevicePin; meta: PinLinkMeta }>(
    `/admin/attendance/pins/${userId}`,
    { pin: input.pin ?? null, pushed_name: input.pushedName }
  );
  return { row: data.data, meta: data.meta };
}

export async function deleteDevicePin(userId: string): Promise<void> {
  await api.delete(`/admin/attendance/pins/${userId}`);
}

export async function getUnmappedPins(): Promise<UnmappedPin[]> {
  const { data } = await api.get<{ data: UnmappedPin[] }>("/admin/attendance/unmapped");
  return data.data || [];
}

/**
 * «اربط بموظف» — links the number AND replays every punch it already made, so a worker who
 * has been touching the device unnamed for a week gets that week of attendance at once.
 * `meta.derived.created` is how many days appeared.
 */
export async function assignUnmappedPin(
  pin: string,
  userId: string
): Promise<{ row: StaffDevicePin; meta: PinLinkMeta }> {
  const { data } = await api.post<{ data: StaffDevicePin; meta: PinLinkMeta }>(
    `/admin/attendance/unmapped/${encodeURIComponent(pin)}/assign`,
    { user_id: userId }
  );
  return { row: data.data, meta: data.meta };
}

export async function getPunchRejects(limit = 50): Promise<PunchReject[]> {
  const { data } = await api.get<{ data: PunchReject[] }>("/admin/attendance/rejects", {
    params: { limit },
  });
  return data.data || [];
}

// ─── الخروج المؤقت (admin side) ──────────────────────────────────────────────

interface ApiAdminBreak {
  id: string;
  user_id: string;
  staff_name: string | null;
  work_date: string;
  month_key: string;
  reason_ar: string | null;
  requested_minutes: number | null;
  requested_at: string;
  left_at: string | null;
  returned_at: string | null;
  minutes: number;
  state: StaffBreak["state"];
  approval: StaffBreak["approval"];
  left_without_approval: boolean;
  decided_at: string | null;
  decision_note_ar: string | null;
  free_minutes: number;
  deducted_minutes: number;
  deduction_per_minute: number;
  deduction_amount: number;
  auto_closed: boolean;
  admin_note_ar: string | null;
  open_minutes: number;
  open_too_long: boolean;
}

function mapAdminBreak(r: ApiAdminBreak): StaffBreak {
  return {
    id: r.id,
    userId: r.user_id,
    staffName: r.staff_name,
    workDate: r.work_date,
    monthKey: r.month_key,
    reasonAr: r.reason_ar,
    requestedMinutes: r.requested_minutes == null ? null : Number(r.requested_minutes),
    requestedAt: r.requested_at,
    leftAt: r.left_at,
    returnedAt: r.returned_at,
    minutes: Number(r.minutes) || 0,
    state: r.state,
    approval: r.approval,
    leftWithoutApproval: Boolean(r.left_without_approval),
    decidedAt: r.decided_at,
    decisionNoteAr: r.decision_note_ar,
    freeMinutes: Number(r.free_minutes) || 0,
    deductedMinutes: Number(r.deducted_minutes) || 0,
    deductionPerMinute: Number(r.deduction_per_minute) || 0,
    deductionAmount: Number(r.deduction_amount) || 0,
    autoClosed: Boolean(r.auto_closed),
    adminNoteAr: r.admin_note_ar,
    openMinutes: Number(r.open_minutes) || 0,
    openTooLong: Boolean(r.open_too_long),
  };
}

export async function getBreaks(params?: {
  from?: string;
  to?: string;
  userId?: string;
  state?: StaffBreak["state"];
  approval?: StaffBreak["approval"];
}): Promise<StaffBreak[]> {
  const { data } = await api.get<{ data: ApiAdminBreak[] }>("/admin/attendance/breaks", {
    params: {
      from: params?.from,
      to: params?.to,
      user_id: params?.userId,
      state: params?.state,
      approval: params?.approval,
    },
  });
  return (data.data || []).map(mapAdminBreak);
}

export async function getBreakBalances(month?: string): Promise<{
  monthKey: string;
  staff: StaffBreakBalanceRow[];
}> {
  const { data } = await api.get<{
    data: {
      month_key: string;
      staff: Array<{
        user_id: string;
        staff_name: string | null;
        monthly_minutes: number;
        used_minutes: number;
        remaining_minutes: number;
        deducted_minutes: number;
        deduction_amount: number;
        break_count: number;
        out_count: number;
        pending_count: number;
      }>;
    };
  }>("/admin/attendance/breaks/balances", { params: month ? { month } : undefined });
  return {
    monthKey: data.data.month_key,
    staff: (data.data.staff || []).map((s) => ({
      userId: s.user_id,
      staffName: s.staff_name,
      monthKey: data.data.month_key,
      monthlyMinutes: Number(s.monthly_minutes) || 0,
      usedMinutes: Number(s.used_minutes) || 0,
      remainingMinutes: Number(s.remaining_minutes) || 0,
      deductedMinutes: Number(s.deducted_minutes) || 0,
      deductionAmount: Number(s.deduction_amount) || 0,
      breakCount: Number(s.break_count) || 0,
      outCount: Number(s.out_count) || 0,
      pendingCount: Number(s.pending_count) || 0,
    })),
  };
}

export async function decideBreak(
  breakId: string,
  decision: "approve" | "reject",
  noteAr?: string
): Promise<StaffBreak> {
  const { data } = await api.post<{ data: { break: ApiAdminBreak } }>(
    `/admin/attendance/breaks/${breakId}/${decision}`,
    { note_ar: noteAr || null }
  );
  return mapAdminBreak(data.data.break);
}

/** Fix a break the worker forgot to close, or correct its duration. */
export async function correctBreak(
  breakId: string,
  input: { minutes?: number; returnedAt?: string; adminNoteAr?: string }
): Promise<StaffBreak> {
  const { data } = await api.patch<{ data: { break: ApiAdminBreak } }>(
    `/admin/attendance/breaks/${breakId}`,
    {
      minutes: input.minutes,
      returned_at: input.returnedAt,
      admin_note_ar: input.adminNoteAr || null,
    }
  );
  return mapAdminBreak(data.data.break);
}

// ─── Admin Custom Orders ──────────────────────────────────────────────────────

export interface AdminCustomOrderWholesaler {
  id: string;
  name: string;
  universityName: string | null;
  department: string | null;
  pricing: FullSetPricing;
}

export interface AdminCustomOrderConfig {
  packages: FullSetPackage[];
  pricing: FullSetPricing | null;
  wholesalers: AdminCustomOrderWholesaler[];
}

export interface AdminCustomOrderPayload extends CreateFullSetPayload {
  /** طالب جديد mode — required when student_id absent. */
  student_name?: string;
  /** طالب موجود mode — takes precedence over student_name. */
  student_id?: string | null;
  wholesaler_id?: string | null;
}

export async function getAdminCustomOrderConfig(): Promise<AdminCustomOrderConfig> {
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
  }>("/admin/custom-order/config");
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

export async function createAdminCustomOrder(
  payload: AdminCustomOrderPayload
): Promise<{ studentId: string; total: number; packageName: string }> {
  const { data } = await api.post<{
    data: { student_id: string; total: number; package_name: string };
  }>("/admin/custom-order", payload);
  return {
    studentId: data.data.student_id,
    total: data.data.total,
    packageName: data.data.package_name,
  };
}

export async function uploadAdminCustomOrderImage(file: File): Promise<string> {
  const res = (await apiUploadFile("/admin/custom-order/uploads/image", file)) as {
    data: { url: string };
  };
  return res.data.url;
}

export async function searchAdminCustomOrderStudents(
  q: string
): Promise<import("./staff").StudentSearchHit[]> {
  const { data } = await api.get<{ data: import("./staff").StudentSearchHit[] }>(
    "/admin/custom-order/students-search",
    { params: { q } }
  );
  return data.data ?? [];
}

// ─── Staff Activity ──────────────────────────────────────────────────────────

interface ApiStaffActivity {
  id: string;
  source: "stage" | "audit";
  action: string;
  order_id: string | null;
  from_stage: string | null;
  to_stage: string | null;
  zone: string | null;
  created_at: string;
  product_name: string | null;
  student_name: string | null;
}

/** `month` is 'YYYY-MM'. Omit it for the current month at the shop (Asia/Baghdad). */
export async function getStaffActivity(userId: string, month?: string): Promise<StaffActivity[]> {
  const { data } = await api.get<{ data: ApiStaffActivity[]; meta: { month: string } }>(
    `/admin/staff/${userId}/activity`,
    { params: month ? { month } : undefined }
  );
  return (data.data || []).map((r) => ({
    id: r.id,
    source: r.source,
    action: r.action,
    orderId: r.order_id,
    fromStage: (r.from_stage as StaffActivity["fromStage"]) ?? null,
    toStage: (r.to_stage as StaffActivity["toStage"]) ?? null,
    zone: r.zone,
    createdAt: r.created_at,
    productName: r.product_name,
    studentName: r.student_name,
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

// ─── OTP gateway status — GET /admin/otp-gateway ───────────────────────────────
// Read-only mirror of backend/lib/otp.js's gatewayStatus(): which WhatsApp sender device is
// currently active, and whether any device is presently cooled down (i.e. failed a send that
// another device then succeeded on — see the file's own header for why devices are NEVER
// load-balanced and why a cooldown is the only signal a ban leaves behind). Device ids arrive
// already masked by the backend (`maskDevice`) — never a raw credential.

export interface OtpGatewayDevice {
  /** Masked device id, e.g. "a1b2c3…" — never the raw Zentramsg device uuid. */
  device: string;
  healthy: boolean;
  cooledUntil: string | null;
  sent: number;
  failed: number;
}

export interface OtpGatewayStatus {
  configured: number;
  /** Masked id of the device currently sending, or null if none are configured. */
  active: string | null;
  /** Index 0 is always the PRIMARY device (ZENTRAMSG_DEVICE_UUID) — configuredDevices()
   *  preserves DEVICE_ENV_KEYS order, so this ordering is load-bearing for telling
   *  "still on the primary" apart from "failed over to a backup". */
  devices: OtpGatewayDevice[];
}

interface ApiOtpGatewayDevice {
  device: string;
  healthy: boolean;
  cooled_until: string | null;
  sent: number;
  failed: number;
}

export async function getOtpGatewayStatus(): Promise<OtpGatewayStatus> {
  const { data } = await api.get<{
    data: { configured: number; active: string | null; devices: ApiOtpGatewayDevice[] };
  }>("/admin/otp-gateway");
  const raw = data.data;
  return {
    configured: Number(raw?.configured ?? 0),
    active: raw?.active ?? null,
    devices: (raw?.devices || []).map((d) => ({
      device: d.device,
      healthy: !!d.healthy,
      cooledUntil: d.cooled_until ?? null,
      sent: Number(d.sent ?? 0),
      failed: Number(d.failed ?? 0),
    })),
  };
}
