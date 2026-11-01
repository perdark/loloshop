"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getRetailBookingLock } from "@/lib/catalog";
import { updateRetailBookingLock, type RetailBookingLock } from "@/lib/admin";

const DEFAULT_MESSAGE = "انتظرونا، راح نبلّغكم أول ما ينفتح الحجز";

export function RetailBookingControl() {
  const [cfg, setCfg] = useState<RetailBookingLock>({
    active: false,
    message_ar: DEFAULT_MESSAGE,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getRetailBookingLock()
      .then((data) => setCfg(data))
      .catch(() => toast.error("تعذر تحميل إعدادات الحجز"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateRetailBookingLock(cfg);
      setCfg(updated);
      toast.success(
        updated.active ? "تم قفل الحجز للطلاب المفرد" : "تم فتح الحجز للطلاب المفرد"
      );
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
      <h2 className="mb-1.5 font-display text-xl font-bold tracking-tight text-ink">
        قفل الحجز للطلاب المفرد
      </h2>
      <p className="mb-5 text-xs text-ink/50">
        الطالب المفرد يكدر يتصفّح ويضيف للسلة، بس ما يكدر يكمّل الطلب ويطلعله رسالة الحجز.
        طلاب الممثلين والطلب المخصّص من الإدارة يشتغلون عادي.
      </p>

      {loading ? (
        <div className="space-y-3">
          <div className="skeleton h-11 w-full rounded-xl" />
          <div className="skeleton h-20 w-full rounded-xl" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Active toggle */}
          <label className="flex min-h-[44px] items-center justify-between gap-4 rounded-xl border border-ink/10 bg-white/60 px-4 py-3 cursor-pointer">
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-ink">الحجز مقفول</span>
              <span className="text-xs text-ink/50">
                {cfg.active
                  ? "المفرد ما يكدرون يكمّلون طلب هسه"
                  : "الحجز مفتوح للكل"}
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

          {/* Message */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="retail-booking-message"
              className="text-sm font-semibold text-ink"
            >
              الرسالة اللي تطلع للطالب
            </label>
            <textarea
              id="retail-booking-message"
              rows={3}
              value={cfg.message_ar}
              onChange={(e) =>
                setCfg((prev) => ({ ...prev, message_ar: e.target.value }))
              }
              maxLength={300}
              placeholder={DEFAULT_MESSAGE}
              className="w-full resize-none rounded-xl border border-ink/15 bg-white/70 px-4 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/20"
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
