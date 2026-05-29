"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { OrderCard } from "@/components/staff/OrderCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { getStaffOrders } from "@/lib/staff";
import type { StaffListFilter, StaffOrder } from "@/lib/staff-types";

const FILTER_TITLES: Record<StaffListFilter, { title: string; subtitle: string }> =
  {
    all: {
      title: "لوحة الطلبات",
      subtitle: "طلبات تحتاج إجراء من الموظف",
    },
    review: {
      title: "طلبات قيد المراجعة",
      subtitle: "تصاميم مكتملة بانتظار المراجعة",
    },
    printing: {
      title: "جاهز للطباعة",
      subtitle: "طلبات قيد الطباعة",
    },
    done: {
      title: "مكتمل",
      subtitle: "جاهز للاستلام أو تم التسليم",
    },
  };

/** Content-shaped skeleton: mimics the order card grid */
function OrderListSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton h-28 w-full rounded-2xl" />
      ))}
    </div>
  );
}

function StaffOrdersContent() {
  const searchParams = useSearchParams();
  const filter = (searchParams.get("filter") || "all") as StaffListFilter;
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const data = await getStaffOrders(filter);
      setOrders(data);
    } catch {
      toast.error("تعذر تحميل الطلبات");
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  const meta = FILTER_TITLES[filter] || FILTER_TITLES.all;

  return (
    <div dir="rtl" lang="ar">
      <PageHeader
        title={meta.title}
        subtitle={meta.subtitle}
        action={
          <Button variant="ghost" onClick={load} loading={loading}>
            تحديث
          </Button>
        }
      />

      {loading ? (
        <OrderListSkeleton />
      ) : fetchError ? (
        <div className="rounded-2xl border border-[var(--color-danger)]/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
          <p className="text-base font-semibold text-ink">تعذر تحميل الطلبات</p>
          <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
          <Button className="mt-4" onClick={load}>إعادة المحاولة</Button>
        </div>
      ) : orders.length === 0 ? (
        <EmptyState message="لا توجد طلبات في هذه القائمة حالياً." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => (
            <li key={order.id}>
              <OrderCard order={order} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function StaffOrdersPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <StaffOrdersContent />
    </Suspense>
  );
}
