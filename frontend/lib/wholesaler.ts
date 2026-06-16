import { api, apiUploadFile } from "./api";
import type {
  JoinPayload,
  OrderStatus,
  PendingStudent,
  WholesalerDashboard,
  WholesalerStudentRow,
} from "./types";

interface ApiDashboard {
  deadline: string | null;
  student_count: number;
  pending_count: number;
  completed_designs: number;
  commission_rate: number;
  earned_commission: number;
  referral_url: string;
  referral_code: string;
}

interface ApiPendingStudent {
  id: string;
  name: string;
  phone: string;
  email?: string;
  university_name?: string;
  department?: string;
  created_at: string;
}

export async function getWholesalerDashboard(): Promise<WholesalerDashboard> {
  const { data } = await api.get<ApiDashboard>("/wholesaler/dashboard");
  return {
    deadline: data.deadline,
    studentCount: data.student_count,
    pendingCount: data.pending_count,
    completedDesigns: data.completed_designs,
    commissionRate: data.commission_rate ?? 0,
    earnedCommission: data.earned_commission ?? 0,
    referralUrl: data.referral_url,
    referralCode: data.referral_code,
  };
}

export async function getPendingStudents(): Promise<PendingStudent[]> {
  const { data } = await api.get<{ data: ApiPendingStudent[] }>(
    "/wholesaler/pending-students"
  );
  return (data.data || []).map((s) => ({
    id: s.id,
    fullName: s.name,
    phone: s.phone,
    email: s.email,
    universityName: s.university_name,
    department: s.department,
    createdAt: s.created_at,
  }));
}

export async function approveStudent(studentId: string): Promise<void> {
  await api.post(`/wholesaler/approve/${studentId}`);
}

export async function rejectStudent(studentId: string): Promise<void> {
  await api.post(`/wholesaler/reject/${studentId}`);
}

export async function bulkSetStudentStatus(
  studentIds: string[],
  action: "approve" | "reject"
): Promise<number> {
  const { data } = await api.post<{ data: { count: number } }>(
    "/wholesaler/students/bulk",
    { studentIds, action }
  );
  return data.data?.count ?? 0;
}

interface ApiWholesalerStudentRow {
  id: string;
  name: string;
  phone: string;
  status: "pending_approval" | "approved" | "rejected";
  university_name: string | null;
  department: string | null;
  order_status: string | null;
  is_completed?: boolean;
}

const ORDER_STATUS_SET = new Set<OrderStatus>([
  "pending_approval",
  "designing",
  "design_complete",
  "staff_review",
  "printing",
  "ready",
  "delivered",
  "cancelled",
]);

function parseOrderStatus(v: string | null): OrderStatus | null {
  if (!v) return null;
  return ORDER_STATUS_SET.has(v as OrderStatus) ? (v as OrderStatus) : null;
}

export async function getWholesalerStudents(params?: {
  status?: "" | "pending_approval" | "approved" | "rejected";
}): Promise<WholesalerStudentRow[]> {
  const { data } = await api.get<{ data: ApiWholesalerStudentRow[] }>(
    "/wholesaler/students",
    { params: { status: params?.status || undefined } }
  );
  return (data.data || []).map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    status: r.status,
    universityName: r.university_name,
    department: r.department,
    orderStatus: parseOrderStatus(r.order_status),
    isCompleted: Boolean(r.is_completed),
  }));
}

export interface WholesalerSashConfig {
  editable_sash_side: "left" | "right" | null;
  locked_side_design: unknown | null;
}

export async function getMySashConfig(): Promise<WholesalerSashConfig> {
  const { data } = await api.get<{ data: WholesalerSashConfig }>(
    "/wholesaler/sash-config"
  );
  return data.data;
}

export async function updateMySashConfig(
  config: WholesalerSashConfig
): Promise<void> {
  await api.put("/wholesaler/sash-config", {
    editable_sash_side: config.editable_sash_side,
    locked_side_design: config.locked_side_design,
  });
}

export async function joinWithCode(
  code: string,
  payload: JoinPayload
): Promise<{ message: string }> {
  const { data } = await api.post<{
    data?: { message_ar?: string };
    message_ar?: string;
  }>(`/join/${code}`, payload);
  const msg =
    data.data?.message_ar ||
    data.message_ar ||
    "طلبك بانتظار موافقة الممثل";
  return { message: msg };
}

// ── Rep-entered full-set order (WhatsApp intake form → الطقم الكامل) ──

export interface FullSetPackage {
  id: string;
  name_ar: string;
  price: number;
}

export async function getFullSetPackages(): Promise<FullSetPackage[]> {
  const { data } = await api.get<{ data: FullSetPackage[] }>(
    "/wholesaler/full-set-packages"
  );
  return data.data || [];
}

export interface WholesalerStudentDetail {
  id: string;
  name: string;
  phone: string;
  status: "pending_approval" | "approved" | "rejected";
  universityName: string | null;
  department: string | null;
  hasOrder: boolean;
}

export async function getWholesalerStudent(
  studentId: string
): Promise<WholesalerStudentDetail> {
  const { data } = await api.get<{
    data: {
      id: string;
      name: string;
      phone: string;
      status: "pending_approval" | "approved" | "rejected";
      university_name: string | null;
      department: string | null;
      has_order: boolean;
    };
  }>(`/wholesaler/students/${studentId}`);
  const r = data.data;
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    status: r.status,
    universityName: r.university_name,
    department: r.department,
    hasOrder: Boolean(r.has_order),
  };
}

export type PieceType = "عادي" | "ملكي";

export interface EmbroideryZone {
  text?: string;
  image_url?: string;
}

export interface CreateFullSetPayload {
  package_id: string;
  measurements: {
    robe_length_cm: number | string;
    sleeve_length_cm: number | string;
    shoulder_cm: number | string;
  };
  sash_type: PieceType;
  cap_type: PieceType;
  embroidery: {
    cap_side?: EmbroideryZone;
    cap_top?: EmbroideryZone;
    sash_front?: EmbroideryZone;
    sash_back?: EmbroideryZone;
  };
  notes?: string;
}

export async function createWholesalerFullSetOrder(
  studentId: string,
  payload: CreateFullSetPayload
): Promise<{ total: number; packageName: string }> {
  const { data } = await api.post<{
    data: { total: number; package_name: string };
  }>(`/wholesaler/students/${studentId}/full-set-order`, payload);
  return { total: data.data.total, packageName: data.data.package_name };
}

export async function uploadWholesalerImage(file: File): Promise<string> {
  const res = (await apiUploadFile("/wholesaler/uploads/image", file)) as {
    data: { url: string };
  };
  return res.data.url;
}
