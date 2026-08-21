import { api } from "./api";

/**
 * «لولو الإدارة» — the admin console's typed API surface.
 *
 * ⚠️ Deliberately NOT in lib/admin.ts and NOT sharing anything with the storefront assistant's
 * client. Everything here is behind `requireRole('admin')` on the server, and the two
 * assistants must stay separable in the client too — a shared helper is how a customer-facing
 * component eventually ends up importing an admin endpoint.
 */

export interface AdminProposal {
  action: string;
  label: string;
  subject: string;
  /** The exact sentence the admin is agreeing to. Written by the SERVER, never by the model. */
  confirm: string;
  /** HMAC-signed by the server; the entire authorisation for /act. Opaque to this client. */
  token: string;
  expires_in_ms: number;
}

export interface AdminAskResult {
  answer: string;
  intent: string | null;
  label?: string;
  /** The numbers WE computed, shipped beside the prose so the phrasing is auditable. */
  facts: string[];
  proposal: AdminProposal | null;
}

export interface AdminSuggestion {
  id: string;
  severity: "urgent" | "attention" | "info";
  title: string;
  detail: string;
  href: string;
  /** A question to pre-fill the console with, so "tell me more" is one tap. */
  ask: string | null;
}

export interface StaffDayRow {
  user_id: string;
  name: string;
  staff_type: string | null;
  attendance_required: boolean;
  opened: boolean;
  opens: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  platform: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  still_in: boolean;
  /** null — NOT 0 — while someone is still checked in. See lib/staffPresence.js. */
  worked_minutes: number | null;
  late_minutes: number;
  break_minutes: number;
  attendance_status: string | null;
  production_actions: number;
}

export interface StaffDailyReport {
  date: string;
  totals: {
    staff: number;
    opened: number;
    not_opened: number;
    checked_in: number;
    absent: number;
    not_required: number;
    still_in: number;
    opens: number;
    worked_minutes: number;
    production_actions: number;
  };
  rows: StaffDayRow[];
}

export interface AdminChatTurn {
  question: string;
  answer: string;
  intent: string | null;
  created_at: string;
}

export async function askAdminConsole(question: string): Promise<AdminAskResult> {
  const { data } = await api.post("/assistant/admin/ask", { question });
  return data as AdminAskResult;
}

/** Execute a confirmed proposal. The token is the authorisation — nothing else is sent. */
export async function runAdminAction(token: string): Promise<{ message: string; action: string }> {
  const { data } = await api.post("/assistant/admin/act", { token });
  return data.data;
}

export async function getAdminSuggestions(): Promise<{ date: string; suggestions: AdminSuggestion[] }> {
  const { data } = await api.get("/assistant/admin/suggestions");
  return data.data;
}

export async function getAdminChatHistory(limit = 20): Promise<AdminChatTurn[]> {
  const { data } = await api.get("/assistant/admin/history", { params: { limit } });
  return data.data;
}

export async function getStaffDailyReport(date?: string): Promise<StaffDailyReport> {
  const { data } = await api.get("/admin/staff-daily-report", {
    params: date ? { date } : undefined,
  });
  return data.data;
}
