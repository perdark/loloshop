import { api } from "./api";

/* Mirrors OPERATIONS in backend/controllers/workshopController.js. The Arabic labels arrive
   from the API (`operation_label_ar`), so this union is the only thing to widen here. */
export type WorkshopOperation =
  | "cut" | "overlock" | "cap_sew" | "robe_sew" | "shawl_close" | "american_shawl" | "ruler";
export type WorkshopProduct = "robe" | "cap" | "shawl" | "sash";
export type WorkshopAdjustmentKind = "bonus" | "deduction";
/** Who the finished piece is for — decides which piece rate the worker is paid. */
export type WorkshopAudience = "wholesale" | "retail";

export interface RateRow {
  operation: WorkshopOperation;
  product: WorkshopProduct;
  audience: WorkshopAudience;
  operation_label_ar: string;
  product_label_ar: string;
  audience_label_ar: string;
  amount: number;
}

export interface WorkshopWorker {
  id: string;
  user_id: string;
  name: string;
  role: string;
  is_lead: boolean;
  active: boolean;
  is_staff: boolean;
  pieces: number;
  production: number;
  bonuses: number;
  deductions: number;
  payable: number;
}

export interface WorkshopLedgerEntry {
  id: string;
  kind: "production" | WorkshopAdjustmentKind;
  product: WorkshopProduct | null;
  operation: WorkshopOperation | null;
  product_label_ar: string | null;
  operation_label_ar: string | null;
  /** null on bonus/deduction rows — an adjustment belongs to no audience. */
  audience: WorkshopAudience | null;
  audience_label_ar: string | null;
  qty: number;
  rate: number;
  amount: number;
  entry_date: string;
  reason: string | null;
  created_at: string;
}

export interface WorkerSummary {
  production: number;
  production_wholesale: number;
  production_retail: number;
  bonuses: number;
  deductions: number;
  payable: number;
  pieces: number;
  entries: WorkshopLedgerEntry[];
  rates?: RateRow[];
}

export interface WorkshopDashboard {
  totals: Omit<WorkerSummary, "entries" | "rates"> & {
    active_workers: number;
    pieces_wholesale: number;
    pieces_retail: number;
  };
  workers: WorkshopWorker[];
  recent: (WorkshopLedgerEntry & { worker_name: string })[];
}

export interface PortalMember { id: string; name: string }

export async function getWorkshopPortalMembers(key: string): Promise<PortalMember[]> {
  const { data } = await api.get<{ data: PortalMember[] }>("/workshop/portal/members", { params: { key } });
  return data.data || [];
}

export async function workshopPortalLogin(key: string, workerId: string, password: string) {
  const { data } = await api.post("/workshop/portal-login", { key, worker_id: workerId, password });
  return data as { token: string; user: { id: string; name: string; role: string } };
}

export async function getMyWorkshopSummary(): Promise<WorkerSummary> {
  const { data } = await api.get<WorkerSummary>("/workshop/me/summary");
  return data;
}

export async function recordMyProduction(body: {
  product: WorkshopProduct; operation: WorkshopOperation; audience: WorkshopAudience;
  qty: number; work_date?: string; note?: string;
}) {
  const { data } = await api.post("/workshop/me/production", body);
  return data as { id: string; qty: number; rate: number; amount: number };
}

export async function getWorkshopDashboard(): Promise<WorkshopDashboard> {
  const { data } = await api.get<WorkshopDashboard>("/workshop/dashboard");
  return data;
}

export async function listWorkshopWorkers(): Promise<WorkshopWorker[]> {
  const { data } = await api.get<{ data: WorkshopWorker[] }>("/workshop/workers");
  return data.data || [];
}

export async function getLinkCandidates(): Promise<PortalMember[]> {
  const { data } = await api.get<{ data: PortalMember[] }>("/workshop/link-candidates");
  return data.data || [];
}

export async function createWorkshopWorker(body: { name?: string; password?: string; is_lead?: boolean; link_user_id?: string }) {
  const { data } = await api.post("/workshop/workers", body);
  return data as { id?: string; worker_id?: string; user_id?: string };
}

export async function updateWorkshopWorker(id: string, body: { is_lead?: boolean; active?: boolean; name?: string; password?: string }) {
  await api.patch(`/workshop/workers/${id}`, body);
}

/** Remove a worker from the workshop roster.
 *
 *  ⚠️ The API REFUSES (409 `ERR_HAS_HISTORY`) any worker who has ever been paid — the wage
 *  ledger is ON DELETE CASCADE, so a delete would erase it. Surface that Arabic message with
 *  `getApiErrorMessage`; it names the counts and tells the admin to use «إيقاف» instead.
 *  `account_retired` says whether the worker's own login was retired with them (a workshop
 *  account, `+ عامل`) or left alone (a linked staff member, who still works in the shop). */
export async function deleteWorkshopWorker(id: string): Promise<{ account_retired: boolean }> {
  const { data } = await api.delete<{ ok: true; account_retired: boolean }>(`/workshop/workers/${id}`);
  return { account_retired: !!data.account_retired };
}

export async function listRates(): Promise<RateRow[]> {
  const { data } = await api.get<{ data: RateRow[] }>("/workshop/rates");
  return data.data || [];
}

export async function upsertRate(
  operation: WorkshopOperation, product: WorkshopProduct,
  audience: WorkshopAudience, amount: number
) {
  await api.put("/workshop/rates", { operation, product, audience, amount });
}

export async function recordProductionForWorker(body: {
  worker_id: string; product: WorkshopProduct; operation: WorkshopOperation;
  audience: WorkshopAudience; qty: number; work_date?: string; note?: string;
}) {
  const { data } = await api.post("/workshop/production", body);
  return data as { id: string; qty: number; rate: number; amount: number };
}

export async function addWorkshopAdjustment(body: {
  worker_id: string; kind: WorkshopAdjustmentKind; amount: number; reason: string; entry_date?: string;
}) {
  const { data } = await api.post("/workshop/adjustments", body);
  return data as { id: string };
}

/** Fix a recorded piece. `rate` and `amount` are NEVER sent — the server recomputes the wage
 *  from `workshop_piece_rates` for the (product, operation, audience) triple, the same way the
 *  insert path does. A partial body is merged over the stored row and validated as a whole.
 *
 *  Who may call it: a lead or admin on any entry; a worker on their OWN entry only — that is
 *  the point of it, a worker who mis-taps «سجّل الشغل» can undo it themselves. */
export async function updateProductionEntry(id: string, body: {
  product?: WorkshopProduct; operation?: WorkshopOperation; audience?: WorkshopAudience;
  qty?: number; work_date?: string; note?: string;
}) {
  const { data } = await api.patch(`/workshop/production/${id}`, body);
  return data.data as WorkshopLedgerEntry;
}

/** Delete a recorded piece. Hard delete — an audit_log row keeps the evidence. */
export async function deleteProductionEntry(id: string) {
  await api.delete(`/workshop/production/${id}`);
}

export async function getWorkerLedger(id: string): Promise<WorkerSummary> {
  const { data } = await api.get<WorkerSummary>(`/workshop/workers/${id}/ledger`);
  return data;
}
