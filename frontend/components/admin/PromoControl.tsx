"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getPromo } from "@/lib/catalog";
import { updatePromo, type PromoConfig } from "@/lib/admin";

/** Convert an ISO string (or null) to the value expected by <input type="datetime-local">. */
function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  // datetime-local expects "YYYY-MM-DDTHH:mm"
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    // Pad to local time
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      "T" +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
  } catch {
    return "";
  }
}

/** Convert a datetime-local string → ISO (UTC) string, or null if empty. */
function datetimeLocalToIso(value: string): string | null {
  if (!value) return null;
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

export function PromoControl() {
  const [cfg, setCfg] = useState<PromoConfig>({
    active: false,
    title_ar: "",
    message_ar: "",
    deadline: null,
  });
  const [deadlineLocal, setDeadlineLocal] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getPromo()
      .then((data) => {
        setCfg(data);
        setDeadlineLocal(isoToDatetimeLocal(data.deadline));
      })
      .catch(() => toast.error("تعذر تحميل إعدادات الإعلان"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const payload: PromoConfig = {
        ...cfg,
        deadline: datetimeLocalToIso(deadlineLocal),
      };
      const updated = await updatePromo(payload);
      setCfg(updated);
      setDeadlineLocal(isoToDatetimeLocal(updated.deadline));
      toast.success("تم حفظ إعدادات الإعلان");
    } catch {
      toast.error("تعذر حفظ الإعدادات");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      dir="rtl"
      lang="ar"
      className="rounded-2xl border border-ink/10 bg-beige p-6 sm:p-7"
    >
      <h2 className="mb-5 font-display text-xl font-bold tracking-tight text-ink">
        إعلان الخصومات
      </h2>

      {loading ? (
        <div className="space-y-3">
          <div className="skeleton h-11 w-full rounded-xl" />
          <div className="skeleton h-11 w-full rounded-xl" />
          <div className="skeleton h-20 w-full rounded-xl" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Active toggle */}
          <label className="flex min-h-[44px] items-center justify-between gap-4 rounded-xl border border-ink/10 bg-white/60 px-4 py-3 cursor-pointer">
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-ink">مُفعّل</span>
              <span className="text-xs text-ink/50">
                {cfg.active
                  ? "الإعلان مرئي للزوار (إذا لم ينته الموعد)"
                  : "الإعلان مخفي — لن يظهر النافذة للزوار"}
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={cfg.active}
              onClick={() => setCfg((prev) => ({ ...prev, active: !prev.active }))}
              dir="ltr"
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-ink ${
                cfg.active ? "bg-orange-ink" : "bg-ink/20"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                  cfg.active ? "translate-x-[1.25rem]" : "translate-x-[0.25rem]"
                }`}
              />
            </button>
          </label>

          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="promo-title" className="text-sm font-semibold text-ink">
              العنوان
            </label>
            <input
              id="promo-title"
              type="text"
              value={cfg.title_ar}
              onChange={(e) => setCfg((prev) => ({ ...prev, title_ar: e.target.value }))}
              placeholder="مثال: استغل الخصومات"
              className="min-h-[44px] w-full rounded-xl border border-ink/15 bg-white/70 px-4 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/20"
            />
          </div>

          {/* Message */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="promo-message" className="text-sm font-semibold text-ink">
              نص الإعلان
            </label>
            <textarea
              id="promo-message"
              rows={3}
              value={cfg.message_ar}
              onChange={(e) => setCfg((prev) => ({ ...prev, message_ar: e.target.value }))}
              placeholder="مثال: أسعار مخفّضة على المنتجات المختارة — لا تفوّت الفرصة!"
              className="w-full resize-none rounded-xl border border-ink/15 bg-white/70 px-4 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/20"
            />
          </div>

          {/* Deadline */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="promo-deadline" className="text-sm font-semibold text-ink">
              ينتهي في
              <span className="ms-1.5 text-xs font-normal text-ink/50">
                (اتركه فارغاً لعدم إظهار العداد التنازلي)
              </span>
            </label>
            <input
              id="promo-deadline"
              type="datetime-local"
              value={deadlineLocal}
              onChange={(e) => setDeadlineLocal(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-ink/15 bg-white/70 px-4 py-2.5 text-sm text-ink focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/20"
            />
          </div>

          {/* Save */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-orange-ink px-6 font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-ink disabled:opacity-50"
          >
            {saving ? "جاري الحفظ…" : "حفظ"}
          </button>
        </div>
      )}
    </section>
  );
}
