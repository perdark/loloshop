"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  correctBreak,
  decideBreak,
  getAttendanceCalendar,
  getAttendanceRecords,
  getAttendanceSettings,
  getAttendanceUserSettings,
  getBreakBalances,
  getBreaks,
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
  StaffBreak,
  StaffBreakBalanceRow,
} from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { CalculationDetails } from "@/components/admin/CalculationDetails";
import { WeeklySchedulePanel } from "@/components/admin/WeeklySchedulePanel";

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

type AttendanceConfirm =
  | { kind: "clear-deduction"; record: StaffAttendanceRecord }
  | { kind: "reset-schedule"; row: StaffAttendanceUserSetting };

export default function AdminAttendancePage() {
  const [settings, setSettings] = useState<StaffAttendanceSettings | null>(null);
  const [userSettings, setUserSettings] = useState<StaffAttendanceUserSetting[]>([]);
  const [drafts, setDrafts] = useState<Record<string, StaffAttendanceUserSetting>>({});
  const [date, setDate] = useState(todayLocal());
  const [calendarMonth, setCalendarMonth] = useState(todayLocal().slice(0, 7));
  const [calendarDays, setCalendarDays] = useState<AttendanceCalendarDay[]>([]);
  const [records, setRecords] = useState<StaffAttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmAction, setConfirmAction] = useState<AttendanceConfirm | null>(null);
  const [confirming, setConfirming] = useState(false);
  // الخروج المؤقت
  const [breaks, setBreaks] = useState<StaffBreak[]>([]);
  const [breakBalances, setBreakBalances] = useState<StaffBreakBalanceRow[]>([]);
  const [breakBusyId, setBreakBusyId] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<StaffBreak | null>(null);
  const [correctMinutes, setCorrectMinutes] = useState("");

  const breakMonth = calendarMonth;
  // everything still waiting on a decision, including breaks already taken and
  // charged — approving those is what cancels the deduction
  const pendingBreaks = useMemo(
    () => breaks.filter((b) => b.approval === "pending"),
    [breaks]
  );

  const loadBreaks = useCallback(async () => {
    try {
      const [list, balances] = await Promise.all([
        getBreaks({ ...monthRange(breakMonth) }),
        getBreakBalances(breakMonth),
      ]);
      setBreaks(list);
      setBreakBalances(balances.staff);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحميل الخروج المؤقت"));
    }
  }, [breakMonth]);

  useEffect(() => {
    loadBreaks();
  }, [loadBreaks]);

  async function decide(row: StaffBreak, decision: "approve" | "reject") {
    setBreakBusyId(row.id);
    try {
      await decideBreak(row.id, decision);
      toast.success(decision === "approve" ? "تمت الموافقة" : "تم الرفض");
      // a decision re-prices the whole month, so both views are refetched
      await loadBreaks();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تنفيذ القرار"));
    } finally {
      setBreakBusyId(null);
    }
  }

  async function saveCorrection() {
    if (!correcting) return;
    const minutes = Number(correctMinutes.replace(/[^\d]/g, ""));
    if (!Number.isInteger(minutes) || minutes < 0) {
      toast.error("أدخل عدد دقائق صحيح");
      return;
    }
    setBreakBusyId(correcting.id);
    try {
      await correctBreak(correcting.id, {
        minutes,
        adminNoteAr: "تصحيح مدة الخروج من الأدمن",
      });
      toast.success("تم تصحيح المدة");
      setCorrecting(null);
      setCorrectMinutes("");
      await loadBreaks();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تصحيح المدة"));
    } finally {
      setBreakBusyId(null);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
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
      setLoadError(true);
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
    setConfirming(true);
    try {
      const next = await overrideAttendanceRecord(record.id, {
        lateMinutes: 0,
        deductionAmount: 0,
        noteAr: "إلغاء مبلغ التأخير من الأدمن",
      });
      setRecords((prev) => prev.map((r) => (r.id === next.id ? next : r)));
      toast.success("تم تصحيح سجل البصمة");
      setConfirmAction(null);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تصحيح السجل"));
    } finally {
      setConfirming(false);
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
        breakMonthlyMinutes: draft.breakMonthlyMinutes,
      });
      // the allowance change re-prices this month, so reload the break views
      loadBreaks();
      setUserSettings((prev) => prev.map((item) => (item.userId === next.userId ? next : item)));
      setDrafts((prev) => ({ ...prev, [next.userId]: next }));
      toast.success("تم حفظ دوام الموظف");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حفظ دوام الموظف"));
    }
  }

  async function resetUserSetting(row: StaffAttendanceUserSetting) {
    setConfirming(true);
    try {
      await deleteAttendanceUserSettings(row.userId);
      const next = {
        ...row,
        startTime: null,
        endTime: null,
        graceMinutes: null,
        deductionPerMinute: null,
        attendanceRequired: true,
        breakMonthlyMinutes: null,
        hasOverride: false,
      };
      setUserSettings((prev) => prev.map((item) => (item.userId === row.userId ? next : item)));
      setDrafts((prev) => ({ ...prev, [row.userId]: next }));
      toast.success("تم إرجاع الموظف للدوام الافتراضي");
      setConfirmAction(null);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حذف الدوام المخصص"));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div dir="rtl" lang="ar" className="space-y-6 animate-fade-page-in">
      <PageHeader
        title="بصمة الموظفين"
        subtitle="إعداد وقت الحضور والانصراف ومتابعة التأخير بمعزل عن الراتب"
        action={<Button onClick={load} variant="ghost" loading={loading}>تحديث</Button>}
      />

      {loadError && (
        <div className="rounded-2xl border border-danger/25 bg-surface px-6 py-8 text-center" role="alert">
          <p className="font-bold text-ink">تعذّر تحميل بيانات البصمة</p>
          <p className="mt-1 text-sm text-ink-soft">لم تُخفَ الإعدادات؛ أعد المحاولة بعد التحقق من الاتصال.</p>
          <Button className="mt-4" variant="ghost" onClick={load} loading={loading}>
            إعادة المحاولة
          </Button>
        </div>
      )}

      {/* The weekly schedule comes FIRST: it is what actually decides lateness now, and the
          single «الدوام الافتراضي» pair below it is only the fallback for a day with no row. */}
      <WeeklySchedulePanel />

      {settings && (
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
          <h2 className="mb-1 font-display-ar text-base font-bold text-ink">الدوام الافتراضي</h2>
          <p className="mb-3 text-xs text-muted">
            احتياطي فقط — يُستعمل لو يوم ما عنده صف بجدول الأسبوع فوق.
          </p>
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
            <div className="md:col-span-2">
              <Input
                label="رصيد الخروج المؤقت شهرياً (دقيقة)"
                inputMode="numeric"
                value={String(settings.breakMonthlyMinutes)}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    breakMonthlyMinutes: Number(e.target.value.replace(/[^\d]/g, "")) || 0,
                  })
                }
              />
              <p className="mt-1 text-xs text-muted">
                = {durationLabel(settings.breakMonthlyMinutes)} لكل موظف شهرياً. الدقائق المصرَّحة
                داخل الرصيد مجانية؛ ما بعدها وأي خروج بدون موافقة يُخصم بمبلغ الدقيقة أعلاه.
              </p>
            </div>
          </div>
          <CalculationDetails summary="كيف يُحسب مبلغ التأخير؟" className="mt-3">
            <p>
              دقائق التأخير = وقت الدخول − وقت الحضور − دقائق السماح، وبحد أدنى صفر.
              مبلغ التأخير = دقائق التأخير × المبلغ لكل دقيقة. الإعداد الخاص بالموظف، إن وُجد، يتقدم على الإعداد الافتراضي.
            </p>
            <p className="mt-1">يُحفظ المبلغ وقت تسجيل الدخول؛ وأي تعديل إداري لاحق على السجل يظهر كمبلغ معتمد بدلاً من الحساب الأصلي.</p>
          </CalculationDetails>

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
                    <th className="px-4 py-3 text-start">رصيد الخروج</th>
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
                        <td className="px-4 py-3">
                          <Input
                            inputMode="numeric"
                            placeholder={String(settings.breakMonthlyMinutes)}
                            value={
                              draft.breakMonthlyMinutes == null
                                ? ""
                                : String(draft.breakMonthlyMinutes)
                            }
                            disabled={!draft.attendanceRequired}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^\d]/g, "");
                              // empty = inherit the shop-wide allowance
                              updateDraft(row.userId, {
                                breakMonthlyMinutes: raw === "" ? null : Number(raw),
                              });
                            }}
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
                              <Button size="sm" variant="ghost" onClick={() => setConfirmAction({ kind: "reset-schedule", row })}>
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

      {/* ── الخروج المؤقت ─────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display-ar text-base font-bold text-ink">الخروج المؤقت</h2>
            <p className="mt-1 text-sm text-ink-soft">
              طلبات الخروج خلال الدوام ورصيد كل موظف لشهر {breakMonth}. الدقائق المصرَّحة داخل
              الرصيد مجانية؛ ما بعدها وأي خروج بدون موافقة يُخصم من الراتب.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={loadBreaks}>
            تحديث
          </Button>
        </div>

        {pendingBreaks.length > 0 && (
          <div className="mb-5 space-y-2">
            <h3 className="text-sm font-bold text-ink">
              بانتظار قرارك ({pendingBreaks.length})
            </h3>
            {pendingBreaks.map((row) => (
              <div
                key={row.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${
                  row.leftWithoutApproval
                    ? "border-danger/35 bg-danger/5"
                    : "border-orange-ink/25 bg-peach/30"
                }`}
              >
                <div className="min-w-0">
                  <p className="font-bold text-ink">
                    {row.staffName || "—"}
                    {row.leftWithoutApproval && (
                      <span className="ms-2 rounded-full border border-danger/30 bg-surface px-2 py-0.5 text-[11px] font-bold text-danger">
                        خرج بدون موافقة
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {row.state === "out"
                      ? `خارج المحل الآن — ${durationLabel(row.openMinutes)}`
                      : row.state === "returned"
                        ? `خرج ${durationLabel(row.minutes)} · خصم ${formatIQD(row.deductionAmount)}`
                        : "لم يخرج بعد"}
                    {row.requestedMinutes ? ` · طلب ${durationLabel(row.requestedMinutes)}` : ""}
                    {row.reasonAr ? ` · ${row.reasonAr}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => decide(row, "approve")}
                    loading={breakBusyId === row.id}
                    disabled={breakBusyId === row.id}
                  >
                    {row.state === "returned" ? "أوافق وألغي الخصم" : "أوافق"}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => decide(row, "reject")}
                    disabled={breakBusyId === row.id}
                  >
                    أرفض
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <h3 className="mb-2 text-sm font-bold text-ink">رصيد الموظفين</h3>
        {breakBalances.length === 0 ? (
          <EmptyState message="لا يوجد موظفون مطلوبة منهم البصمة" />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-sink text-ink-soft">
                <tr>
                  <th className="px-4 py-3 text-start">الموظف</th>
                  <th className="px-4 py-3 text-start">الرصيد</th>
                  <th className="px-4 py-3 text-start">استهلك</th>
                  <th className="px-4 py-3 text-start">الباقي</th>
                  <th className="px-4 py-3 text-start">مخصوم</th>
                  <th className="px-4 py-3 text-start">مرات</th>
                </tr>
              </thead>
              <tbody>
                {breakBalances.map((row) => (
                  <tr key={row.userId} className="border-t border-line">
                    <td className="px-4 py-3 font-semibold text-ink">
                      {row.staffName || "—"}
                      {row.outCount > 0 && (
                        <span className="ms-2 rounded-full border border-orange-ink/30 bg-peach/40 px-2 py-0.5 text-[11px] font-bold text-orange-ink">
                          خارج الآن
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{durationLabel(row.monthlyMinutes)}</td>
                    <td className="px-4 py-3 text-ink-soft">{durationLabel(row.usedMinutes)}</td>
                    <td
                      className={`px-4 py-3 font-bold ${
                        row.remainingMinutes > 0 ? "text-ink" : "text-danger"
                      }`}
                    >
                      {row.remainingMinutes > 0 ? durationLabel(row.remainingMinutes) : "خلص"}
                    </td>
                    <td
                      className={`px-4 py-3 ${
                        row.deductionAmount > 0 ? "font-bold text-danger" : "text-ink-soft"
                      }`}
                    >
                      {row.deductionAmount > 0 ? formatIQD(row.deductionAmount) : "—"}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{row.breakCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 className="mb-2 mt-5 text-sm font-bold text-ink">سجل الخروج</h3>
        {breaks.length === 0 ? (
          <EmptyState message="لا يوجد خروج مؤقت هذا الشهر" />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-sink text-ink-soft">
                <tr>
                  <th className="px-4 py-3 text-start">الموظف</th>
                  <th className="px-4 py-3 text-start">التاريخ</th>
                  <th className="px-4 py-3 text-start">الخروج</th>
                  <th className="px-4 py-3 text-start">الرجوع</th>
                  <th className="px-4 py-3 text-start">المدة</th>
                  <th className="px-4 py-3 text-start">الحالة</th>
                  <th className="px-4 py-3 text-start">الخصم</th>
                  <th className="px-4 py-3 text-start">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {breaks.map((row) => (
                  <tr key={row.id} className="border-t border-line">
                    <td className="px-4 py-3 font-semibold text-ink">{row.staffName || "—"}</td>
                    <td className="px-4 py-3 text-ink-soft">{formatDateShort(row.workDate)}</td>
                    <td className="px-4 py-3 text-ink-soft">{timeOnly(row.leftAt)}</td>
                    <td className="px-4 py-3 text-ink-soft">
                      {row.state === "out" ? "لم يرجع" : timeOnly(row.returnedAt)}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      {row.state === "out"
                        ? durationLabel(row.openMinutes)
                        : durationLabel(row.minutes)}
                      {row.autoClosed && (
                        <span className="ms-1 text-[11px] text-muted">(أُغلق بالبصمة)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span
                        className={
                          row.approval === "approved"
                            ? "font-bold text-emerald-700"
                            : row.approval === "rejected"
                              ? "font-bold text-danger"
                              : "font-bold text-orange-ink"
                        }
                      >
                        {row.approval === "approved"
                          ? "مصرَّح"
                          : row.approval === "rejected"
                            ? "مرفوض"
                            : "بانتظار الموافقة"}
                      </span>
                      {row.leftWithoutApproval && (
                        <span className="block text-[11px] text-danger">خرج بدون موافقة</span>
                      )}
                    </td>
                    <td
                      className={`px-4 py-3 ${
                        row.deductionAmount > 0 ? "font-bold text-danger" : "text-ink-soft"
                      }`}
                    >
                      {row.deductionAmount > 0 ? formatIQD(row.deductionAmount) : "—"}
                      {row.deductedMinutes > 0 && (
                        <span className="block text-[11px] text-muted">
                          {row.deductedMinutes} دقيقة مخصومة
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {row.approval !== "approved" && (
                          <Button
                            size="sm"
                            onClick={() => decide(row, "approve")}
                            loading={breakBusyId === row.id}
                            disabled={breakBusyId === row.id}
                          >
                            أوافق
                          </Button>
                        )}
                        {row.approval !== "rejected" && row.state === "returned" && (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => decide(row, "reject")}
                            disabled={breakBusyId === row.id}
                          >
                            أرفض
                          </Button>
                        )}
                        {row.state !== "requested" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setCorrecting(row);
                              setCorrectMinutes(
                                String(row.state === "out" ? row.openMinutes : row.minutes)
                              );
                            }}
                            disabled={breakBusyId === row.id}
                          >
                            تصحيح المدة
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
                        <Button size="sm" variant="ghost" onClick={() => setConfirmAction({ kind: "clear-deduction", record: r })}>
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

      <Modal
        open={confirmAction !== null}
        onClose={() => { if (!confirming) setConfirmAction(null); }}
        title={confirmAction?.kind === "reset-schedule" ? "إرجاع الدوام الافتراضي" : "إلغاء مبلغ التأخير"}
        footer={
          <>
            <Button variant="ghost" disabled={confirming} onClick={() => setConfirmAction(null)}>
              إلغاء
            </Button>
            <Button
              variant="danger"
              loading={confirming}
              onClick={() => {
                if (confirmAction?.kind === "reset-schedule") void resetUserSetting(confirmAction.row);
                if (confirmAction?.kind === "clear-deduction") void clearDeduction(confirmAction.record);
              }}
            >
              تأكيد
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">
          {confirmAction?.kind === "reset-schedule"
            ? `سيعود ${confirmAction.row.staffName || "الموظف"} إلى إعدادات الدوام العامة.`
            : "سيُلغى مبلغ التأخير لهذا السجل مع إبقاء سجل الحضور محفوظاً."}
        </p>
      </Modal>

      {/* Relief valve for a worker who forgot to tap «رجعت» and is being billed for it. */}
      <Modal
        open={correcting !== null}
        onClose={() => {
          if (breakBusyId !== correcting?.id) setCorrecting(null);
        }}
        title="تصحيح مدة الخروج"
        footer={
          <>
            <Button
              variant="ghost"
              disabled={breakBusyId === correcting?.id}
              onClick={() => setCorrecting(null)}
            >
              إلغاء
            </Button>
            <Button loading={breakBusyId === correcting?.id} onClick={saveCorrection}>
              حفظ المدة
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">
          {correcting?.staffName || "الموظف"} — المدة المسجّلة{" "}
          {durationLabel(
            correcting?.state === "out" ? correcting?.openMinutes : correcting?.minutes
          )}
          . أدخل المدة الحقيقية؛ يُعاد حساب الرصيد والخصم لهذا الشهر بالكامل.
        </p>
        <div className="mt-3">
          <Input
            label="المدة بالدقائق"
            inputMode="numeric"
            value={correctMinutes}
            onChange={(e) => setCorrectMinutes(e.target.value.replace(/[^\d]/g, ""))}
          />
        </div>
        {correcting?.state === "out" && (
          <p className="mt-2 text-xs font-semibold text-orange-ink">
            هذا الخروج ما زال مفتوحاً — الحفظ سيُغلقه ويُسجّل رجوعه.
          </p>
        )}
      </Modal>
    </div>
  );
}
