"use client";

// The بصمة REMINDER that replaced the بصمة CONTROLS on the work queues.
//
// ⚠️ WHY THIS IS A LINK AND NOT A BUTTON — reported by the workshop 2026-08-05:
// «اكو خلل عام عند العامل بالبصمة انه يضغطوها بالغلط لانها بقائمة التجهيز اولا ولازم تنشال
// وتنحط عند قائمة البصمة». `StaffAttendancePanel compact` put a live «بصمة دخول» /
// «بصمة خروج» primary button at the very top of every production queue — the first thing
// under the thumb on a phone, directly above the list the worker actually came to tap.
// Workers were punching in and out by accident, which writes real payroll rows.
//
// The controls were NOT deleted: `/staff/attendance` («بصمة الموظف» in the sidebar) already
// mounts the FULL panel — check-in/out card, break request, live break timer, balance. This
// component keeps the one thing the queue genuinely needs — «did I forget to punch in?» —
// and makes acting on it a deliberate navigation to that page.
//
// So: it never mutates attendance. Every path out of here is a <Link>.

import Link from "next/link";
import { useEffect, useState } from "react";
import { getMyAttendanceToday, type MyAttendanceToday } from "@/lib/staff";

export function AttendanceReminder({ className = "" }: { className?: string }) {
  const [attendance, setAttendance] = useState<MyAttendanceToday | null>(null);

  // Fetch once. The old compact panel polled every 20 s while a break was live; a
  // read-only reminder does not need that, and the queue screens are the ones the
  // workshop asked to make FAST. Live break state belongs on /staff/attendance.
  useEffect(() => {
    let alive = true;
    getMyAttendanceToday()
      .then((a) => alive && setAttendance(a))
      .catch(() => {
        /* silent — a reminder that fails to load must not toast over the work queue */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!attendance) return null;

  const attendanceRequired = attendance.settings.attendanceRequired !== false;
  const record = attendance.record;
  // Same visibility rule the compact panel used: nothing to say when بصمة is off for this
  // workshop, or the shift is already closed.
  if (!attendanceRequired || record?.checkOutAt) return null;

  const checkedIn = !!record?.checkInAt;

  // Not punched in yet — the one case worth interrupting for, because forgetting it costs
  // the worker money. Warm, not alarming, and still only a link.
  if (!checkedIn) {
    return (
      <Link
        href="/staff/attendance"
        className={`flex min-h-11 items-center justify-between gap-3 rounded-xl border border-orange-ink/30 bg-orange-ink/8 px-4 py-2.5 text-sm transition-colors hover:bg-orange-ink/15 ${className}`}
      >
        <span className="font-semibold text-orange-ink">لم تسجّل بصمة الدخول اليوم</span>
        <span className="shrink-0 text-xs font-bold text-orange-ink">
          بصّم على الجهاز بالمحل <span aria-hidden>←</span>
        </span>
      </Link>
    );
  }

  // Punched in: a quiet acknowledgement. An open break is surfaced here too — the worker
  // needs to know the clock is running — but ending it is done on the بصمة page.
  const onBreak = !!attendance.break;
  return (
    <Link
      href="/staff/attendance"
      className={`flex min-h-11 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm transition-colors hover:border-orange-ink/40 ${className}`}
    >
      <span className="font-medium text-ink-soft">
        {onBreak ? "أنت في خروج مؤقت الآن" : "بصمة الدخول مسجّلة"}
      </span>
      <span className="shrink-0 text-xs font-semibold text-ink-soft">
        {onBreak ? "إنهاء الخروج" : "صفحة البصمة"} <span aria-hidden>←</span>
      </span>
    </Link>
  );
}
