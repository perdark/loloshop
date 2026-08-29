"use client";

/**
 * جهاز البصمة (ZKTeco K40 عبر ADMS) — migration 094.
 *
 * WHY THIS SCREEN EXISTS, in the order it renders:
 *   1. الأجهزة — an UNREGISTERED serial is dropped by the server on purpose (some firmware
 *      retries a 4xx forever, so one misconfigured device becomes a self-inflicted flood).
 *      Registering here is therefore a prerequisite for any punch ever landing.
 *   2. «أرقام جهاز بلا اسم» — the actionable list. A finger that touched the device before
 *      anybody mapped it is STORED, not rejected, and linking it replays those punches into
 *      attendance. That is why this sits above the roster: it is the only part with a queue.
 *   3. أرقام الموظفين — the mapping itself, plus «حالة الإرسال» of the name push.
 *   4. «نبضات مرفوضة» — quarantined lines. A row here is a dialect mismatch and its raw line
 *      names it exactly; it is the only place that failure is ever visible.
 *
 * ⚠️ Built phone-first even though /admin is laptop-primary: this is the screen an admin has
 * open while standing next to the device with the other hand on a fingerprint sensor. Cards,
 * never tables — a table forces a horizontal scroll exactly where both hands are busy.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DEVICE_PUSH_STATE_AR,
  assignUnmappedPin,
  deleteDevicePin,
  getAttendanceDevices,
  getDevicePins,
  getPunchRejects,
  getUnmappedPins,
  registerAttendanceDevice,
  setDevicePin,
  updateAttendanceDevice,
  type AttendanceDevice,
  type PinLinkMeta,
  type PunchReject,
  type StaffDevicePin,
  type UnmappedPin,
} from "@/lib/admin";
import { getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";

const STAMP = new Intl.DateTimeFormat("ar-IQ", {
  timeZone: "Asia/Baghdad",
  dateStyle: "short",
  timeStyle: "short",
});

function stamp(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : STAMP.format(d);
}

/** The device's own clock, verbatim. Kept beside the resolved instant on purpose — a worker
 *  disputing a late mark points at what the DEVICE showed, not at what we computed. */
function deviceStamp(value: string | null | undefined) {
  if (!value) return "—";
  return String(value).replace("T", " ").slice(0, 16);
}

function pushBadge(state: StaffDevicePin["push_state"]) {
  if (!state) return null;
  const tone =
    state === "confirmed"
      ? "bg-emerald-500/12 text-emerald-700"
      : state === "failed"
        ? "bg-danger/12 text-danger"
        : "bg-orange/12 text-orange-ink";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      {DEVICE_PUSH_STATE_AR[state]}
    </span>
  );
}

function replaySummary(meta: PinLinkMeta) {
  if (!meta.replayed) return "تم الربط. ما في نبضات سابقة لهذا الرقم.";
  const days = meta.derived.created;
  return days
    ? `تم الربط — رجعت ${meta.replayed} نبضة سابقة وظهر ${days} يوم دوام.`
    : `تم الربط — رجعت ${meta.replayed} نبضة سابقة.`;
}

