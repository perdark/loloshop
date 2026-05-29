import { api } from "./api";
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
