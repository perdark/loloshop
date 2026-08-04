"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import {
  clearSkipDashboardRedirect,
  dashboardPathFor,
  getUser,
  shouldSkipDashboardRedirect,
} from "@/lib/auth";
import { getShopFeed, getMaintenance, type MaintenanceConfig } from "@/lib/catalog";
import { SHOP_SECTION_TITLES, SHOP_TYPE_ORDER } from "@/lib/constants";
import { copyFor } from "@/lib/copy-ar";
import { firstName, getProfile, PROFILE_CHANGED_EVENT, type Gender } from "@/lib/profile";
import { featuredFirst } from "@/lib/shop-sort";
import type { ProductType, ShopFeed } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { FamilySlider } from "@/components/shop/FamilySlider";
import { WhyLoloShop } from "@/components/shop/WhyLoloShop";
import { VipPackageCard } from "@/components/shop/VipPackageCard";
import { CohortProof } from "@/components/shop/CohortProof";
import { StoreLocation } from "@/components/shop/StoreLocation";
import { MaintenanceScreen } from "@/components/MaintenanceScreen";

/**
 * The storefront home — direction D, built out.
 *
 * D's thesis is SPEED: no marketing hero, the goods start above the fold. Its one
 * weakness in the bake-off was that it never answered «ليش لولو شوب؟», and the fix
 * is a section in each GAP between the family rails — so the page earns its story
 * without ever pushing product down:
 *
 *   تحية → وعد → [أوشحة ⇄] → ليش لولو شوب → [روبات ⇄] → باقة VIP
 *        → [قبعات ⇄] → الدفعة (٥٥٤ خرّيج) → [شالات ⇄] → موقعنا
 */

