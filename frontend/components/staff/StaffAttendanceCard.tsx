"use client";

import { formatIQD } from "@/lib/format";
import type { StaffAttendanceRecord, StaffAttendanceSettings } from "@/lib/types";

function timeOnly(v: string | null | undefined) {
  if (!v) return "—";
  return new Intl.DateTimeFormat("ar-IQ", {
    timeZone: "Asia/Baghdad",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(v));
}

function durationLabel(minutes: number | null | undefined) {
  const total = Math.max(0, Number(minutes) || 0);
  if (!total) return "—";
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours && mins) return `${hours} ساعة و${mins} دقيقة`;
  if (hours) return `${hours} ساعة`;
  return `${mins} دقيقة`;
}

/**
 * ⚠️ READ-ONLY SINCE 2026-08-30 — this card shows the day, it no longer punches it.
 * دخول/خروج come from the K40 at the shop; the two buttons that used to live here are gone
 * and the backend routes behind them were removed in the same change, so putting a button
 * back would call an endpoint that does not exist. الخروج المؤقت stays in `breakSlot`: it is
 * still a phone action, because the device's break keys are on an unmerged branch (ffcb0ce).
 */
export function StaffAttendanceCard({
  settings,
  record,
  breakSlot = null,
  className = "",
}: {
  settings: StaffAttendanceSettings | null | undefined;
  record: StaffAttendanceRecord | null;
  /** الخروج المؤقت controls — rendered only while a shift is open */
  breakSlot?: React.ReactNode;
  className?: string;
}) {
  const attendanceRequired = settings?.attendanceRequired !== false;

  return (
    <section
      className={`rounded-2xl border border-orange-ink/20 bg-warm-veil p-5 shadow-[var(--shadow-soft)] ${className}`}
      aria-label="بصمة الموظف"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-ink">بصمة الموظف</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {attendanceRequired
              ? (
                <>
                  الدوام {settings?.startTime ?? "09:00"} - {settings?.endTime ?? "18:00"} · سماح{" "}
                  {settings?.graceMinutes ?? 15} دقيقة
                </>
              )
              : "هذا الموظف معفى من شرط البصمة"}
          </p>
        </div>
        {attendanceRequired ? (
          <span className="rounded-full border border-orange-ink/30 bg-orange-ink/8 px-3 py-1 text-xs font-bold text-orange-ink">
            البصمة على الجهاز بالمحل
          </span>
        ) : (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
            غير مطلوب
          </span>
        )}
      </div>

      {attendanceRequired && breakSlot ? <div className="mt-4">{breakSlot}</div> : null}

      {attendanceRequired && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-xl bg-surface/75 p-3">
            <p className="text-xs text-muted">الدخول</p>
            <p className="mt-1 font-bold text-ink">{timeOnly(record?.checkInAt)}</p>
          </div>
          <div className="rounded-xl bg-surface/75 p-3">
            <p className="text-xs text-muted">الخروج</p>
            <p className="mt-1 font-bold text-ink">{timeOnly(record?.checkOutAt)}</p>
          </div>
          <div className="rounded-xl bg-surface/75 p-3">
            <p className="text-xs text-muted">التأخير</p>
            <p className={record?.lateMinutes ? "mt-1 font-bold text-danger" : "mt-1 font-bold text-ink"}>
              {record ? `${record.lateMinutes} دقيقة` : "—"}
            </p>
          </div>
          <div className="rounded-xl bg-surface/75 p-3">
            <p className="text-xs text-muted">مدة العمل</p>
            <p className="mt-1 font-bold text-ink">{durationLabel(record?.workedMinutes)}</p>
            {/* breaks are excluded from مدة العمل — say so where the number is */}
            {record?.breakMinutes ? (
              <p className="mt-0.5 text-[11px] text-muted">
                بعد خصم {durationLabel(record.breakMinutes)} خروج مؤقت
              </p>
            ) : null}
          </div>
          <div className="rounded-xl bg-surface/75 p-3">
            <p className="text-xs text-muted">وقت إضافي</p>
            <p className={record?.overtimeMinutes ? "mt-1 font-bold text-orange-ink" : "mt-1 font-bold text-ink"}>
              {durationLabel(record?.overtimeMinutes)}
            </p>
          </div>
          <div className="rounded-xl bg-surface/75 p-3">
            <p className="text-xs text-muted">مبلغ التأخير</p>
            <p className={record?.deductionAmount ? "mt-1 font-bold text-danger" : "mt-1 font-bold text-ink"}>
              {record ? formatIQD(record.deductionAmount) : "—"}
            </p>
          </div>
        </div>
      )}

      {attendanceRequired && record?.openTooLong && (
        <div className="mt-3 rounded-xl border border-danger/25 bg-danger/5 px-3 py-2 text-sm font-semibold text-danger">
          {record.noteAr || "الموظف لم يخرج من المعمل"}
        </div>
      )}

      {attendanceRequired && record && (
        <p className="mt-3 text-xs text-ink-soft">
          التحقق: الشبكة {record.networkOk ? "مطابقة" : "غير مطابقة"} · الموقع{" "}
          {record.locationOk ? "مطابق" : "غير مطابق"}
          {record.distanceMeters != null ? ` · المسافة ${record.distanceMeters}م` : ""}
        </p>
      )}
    </section>
  );
}