export function AttendanceDevicePanel() {
  const [devices, setDevices] = useState<AttendanceDevice[]>([]);
  const [pins, setPins] = useState<StaffDevicePin[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedPin[]>([]);
  const [rejects, setRejects] = useState<PunchReject[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [newSerial, setNewSerial] = useState("");
  const [newLabel, setNewLabel] = useState("");
  // one chosen موظف per unmapped number
  const [assignTo, setAssignTo] = useState<Record<string, string>>({});
  const [pinDraft, setPinDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, p, u, r] = await Promise.all([
        getAttendanceDevices(),
        getDevicePins(),
        getUnmappedPins(),
        getPunchRejects(30),
      ]);
      setDevices(d);
      setPins(p);
      setUnmapped(u);
      setRejects(r);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
      toast.error(getApiErrorMessage(e, "تعذر تحميل بيانات جهاز البصمة"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const staffOptions = useMemo(
    () => [
      { value: "", label: "اختر الموظف…" },
      ...pins.map((p) => ({
        value: p.user_id,
        label: p.pin == null ? p.staff_name : `${p.staff_name} (رقم ${p.pin})`,
      })),
    ],
    [pins]
  );

  async function handleRegister() {
    const serial = newSerial.trim();
    if (!serial) return toast.error("اكتب الرقم التسلسلي المطبوع على الجهاز");
    setBusy("register");
    try {
      const row = await registerAttendanceDevice(serial, newLabel.trim() || undefined);
      setDevices((cur) => [...cur, row]);
      setNewSerial("");
      setNewLabel("");
      toast.success("تم تسجيل الجهاز");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تسجيل الجهاز"));
    } finally {
      setBusy(null);
    }
  }

  async function handleToggleDevice(device: AttendanceDevice) {
    setBusy(`device:${device.serial_number}`);
    try {
      const row = await updateAttendanceDevice(device.serial_number, { active: !device.active });
      setDevices((cur) => cur.map((d) => (d.serial_number === row.serial_number ? { ...d, ...row } : d)));
      toast.success(row.active ? "الجهاز شغّال" : "تم إيقاف الجهاز");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تعديل الجهاز"));
    } finally {
      setBusy(null);
    }
  }

  async function handleAssign(row: UnmappedPin) {
    const userId = assignTo[row.device_pin];
    if (!userId) return toast.error("اختر الموظف أولاً");
    setBusy(`assign:${row.device_pin}`);
    try {
      const { meta } = await assignUnmappedPin(row.device_pin, userId);
      toast.success(replaySummary(meta));
      await load();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر ربط الرقم بالموظف"));
    } finally {
      setBusy(null);
    }
  }

  async function handleSetPin(row: StaffDevicePin, allocate: boolean) {
    const raw = (pinDraft[row.user_id] ?? "").trim();
    if (!allocate && !raw) return toast.error("اكتب رقم الجهاز");
    setBusy(`pin:${row.user_id}`);
    try {
      const { meta } = await setDevicePin(row.user_id, {
        pin: allocate ? null : Number(raw),
      });
      setPinDraft((cur) => ({ ...cur, [row.user_id]: "" }));
      toast.success(replaySummary(meta));
      await load();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حفظ رقم الجهاز"));
    } finally {
      setBusy(null);
    }
  }

  async function handleUnlink(row: StaffDevicePin) {
    setBusy(`pin:${row.user_id}`);
    try {
      await deleteDevicePin(row.user_id);
      toast.success("تم فك الربط. سجلات الدوام السابقة محفوظة.");
      await load();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر فك الربط"));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-5">
        <p className="text-sm text-ink-soft">جارٍ تحميل بيانات جهاز البصمة…</p>
      </section>
    );
  }

  return (
    <div dir="rtl" lang="ar" className="space-y-5">
      {loadError && (
        <div className="rounded-2xl border border-danger/25 bg-surface px-5 py-6 text-center" role="alert">
          <p className="font-bold text-ink">تعذّر تحميل بيانات الجهاز</p>
          <Button className="mt-3" variant="ghost" onClick={load}>
            إعادة المحاولة
          </Button>
        </div>
      )}

      {/* ── 1. الأجهزة ── */}
      <section className="space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display-ar text-base font-bold text-ink">جهاز البصمة</h2>
            <p className="mt-1 text-sm text-ink-soft">
              سجّل الرقم التسلسلي المطبوع على ظهر الجهاز قبل ما توجّهه للخادم. أي جهاز غير مسجّل
              يُهمَل ولا توصل منه أي بصمة.
            </p>
          </div>
          <Button variant="ghost" onClick={load} className="min-h-11">
            تحديث
          </Button>
        </div>

        {devices.length === 0 ? (
          <EmptyState message="ما في جهاز مسجّل. سجّل الرقم التسلسلي أدناه." />
        ) : (
          <ul className="space-y-2.5">
            {devices.map((d) => (
              <li
                key={d.serial_number}
                className={`rounded-xl border p-3 ${d.active ? "border-line bg-surface" : "border-line bg-surface-sink"}`}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="font-bold text-ink">{d.label_ar}</span>
                  <span dir="ltr" className="rounded-lg bg-ink/5 px-2 py-0.5 font-mono text-xs text-ink-soft">
                    {d.serial_number}
                  </span>
                  {!d.active && (
                    <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
                      موقوف
                    </span>
                  )}
                </div>
                <dl className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-3">
                  <div className="flex gap-1.5">
                    <dt className="text-muted">آخر اتصال بالجهاز:</dt>
                    <dd className={d.last_seen_at ? "font-semibold text-ink" : "font-semibold text-orange-ink"}>
                      {d.last_seen_at ? stamp(d.last_seen_at) : "لم يتصل بعد"}
                    </dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-muted">بصمات اليوم:</dt>
                    <dd className="font-semibold text-ink">{d.today_punches}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-muted">أوامر بالانتظار:</dt>
                    <dd className="font-semibold text-ink">{d.queued_commands}</dd>
                  </div>
                </dl>
                <div className="mt-2.5">
                  <Button
                    variant="ghost"
                    className="min-h-11"
                    loading={busy === `device:${d.serial_number}`}
                    onClick={() => handleToggleDevice(d)}
                  >
                    {d.active ? "إيقاف الجهاز" : "تشغيل الجهاز"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Input
            label="الرقم التسلسلي"
            dir="ltr"
            placeholder="مثال: CJPP234560012"
            value={newSerial}
            onChange={(e) => setNewSerial(e.target.value)}
          />
          <Input
            label="اسم الجهاز"
            placeholder="جهاز البصمة"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <Button onClick={handleRegister} loading={busy === "register"} className="min-h-11 w-full sm:w-auto">
            تسجيل الجهاز
          </Button>
        </div>
      </section>

      {/* ── 2. أرقام جهاز بلا اسم — the only part with a queue ── */}
      <section className="space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)] sm:p-5">
        <div>
          <h2 className="font-display-ar text-base font-bold text-ink">
            أرقام جهاز بلا اسم
            {unmapped.length > 0 && (
              <span className="ms-2 rounded-full bg-orange/15 px-2 py-0.5 align-middle text-xs font-semibold text-orange-ink">
                {unmapped.length}
              </span>
            )}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            بصمات وصلت من رقم داخل الجهاز ما مربوط بأي موظف. ما ضاعت — أول ما تربط الرقم
            بموظف، كل بصماته السابقة تتحوّل لسجلات دوام بأوقاتها الأصلية.
          </p>
        </div>

        {unmapped.length === 0 ? (
          <EmptyState message="كل الأرقام اللي بصمت مربوطة بموظفين." />
        ) : (
          <ul className="space-y-2.5">
            {unmapped.map((row) => (
              <li key={row.device_pin} className="rounded-xl border border-orange/30 bg-orange/[0.04] p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="text-muted text-sm">رقم الجهاز</span>
                  <span dir="ltr" className="rounded-lg bg-orange/15 px-2.5 py-1 font-mono text-base font-bold text-orange-ink">
                    {row.device_pin}
                  </span>
                  <span className="text-sm font-semibold text-ink">{row.punch_count} بصمة</span>
                </div>
                <p className="mt-1.5 text-xs text-ink-soft">
                  من {deviceStamp(row.first_device_ts)} إلى {deviceStamp(row.last_device_ts)}
                  {row.device_sn ? ` · ${row.device_sn}` : ""}
                </p>
                {row.mapped_staff_name && (
                  <p className="mt-1.5 text-xs font-semibold text-orange-ink">
                    الرقم مربوط بـ{row.mapped_staff_name} بس هذي البصمات وصلت قبل الربط — اربطه مرة ثانية لاسترجاعها.
                  </p>
                )}
                <div className="mt-3 grid gap-2.5 sm:grid-cols-[1fr_auto] sm:items-end">
                  <Select
                    label="اربط بموظف"
                    options={staffOptions}
                    value={assignTo[row.device_pin] ?? ""}
                    onChange={(e) =>
                      setAssignTo((cur) => ({ ...cur, [row.device_pin]: e.target.value }))
                    }
                  />
                  <Button
                    className="min-h-11 w-full sm:w-auto"
                    loading={busy === `assign:${row.device_pin}`}
                    onClick={() => handleAssign(row)}
                  >
                    اربط
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 3. أرقام الموظفين ── */}
      <section className="space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)] sm:p-5">
        <div>
          <h2 className="font-display-ar text-base font-bold text-ink">أرقام الموظفين داخل الجهاز</h2>
          <p className="mt-1 text-sm text-ink-soft">
            كل موظف يحتاج رقم داخل الجهاز حتى تنحسب بصمته. «رقم تلقائي» ياخذ أول رقم فاضي،
            و«حالة الإرسال» تبيّن وصول اسم الموظف للجهاز.
          </p>
        </div>

        {pins.length === 0 ? (
          <EmptyState message="ما في موظفين." />
        ) : (
          <ul className="space-y-2.5">
            {pins.map((row) => (
              <li key={row.user_id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="font-bold text-ink">{row.staff_name}</span>
                  {row.pin != null && (
                    <span dir="ltr" className="rounded-lg bg-ink/5 px-2 py-0.5 font-mono text-sm font-bold text-ink">
                      {row.pin}
                    </span>
                  )}
                  {pushBadge(row.push_state)}
                  {row.punch_count > 0 && (
                    <span className="text-xs text-muted">{row.punch_count} بصمة مسجّلة</span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-2.5">
                  <Input
                    label="رقم الجهاز"
                    dir="ltr"
                    inputMode="numeric"
                    className="w-28"
                    placeholder={row.pin == null ? "—" : String(row.pin)}
                    value={pinDraft[row.user_id] ?? ""}
                    onChange={(e) =>
                      setPinDraft((cur) => ({
                        ...cur,
                        [row.user_id]: e.target.value.replace(/[^\d]/g, ""),
                      }))
                    }
                  />
                  <Button
                    variant="ghost"
                    className="min-h-11"
                    loading={busy === `pin:${row.user_id}`}
                    onClick={() => handleSetPin(row, false)}
                  >
                    حفظ الرقم
                  </Button>
                  {row.pin == null ? (
                    <Button
                      className="min-h-11"
                      loading={busy === `pin:${row.user_id}`}
                      onClick={() => handleSetPin(row, true)}
                    >
                      رقم تلقائي
                    </Button>
                  ) : (
                    <Button
                      variant="danger"
                      className="min-h-11"
                      loading={busy === `pin:${row.user_id}`}
                      onClick={() => handleUnlink(row)}
                    >
                      فك الربط
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Said out loud because the button looks destructive and is not. */}
        <p className="text-xs text-muted">
          فك الربط ما يمسح دوام سابق — السجلات المشتقّة تبقى للموظف، والرقم بس يرجع «بلا اسم»
          للبصمات الجاية.
        </p>
      </section>

      {/* ── 4. نبضات مرفوضة ── */}
      <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)] sm:p-5">
        <div>
          <h2 className="font-display-ar text-base font-bold text-ink">نبضات مرفوضة</h2>
          <p className="mt-1 text-sm text-ink-soft">
            سطور وصلت من الجهاز وما قدرنا نقراها. تنعزل هنا حتى سطر واحد خربان ما يجمّد باقي
            البصمات، ونص السطر نفسه يبيّن السبب.
          </p>
        </div>
        {rejects.length === 0 ? (
          <p className="text-sm text-muted">ما في نبضات مرفوضة.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {rejects.map((r) => (
              <li key={r.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-danger">{r.reason}</span>
                  <span className="text-xs text-muted">{stamp(r.at)}</span>
                </div>
                {r.raw_line && (
                  <p dir="ltr" className="mt-1 overflow-x-auto whitespace-pre font-mono text-xs text-ink-soft">
                    {r.raw_line}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
