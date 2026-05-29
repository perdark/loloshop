"use client";

import { useEffect, useState } from "react";
import { formatDateIQ } from "@/lib/format";

interface BatchCountdownProps {
  deadline: string;
}

function msUntil(iso: string): number {
  return new Date(iso).getTime() - Date.now();
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "انتهى الموعد";
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (36e5));
  if (days > 0) return `${days} يوم و ${hours} ساعة`;
  const mins = Math.floor((ms % 36e5) / 6e4);
  return `${hours} ساعة و ${mins} دقيقة`;
}

export function BatchCountdown({ deadline }: BatchCountdownProps) {
  const [remaining, setRemaining] = useState(() =>
    formatRemaining(msUntil(deadline))
  );

  useEffect(() => {
    const tick = () => setRemaining(formatRemaining(msUntil(deadline)));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [deadline]);

  return (
    <div className="bg-hero-rich relative overflow-hidden rounded-3xl p-6 text-center text-white shadow-[var(--shadow-float)] ring-1 ring-orange/10">
      <span
        aria-hidden
        className="pointer-events-none absolute -end-8 -top-8 h-32 w-32 rounded-full bg-orange-light/30 blur-3xl"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-10 -start-6 h-28 w-28 rounded-full bg-blush/40 blur-3xl"
      />
      <p className="relative inline-flex items-center gap-1.5 rounded-pill bg-white/15 px-3 py-1 text-xs font-bold tracking-wide backdrop-blur-sm">
        الموعد النهائي للدفعة
      </p>
      <p className="relative mt-3 font-display text-2xl font-bold tabular-nums">
        {formatDateIQ(deadline)}
      </p>
      <p className="relative mt-3 text-lg font-semibold tabular-nums text-white/90">
        {remaining}
      </p>
    </div>
  );
}
