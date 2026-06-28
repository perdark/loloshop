"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getAttendanceRecords,
  getAttendanceSettings,
  getAttendanceUserSettings,
  deleteAttendanceUserSettings,
  overrideAttendanceRecord,
  setAttendanceUserSettings,
  updateAttendanceSettings,
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

function timeOnly(v: string | null) {
  if (!v) return "—";
  return new Intl.DateTimeFormat("ar-IQ", {
    timeZone: "Asia/Baghdad",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(v));
}

export default function AdminAttendancePage() {
  const [settings, setSettings] = useState<StaffAttendanceSettings | null>(null);
  const [userSettings, setUserSettings] = useState<StaffAttendanceUserSetting[]>([]);
  const [drafts, setDrafts] = useState<Record<string, StaffAttendanceUserSetting>>({});
  const [date, setDate] = useState(todayLocal());
  const [records, setRecords] = useState<StaffAttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, u, r] = await Promise.all([
        getAttendanceSettings(),
        getAttendanceUserSettings(),
        getAttendanceRecords({ date }),
      ]);
      setSettings(s);
      setUserSettings(u);
      setDrafts(Object.fromEntries(u.map((row) => [row.userId, row])));
      setRecords(r);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحميل بيانات البصمة"));
    } finally {
      setLoading(false);
    }
  }, [date]);

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
    if (!window.confirm("إلغاء خصم التأخير لهذا السجل؟")) return;
    try {
      const next = await overrideAttendanceRecord(record.id, {
        lateMinutes: 0,
        deductionAmount: 0,
        noteAr: "إلغاء خصم التأخير من الأدمن",
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
      const next = { ...row, startTime: null, endTime: null, graceMinutes: null, deductionPerMinute: null, hasOverride: false };
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
        subtitle="إعداد وقت الحضور والانصراف وخصم التأخير"
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
              label="خصم كل دقيقة (د.ع)"
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
            <h2 className="font-display-ar text-base font-bold text-ink">دوام مخصص لكل موظف</h2>
            <p className="mt-1 text-sm text-ink-soft">
              اترك الموظف بدون تخصيص ليتبع الدوام الافتراضي. مثال: موظف 9:00 وموظف 10:00.
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
                    <th className="px-4 py-3 text-start">الحضور</th>
                    <th className="px-4 py-3 text-start">الخروج</th>
                    <th className="px-4 py-3 text-start">السماح</th>
                    <th className="px-4 py-3 text-start">خصم الدقيقة</th>
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
                          <Input
                            type="time"
                            value={draft.startTime || settings.startTime}
                            onChange={(e) => updateDraft(row.userId, { startTime: e.target.value })}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            type="time"
                            value={draft.endTime || settings.endTime}
                            onChange={(e) => updateDraft(row.userId, { endTime: e.target.value })}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            inputMode="numeric"
                            value={String(draft.graceMinutes ?? settings.graceMinutes)}
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
                            onChange={(e) =>
                              updateDraft(row.userId, {
                                deductionPerMinute: Number(e.target.value.replace(/[^\d]/g, "")) || 0,
                              })
                            }
                          />
                        </td>
                        <td className="px-4 py-3 text-xs text-ink-soft">
                          {row.hasOverride ? "دوام مخصص" : "يتبع الافتراضي"}
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
            <h2 className="font-display-ar text-base font-bold text-ink">سجلات اليوم</h2>
            <p className="mt-1 text-sm text-ink-soft">الوقت يعرض حسب توقيت العراق</p>
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
                  <th className="px-4 py-3 text-start">التأخير</th>
                  <th className="px-4 py-3 text-start">الخصم</th>
                  <th className="px-4 py-3 text-start">التحقق</th>
                  <th className="px-4 py-3 text-start">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-4 py-3 font-semibold text-ink">{r.staffName || "—"}</td>
                    <td className="px-4 py-3">{timeOnly(r.checkInAt)}</td>
                    <td className="px-4 py-3">{timeOnly(r.checkOutAt)}</td>
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
                    <td className="px-4 py-3">
                      {r.deductionAmount > 0 ? (
                        <Button size="sm" variant="ghost" onClick={() => clearDeduction(r)}>
                          إلغاء الخصم
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
