"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { getVipUpgradeContext, listVipPackages, upgradeToVip } from "@/lib/packages";
import { formatIQD } from "@/lib/format";
import type { PackageTier, VipUpgradeContext } from "@/lib/types";
import { vipAccent } from "./vipAccent";
import { IconCrest, IconArrow } from "./VipIcons";

type Mode = "loading" | "upgrade" | "discover" | "hidden";

/** Leading crest chip — reused in both upgrade + discover branches. */
const SparkleIcon = (
  <span
    aria-hidden
    className="vip-float flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white shadow-[var(--shadow-card)]"
  >
    <IconCrest className="h-7 w-7" />
  </span>
);

function UpsellShell({ accent, children }: { accent: string; children: ReactNode }) {
  return (
    <div
      className="vip-border vip-sheen card-lift relative flex items-center gap-4 overflow-hidden rounded-[var(--radius-card)] bg-warm-veil p-5 shadow-[var(--shadow-card)]"
      style={{ "--vip-accent": accent } as CSSProperties}
    >
      {children}
    </div>
  );
}

/**
 * Cart upsell. Self-contained: probes the student's bundle + the VIP catalogue.
 *  • Has an upgradeable standard bundle → in-place "upgrade to VIP" (design kept).
 *  • Otherwise → "discover VIP" link to the showcase.
 *  • No VIP packages / already VIP → renders nothing.
 */
export function VipUpsellCard({ onUpgraded }: { onUpgraded?: () => void }) {
  const [mode, setMode] = useState<Mode>("loading");
  const [vip, setVip] = useState<PackageTier | null>(null);
  const [ctx, setCtx] = useState<VipUpgradeContext | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [list, context] = await Promise.all([
          listVipPackages(),
          getVipUpgradeContext().catch(() => null),
        ]);
        if (!alive) return;
        if (!list.length) return setMode("hidden");
        setVip(list[0]);
        setCtx(context);
        if (context?.reason === "already_vip") return setMode("hidden");
        setMode(context?.upgradeable && context.locator ? "upgrade" : "discover");
      } catch {
        if (alive) setMode("hidden");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function handleUpgrade() {
    if (!vip || !ctx?.locator) return;
    setBusy(true);
    try {
      const res = await upgradeToVip({ packageId: vip.id, ...ctx.locator });
      toast.success(`تمت الترقية إلى ${res.packageName}`);
      setMode("hidden");
      onUpgraded?.();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّرت الترقية"));
    } finally {
      setBusy(false);
    }
  }

  if (mode === "loading" || mode === "hidden" || !vip) return null;
  const a = vipAccent(vip.accent);

  if (mode === "upgrade") {
    return (
      <UpsellShell accent={a}>
        {SparkleIcon}
        <div className="min-w-0 flex-1">
          <p className="font-display-ar text-base font-bold text-ink">ارتقِ بطلبك إلى VIP</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            نُبقي تصميمك كما هو، ونرفع إطلالتك إلى {vip.nameAr}.
          </p>
          <p className="mt-1 text-xs text-[var(--shop-muted)]" dir="ltr">
            {formatIQD(vip.price)}
          </p>
        </div>
        <button
          type="button"
          onClick={handleUpgrade}
          disabled={busy}
          className="btn-shine inline-flex min-h-11 shrink-0 items-center justify-center rounded-pill bg-brand-gradient px-5 text-sm font-bold text-white shadow-[var(--shadow-card)] transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? "جارٍ…" : "ترقية"}
        </button>
      </UpsellShell>
    );
  }

  // discover
  return (
    <Link href="/vip" className="group block">
      <UpsellShell accent={a}>
        {SparkleIcon}
        <div className="min-w-0 flex-1">
          <p className="font-display-ar text-base font-bold text-ink">اكتشف باقة VIP</p>
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-ink-soft">
            {vip.description || "الإطلالة الأرقى ليوم تخرجك — خامات فاخرة وتطريز ذهبي."}
          </p>
        </div>
        <IconArrow className="h-5 w-5 shrink-0 text-orange-ink transition-transform duration-200 group-hover:-translate-x-0.5" />
      </UpsellShell>
    </Link>
  );
}
