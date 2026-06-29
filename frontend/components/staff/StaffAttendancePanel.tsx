"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { StaffAttendanceCard } from "@/components/staff/StaffAttendanceCard";
import { getApiErrorMessage } from "@/lib/api";
import {
  checkInAttendance,
  checkOutAttendance,
  getBrowserAttendanceLocation,
  getMyAttendanceToday,
  type MyAttendanceToday,
} from "@/lib/staff";

export function StaffAttendancePanel({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const pathname = usePathname();
  const compactMode = compact || pathname === "/staff";
  const [attendance, setAttendance] = useState<MyAttendanceToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAttendance(await getMyAttendanceToday());
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحميل البصمة"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submitAttendance(kind: "in" | "out") {
    setBusy(true);
    try {
      const location = await getBrowserAttendanceLocation();
      const next = kind === "in" ? await checkInAttendance(location) : await checkOutAttendance(location);
      setAttendance(next);
      toast.success(kind === "in" ? "تم تسجيل بصمة الدخول" : "تم تسجيل بصمة الخروج");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تسجيل البصمة"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    if (compactMode) return null;
    return <div className={`skeleton h-40 rounded-2xl ${className}`} aria-label="جارٍ تحميل البصمة" />;
  }

  if (!attendance) {
    if (compactMode) return null;
    return (
      <div className={`rounded-2xl border border-danger/25 bg-danger/5 p-4 text-sm text-danger ${className}`}>
        <p>تعذر تحميل بصمة الموظف.</p>
        <Button className="mt-3" variant="ghost" size="sm" onClick={load}>
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  if (compactMode) {
    const attendanceRequired = attendance.settings.attendanceRequired !== false;
    const record = attendance.record;
    if (!attendanceRequired || record?.checkOutAt) return null;

    const needsCheckout = !!record?.checkInAt && !record.checkOutAt;
    return (
      <div className={`flex flex-wrap items-center gap-2 ${className}`}>
        <Button
          type="button"
          size="sm"
          variant={needsCheckout ? "ghost" : "primary"}
          onClick={() => submitAttendance(needsCheckout ? "out" : "in")}
          loading={busy}
          disabled={busy}
        >
          {needsCheckout ? "بصمة خروج" : "بصمة دخول"}
        </Button>
        {needsCheckout && (
          <span className="text-xs font-medium text-ink-soft">
            دخولك مسجل، سجّل الخروج عند المغادرة
          </span>
        )}
        {record?.openTooLong && (
          <span className="rounded-full border border-danger/25 bg-danger/5 px-2.5 py-1 text-xs font-bold text-danger">
            {record.noteAr || "الموظف لم يخرج من المعمل"}
          </span>
        )}
      </div>
    );
  }

  return (
    <StaffAttendanceCard
      className={className}
      settings={attendance.settings}
      record={attendance.record}
      busy={busy}
      onCheckIn={() => submitAttendance("in")}
      onCheckOut={() => submitAttendance("out")}
    />
  );
}
