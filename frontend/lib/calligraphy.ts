import { api } from "@/lib/api";

export type CalSource = "typed" | "wholesaler" | "txt";

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
}

export interface CalJob {
  job_id: string;
  total: number;
  done: number;
  failed: number;
  pending: number;
  job_cost: number;
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
}

export interface CreateJobItem {
  render_text: string;
  student_id?: string | null;
  order_item_id?: string | null;
}

export interface CreateJobBody {
  source: CalSource;
  model?: "standard" | "premium";
  wholesaler_id?: string | null;
  items: CreateJobItem[];
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

export async function linkPlate(id: string): Promise<{ ok: boolean }> {
  const { data } = await api.post<{ data: { ok: boolean } }>(
    `/calligraphy/plates/${id}/link`
  );
  return data.data;
}

export function calDownloadUrl(jobId: string, sheets = false): string {
  return `${API_BASE}/api/calligraphy/jobs/${jobId}/download${sheets ? "?sheets=1" : ""}`;
}
