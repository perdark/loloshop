"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getAttendanceCalendar,
  getAttendanceRecords,
  getAttendanceSettings,
  getAttendanceUserSettings,
  deleteAttendanceUserSettings,
  overrideAttendanceRecord,
  setAttendanceUserSettings,
  updateAttendanceSettings,
  type AttendanceCalendarDay,
} from "@/lib/admin";
import { getApiErrorMessage } from "@/lib/api";
import { formatDateShort, formatIQD } from "@/lib/format";
import type {
  AttendanceVerificationMode,
  StaffAttendanceRecord,
  StaffAttendanceSettings,
  StaffAttendanceUserSetting,
} from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";

const MODE_OPTIONS: { value: AttendanceVerificationMode; label: string }[] = [
  { value: "none", label: "بدون تحقق" },
  { value: "network", label: "شبكة المحل فقط" },
  { value: "location", label: "موقع المحل فقط" },
  { value: "both", label: "الشبكة والموقع معاً" },
  { value: "network_or_location", label: "الشبكة أو الموقع" },
];

function todayLocal() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function monthRange(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthIndex - 1, 1));
  const last = new Date(Date.UTC(year, monthIndex, 0));
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
  };
}

function monthGrid(month: string) {
  const { from, to } = monthRange(month);
  const days: (string | null)[] = [];
  const first = new Date(`${from}T00:00:00Z`);
  const lastDay = Number(to.slice(8, 10));
  const leading = first.getUTCDay();
  for (let i = 0; i < leading; i++) days.push(null);
  for (let d = 1; d <= lastDay; d++) {
    days.push(`${month}-${String(d).padStart(2, "0")}`);
  }
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

function timeOnly(v: string | null) {
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
  if (hours && mins) return `${hours} س ${mins} د`;
  if (hours) return `${hours} س`;
  return `${mins} د`;
}

export default function AdminAttendancePage() {
  const [settings, setSettings] = useState<StaffAttendanceSettings | null>(null);
  const [userSettings, setUserSettings] = useState<StaffAttendanceUserSetting[]>([]);
  const [drafts, setDrafts] = useState<Record<string, StaffAttendanceUserSetting>>({});
  const [date, setDate] = useState(todayLocal());
  const [calendarMonth, setCalendarMonth] = useState(todayLocal().slice(0, 7));
  const [calendarDays, setCalendarDays] = useState<AttendanceCalendarDay[]>([]);
  const [records, setRecords] = useState<StaffAttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const range = monthRange(calendarMonth);
      const [s, u, r, c] = await Promise.all([
        getAttendanceSettings(),
        getAttendanceUserSettings(),
        getAttendanceRecords({ date }),
        getAttendanceCalendar(range),
      ]);
      setSettings(s);
      setUserSettings(u);
      setDrafts(Object.fromEntries(u.map((row) => [row.userId, row])));
      setRecords(r);
      setCalendarDays(c);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحميل بيانات البصمة"));
    } finally {
      setLoading(false);
    }
  }, [calendarMonth, date]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    try {
      const next = await updateAttendanceSettings(settings);
      setSettings(next);
      toast.success("تم حفظ إعدادات البصمة");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حفظ الإعدادات"));
    } finally {
      setSaving(false);
    }
  }

  async function clearDeduction(record: StaffAttendanceRecord) {
    if (!window.confirm("إلغاء مبلغ التأخير لهذا السجل؟")) return;
    try {
      const next = await overrideAttendanceRecord(record.id, {
        lateMinutes: 0,
        deductionAmount: 0,
        noteAr: "إلغاء مبلغ التأخير من الأدمن",
      });
      setRecords((prev) => prev.map((r) => (r.id === next.id ? next : r)));
      toast.success("تم تصحيح سجل البصمة");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تصحيح السجل"));
    }
  }

  function updateDraft(userId: string, patch: Partial<StaffAttendanceUserSetting>) {
    setDrafts((prev) => ({ ...prev, [userId]: { ...prev[userId], ...patch } }));
  }

  async function saveUserSetting(row: StaffAttendanceUserSetting) {
    const draft = drafts[row.userId] || row;
    const startTime = draft.startTime || settings?.startTime || "09:00";
    const endTime = draft.endTime || settings?.endTime || "18:00";
    try {
      const next = await setAttendanceUserSettings(row.userId, {
        startTime,
        endTime,
        graceMinutes: draft.graceMinutes ?? settings?.graceMinutes ?? 15,
        deductionPerMinute: draft.deductionPerMinute ?? settings?.deductionPerMinute ?? 0,
        attendanceRequired: draft.attendanceRequired,
      });
      setUserSettings((prev) => prev.map((item) => (item.userId === next.userId ? next : item)));
      setDrafts((prev) => ({ ...prev, [next.userId]: next }));
      toast.success("تم حفظ دوام الموظف");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حفظ دوام الموظف"));
    }
  }

  async function resetUserSetting(row: StaffAttendanceUserSetting) {
    if (!window.confirm("إرجاع هذا الموظف إلى الدوام الافتراضي؟")) return;
    try {
      await deleteAttendanceUserSettings(row.userId);
      const next = {
        ...row,
        startTime: null,
        endTime: null,
        graceMinutes: null,
        deductionPerMinute: null,
        attendanceRequired: true,
        hasOverride: false,
      };
      setUserSettings((prev) => prev.map((item) => (item.userId === row.userId ? next : item)));
      setDrafts((prev) => ({ ...prev, [row.userId]: next }));
      toast.success("تم إرجاع الموظف للدوام الافتراضي");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حذف الدوام المخصص"));
    }
  }

  return (
    <div dir="rtl" lang="ar" className="space-y-6 animate-fade-page-in">
      <PageHeader
        title="بصمة الموظفين"
        subtitle="إعداد وقت الحضور والانصراف ومتابعة التأخير بمعزل عن الراتب"
        action={<Button onClick={load} variant="ghost" loading={loading}>تحديث</Button>}
      />

      {settings && (
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
          <h2 className="mb-3 font-display-ar text-base font-bold text-ink">الدوام الافتراضي</h2>
          <div className="grid gap-3 md:grid-cols-4">
            <Input
              label="وقت الحضور"
              type="time"
              value={settings.startTime}
              onChange={(e) => setSettings({ ...settings, startTime: e.target.value })}
            />
            <Input
              label="وقت الخروج"
              type="time"
              value={settings.endTime}
              onChange={(e) => setSettings({ ...settings, endTime: e.target.value })}
            />
            <Input
              label="دقائق السماح"
              inputMode="numeric"
              value={String(settings.graceMinutes)}
              onChange={(e) => setSettings({ ...settings, graceMinutes: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })}
            />
            <Input
              label="مبلغ التأخير لكل دقيقة (د.ع)"
              inputMode="numeric"
              value={String(settings.deductionPerMinute)}
              onChange={(e) => setSettings({ ...settings, deductionPerMinute: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })}
            />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <Select
              label="طريقة التحقق"
              value={settings.verificationMode}
              onChange={(e) =>
                setSettings({ ...settings, verificationMode: e.target.value as AttendanceVerificationMode })
              }
              options={MODE_OPTIONS}
            />
            <Input
              label="شبكات المحل IP/CIDR"
              className="md:col-span-3"
              dir="ltr"
              value={settings.allowedIpRanges.join(", ")}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  allowedIpRanges: e.target.value.split(",").map((v) => v.trim()).filter(Boolean),
                })
              }
              placeholder="مثال: 203.0.113.10, 192.168.1.0/24"
            />
            <Input
              label="خط العرض"
              dir="ltr"
              value={settings.shopLatitude ?? ""}
              onChange={(e) =>
                setSettings({ ...settings, shopLatitude: e.target.value ? Number(e.target.value) : null })
              }
            />
            <Input
              label="خط الطول"
              dir="ltr"
              value={settings.shopLongitude ?? ""}
              onChange={(e) =>
                setSettings({ ...settings, shopLongitude: e.target.value ? Number(e.target.value) : null })
              }
            />
            <Input
              label="نطاق الموقع بالمتر"
              inputMode="numeric"
              value={String(settings.shopRadiusMeters)}
              onChange={(e) =>
                setSettings({ ...settings, shopRadiusMeters: Number(e.target.value.replace(/[^\d]/g, "")) || 120 })
              }
            />
            <div className="flex items-end">
              <Button onClick={saveSettings} loading={saving} className="w-full">
                حفظ الإعدادات
              </Button>
            </div>
          </div>
        </section>
      )}

      {settings && (
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
          <div className="mb-4">
            <h2 className="font-display-ar text-base font-bold text-ink">إعدادات البصمة لكل موظف</h2>
            <p className="mt-1 text-sm text-ink-soft">
              حدد من تُطلب منه البصمة ومن يُعفى منها، مع إمكانية تخصيص وقت دوام كل موظف.
            </p>
          </div>

          {userSettings.length === 0 ? (
            <EmptyState message="لا يوجد موظفون" />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="w-full text-sm">
                <thead className="bg-surface-sink text-ink-soft">
                  <tr>
                    <th className="px-4 py-3 text-start">الموظف</th>
                    <th className="px-4 py-3 text-start">شرط البصمة</th>
                    <th className="px-4 py-3 text-start">الحضور</th>
                    <th className="px-4 py-3 text-start">الخروج</th>
                    <th className="px-4 py-3 text-start">السماح</th>
                    <th className="px-4 py-3 text-start">مبلغ الدقيقة</th>
                    <th className="px-4 py-3 text-start">الحالة</th>
                    <th className="px-4 py-3 text-start">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {userSettings.map((row) => {
                    const draft = drafts[row.userId] || row;
                    return (
                      <tr key={row.userId} className="border-t border-line">
                        <td className="px-4 py-3 font-semibold text-ink">{row.staffName || "—"}</td>
                        <td className="px-4 py-3">
                          <label className="flex min-w-36 items-center gap-2 text-sm font-medium text-ink-soft">
                            <input
                              type="checkbox"
                              checked={draft.attendanceRequired}
                              onChange={(e) =>
                                updateDraft(row.userId, { attendanceRequired: e.target.checked })
                              }
                              className="h-4 w-4 accent-orange-ink"
                            />
                            {draft.attendanceRequired ? "مطلوبة" : "معفى"}
                          </label>
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            type="time"
                            value={draft.startTime || settings.startTime}
                            disabled={!draft.attendanceRequired}
                            onChange={(e) => updateDraft(row.userId, { startTime: e.target.value })}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            type="time"
                            value={draft.endTime || settings.endTime}
                            disabled={!draft.attendanceRequired}
                            onChange={(e) => updateDraft(row.userId, { endTime: e.target.value })}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            inputMode="numeric"
                            value={String(draft.graceMinutes ?? settings.graceMinutes)}
                            disabled={!draft.attendanceRequired}
                            onChange={(e) =>
                              updateDraft(row.userId, {
                                graceMinutes: Number(e.target.value.replace(/[^\d]/g, "")) || 0,
                              })
                            }
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            inputMode="numeric"
                            value={String(draft.deductionPerMinute ?? settings.deductionPerMinute)}
                            disabled={!draft.attendanceRequired}
                            onChange={(e) =>
                              updateDraft(row.userId, {
                                deductionPerMinute: Number(e.target.value.replace(/[^\d]/g, "")) || 0,
                              })
                            }
                          />
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-soft">
                          {!row.attendanceRequired
                            ? "معفى من البصمة"
                            : row.hasOverride
                              ? "دوام مخصص"
                              : "يتبع الافتراضي"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => saveUserSetting(row)}>
                              حفظ
                            </Button>
                            {row.hasOverride && (
                              <Button size="sm" variant="ghost" onClick={() => resetUserSetting(row)}>
                                افتراضي
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display-ar text-base font-bold text-ink">تقويم الحضور</h2>
            <p className="mt-1 text-sm text-ink-soft">
              اختر يوماً لرؤية الدخول والخروج ومدة العمل والوقت الإضافي.
            </p>
          </div>
          <Input
            label="الشهر"
            type="month"
            value={calendarMonth}
            onChange={(e) => setCalendarMonth(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-7 gap-2 text-center text-xs font-bold text-muted">
          {["أحد", "إثن", "ثلث", "أرب", "خمس", "جمع", "سبت"].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-2">
          {monthGrid(calendarMonth).map((day, i) => {
            const item = day ? calendarDays.find((d) => d.date === day) : null;
            const selected = day === date;
            return (
              <button
                key={`${day || "empty"}-${i}`}
                type="button"
                disabled={!day}
                onClick={() => day && setDate(day)}
                className={`min-h-24 rounded-2xl border p-2 text-start transition-colors disabled:opacity-30 ${
                  selected
                    ? "border-orange-ink bg-orange-ink/10"
                    : "border-line bg-surface-sink hover:border-orange-ink/30"
                }`}
              >
                {day && (
                  <>
                    <span className="font-bold text-ink">{Number(day.slice(8, 10))}</span>
                    {item ? (
                      <div className="mt-2 space-y-1 text-[11px] text-ink-soft">
                        <p>{item.totals.presentCount} حضور</p>
                        {item.totals.lateCount > 0 && <p className="text-danger">{item.totals.lateCount} متأخر</p>}
                        {item.totals.openCount > 0 && <p className="text-orange-ink">{item.totals.openCount} مفتوح</p>}
                        {item.totals.overtimeMinutes > 0 && (
                          <p>إضافي {durationLabel(item.totals.overtimeMinutes)}</p>
                        )}
                      </div>
                    ) : (
                      <p className="mt-2 text-[11px] text-muted">لا توجد بصمات</p>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display-ar text-base font-bold text-ink">تفاصيل اليوم المحدد</h2>
            <p className="mt-1 text-sm text-ink-soft">الوقت يعرض حسب توقيت العراق، والسجل يتبع يوم الدخول.</p>
          </div>
          <Input label="التاريخ" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {loading ? (
          <div className="skeleton h-32 rounded-2xl" />
        ) : records.length === 0 ? (
          <EmptyState message="لا توجد بصمات لهذا التاريخ" />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-sink text-ink-soft">
                <tr>
                  <th className="px-4 py-3 text-start">الموظف</th>
                  <th className="px-4 py-3 text-start">الدخول</th>
                  <th className="px-4 py-3 text-start">الخروج</th>
                  <th className="px-4 py-3 text-start">مدة العمل</th>
                  <th className="px-4 py-3 text-start">وقت إضافي</th>
                  <th className="px-4 py-3 text-start">التأخير</th>
                  <th className="px-4 py-3 text-start">مبلغ التأخير</th>
                  <th className="px-4 py-3 text-start">التحقق</th>
                  <th className="px-4 py-3 text-start">ملاحظة</th>
                  <th className="px-4 py-3 text-start">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-4 py-3 font-semibold text-ink">{r.staffName || "—"}</td>
                    <td className="px-4 py-3">{timeOnly(r.checkInAt)}</td>
                    <td className="px-4 py-3">{timeOnly(r.checkOutAt)}</td>
                    <td className="px-4 py-3">{durationLabel(r.workedMinutes)}</td>
                    <td className={r.overtimeMinutes > 0 ? "px-4 py-3 font-bold text-orange-ink" : "px-4 py-3"}>
                      {durationLabel(r.overtimeMinutes)}
                    </td>
                    <td className={r.lateMinutes > 0 ? "px-4 py-3 font-bold text-danger" : "px-4 py-3"}>
                      {r.lateMinutes} دقيقة
                    </td>
                    <td className={r.deductionAmount > 0 ? "px-4 py-3 font-bold text-danger" : "px-4 py-3"}>
                      {formatIQD(r.deductionAmount)}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-soft">
                      {r.verified ? "مطابق" : "غير مطابق"}
                      {r.distanceMeters != null ? ` · ${r.distanceMeters}م` : ""}
                      <br />
                      {r.checkInIp || "بدون IP"}
                    </td>
                    <td className={r.openTooLong ? "px-4 py-3 text-xs font-bold text-danger" : "px-4 py-3 text-xs text-ink-soft"}>
                      {r.noteAr || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {r.deductionAmount > 0 ? (
                        <Button size="sm" variant="ghost" onClick={() => clearDeduction(r)}>
                          إلغاء المبلغ
                        </Button>
                      ) : r.overriddenAt ? (
                        <span className="text-xs text-muted">مصحح {formatDateShort(r.overriddenAt)}</span>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
