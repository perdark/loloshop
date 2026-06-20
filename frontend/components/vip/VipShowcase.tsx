"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import {
  confirmPackage,
  getVipUpgradeContext,
  listPackages,
  listVipPackages,
  upgradeToVip,
} from "@/lib/packages";
import type { PackageTier, VipUpgradeContext } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";
import { VipShowcaseView } from "./VipShowcaseView";

/**
 * Data container for the VIP showcase: fetches the VIP package(s), the upgrade
 * context, and a best-effort standard-price anchor, then hands everything to the
 * presentational VipShowcaseView. All order/navigation side-effects live here.
 */
export function VipShowcase() {
  const router = useRouter();
  const [packages, setPackages] = useState<PackageTier[]>([]);
  const [standardPrice, setStandardPrice] = useState<number | undefined>(undefined);
  const [ctx, setCtx] = useState<VipUpgradeContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [list, context, retail] = await Promise.all([
        listVipPackages(),
        getVipUpgradeContext().catch(() => null),
        listPackages("retail").catch(() => [] as PackageTier[]),
      ]);
      setPackages(list);
      setCtx(context);
      const cheapestStandard = retail
        .filter((p) => !p.isVip)
        .sort((a, b) => a.price - b.price)[0];
      setStandardPrice(cheapestStandard?.price);
    } catch (e) {
      setLoadError(true);
      toast.error(getApiErrorMessage(e, "تعذّر تحميل باقات VIP"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hero = packages[0] ?? null;

  async function pick(pkg: PackageTier) {
    setBusyId(pkg.id);
    try {
      await confirmPackage({ packageId: pkg.id, capOptionId: "" });
      toast.success("تم اعتماد الباقة");
      router.push("/cart");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّر اعتماد الباقة"));
      setBusyId(null);
    }
  }

  async function upgrade() {
    if (!hero || !ctx?.locator) return;
    setUpgrading(true);
    try {
      const res = await upgradeToVip({ packageId: hero.id, ...ctx.locator });
      toast.success(`تمت الترقية إلى ${res.packageName}`);
      router.push("/cart");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّرت الترقية"));
    } finally {
      setUpgrading(false);
    }
  }

  if (loading) {
    return (
      <div className="animate-fade-page-in space-y-10 pb-24" aria-busy="true">
        <span className="sr-only">جارٍ تحميل باقات VIP…</span>
        <div className="skeleton h-80 w-full rounded-[var(--radius-card)]" />
        <div className="skeleton mx-auto h-8 w-1/2 rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="skeleton h-44 w-full rounded-[var(--radius-card)]" />
          <div className="skeleton h-44 w-full rounded-[var(--radius-card)]" />
          <div className="skeleton h-44 w-full rounded-[var(--radius-card)]" />
        </div>
      </div>
    );
  }

  if (loadError || !hero) {
    return (
      <div className="space-y-4 py-8">
        <BackLink />
        <EmptyState
          title={loadError ? "تعذّر التحميل" : "لا توجد باقات VIP بعد"}
          message={loadError ? "تحقق من الاتصال ثم حاول مجدداً." : "تابعنا قريباً — باقات VIP في الطريق."}
          action={
            loadError ? (
              <button
                type="button"
                onClick={load}
                className="inline-flex min-h-11 items-center rounded-pill border border-line bg-beige px-6 text-sm font-semibold text-ink hover:border-orange-ink/40 hover:text-orange-ink"
              >
                إعادة المحاولة
              </button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <VipShowcaseView
      packages={packages}
      standardPrice={standardPrice}
      onPick={pick}
      onStandard={() => router.push("/")}
      onUpgrade={upgrade}
      upgradeable={!!ctx?.upgradeable}
      busyId={busyId}
      upgrading={upgrading}
    />
  );
}

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-orange-ink transition-colors hover:text-ink"
    >
      <span aria-hidden>→</span>
      المتجر
    </Link>
  );
}
