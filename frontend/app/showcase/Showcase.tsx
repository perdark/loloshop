"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

const Scene3D = dynamic(() => import("./Scene3D"), {
  ssr: false,
  loading: () => <Loader />,
});

const LOGOS = Array.from({ length: 11 }, (_, i) => `/showcase/z${i + 1}.webp`);

function Loader() {
  return (
    <div className="fixed inset-0 grid place-items-center bg-cream">
      <div className="flex flex-col items-center gap-3">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-line border-t-orange" />
        <p className="text-sm tracking-[0.3em] text-orange-ink" style={{ fontFamily: "var(--font-display)" }}>
          LOLOSHOP
        </p>
      </div>
    </div>
  );
}

/* RTL scroll overlay — 4 beats scrolling with the 3D camera */
function Overlay({ nameRef, logoRef }: { nameRef: React.MutableRefObject<string>; logoRef: React.MutableRefObject<string> }) {
  return (
    <div dir="rtl" lang="ar" className="w-full text-ink [&_a]:pointer-events-auto">
      {/* 0 — hero */}
      <section className="relative flex h-screen flex-col items-center justify-end px-6 pb-[12vh] text-center">
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[68%]"
          style={{ background: "linear-gradient(to top, rgba(250,244,234,0.97) 30%, rgba(250,244,234,0.8) 55%, rgba(250,244,234,0) 100%)" }}
        />
        <p className="relative mb-3 text-xs tracking-[0.32em] text-orange-ink" style={{ fontFamily: "var(--font-display)" }}>
          LOLOSHOP · @lolo_shop96
        </p>
        <h1 className="relative text-4xl leading-tight sm:text-6xl" style={{ fontFamily: "var(--font-display-ar)" }}>
          تخرّجكِ يستاهل إطلالة كاملة
        </h1>
        <p className="relative mt-3 max-w-md text-base text-ink-soft sm:text-lg">
          روب · وشاح · قبّعة — باقة التخرّج المتكاملة.
        </p>
        <span className="relative mt-8 animate-bounce text-2xl text-muted">↓</span>
      </section>

      {/* 1 — sash tease */}
      <section className="flex h-screen flex-col items-end justify-center px-8 text-end sm:px-20">
        <span className="mb-4 rounded-pill border border-line bg-beige/80 px-5 py-2 text-sm font-medium text-orange-ink backdrop-blur-sm" style={{ fontFamily: "var(--font-display)" }}>
          ✦ سرّ الباقة
        </span>
        <h2 className="max-w-lg text-4xl leading-snug sm:text-6xl" style={{ fontFamily: "var(--font-display-ar)" }}>
          والوشاح…
          <br />
          <span className="text-orange-ink">تصمّمينه أنتِ</span>
        </h2>
        <p className="mt-4 max-w-sm text-base text-ink-soft sm:text-lg">
          اكتبي اسمكِ وشوفيه يظهر على الوشاح مباشرة ←
        </p>
        <input
          type="text"
          dir="rtl"
          defaultValue=""
          maxLength={14}
          placeholder="اكتبي اسمكِ هنا…"
          onChange={(e) => {
            nameRef.current = e.target.value;
          }}
          className="mt-5 w-full max-w-xs rounded-pill border-2 border-line bg-beige px-6 py-3.5 text-center text-lg text-ink shadow-soft outline-none transition focus:border-orange"
          style={{ fontFamily: "var(--font-display-ar)" }}
        />
        {/* college logo picker → shows on the left strap */}
        <p className="mt-5 text-sm text-muted">اختاري كليتكِ — يظهر شعارها على الوشاح</p>
        <div className="mt-3 flex max-w-xs gap-2 overflow-x-auto pb-2">
          {LOGOS.map((l, i) => (
            <button
              key={l}
              aria-label={`كلية ${i + 1}`}
              onClick={() => { logoRef.current = l; }}
              className="h-12 w-12 shrink-0 overflow-hidden rounded-full border-2 border-line bg-white shadow-soft transition hover:scale-110 hover:border-orange"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={l} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
        <a href="/design" className="mt-6 rounded-pill bg-orange px-8 py-3.5 text-base font-semibold text-white shadow-float transition hover:brightness-105">
          افتحي المصمّم الكامل ←
        </a>
      </section>

      {/* 2 — exploded: three pieces */}
      <section className="flex h-screen flex-col items-center justify-center px-6 text-center">
        <span className="mb-4 rounded-pill border border-line bg-beige px-5 py-2 text-sm font-medium text-orange-ink" style={{ fontFamily: "var(--font-display)" }}>
          ✦ الباقة
        </span>
        <h2 className="text-4xl leading-snug sm:text-6xl" style={{ fontFamily: "var(--font-display-ar)" }}>
          ثلاث قطع، باقة واحدة
        </h2>
        <p className="mt-3 max-w-md text-base text-ink-soft sm:text-lg">
          قبّعة · وشاح · روب — متناسقة، فاخرة، جاهزة ليومكِ.
        </p>
      </section>

      {/* 3 — final CTA */}
      <section className="flex h-screen flex-col items-center justify-center px-6 text-center">
        <h2 className="max-w-xl text-4xl leading-snug sm:text-6xl" style={{ fontFamily: "var(--font-display-ar)" }}>
          باقتكِ الكاملة بانتظارك
        </h2>
        <p className="mt-3 max-w-md text-base text-ink-soft sm:text-lg">
          روب ووشاح وقبّعة — بلمسة فاخرة، وبصمة تخصّكِ.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <a href="/design" className="rounded-pill bg-orange px-8 py-3.5 text-base font-semibold text-white shadow-float transition hover:brightness-105">
            اطلبي باقتك الآن
          </a>
          <a href="/design" className="rounded-pill border-2 border-orange px-8 py-3.5 text-base font-semibold text-orange-ink transition hover:bg-orange hover:text-white">
            صمّمي وشاحك
          </a>
        </div>
      </section>
    </div>
  );
}

/* Static fallback for reduced-motion / no-WebGL */
function Flat() {
  return (
    <main dir="rtl" lang="ar" className="min-h-screen bg-cream text-ink">
      <div className="mx-auto max-w-md px-6 py-10 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/showcase/model.webp" alt="باقة تخرّج لولو شوب" className="mx-auto w-full max-w-sm rounded-card shadow-card" />
        <h1 className="mt-6 text-4xl leading-tight" style={{ fontFamily: "var(--font-display-ar)" }}>
          تخرّجكِ يستاهل إطلالة كاملة
        </h1>
        <p className="mt-3 text-ink-soft">روب · وشاح · قبّعة — والوشاح تصمّمينه أنتِ.</p>
        <a href="/design" className="mt-6 inline-block rounded-pill bg-orange px-8 py-3.5 font-semibold text-white shadow-float">
          صمّمي باقتك
        </a>
      </div>
    </main>
  );
}

export default function Showcase() {
  const [mode, setMode] = useState<"load" | "3d" | "flat">("load");
  const nameRef = useRef("");
  const logoRef = useRef("");
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setMode(reduced ? "flat" : "3d");
  }, []);

  if (mode === "load") return <Loader />;
  if (mode === "flat") return <Flat />;
  return (
    <div className="fixed inset-0 bg-cream">
      <Scene3D nameRef={nameRef} logoRef={logoRef} overlay={<Overlay nameRef={nameRef} logoRef={logoRef} />} />
    </div>
  );
}
