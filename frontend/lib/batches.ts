import { api } from "./api";
import type { BatchDetail, BatchStudentDetail, BatchSummary } from "./types";

function mapBatchSummary(raw: Record<string, unknown>): BatchSummary {
  return {
    id: String(raw.id),
    nameAr: String(raw.name_ar ?? raw.nameAr),
    deadline: (raw.deadline as string | null) ?? null,
    wholesalerId: (raw.wholesaler_id as string | null) ?? null,
    wholesalerName: (raw.wholesaler_name as string | null) ?? null,
    grandTotal: Number(raw.grand_total ?? raw.grandTotal ?? 0),
    orderCount: Number(raw.order_count ?? raw.orderCount ?? 0),
  };
}

function mapBatchStudent(raw: Record<string, unknown>): BatchStudentDetail {
  return {
    id: String(raw.id),
    name: String(raw.name),
    fullNameThird: (raw.full_name_third as string | null) ?? null,
    status: String(raw.status),
    total: Number(raw.total ?? 0),
    orderCount: Number(raw.order_count ?? raw.orderCount ?? 0),
    cost: raw.cost != null ? Number(raw.cost) : null,
    profit: raw.profit != null ? Number(raw.profit) : null,
  };
}

export async function listBatches(): Promise<BatchSummary[]> {
  const { data } = await api.get<{ data: Record<string, unknown>[] }>(
    "/batches"
  );
  return (data.data || []).map(mapBatchSummary);
}

export async function getBatch(id: string): Promise<BatchDetail> {
  const { data } = await api.get<{ data: Record<string, unknown> }>(
    `/batches/${id}`
  );
  const raw = data.data;
  const students =
    (raw.students as Record<string, unknown>[] | undefined) || [];
  return {
    id: String(raw.id),
    nameAr: String(raw.name_ar ?? raw.nameAr),
    deadline: (raw.deadline as string | null) ?? null,
    wholesalerId: (raw.wholesaler_id as string | null) ?? null,
    students: students.map(mapBatchStudent),
    grandTotal: Number(raw.grand_total ?? raw.grandTotal ?? 0),
  };
}

export async function createBatch(body: {
  nameAr: string;
  wholesalerId?: string;
  deadline?: string;
}): Promise<string> {
  const { data } = await api.post<{ data: { id: string } }>("/batches", {
    name_ar: body.nameAr,
    wholesaler_id: body.wholesalerId,
    deadline: body.deadline,
  });
  return data.data.id;
}

export async function updateBatch(
  id: string,
  body: { nameAr?: string; wholesalerId?: string; deadline?: string }
): Promise<void> {
  await api.patch(`/batches/${id}`, {
    name_ar: body.nameAr,
    wholesaler_id: body.wholesalerId,
    deadline: body.deadline,
  });
}