function HomeSkeleton() {
  return (
    <div className="animate-fade-page-in space-y-8 py-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">جارٍ تحميل المتجر…</span>
      <div className="space-y-2">
        <div className="skeleton h-8 w-40 rounded-pill" />
        <div className="skeleton h-4 w-56 rounded-pill" />
      </div>
      <div className="skeleton h-14 w-full rounded-[12px]" />
      {[0, 1].map((row) => (
        <div key={row} className="space-y-3">
          <div className="skeleton h-7 w-32 rounded-pill" />
          <div className="flex gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="w-[60%] shrink-0 space-y-2.5">
                <div className="skeleton aspect-[3/4] w-full rounded-[10px]" />
                <div className="skeleton h-4 w-2/3 rounded-pill" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function StudentHomePage() {
  const router = useRouter();
  const [feed, setFeed] = useState<ShopFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Admin/staff on "/": redirect to their panel, unless they explicitly chose
  // «زيارة الموقع الرئيسي» — then show a return pill instead.
  const [redirecting, setRedirecting] = useState(false);
  const [panelHref, setPanelHref] = useState<string | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceConfig | null>(null);
  const [maintenanceLoading, setMaintenanceLoading] = useState(true);
  // The visitor profile drives the greeting and every gendered string.
  const [name, setName] = useState<string | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);

  const loadShop = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    getShopFeed()
      .then((feedData) => {
        // Wholesaler-students have no product grid — send them straight to the
        // طقم order form, not the shop.
        if (feedData.audience === "wholesaler_student") {
          router.replace("/my-order");
          return;
        }
        setFeed(feedData);
      })
      .catch((reason) => {
        const msg = getApiErrorMessage(
          reason,
          "تعذر تحميل المتجر — تحقق من الاتصال بالخادم"
        );
        setLoadError(msg);
        toast.error(msg);
      })
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    const role = getUser()?.role;
    const href = dashboardPathFor(role);
    if (href) {
      if (!shouldSkipDashboardRedirect()) {
        setRedirecting(true);
        router.replace(href);
        return;
      }
      setPanelHref(href);
    }
    // ⚠️ These two run CONCURRENTLY on purpose. `loadShop()` used to be chained
    // inside `getMaintenance().then()`, which made every visitor pay two SERIAL
    // round trips (~1s on mobile) before the grid could render — and, because
    // the grid introduces the product <img>s, before the browser could even
    // discover the images. That serial hop was the bulk of the 2113 ms LCP
    // "load delay" this page showed in CrUX field data.
    //
    // The maintenance flag decides whether the shop is DISPLAYED, not whether it
    // is worth FETCHING, so nothing depends on the order: the maintenance
    // early-return below still sits ahead of the `loading` gate.
    loadShop();
    getMaintenance()
      .then((m) => setMaintenance(m))
      .catch(() => setMaintenance({ active: false, message_ar: "الموقع قيد الصيانة" }))
      .finally(() => setMaintenanceLoading(false));
  }, [loadShop, router]);

  // Profile lives in localStorage (client-only) — read after mount, and re-read
  // when onboarding or «تفضيلاتي» changes it so the greeting updates in place.
  //
  // A signed-in student never sees onboarding (the DB owns their details), so
  // fall back to the account name — otherwise the one visitor the app definitely
  // knows would be the one greeted as a stranger. Gender has no column on
  // `users`, so it stays whatever the device says.
  useEffect(() => {
    const sync = () => {
      const p = getProfile();
      setName(firstName(p.name) ?? firstName(getUser()?.name ?? null));
      setGender(p.gender);
    };
    sync();
    window.addEventListener(PROFILE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(PROFILE_CHANGED_EVENT, sync);
  }, []);

  const copy = copyFor(gender);

  const families = useMemo(
    () =>
      SHOP_TYPE_ORDER.map((type) => ({
        type,
        title: SHOP_SECTION_TITLES[type],
        products: featuredFirst(feed?.byType[type] ?? []),
      })).filter((f) => f.products.length > 0),
    [feed]
  );

  if (redirecting || maintenanceLoading) return <HomeSkeleton />;

  // Maintenance mode — public visitors only; admins bypass.
  if (maintenance?.active && getUser()?.role !== "admin") {
    return <MaintenanceScreen message={maintenance.message_ar} />;
  }

  if (loading) return <HomeSkeleton />;

  // Admin/staff browsing the shop on purpose — floating pill back to their panel.
  // Portaled to <body>: <main> is transformed (animate-page-in), which would
  // otherwise hijack position:fixed and pin the pill to the page bottom.
  const returnPill = panelHref
    ? createPortal(
        <button
          type="button"
          onClick={() => {
            clearSkipDashboardRedirect();
            router.push(panelHref);
          }}
          className="fixed bottom-24 left-1/2 z-50 flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-pill bg-brand-gradient px-5 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-float)] transition-transform hover:scale-[1.03]"
        >
          <span aria-hidden>→</span>
          {panelHref === "/admin" ? "العودة للوحة التحكم" : "العودة لصفحة الموظف"}
        </button>,
        document.body
      )
    : null;

  if (!feed) {
    return (
      <div className="space-y-10">
        {returnPill}
        <div className="animate-step-in flex flex-col items-center gap-4 rounded-card border border-dashed border-orange/25 bg-beige/60 px-6 py-14 text-center">
          <span
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-full bg-orange/10 text-orange-ink"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
          </span>
          <p className="max-w-[34ch] text-sm font-medium text-ink-soft">{loadError}</p>
          <Button onClick={loadShop}>إعادة المحاولة</Button>
        </div>
      </div>
    );
  }

  // Whole catalog empty — the promise and the store details carry the page.
  if (families.length === 0) {
    return (
      <div className="animate-fade-page-in">
        {returnPill}
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-orange/25 px-6 py-14 text-center">
          <p className="font-script text-3xl leading-none text-orange-ink">lolo</p>
          <p className="max-w-[32ch] text-sm font-medium text-ink-soft">
            المتجر يجهّز لموسم التخرّج، تابعونا على إنستغرام @lolo_shop96
          </p>
        </div>
        <StoreLocation />
      </div>
    );
  }

  // The story sections that sit in the gaps between the rails, in order. Any rail
  // that has no products drops out above, and its gap-filler moves up with it —
  // so the page never shows two story blocks back to back with no goods between.
  const gapSections = [
    <WhyLoloShop key="why" copy={copy} />,
    <VipPackageCard key="vip" copy={copy} />,
  ];

  return (
    <div className="animate-fade-page-in">
      {returnPill}

      {/* الدفعة — bet C, and it opens the page (owner call, 2026-08-02): the first
          thing a student sees is a real cohort and a real number, because «هذا محل
          حقيقي لو حساب إنستغرام؟» is the question that has to be answered first. */}
      <CohortProof graduates={feed.graduates} atTop />

      {/* تحية — the payoff for asking the name. Without a name it is still a
          greeting, never an empty slot or a «أهلاً undefined». */}
      <section className="pt-7">
        <h1 className="font-display-ar text-[1.7rem] font-bold leading-[1.4] text-ink">
          {name ? `أهلاً ${name}` : "أهلاً بك"}
        </h1>
        <p className="mt-0.5 text-[13.5px] text-[var(--shop-muted)]">{copy.greetSub}</p>
      </section>

      {/* الوعد — D's single line of marketing, and it is all fear-answers. */}
      <p className="mt-4 flex items-center gap-2 rounded-[12px] bg-orange/10 px-4 py-3 text-[12.5px] font-bold leading-relaxed text-ink">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-[17px] w-[17px] shrink-0"
          fill="none"
          stroke="var(--color-orange-ink)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m20 6-11 11-5-5" />
        </svg>
        {copy.promise}
      </p>

      {families.map((family, i) => (
        <div key={family.type}>
          <FamilySlider
            type={family.type as ProductType}
            title={family.title}
            products={family.products}
            seeAllLabel={`كل ال${family.title}`}
          />
          {gapSections[i] ?? null}
        </div>
      ))}

      <StoreLocation />
    </div>
  );
}
