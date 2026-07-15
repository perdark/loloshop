import { api } from "@/lib/api";

export type CalSource = "typed" | "wholesaler" | "txt";
export type CalVariant = "front" | "back" | "cap" | "cap_side";

export const VARIANT_LABEL: Record<CalVariant, string> = {
  front: "أمامي",
  back: "خلفي",
  cap: "قبعة — أعلى",
  cap_side: "قبعة — جانب",
};

export interface CalPlate {
  id: string;
  render_text: string;
  status: "pending" | "done" | "failed";
  plate_path: string | null;
  sheet_path: string | null;
  student_id: string | null;
  order_item_id: string | null;
  linked: boolean;
  cost_usd: number;
  error: string | null;
  variant: CalVariant;
  element_text: string | null;
  /** Order context (attached server-side when the plate belongs to an order line). */
  order_id?: string | null;
  order_status?: string | null;
  zone_label?: string | null;
  student_name?: string | null;
  product_name?: string | null;
  product_type?: string | null;
  wholesaler_id?: string | null;
  wholesaler_name?: string | null;
}

export interface CalJob {
  job_id: string;
  total: number;
  done: number;
  failed: number;
  pending: number;
  job_cost: number;
  /** Names the server refused to generate (no ≥2 Arabic letters). */
  dropped?: string[];
  plates: CalPlate[];
}

export interface CalProcess {
  processed: number;
  total: number;
  done: number;
  failed: number;
  pending: number;
  remaining: number;
  job_cost: number;
  review?: boolean;
  /** How many generation attempts this batch took (1 = clean first try). */
  attempts?: number;
  plates: CalPlate[];
}

export interface CalWholesaler {
  id: string;
  name: string;
  student_count: number;
}

export interface CalGrabRow {
  student_id: string;
  student_name: string;
  order_item_id: string;
  render_text: string;
  plate_id: string | null;
  plate_status: string | null;
  plate_path: string | null;
  linked: boolean;
  variant: CalVariant;
}

export interface CreateJobItem {
  render_text: string;
  student_id?: string | null;
  order_item_id?: string | null;
  variant?: CalVariant;
  element_text?: string | null;
}

export interface CreateJobBody {
  source: CalSource;
  model?: "standard" | "premium";
  wholesaler_id?: string | null;
  variant?: CalVariant;
  items: CreateJobItem[];
}

/** Below this, the UI warns (a sheet costs the same whether it holds 1 or 10 names). */
export const MIN_BATCH = 10;

// Mirrors the backend `isRealName`: a real embroiderable name has ≥2 Arabic letters,
// so pure numbers / Latin / emoji / single chars are flagged and never generated.
const ARABIC_LETTER = /[ء-يٱ-ۓۺ-ۼ]/g;
export function isRealName(text: string): boolean {
  const m = (text || "").match(ARABIC_LETTER);
  return !!m && m.length >= 2;
}

const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:4000");

/** Guard for relative plate paths — stored paths are absolute public URLs already. */
export function absUrl(p: string | null): string {
  if (!p) return "";
  return p.startsWith("http") ? p : `${API_BASE}${p}`;
}

export async function getCalWholesalers(): Promise<CalWholesaler[]> {
  const { data } = await api.get<{ data: CalWholesaler[] }>("/calligraphy/wholesalers");
  return data.data;
}

export async function getCalNames(id: string): Promise<CalGrabRow[]> {
  const { data } = await api.get<{ data: CalGrabRow[] }>(
    `/calligraphy/wholesalers/${id}/names`
  );
  return data.data;
}

export async function createCalJob(body: CreateJobBody): Promise<CalJob> {
  const { data } = await api.post<{ data: CalJob }>("/calligraphy/jobs", body);
  return data.data;
}

export async function processCalJob(jobId: string): Promise<CalProcess> {
  const { data } = await api.post<{ data: CalProcess }>(
    `/calligraphy/jobs/${jobId}/process`
  );
  return data.data;
}

