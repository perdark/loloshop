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
  embroidery_color?: string | null;
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
    embroideryColor: data.embroidery_color ?? null,
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

export interface ReferralInfo {
  wholesalerName: string;
  universityName: string | null;
  department: string | null;
  deadline: string | null;
}

/** Look up a referral code → the rep's name + cohort (جامعة/قسم) for the join screen. */
export async function getReferralInfo(code: string): Promise<ReferralInfo> {
  const { data } = await api.get<{
    wholesaler_name: string;
    deadline: string | null;
    university_name: string | null;
    department: string | null;
  }>(`/join/${code}`);
  return {
    wholesalerName: data.wholesaler_name,
    universityName: data.university_name,
    department: data.department,
    deadline: data.deadline,
  };
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

/** «التسعيرة» the rep/student sees on the order form.
 *  `base` is the full package price; partial selections use the editable piece prices below. */
export interface FullSetPricing {
  base: number;
  addons: {
    royal_sash: number;
    royal_cap_when_normal_sash: number;
    extra_cap_embroidery: number;
    robe_sleeve_each: number;
    american_shawl: number;
    piece_sash_normal: number;
    piece_sash_royal: number;
    piece_cap_normal: number;
    piece_cap_royal: number;
    piece_robe_normal: number;
    piece_robe_royal: number;
  };
}

export const DEFAULT_FULLSET_ADDONS: FullSetPricing["addons"] = {
  royal_sash: 10000,
  royal_cap_when_normal_sash: 3000,
  extra_cap_embroidery: 3000,
  robe_sleeve_each: 5000,
  american_shawl: 25000,
  piece_sash_normal: 20000,
  piece_sash_royal: 25000,
  piece_cap_normal: 15000,
  piece_cap_royal: 20000,
  piece_robe_normal: 25000,
  piece_robe_royal: 25000,
};

export interface FullSetPackagesResult {
  packages: FullSetPackage[];
  pricing: FullSetPricing | null;
}

export async function getFullSetPackages(): Promise<FullSetPackagesResult> {
  const { data } = await api.get<{
    data: { packages: FullSetPackage[]; pricing: FullSetPricing | null };
  }>("/wholesaler/full-set-packages");
  return {
    packages: data.data?.packages || [],
    pricing: data.data?.pricing ?? null,
  };
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
export type ProductPiece = "sash" | "cap" | "robe";

export interface EmbroideryZone {
  text?: string;
  image_url?: string;
}

export interface CreateFullSetPayload {
  /** Legacy field — no longer sent by the form; backend ignores it. */
  package_id?: string;
  /** The graduation pieces the student wants; at least one is required. */
  selected_pieces: ProductPiece[];
  measurements: {
    robe_length_cm: number | string;
    sleeve_length_cm: number | string;
    shoulder_cm: number | string;
    /** محيط الصدر */
    chest_cm: number | string;
    /** ملاحظات لفصال الروب */
    tailor_notes?: string;
  };
  /** عادي/ملكي — optional (the whole طقم form is optional; omitted when not chosen). */
  sash_type?: PieceType;
  cap_type?: PieceType;
  /** فصال الروب: كسرة الكتف (yes/no). */
  shoulder_pleat?: boolean;
  /** شال امريكي (yes/no) — photo optional. */
  american_shawl?: { enabled: boolean; image_url?: string };
  embroidery: {
    cap_side?: EmbroideryZone;
    cap_top?: EmbroideryZone;
    sash_front?: EmbroideryZone;
    sash_back?: EmbroideryZone;
    /** تطريز ردن الروب — الروب له ردنان فقط (priced add-on per sleeve). */
    robe_sleeve_right?: EmbroideryZone;
    robe_sleeve_left?: EmbroideryZone;
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

// ── Quick custom order (name-only student, both approvals skipped) ──
// The rep adds a student by name only (no account) + the same full-set order in one POST;
// the backend creates the pre-approved student and flips the bundle straight to approved.
export interface QuickFullSetPayload extends CreateFullSetPayload {
  /** اسم الطالب — the only student field collected for a name-only quick order. */
  student_name: string;
}

export async function createQuickFullSetOrder(
  payload: QuickFullSetPayload
): Promise<{ studentId: string; total: number; packageName: string }> {
  const { data } = await api.post<{
    data: { student_id: string; total: number; package_name: string };
  }>("/wholesaler/quick-full-set-order", payload);
  return {
    studentId: data.data.student_id,
    total: data.data.total,
    packageName: data.data.package_name,
  };
}

/** Existing full-set order reconstructed into form shape (for EDIT pre-fill). */
export interface FullSetExistingOrder {
  package_id: string | null;
  selected_pieces?: ProductPiece[];
  measurements: {
    robe_length_cm: number;
    sleeve_length_cm: number;
    shoulder_cm: number;
    chest_cm?: number;
    tailor_notes?: string;
  } | null;
  sash_type: PieceType | null;
  cap_type: PieceType | null;
  /** Legacy — may be absent from orders created after the color field was removed. */
  sash_color?: { text: string; image_url: string };
  shoulder_pleat: boolean;
  american_shawl: { enabled: boolean; image_url: string };
  embroidery: {
    sash_front: EmbroideryZone;
    sash_back: EmbroideryZone;
    cap_side: EmbroideryZone;
    cap_top: EmbroideryZone;
    robe_sleeve_right: EmbroideryZone;
    robe_sleeve_left: EmbroideryZone;
  };
  notes: string;
}

/** Rep reads back a student's existing order to pre-fill the edit form. */
export async function getWholesalerStudentOrder(
  studentId: string
): Promise<FullSetExistingOrder | null> {
  const { data } = await api.get<{ data: FullSetExistingOrder | null }>(
    `/wholesaler/students/${studentId}/full-set-order`
  );
  return data.data;
}

// ── Student self-service (rep-linked student fills their OWN order) ──

export interface RepFullSetContext {
  isRepStudent: boolean;
  approved: boolean;
  packages: FullSetPackage[];
  existing: FullSetExistingOrder | null;
  pricing: FullSetPricing | null;
}

export async function getRepFullSetContext(): Promise<RepFullSetContext> {
  const { data } = await api.get<{
    data: {
      is_rep_student: boolean;
      approved: boolean;
      packages: FullSetPackage[];
      existing: FullSetExistingOrder | null;
      pricing: FullSetPricing | null;
    };
  }>("/orders/rep-full-set");
  return {
    isRepStudent: data.data.is_rep_student,
    approved: data.data.approved,
    packages: data.data.packages || [],
    existing: data.data.existing,
    pricing: data.data.pricing ?? null,
  };
}

export async function submitRepFullSetOrder(
  payload: CreateFullSetPayload
): Promise<{ total: number; packageName: string }> {
  const { data } = await api.post<{
    data: { total: number; package_name: string };
  }>("/orders/rep-full-set", payload);
  return { total: data.data.total, packageName: data.data.package_name };
}

// ── Rep order approval ──

export interface RepOrderRow {
  checkout_group_id: string;
  student_id: string;
  student_name: string;
  product_summary: string;
  total_price: number;
  submitted_at: string;
  approval: "pending" | "approved" | "rejected";
  reject_reason: string | null;
}

export async function getRepOrders(
  approval: "pending" | "approved" | "rejected" | "all" = "pending"
): Promise<RepOrderRow[]> {
  const { data } = await api.get<{ data: RepOrderRow[] }>(
    `/wholesaler/orders?approval=${approval}`
  );
  return data.data;
}

export async function approveRepOrder(checkoutGroupId: string): Promise<void> {
  await api.post(`/wholesaler/orders/${checkoutGroupId}/approve`);
}

export async function rejectRepOrder(
  checkoutGroupId: string,
  reason: string
): Promise<void> {
  await api.post(`/wholesaler/orders/${checkoutGroupId}/reject`, { reason });
}

export async function bulkRepOrders(
  checkoutGroupIds: string[],
  action: "approve" | "reject",
  reason?: string
): Promise<{ done: number; skipped: string[] }> {
  const { data } = await api.post<{
    data: { done: number; skipped: string[] };
  }>(`/wholesaler/orders/bulk`, { checkoutGroupIds, action, reason });
  return data.data;
}

/** Rep self-edit: PATCH /api/wholesaler/embroidery-color */
export async function updateEmbroideryColor(
  color: string
): Promise<{ embroidery_color: string }> {
  const { data } = await api.patch<{ data: { embroidery_color: string } }>(
    "/wholesaler/embroidery-color",
    { embroidery_color: color }
  );
  return data.data;
}
