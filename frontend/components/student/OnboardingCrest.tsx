"use client";

import Image from "next/image";

// The brand lockup at the top of onboarding: the logo, then the shop's name in
// Arabic beneath it — the arrangement in the reference design the owner supplied.
//
// ⚠️ THE ARABIC NAME IS THE POINT, AND IT REPLACES THE LATIN WORDMARK.
// An earlier version put the script «lolo shop 96» here and it was cut: the logo
// image ALREADY has "lolo shop" drawn inside it, so that was the same name twice,
// inches apart, in the same alphabet. «لولو شوب» is different — it is the name in
// the language every user of this app actually reads, so it adds something the
// mark cannot. It also sidesteps the bidi trap that reversed the Latin wordmark to
// «96 lolo shop» (the RTL flex row put the first child on the right).
//
// No glow, no halo, no expanding rings. Those were on the version the owner called
// blurry — a drop-shadow on a logo reads as an artefact, not as craft. The mark is
// crisp and the ornament behind it (OnboardingBackdrop) does the decorating.

export function OnboardingCrest() {
  return (
    <div className="flex flex-col items-center">
      <Image
        src="/logo.png"
        alt="لولو شوب"
        width={280}
        height={280}
        loading="eager"
        fetchPriority="high"
        className="ob-rise h-[132px] w-[132px] object-contain"
      />
      <p className="ob-rise ob-d1 -mt-1 font-display-ar text-[2.1rem] font-bold leading-none text-[#F26B1D]">
        لولو شوب
      </p>
    </div>
  );
}
