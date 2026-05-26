"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "@/lib/api";
import type { OrderStatus, StudentApprovalStatus, WholesalerStudentRow } from "@/lib/types";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";

interface ApiRow {
  id: string;
  name: string;
  phone: string;
  status: StudentApprovalStatus;
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

function statusLabel(s: StudentApprovalStatus): string {
  if (s === "approved") return "موافق عليه";
  if (s === "rejected") return "مرفوض";
  return "بانتظار الموافقة";
}

export default function AdminWholesalerStudentsPage() {
  const { wholesalerId } = useParams<{ wholesalerId: string }>();
  const [rows, setRows] = useState<WholesalerStudentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!wholesalerId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    setLoading(true);
    api
      .get<{ data: ApiRow[] }>(`/admin/wholesalers/${wholesalerId}/students`)
      .then(({ data }) => {
        setRows(
          (data.data || []).map((r) => ({
            id: r.id,
            name: r.name,
            phone: r.phone,
            status: r.status,
            universityName: r.university_name,
            department: r.department,
            orderStatus: parseOrderStatus(r.order_status),
            isCompleted: Boolean(r.is_completed),
          }))
        );
      })
      .catch((err) => toast.error(getApiErrorMessage(err, "تعذر تحميل الطلاب")))
      .finally(() => setLoading(false));
  }, [wholesalerId]);

  const stats = useMemo(() => {
    let completed = 0;
    let pending = 0;
    for (const r of rows) {
      if (r.isCompleted) completed += 1;
      if (r.status === "pending_approval") pending += 1;
    }
    return { total: rows.length, pending, completed };
  }, [rows]);

  if (loading) return <PageLoader />;

  return (
    <div dir="rtl" lang="ar" className="space-y-5">
      <Link href="/admin/wholesalers" className="text-sm text-orange-ink hover:underline">
        ← الممثلون
      </Link>

      <div>
        <h1 className="font-display text-2xl font-bold text-ink">طلاب الممثل</h1>
        <p className="mt-1 text-sm text-ink/60">
          الكل: {stats.total} — بانتظار: {stats.pending} — مكتمل: {stats.completed}
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState message="لا يوجد طلاب" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-ink/10 bg-ink/5 text-right">
              <tr>
                <th className="px-4 py-3 font-semibold text-ink">الاسم</th>
                <th className="px-4 py-3 font-semibold text-ink">الهاتف</th>
                <th className="px-4 py-3 font-semibold text-ink">الحالة</th>
                <th className="px-4 py-3 font-semibold text-ink">الجامعة/القسم</th>
                <th className="px-4 py-3 font-semibold text-ink">اكتمال</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3">{s.name}</td>
                  <td className="px-4 py-3" dir="ltr">
                    {s.phone}
                  </td>
                  <td className="px-4 py-3 text-ink/70">
                    {statusLabel(s.status)}
                  </td>
                  <td className="px-4 py-3 text-ink/70">
                    {s.universityName || "—"}
                    {s.department ? ` — ${s.department}` : ""}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs ${
                        s.isCompleted
                          ? "bg-orange/10 text-orange-ink"
                          : "bg-ink/5 text-ink/60"
                      }`}
                    >
                      {s.isCompleted ? "مكتمل" : "غير مكتمل"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

