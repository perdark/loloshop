import type { CSSProperties } from "react";

/**
 * Couture graduation sash, rendered as crisp SVG so the VIP hero is NEVER an
 * empty placeholder when no product photo exists. A deep-emerald honor stole
 * with hand-gold embroidery: university lines + logo on the right panel, a
 * calligraphic name flourish on the left, and a gold seal where they meet.
 * Purely decorative (aria-hidden); the gold light sweep lives on the wrapper.
 */
export function VipSashArt({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="76 14 168 392"
      className={className}
      role="img"
      aria-label="وشاح تخرّج فاخر"
      style={{ filter: "drop-shadow(0 26px 42px rgba(0,0,0,0.55))" } as CSSProperties}
    >
      <defs>
        <linearGradient id="vipFabric" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1c4d3a" />
          <stop offset="0.5" stopColor="#123a2c" />
          <stop offset="1" stopColor="#0c2a20" />
        </linearGradient>
        <linearGradient id="vipGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7e6b6" />
          <stop offset="0.5" stopColor="#e7c178" />
          <stop offset="1" stopColor="#a9801f" />
        </linearGradient>
        <linearGradient id="vipFabricSheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* ── Left ribbon (student name) ── */}
      <g>
        <path
          d="M92 34 L146 48 L150 350 L136 384 L110 346 Z"
          fill="url(#vipFabric)"
          stroke="url(#vipGold)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path d="M92 34 L146 48 L150 350 L136 384 L110 346 Z" fill="url(#vipFabricSheen)" />
        {/* inner gold guard line */}
        <path
          d="M101 44 L141 54 L144 344"
          fill="none"
          stroke="url(#vipGold)"
          strokeWidth="0.9"
          strokeOpacity="0.55"
          strokeLinecap="round"
        />
        {/* calligraphic name flourish */}
        <path
          d="M108 168 C116 156 126 156 132 168 C126 178 118 178 114 170 C120 164 130 166 134 174"
          fill="none"
          stroke="url(#vipGold)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M104 184 L138 184" stroke="url(#vipGold)" strokeWidth="1.4" strokeOpacity="0.7" strokeLinecap="round" />
      </g>

      {/* ── Right ribbon (university + logo) ── */}
      <g>
        <path
          d="M228 34 L174 48 L170 350 L184 384 L210 346 Z"
          fill="url(#vipFabric)"
          stroke="url(#vipGold)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path d="M228 34 L174 48 L170 350 L184 384 L210 346 Z" fill="url(#vipFabricSheen)" />
        <path
          d="M219 44 L179 54 L176 344"
          fill="none"
          stroke="url(#vipGold)"
          strokeWidth="0.9"
          strokeOpacity="0.55"
          strokeLinecap="round"
        />
        {/* logo roundel */}
        <circle cx="197" cy="104" r="11" fill="none" stroke="url(#vipGold)" strokeWidth="2" />
        <circle cx="197" cy="104" r="4.5" fill="url(#vipGold)" />
        {/* embroidered university lines */}
        <rect x="171" y="134" width="44" height="5" rx="2.5" fill="url(#vipGold)" />
        <rect x="176" y="150" width="34" height="4.5" rx="2.25" fill="url(#vipGold)" fillOpacity="0.85" />
        <rect x="180" y="165" width="26" height="4" rx="2" fill="url(#vipGold)" fillOpacity="0.7" />
      </g>

      {/* ── Center seal where the ribbons meet ── */}
      <g>
        <circle cx="160" cy="66" r="19" fill="#0c2a20" stroke="url(#vipGold)" strokeWidth="2.5" />
        <circle cx="160" cy="66" r="13.5" fill="none" stroke="url(#vipGold)" strokeWidth="0.8" strokeOpacity="0.6" />
        {/* mortarboard cap glyph */}
        <path d="M160 56 L172 62 L160 68 L148 62 Z" fill="url(#vipGold)" />
        <path d="M153 65 L153 72 C153 75 167 75 167 72 L167 65" fill="none" stroke="url(#vipGold)" strokeWidth="1.6" />
        <path d="M172 62 L172 70" stroke="url(#vipGold)" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="172" cy="71" r="1.6" fill="url(#vipGold)" />
      </g>
    </svg>
  );
}