export async function getCalJob(jobId: string): Promise<CalJob> {
  const { data } = await api.get<{ data: CalJob }>(`/calligraphy/jobs/${jobId}`);
  return data.data;
}

export async function rerollPlate(id: string): Promise<CalPlate> {
  const { data } = await api.post<{ data: CalPlate }>(
    `/calligraphy/plates/${id}/reroll`
  );
  return data.data;
}

// ─── Order send («تحويل للتطريز») + zone status ─────────────────────────────
// «ربط بالطلب» is gone — plates auto-attach on generation. The only manual action
// is pushing the whole ORDER out of بانتظار التصميم; label comes from the backend.

export interface CalZone {
  key: string;
  label: string;
  has_image: boolean;
}

export interface CalOrderZones {
  order_id: string;
  order_status: string;
  zones: CalZone[];
  can_send: boolean;
  next_stage: string | null;
  send_label: string | null;
}

export async function getOrdersZones(ids: string[]): Promise<CalOrderZones[]> {
  if (!ids.length) return [];
  const out: CalOrderZones[] = [];
  // Backend caps 100 ids per call — chunk defensively.
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data } = await api.get<{ data: CalOrderZones[] }>(
      `/calligraphy/orders-zones?ids=${chunk.join(",")}`
    );
    out.push(...data.data);
  }
  return out;
}

export async function sendCalOrder(
  orderId: string
): Promise<{ ok: boolean; order_id: string; status: string }> {
  const { data } = await api.post<{ data: { ok: boolean; order_id: string; status: string } }>(
    `/calligraphy/orders/${orderId}/send`
  );
  return data.data;
}

/** ZIP fallback for browsers without the File System Access folder picker. */
export async function platesZipBlob(ids: string[]): Promise<Blob> {
  const { data } = await api.post(`/calligraphy/plates/zip`, { ids }, { responseType: "blob" });
  return data as Blob;
}

export function calDownloadUrl(jobId: string, sheets = false): string {
  return `${API_BASE}/api/calligraphy/jobs/${jobId}/download${sheets ? "?sheets=1" : ""}`;
}

// ─── Queue ───────────────────────────────────────────────────────────────────

export interface CalQueueItem {
  order_item_id: string;
  student_id: string;
  student_name: string;
  render_text: string;
  variant: CalVariant;
}

export interface CalQueueZone {
  pending: number;
  items: CalQueueItem[];
}

export interface CalQueue {
  front: CalQueueZone;
  back: CalQueueZone;
  cap: CalQueueZone;
  cap_side: CalQueueZone;
}

export async function getCalQueue(wholesalerId?: string | null): Promise<CalQueue> {
  const qs = wholesalerId ? `?wholesaler_id=${wholesalerId}` : "";
  const { data } = await api.get<{ data: CalQueue }>(`/calligraphy/queue${qs}`);
  return data.data;
}

export async function generateFromQueue(
  variant: CalVariant,
  mode: "full" | "all",
  wholesalerId?: string | null
): Promise<CalJob> {
  const { data } = await api.post<{ data: CalJob }>("/calligraphy/queue/generate", {
    variant,
    mode,
    wholesaler_id: wholesalerId || null,
  });
  return data.data;
}

export async function getRecentPlates(limit = 60): Promise<CalPlate[]> {
  const { data } = await api.get<{ data: { plates: CalPlate[] } }>(`/calligraphy/recent?limit=${limit}`);
  return data.data.plates;
}

export async function composePlate(id: string, image: Blob): Promise<CalPlate> {
  const fd = new FormData();
  fd.append("image", image, "plate.png");
  const { data } = await api.post<{ data: CalPlate }>(`/calligraphy/plates/${id}/compose`, fd);
  return data.data;
}

export async function generateElement(word: string): Promise<{ url: string; cost: number }> {
  const { data } = await api.post<{ data: { url: string; cost: number } }>(`/calligraphy/element`, { word });
  return data.data;
}
