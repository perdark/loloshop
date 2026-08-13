import { api } from "./api";
import type { User } from "./types";

/**
 * «أيادي التصميم» is intentionally separate from the normal staff workspace.
 * These types mirror the allow-listed API payload: no price, phone, gender,
 * checkout, delivery, attendance, or payroll fields belong here.
 */
export type DesignTeamTaskStatus = "open" | "ready";
export type DesignTeamMemberRole = "lead" | "helper";

export interface DesignTeamMember {
  id: string;
  userId: string;
  name: string;
  memberRole: DesignTeamMemberRole;
  active: boolean;
  email: string | null;
  createdAt: string;
}

export interface DesignTeamSession {
  viewer: {
    id: string;
    name: string;
    isLead: boolean;
    canManage: boolean;
  };
  team: {
    name: string;
    portalPath: string | null;
    helperLimit: number;
    activeHelperCount: number;
  } | null;
  members: DesignTeamMember[];
}

export interface DesignTeamSpecLine {
  label: string | null;
  text: string | null;
  /** What the STUDENT sent — the reference to follow. */
  imageUrl: string | null;
  /** The plate the calligraphy generator already made for this line (migration 080). */
  plateImageUrl: string | null;
}

export interface DesignTeamStudent {
  name: string;
  fullName: string | null;
  universityName: string | null;
  department: string | null;
  gender: string | null;
  instagram: string | null;
  phone: string | null;
  eventDate: string | null;
  governorate: string | null;
  notes: string | null;
}

export interface DesignTeamJob {
  id: string;
  orderId: string;
  studentName: string;
  universityName: string | null;
  department: string | null;
  student: DesignTeamStudent;
  productName: string;
  productType: string;
  createdAt: string;
  finalDesignUrl: string | null;
  specLines: DesignTeamSpecLine[];
  task: {
    status: DesignTeamTaskStatus;
    note: string | null;
    assignedTo: string | null;
    assignedName: string | null;
    assignedAt: string | null;
    readyBy: string | null;
    readyAt: string | null;
  };
}

export interface DesignTeamPortalMember {
  id: string;
  name: string;
}

interface ApiMember {
  id: string;
  user_id: string;
  name: string;
  member_role: DesignTeamMemberRole;
  active: boolean;
  email: string | null;
  created_at: string;
}

interface ApiJob {
  order_id: string;
  status: string;
  created_at: string;
  final_design_url: string | null;
  student: {
    name: string;
    full_name?: string | null;
    university_name: string | null;
    department: string | null;
    gender?: string | null;
    instagram?: string | null;
    phone?: string | null;
    event_date?: string | null;
    governorate?: string | null;
    notes?: string | null;
  };
  product: { name_ar: string; type: string };
  spec_lines: {
    label: string | null;
    text: string | null;
    /** What the STUDENT sent — the reference أيادي التصميم is asked to follow. */
    image_url: string | null;
    /** What the calligraphy generator already produced for this line (migration 080). */
    plate_image_url: string | null;
  }[];
  task: {
    status: DesignTeamTaskStatus;
    note: string | null;
    assigned_to: { id: string; name: string } | null;
    assigned_at: string | null;
    ready_by: { id: string; name: string } | null;
    ready_at: string | null;
  } | null;
}

function mapMember(row: ApiMember): DesignTeamMember {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    memberRole: row.member_role,
    active: Boolean(row.active),
    email: row.email ?? null,
    createdAt: row.created_at,
  };
}

