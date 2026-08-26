"use client";

/**
 * جدول الدوام الأسبوعي + الإجازات — migration 093.
 *
 * WHY IT EXISTS. Before this, the shop had ONE start/end pair for all seven days, and the
 * backend computed lateness against it every day. The shop opens 3 م الجمعة, so every Friday
 * بصمة was recorded as roughly six hours late — for months.
 *
 * ⚠️ The week saves WHOLE, never a day at a time. Seven rows are one decision; a half-applied
 * week is the shape where الجمعة is right and السبت is still wrong. The server enforces this
 * too (it refuses anything but seven days), so the UI is not the only thing holding it.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  addHoliday,
  deleteHoliday,
  getStaffSchedule,
  saveStaffSchedule,
  type Holiday,
  type ScheduleDay,
} from "@/lib/admin";
import { getApiErrorMessage } from "@/lib/api";
import { formatDateShort, formatShiftRange } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function WeeklySchedulePanel() {
  const [week, setWeek] = useState<ScheduleDay[] | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getStaffSchedule();
      setWeek(data.week);
      setHolidays(data.holidays);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحميل جدول الدوام"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function patchDay(weekday: number, patch: Partial<ScheduleDay>) {
    setWeek((cur) =>
      cur ? cur.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)) : cur
    );
  }

  async function handleSave() {
    if (!week) return;
    setSaving(true);
    try {
      setWeek(await saveStaffSchedule(week));
      toast.success("تم حفظ جدول الدوام");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حفظ الجدول"));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddHoliday() {
    if (!newDate) return toast.error("اختر التاريخ");
    if (!newLabel.trim()) return toast.error("اكتب سبب الإجازة");
    try {
      const row = await addHoliday(newDate, newLabel.trim());
      setHolidays((cur) => [row, ...cur.filter((h) => h.work_date !== row.work_date)]);
      setNewDate("");
      setNewLabel("");
      toast.success("تمت إضافة الإجازة");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر إضافة الإجازة"));
    }
  }

  async function handleDeleteHoliday(workDate: string) {
    try {
      await deleteHoliday(workDate);
      setHolidays((cur) => cur.filter((h) => h.work_date !== workDate));
      toast.success("تم حذف الإجازة");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حذف الإجازة"));
    }
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-5">
        <p className="text-sm text-ink-soft">جارٍ تحميل جدول الدوام…</p>
      </section>
    );
  }
  if (!week) return null;

  return (
    <section className="space-y-5 rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
      <div>
        <h2 className="font-display-ar text-base font-bold text-ink">جدول الدوام الأسبوعي</h2>
        <p className="mt-1 text-sm text-ink-soft">
          وقت الدوام لكل يوم على حدة. التأخير ينحسب على وقت اليوم نفسه، مو على وقت واحد لكل
          الأسبوع.
        </p>
      </div>

      {/* One card per day — a table would force a horizontal scroll on a phone, and this
          screen is opened from one as often as from the laptop. */}
      <div className="space-y-2.5">
        {week.map((d) => (
          <div
            key={d.weekday}
            className={`rounded-xl border p-3 ${
              d.is_off ? "border-line bg-surface-sink" : "border-line bg-surface"
            }`}
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-16 font-bold text-ink">{d.label_ar}</span>

              {d.is_off ? (
                <span className="text-sm text-muted">مغلق — ما يحتسب تأخير</span>
              ) : (
                <>
                  <label className="flex items-center gap-1.5 text-sm text-ink-soft">
                    <span>من</span>
                    <input
                      type="time"
                      value={d.start_time}
                      onChange={(e) => patchDay(d.weekday, { start_time: e.target.value })}
                      className="min-h-11 rounded-lg border border-line bg-white px-2 text-ink outline-none focus:border-orange-ink"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-sm text-ink-soft">
                    <span>إلى</span>
                    <input
                      type="time"
                      value={d.end_time}
                      onChange={(e) => patchDay(d.weekday, { end_time: e.target.value })}
                      className="min-h-11 rounded-lg border border-line bg-white px-2 text-ink outline-none focus:border-orange-ink"
                    />
                  </label>
                  {/* The browser's time input is 24-hour on most Android builds, so the
                      12-hour reading is shown beside it rather than instead of it. */}
                  <span className="text-sm font-semibold text-orange-ink">
                    {formatShiftRange(d.start_time, d.end_time)}
                  </span>
                  {d.end_time <= d.start_time && (
                    <span className="rounded-full bg-orange/10 px-2 py-0.5 text-[11px] font-medium text-orange-ink">
                      يمتد بعد منتصف الليل
                    </span>
                  )}
                </>
              )}

              <label className="ms-auto flex items-center gap-2 text-sm text-ink-soft">
                <input
                  type="checkbox"
                  checked={d.is_off}
                  onChange={(e) => patchDay(d.weekday, { is_off: e.target.checked })}
                  className="size-4 accent-[var(--shop-orange-ink)]"
                />
                مغلق
              </label>
            </div>
          </div>
        ))}
      </div>

      <Button onClick={handleSave} loading={saving}>
        حفظ جدول الأسبوع
      </Button>

      {/* ── الإجازات ── */}
      <div className="border-t border-line pt-5">
        <h3 className="font-display-ar text-base font-bold text-ink">أيام الإجازات</h3>
        <p className="mt-1 text-sm text-ink-soft">
          تاريخ محدد يعتبر إجازة لكل الموظفين — ما ينحسب تأخير ولا خصم بذاك اليوم.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Input
            label="التاريخ"
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
          />
          <Input
            label="السبب"
            placeholder="مثال: عيد الفطر"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <Button variant="ghost" onClick={handleAddHoliday}>
            إضافة إجازة
          </Button>
        </div>

        {holidays.length ? (
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
            {holidays.map((h) => (
              <li key={h.work_date} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-ink">{h.label_ar}</p>
                  <p className="text-xs text-ink-soft">{formatDateShort(h.work_date)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteHoliday(h.work_date)}
                  className="rounded-full px-2.5 py-1 text-xs text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  حذف
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted">ما في إجازات مسجّلة.</p>
        )}

        {/* Deleting a holiday does not re-mark past rows as late — `late_minutes` is frozen
            onto the record at check-in time. Said out loud so nobody expects otherwise. */}
        <p className="mt-3 text-xs text-muted">
          حذف إجازة ما يغيّر البصمات القديمة — التأخير ينثبّت على السجل وقت البصمة نفسها.
        </p>
      </div>
    </section>
  );
}
