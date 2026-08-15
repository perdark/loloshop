"use client";

import { useCallback, useEffect, useState } from "react";
import { getOtpGatewayStatus, type OtpGatewayStatus as GatewayData } from "@/lib/admin";

/**
 * «حالة بوابة الواتساب» — a glance-sized read of backend/lib/otp.js's failover state, for
 * mid-surge admin monitoring. Fetched once on mount; a manual refresh button is enough (the
 * task explicitly rules out a polling loop — this is a during-an-incident check, not a live
 * dashboard tile).
 *
 * Three states, derived client-side from `gatewayStatus()`'s shape:
 *  - NORMAL   — the primary device (devices[0]) is the one currently sending.
 *  - FAILOVER — some OTHER configured device is sending. The primary is very likely banned
 *               by Meta; see lib/otp.js's own header for why the shop never load-balances and
 *               only ever moves off the primary under failure.
 *  - DEGRADED — every configured device is currently marked unhealthy (cooled down).
 *
 * ⚠️ DEGRADED IS NOT FULLY OBSERVABLE FROM THIS DATA. A device only flips to `healthy:false`
 * when ANOTHER device succeeds right after it fails in the same send (see `sendViaZentramsg`'s
 * "cool down NOTHING" branch) — if every device fails together, none of them ever get marked
 * unhealthy, because there is no surviving success to prove it was the device's fault and not
 * the recipient's number. So this chip can miss a simultaneous total outage; it reliably
 * catches the far more common case (one device banned, the other keeps working, or a bad
 * device recovers only after traffic already moved off it).
 */

type GatewayState = "normal" | "failover" | "degraded" | "unconfigured";

function deriveState(status: GatewayData): GatewayState {
  if (!status.devices.length) return "unconfigured";
  if (status.devices.every((d) => !d.healthy)) return "degraded";
  const primary = status.devices[0];
  if (status.active && status.active !== primary.device) return "failover";
  return "normal";
}

const STATE_META: Record<
  GatewayState,
  { label: string; hint: string; dot: string; box: string; text: string }
> = {
  normal: {
    label: "بوابة الواتساب طبيعية",
    hint: "الرقم الأساسي يرسل رموز التحقق",
    dot: "bg-green-500",
    box: "border-green-200 bg-green-50",
    text: "text-green-800",
  },
  failover: {
    label: "تحويل احتياطي مفعّل",
    hint: "الرقم الأساسي متعطّل على الأرجح (محظور) — رقم احتياطي يرسل الآن",
    dot: "bg-amber-500",
    box: "border-amber-300 bg-amber-50",
    text: "text-amber-900",
  },
  degraded: {
    label: "تعطّل في إرسال رموز التحقق",
    hint: "كل الأرقام المهيّأة متوقفة — الطلاب قد لا يستلمون رموزهم",
    dot: "bg-red-500",
    box: "border-red-300 bg-red-50",
    text: "text-red-900",
  },
  unconfigured: {
    label: "بوابة الواتساب غير مهيّأة",
    hint: "لا يوجد رقم إرسال مضبوط على الخادم",
    dot: "bg-ink/30",
    box: "border-ink/15 bg-ink/[0.03]",
    text: "text-ink-soft",
  },
};

export function OtpGatewayStatus() {
  const [status, setStatus] = useState<GatewayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setStatus(await getOtpGatewayStatus());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const state = status ? deriveState(status) : null;
  const meta = state ? STATE_META[state] : null;

  return (
    <section
      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition-colors ${
        meta ? meta.box : "border-line bg-surface"
      }`}
      aria-live="polite"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta ? meta.dot : "bg-ink/20"} ${
            loading ? "animate-pulse" : ""
          }`}
        />
        <div className="min-w-0">
          <p className={`truncate text-sm font-bold ${meta ? meta.text : "text-ink-soft"}`}>
            {loading && !status
              ? "جاري التحقق من بوابة الواتساب…"
              : error
                ? "تعذر تحميل حالة بوابة الواتساب"
                : meta?.label}
          </p>
          {meta && !loading && !error && (
            <p className={`mt-0.5 truncate text-xs opacity-80 ${meta.text}`}>{meta.hint}</p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => load()}
        disabled={loading}
        className="inline-flex h-9 shrink-0 items-center rounded-full border border-ink/15 bg-white/70 px-3.5 text-xs font-semibold text-ink-soft transition-colors hover:border-orange/40 hover:text-orange-ink disabled:opacity-50"
      >
        {loading ? "…" : "تحديث"}
      </button>
    </section>
  );
}
