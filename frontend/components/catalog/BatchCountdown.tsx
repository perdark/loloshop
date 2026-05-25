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
    <div className="rounded-2xl bg-brand-gradient p-5 text-center text-white shadow-sm">
      <p className="text-sm opacity-90">الموعد النهائي للدفعة</p>
      <p className="mt-1 font-display text-2xl font-bold">{formatDateIQ(deadline)}</p>
      <p className="mt-3 text-lg font-semibold">{remaining}</p>
    </div>
  );
}
