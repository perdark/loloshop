"use client";

import { useEffect, useState } from "react";
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

export default function StaffWholesalerStudentsPage() {
  const { wholesalerId } = useParams<{ wholesalerId: string }>();
  const [rows, setRows] = useState<WholesalerStudentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!wholesalerId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    setLoading(true);
    api
      .get<{ data: ApiRow[] }>(`/staff/wholesalers/${wholesalerId}/students`)
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

  if (loading) return <PageLoader />;

  return (
    <div dir="rtl" lang="ar" className="space-y-5">
      <Link href="/staff/wholesalers" className="text-sm text-orange-ink hover:underline">
        ← الممثلون
      </Link>

      <h1 className="font-display text-2xl font-bold text-ink">طلاب الممثل</h1>

      {rows.length === 0 ? (
        <EmptyState message="لا يوجد طلاب" />
      ) : (
        <div className="space-y-3">
          {rows.map((s) => (
            <article key={s.id} className="rounded-xl border border-ink/10 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{s.name}</p>
                  <p className="text-sm text-ink/60" dir="ltr">
                    {s.phone}
                  </p>
                  <p className="mt-1 text-xs text-ink/50">
                    {s.universityName || "—"}
                    {s.department ? ` — ${s.department}` : ""}
                  </p>
                </div>
                <div className="text-left">
                  <span className="inline-flex rounded-full bg-ink/5 px-2 py-1 text-xs text-ink/70">
                    {statusLabel(s.status)}
                  </span>
                  <div className="mt-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs ${
                        s.isCompleted
                          ? "bg-orange/10 text-orange-ink"
                          : "bg-ink/5 text-ink/60"
                      }`}
                    >
                      {s.isCompleted ? "مكتمل" : "غير مكتمل"}
                    </span>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

