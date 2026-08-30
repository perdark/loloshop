"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { StaffAttendanceCard } from "@/components/staff/StaffAttendanceCard";
import { StaffBreakControl } from "@/components/staff/StaffBreakControl";
import { getApiErrorMessage } from "@/lib/api";
import { usePolling } from "@/lib/hooks/usePolling";
import {
  cancelBreakRequest,
  endBreak,
  getMyAttendanceToday,
  requestBreak,
  startBreak,
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
  // There is no `busy` any more: the only mutation left on this panel is الخروج المؤقت.
  const [breakBusy, setBreakBusy] = useState(false);

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

  /**
   * A worker waiting on «بانتظار موافقة المدير» has no other way to learn the admin
   * answered, so poll while a break is live. Jittered, and only while it matters —
   * the rest of the time this screen makes no background requests.
   */
  const hasLiveBreak = attendance?.break != null;
  const refresh = useCallback(() => {
    if (breakBusy) return;
    getMyAttendanceToday()
      .then(setAttendance)
      .catch(() => {
        /* transient — the next tick retries */
      });
  }, [breakBusy]);
  usePolling(refresh, 20000, hasLiveBreak, 5000);

  /** Every break action returns the same payload, so one runner covers all four. */
  async function runBreak(action: () => Promise<MyAttendanceToday>, success: string) {
    setBreakBusy(true);
    try {
      setAttendance(await action());
      toast.success(success);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تنفيذ الطلب"));
    } finally {
      setBreakBusy(false);
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

  const breakControl = (
    <StaffBreakControl
      balance={attendance.breakBalance}
      activeBreak={attendance.break}
      busy={breakBusy}
      deductionPerMinute={attendance.settings.deductionPerMinute}
      onRequest={(input) =>
        runBreak(() => requestBreak(input), "أُرسل طلب الخروج إلى المدير")
      }
      onStart={(id, withoutApproval) =>
        runBreak(
          () => startBreak(id, withoutApproval),
          withoutApproval ? "سُجّل خروجك بدون موافقة" : "بدأ وقت خروجك"
        )
      }
      onEnd={(id) => runBreak(() => endBreak(id), "أهلاً برجوعك")}
      onCancel={(id) => runBreak(() => cancelBreakRequest(id), "أُلغي الطلب")}
    />
  );

  if (compactMode) {
    const attendanceRequired = attendance.settings.attendanceRequired !== false;
    const record = attendance.record;
    if (!attendanceRequired || record?.checkOutAt) return null;

    const needsCheckout = !!record?.checkInAt && !record.checkOutAt;
    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        <div className="flex flex-wrap items-center gap-2">
          {/* The punch button that used to lead this row is gone (2026-08-30): the K40 is the
              only thing that records دخول/خروج now. What is left is the state, which the
              worker still needs to read at a glance, plus الخروج المؤقت. */}
          {!needsCheckout && (
            <span className="rounded-full border border-orange-ink/30 bg-orange-ink/8 px-3 py-1 text-xs font-bold text-orange-ink">
              ما مسجّل دخول — بصّم على الجهاز
            </span>
          )}
          {/* الخروج المؤقت only makes sense inside an open shift */}
          {needsCheckout && !attendance.break && (
            <StaffBreakControl
              balance={attendance.breakBalance}
              activeBreak={null}
              busy={breakBusy}
              deductionPerMinute={attendance.settings.deductionPerMinute}
              compact
              onRequest={(input) =>
                runBreak(() => requestBreak(input), "أُرسل طلب الخروج إلى المدير")
              }
              onStart={(id, withoutApproval) => runBreak(() => startBreak(id, withoutApproval), "تم")}
              onEnd={(id) => runBreak(() => endBreak(id), "أهلاً برجوعك")}
              onCancel={(id) => runBreak(() => cancelBreakRequest(id), "أُلغي الطلب")}
            />
          )}
          {needsCheckout && !attendance.break && (
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
        {/* an open request or an active break takes the full row — it is the live thing */}
        {needsCheckout && attendance.break && breakControl}
      </div>
    );
  }

  return (
    <StaffAttendanceCard
      className={className}
      settings={attendance.settings}
      record={attendance.record}
      breakSlot={attendance.record?.checkInAt && !attendance.record.checkOutAt ? breakControl : null}
    />
  );
}
