"use client";

import { IRAQ_GOVS, IRAQ_VIEWBOX } from "@/lib/iraqGeo";

// Motivational "conquest" map on the REAL Iraq governorate boundaries.
// Diyala = home (always lit, fire). Baghdad = the headline target (pulses until
// won). Other governorates glow warm once any order arrives. Dim = not yet won.
export function IraqMap({
  gov,
  home = "diyala",
  target = "baghdad",
}: {
  gov: Record<string, number>;
  home?: string;
  target?: string;
}) {
  const total = IRAQ_GOVS.length;
  const reached = IRAQ_GOVS.filter((g) => g.key === home || (gov[g.key] || 0) > 0).length;
  const targetWon = (gov[target] || 0) > 0;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
      <div className="flex items-baseline gap-3">
        <span className="text-3xl">🔥</span>
        <h3 className="font-[Amiri] text-2xl font-bold text-[#5a3210] xl:text-3xl">
          أشعلنا {reached} من {total} محافظة
        </h3>
      </div>
      <p className="text-base text-[#9a6a3a] xl:text-lg">
        {targetWon ? "بغداد لنا — نحو كل العراق 🇮🇶" : "بانتظار بغداد… اشعل العراق كله"}
      </p>

      <div className="relative min-h-0 w-full max-w-[520px] flex-1">
        <svg
          viewBox={IRAQ_VIEWBOX}
          className="h-full w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <filter id="tvGovGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="0" stdDeviation="9" floodColor="#F47B42" floodOpacity="0.85" />
            </filter>
          </defs>

          {IRAQ_GOVS.map((g) => {
            const isHome = g.key === home;
            const isTarget = g.key === target && !targetWon;
            const won = isHome || (gov[g.key] || 0) > 0;
            const fill = isHome ? "#F47B42" : won ? "#FFB100" : isTarget ? "#FFF7EC" : "#ECDCC6";
            return (
              <path
                key={g.key}
                d={g.d}
                fill={fill}
                stroke={isTarget ? "#F47B42" : "#FFFFFF"}
                strokeWidth={isTarget ? 4 : 1.4}
                strokeLinejoin="round"
                filter={isHome ? "url(#tvGovGlow)" : undefined}
                className={isTarget ? "tv-pulse" : ""}
              />
            );
          })}

        </svg>
      </div>

      <div className="flex gap-4 text-sm text-[#9a6a3a]">
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-3 w-3 rounded-full bg-[#F47B42]" /> القاعدة (ديالى)
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-3 w-3 rounded-full bg-[#FFB100]" /> محافظة محرَّرة
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-3 w-3 rounded-full border-2 border-[#F47B42] bg-white" /> الهدف
        </span>
      </div>
    </div>
  );
}