function mapJob(row: ApiJob): DesignTeamJob {
  return {
    id: row.order_id,
    orderId: row.order_id,
    studentName: row.student.name,
    universityName: row.student.university_name,
    department: row.student.department,
    student: {
      name: row.student.name,
      fullName: row.student.full_name ?? row.student.name ?? null,
      universityName: row.student.university_name,
      department: row.student.department,
      gender: row.student.gender ?? null,
      instagram: row.student.instagram ?? null,
      phone: row.student.phone ?? null,
      eventDate: row.student.event_date ?? null,
      governorate: row.student.governorate ?? null,
      notes: row.student.notes ?? null,
    },
    productName: row.product.name_ar,
    productType: row.product.type,
    createdAt: row.created_at,
    finalDesignUrl: row.final_design_url ?? null,
    specLines: (row.spec_lines ?? []).map((line) => ({
      label: line.label ?? null,
      text: line.text ?? null,
      imageUrl: line.image_url ?? null,
      plateImageUrl: line.plate_image_url ?? null,
    })),
    task: {
      status: row.task?.status ?? "open",
      note: row.task?.note ?? null,
      assignedTo: row.task?.assigned_to?.id ?? null,
      assignedName: row.task?.assigned_to?.name ?? null,
      assignedAt: row.task?.assigned_at ?? null,
      readyBy: row.task?.ready_by?.name ?? null,
      readyAt: row.task?.ready_at ?? null,
    },
  };
}

export async function getDesignTeamPortalMembers(
  key: string
): Promise<DesignTeamPortalMember[]> {
  const { data } = await api.get<{ data: DesignTeamPortalMember[] }>(
    "/design-team/portal/members",
    { params: { key } }
  );
  return data.data ?? [];
}

export async function designTeamPortalLogin(
  key: string,
  memberId: string,
  password: string
): Promise<{ token: string; user: User }> {
  const { data } = await api.post<{ token: string; user: User }>(
    "/design-team/portal/login",
    { key, user_id: memberId, password }
  );
  return data;
}

export async function getDesignTeamSession(): Promise<DesignTeamSession> {
  const { data } = await api.get<{
    data: {
      viewer: { id: string; name: string; is_lead: boolean; can_manage: boolean };
      team: {
        name_ar: string;
        portal_path?: string | null;
        helper_limit: number;
        active_helper_count: number;
        members?: ApiMember[];
      } | null;
    };
  }>("/design-team/session");
  const session = data.data;
  return {
    viewer: {
      id: session.viewer.id,
      name: session.viewer.name,
      isLead: Boolean(session.viewer.is_lead),
      canManage: Boolean(session.viewer.can_manage),
    },
    team: session.team
      ? {
          name: session.team.name_ar,
          portalPath: session.team.portal_path ?? null,
          helperLimit: Number(session.team.helper_limit ?? 2),
          activeHelperCount: Number(session.team.active_helper_count ?? 0),
        }
      : null,
    members: (session.team?.members ?? []).map(mapMember),
  };
}

export async function getDesignTeamJobs(): Promise<DesignTeamJob[]> {
  const { data } = await api.get<{ data: ApiJob[] }>("/design-team/jobs");
  return (data.data ?? []).map(mapJob);
}

export async function getDesignTeamMembers(): Promise<DesignTeamMember[]> {
  const { data } = await api.get<{ data: ApiMember[] }>("/design-team/members");
  return (data.data ?? []).map(mapMember);
}

export async function claimDesignTeamJob(id: string): Promise<void> {
  await api.post(`/design-team/jobs/${id}/claim`);
}

export async function readyDesignTeamJob(id: string, note: string): Promise<void> {
  await api.post(`/design-team/jobs/${id}/ready`, { note });
}

export async function approveDesignTeamJob(id: string): Promise<void> {
  await api.post(`/design-team/jobs/${id}/approve`);
}

export async function rejectDesignTeamJob(id: string, reason: string): Promise<void> {
  await api.post(`/design-team/jobs/${id}/reject`, { reason });
}

export async function uploadDesignTeamFinal(id: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<{ data: { url: string } }>(
    `/design-team/jobs/${id}/final-design`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return data.data.url;
}

export async function createDesignTeamMember(input: {
  name: string;
  password: string;
}): Promise<void> {
  await api.post("/design-team/members", {
    name: input.name,
    password: input.password,
  });
}

export async function createDesignTeamLead(input: {
  name: string;
  password: string;
  email?: string;
}): Promise<void> {
  await api.post("/design-team/lead", input);
}

export async function updateDesignTeamMember(
  id: string,
  input: { name?: string; password?: string; active?: boolean }
): Promise<void> {
  await api.patch(`/design-team/members/${id}`, input);
}

export async function removeDesignTeamMember(id: string): Promise<void> {
  await api.delete(`/design-team/members/${id}`);
}
