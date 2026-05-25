import type { OrderStatus } from "./types";

export type StaffListFilter = "all" | "review" | "printing" | "done";

export interface StaffOrder {
  id: string;
  studentId: string;
  studentName: string;
  universityName: string | null;
  department: string | null;
  productName: string;
  status: OrderStatus;
  createdAt: string;
}

export interface StaffDesign {
  id: string;
  student_name: string;
  phone: string;
  university_name: string | null;
  department: string | null;
  sash_color: string | null;
  left_canvas: unknown | null;
  right_canvas: unknown | null;
  logo_url: string | null;
  extra_image_url: string | null;
  fonts_used: string[];
  notes: string | null;
  completed: boolean;
}

/** Raw row from GET /admin/orders (API.md) — student_id TODO on backend */
interface ApiOrderRow {
  id: string;
  student_id?: string;
  student_full_name: string;
  product_name: string;
  wholesaler_name?: string | null;
  price?: number;
  cost?: number | null;
  profit?: number;
  status: OrderStatus;
  created_at: string;
  university_name?: string | null;
  department?: string | null;
}

export function mapApiOrderRow(row: ApiOrderRow): StaffOrder {
  return {
    id: row.id,
    studentId: row.student_id || row.id,
    studentName: row.student_full_name,
    universityName: row.university_name ?? null,
    department: row.department ?? null,
    productName: row.product_name,
    status: row.status,
    createdAt: row.created_at,
  };
}
