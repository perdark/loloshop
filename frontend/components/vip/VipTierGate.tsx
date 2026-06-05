"use client";

import { useEffect, useRef, useState } from "react";
import { listVipPackages } from "@/lib/packages";
import type { PackageTier } from "@/lib/types";
import { VipCompare } from "./VipCompare";

/**
 * Designer pre-step: Standard vs VIP. Purely navigational — it never creates orders
 * itself (the retail design→cart flow stays untouched). Self-skips (resolves
 * "standard") when no VIP packages exist, so the normal 3-step flow is unchanged.
 * The parent owns persistence + navigation via onResolved.
 */
export function VipTierGate({
  standardPrice,
  onResolved,
}: {
  standardPrice?: number;
  onResolved: (choice: "standard" | "vip") => void;
}) {
  const [vip, setVip] = useState<PackageTier | null>(null);
  const [ready, setReady] = useState(false);
  const onResolvedRef = useRef(onResolved);
  const resolvedOnce = useRef(false);

  useEffect(() => {
    onResolvedRef.current = onResolved;
  });

  useEffect(() => {
    let alive = true;
    const skip = () => {
      if (resolvedOnce.current) return;
      resolvedOnce.current = true;
      onResolvedRef.current("standard");
    };
    listVipPackages()
      .then((list) => {
        if (!alive) return;
        if (!list.length) return skip();
        setVip(list[0]);
        setReady(true);
      })
      .catch(() => {
        if (alive) skip();
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!ready || !vip) return null;

  return (
    <div className="animate-step-in mx-auto max-w-2xl space-y-5">
      <div className="text-center">
        <h2 className="font-display-ar text-2xl font-bold text-ink">اختر تجربتك</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          ابدأ تصميمك مباشرةً، أو اكتشف إطلالة VIP الكاملة.
        </p>
      </div>
      <VipCompare
        vip={vip}
        standardPrice={standardPrice}
        onChoose={(choice) => onResolvedRef.current(choice)}
      />
    </div>
  );
}
