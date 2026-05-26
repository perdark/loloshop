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

function StaffOrdersContent() {
  const searchParams = useSearchParams();
  const filter = (searchParams.get("filter") || "all") as StaffListFilter;
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getStaffOrders(filter);
      setOrders(data);
    } catch {
      toast.error("تعذر تحميل الطلبات");
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
    <div>
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
        <PageLoader />
      ) : orders.length === 0 ? (
        <EmptyState message="لا توجد طلبات في هذه القائمة" />
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
