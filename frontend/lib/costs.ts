import { api } from "./api";

/**
 * «التكاليف والربح الحقيقي» — typed wrappers for the admin cost model + true-profit report.
 *
 * WHY THIS EXISTS: the dashboard's «دخل المحل» was never a profit figure — no production
 * cost, salary or fixed expense was ever subtracted from it (see the `retailCostMissing`
 * warning on `/admin`). This file talks to the backend's new cost model
 * (`/admin/costs/*`, built in parallel — see `docs/superpowers/specs/` if one exists for it)
 * so an admin can enter materials/wages/salaries/expenses and finally see a real net figure.
 *
 * Every number here is an ESTIMATE until the admin marks the underlying item/expense
 * `confirmed` — `Pnl.confidence` is how the UI says so instead of presenting a guess as fact.
 *
 * Response shapes follow the contract exactly as specified (no `{ data }` envelope on GET,
 * `{ item }` / `{ line }` / `{ expense }` / `{ settings }` / `{ ok }` on mutations) — this
 * differs from some older wrappers in `lib/admin.ts` that unwrap `{ data }`. If the real
 * backend turns out to wrap responses differently, only this file needs to change.
 */

// ─── Shared vocabulary ───────────────────────────────────────────────────────

export type CostCategory =
  | "material"
  | "embroidery"
  | "press"
  | "packaging"
  | "operating"
  | "other";

export type ProductType = "sash" | "robe" | "cap" | "shawl";

export type CostLineAudience = "all" | "retail" | "rep";

export type ExpenseKind = "monthly" | "one_off" | "loss";

export interface CostItem {
  id: string;
  category: CostCategory;
  name_ar: string;
  unit_ar: string;
  unit_cost: number;
  confirmed: boolean;
  note_ar: string | null;
  sort: number;
}

export interface CostLine {
  id: string;
  product_type: ProductType;
  /** null = applies to every product of this type. */
  product_id: string | null;
  audience: CostLineAudience;
  cost_item_id: string;
  qty: number;
  note_ar: string | null;
}

export interface Expense {
  id: string;
  kind: ExpenseKind;
  category: string;
  name_ar: string;
  amount: number;
  starts_on: string;
  ends_on: string | null;
  confirmed: boolean;
  note_ar: string | null;
}

export interface CostSettings {
  usd_iqd: number;
  unsalaried_day_rate: number;
}

export interface CostProduct {
  id: string;
  name_ar: string;
  type: ProductType;
  active: boolean;
  parent_id: string | null;
}

export interface CostModel {
  items: CostItem[];
  lines: CostLine[];
  expenses: Expense[];
  settings: CostSettings;
  products: CostProduct[];
}

// ─── The true-profit report ──────────────────────────────────────────────────

export interface PnlCosts {
  materials: number;
  workshop_wages: number;
  salaries: number;
  fixed_expenses: number;
  one_off_expenses: number;
  losses: number;
  ai: number;
}

export interface PnlIncome {
  shop_income: number;
  rep_admin_share: number;
  retail_revenue: number;
  /** Context only — never added to or subtracted from the shop's own money. */
  rep_margin: number;
  pieces: number;
}

export interface PnlMonth {
  /** "YYYY-MM", or "total" for the aggregate row. */
  month: string;
  /** The current, still-running month — its numbers read "لحد اليوم". */
  partial: boolean;
  income: PnlIncome;
  costs: PnlCosts;
  total_costs: number;
  net: number;
  margin_pct: number | null;
}

export interface PnlProductRow {
  product_id: string;
  name_ar: string;
  product_type: ProductType;
  pieces: number;
  shop_income: number;
  income_per_piece: number;
  material_cost_per_piece: number;
  material_cost: number;
  contribution: number;
}

export type PnlSalarySource = "statement" | "base" | "estimate" | "workshop";

export interface PnlSalaryRow {
  user_id: string;
  name: string;
  source: PnlSalarySource;
  amount: number;
  note_ar: string | null;
}

export interface PnlWarning {
  code: string;
  text_ar: string;
}

export interface Pnl {
  from: string;
  to: string;
  months: PnlMonth[];
  total: PnlMonth;
  per_product: PnlProductRow[];
  salaries_detail: PnlSalaryRow[];
  losses_detail: {
    manual: number;
    cancelled_after_work: { pieces: number; material_estimate: number };
  };
  ai_usd: number;
  usd_iqd: number;
  confidence: {
    items_total: number;
    items_confirmed: number;
    expenses_total: number;
    expenses_confirmed: number;
  };
  warnings: PnlWarning[];
}

