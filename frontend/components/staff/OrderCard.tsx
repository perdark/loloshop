import Link from "next/link";
import { ORDER_STATUS_LABELS } from "@/lib/constants";
import { formatDateShort } from "@/lib/format";
import type { StaffOrder } from "@/lib/staff-types";

const STATUS_COLORS: Partial<Record<string, string>> = {
  design_complete: "bg-amber-100 text-amber-900",
  staff_review: "bg-blue-100 text-blue-900",
  printing: "bg-purple-100 text-purple-900",
  ready: "bg-emerald-100 text-emerald-900",
  delivered: "bg-ink/10 text-ink",
};

interface OrderCardProps {
  order: StaffOrder;
}

export function OrderCard({ order }: OrderCardProps) {
  const badge =
    STATUS_COLORS[order.status] || "bg-ink/10 text-ink";

  return (
    <Link
      href={`/staff/orders/${order.id}`}
      className="block rounded-xl border border-ink/10 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-ink">
            {order.studentName}
          </h3>
          <p className="mt-1 text-sm text-ink/60">
            {order.universityName || "—"}
            {order.department ? ` · ${order.department}` : ""}
          </p>
          <p className="mt-1 text-xs text-ink/50">{order.productName}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${badge}`}
        >
          {ORDER_STATUS_LABELS[order.status]}
        </span>
      </div>
      <p className="mt-3 text-xs text-ink/40">
        {formatDateShort(order.createdAt)}
      </p>
    </Link>
  );
}