// ─── Model: read + CRUD ───────────────────────────────────────────────────────

export async function getCostModel(): Promise<CostModel> {
  const { data } = await api.get<CostModel>("/admin/costs/model");
  return data;
}

export async function getCostPnl(from: string, to: string): Promise<Pnl> {
  const { data } = await api.get<Pnl>("/admin/costs/pnl", { params: { from, to } });
  return data;
}

// ── Cost items (بنود التكلفة) ──

export type CreateCostItemPayload = Omit<CostItem, "id" | "sort"> & { sort?: number };
export type UpdateCostItemPayload = Partial<Omit<CostItem, "id">>;

export async function createCostItem(payload: CreateCostItemPayload): Promise<CostItem> {
  const { data } = await api.post<{ item: CostItem }>("/admin/costs/items", payload);
  return data.item;
}

export async function updateCostItem(
  id: string,
  payload: UpdateCostItemPayload
): Promise<CostItem> {
  const { data } = await api.patch<{ item: CostItem }>(`/admin/costs/items/${id}`, payload);
  return data.item;
}

/** Also deletes every recipe line referencing this item — say so in the confirm dialog. */
export async function deleteCostItem(id: string): Promise<void> {
  await api.delete<{ ok: true }>(`/admin/costs/items/${id}`);
}

// ── Recipe lines (وصفة كل منتج) ──

export type CreateCostLinePayload = Omit<CostLine, "id">;
export type UpdateCostLinePayload = Partial<Omit<CostLine, "id">>;

export async function createCostLine(payload: CreateCostLinePayload): Promise<CostLine> {
  const { data } = await api.post<{ line: CostLine }>("/admin/costs/lines", payload);
  return data.line;
}

export async function updateCostLine(
  id: string,
  payload: UpdateCostLinePayload
): Promise<CostLine> {
  const { data } = await api.patch<{ line: CostLine }>(`/admin/costs/lines/${id}`, payload);
  return data.line;
}

export async function deleteCostLine(id: string): Promise<void> {
  await api.delete<{ ok: true }>(`/admin/costs/lines/${id}`);
}

// ── Expenses / losses (المصاريف والخسائر) ──

export type CreateExpensePayload = Omit<Expense, "id">;
export type UpdateExpensePayload = Partial<Omit<Expense, "id">>;

export async function createExpense(payload: CreateExpensePayload): Promise<Expense> {
  const { data } = await api.post<{ expense: Expense }>("/admin/costs/expenses", payload);
  return data.expense;
}

export async function updateExpense(
  id: string,
  payload: UpdateExpensePayload
): Promise<Expense> {
  const { data } = await api.patch<{ expense: Expense }>(
    `/admin/costs/expenses/${id}`,
    payload
  );
  return data.expense;
}

export async function deleteExpense(id: string): Promise<void> {
  await api.delete<{ ok: true }>(`/admin/costs/expenses/${id}`);
}

// ── Settings ──

export async function updateCostSettings(
  payload: Partial<CostSettings>
): Promise<CostSettings> {
  const { data } = await api.patch<{ settings: CostSettings }>(
    "/admin/costs/settings",
    payload
  );
  return data.settings;
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export const COST_CATEGORY_LABEL: Record<CostCategory, string> = {
  material: "قماش ومواد",
  embroidery: "تطريز",
  press: "كوي وتكبيس وطباعة",
  packaging: "تغليف وبكجات",
  operating: "تشغيل ومستهلكات",
  other: "أخرى",
};

export const PRODUCT_TYPE_LABEL: Record<ProductType, string> = {
  sash: "وشاح",
  robe: "روب",
  cap: "قبعة",
  shawl: "شال",
};

export const COST_LINE_AUDIENCE_LABEL: Record<CostLineAudience, string> = {
  all: "الكل",
  retail: "التجزئة",
  rep: "الممثلين",
};

export const EXPENSE_KIND_LABEL: Record<ExpenseKind, string> = {
  monthly: "شهرية ثابتة",
  one_off: "لمرة واحدة",
  loss: "خسائر",
};

export const SALARY_SOURCE_LABEL: Record<PnlSalarySource, string> = {
  statement: "كشف راتب",
  base: "راتب أساسي",
  estimate: "تقديري — ماله راتب مسجل",
  workshop: "ورشة بالقطعة",
};
