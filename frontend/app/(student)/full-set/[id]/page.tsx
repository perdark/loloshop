"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { isAuthenticated, loginHref } from "@/lib/auth";
import {
  getProductFull,
  listFullSetPackages,
  resolveCatalogMediaUrl,
} from "@/lib/catalog";
import { configureFullSet, uploadSashLogo } from "@/lib/orders";
import { formatIQD } from "@/lib/format";
import { resolveOptionPrice } from "@/lib/pricing";
import { partitionRobeSleeveGroups } from "@/lib/robeSleeve";
import { fetchMe } from "@/lib/auth-api";
import type { CatalogProduct, CatalogOptionGroup, CatalogOption } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ReceiptUpload } from "@/components/catalog/ReceiptUpload";
import { CustomerImageUpload } from "@/components/catalog/CustomerImageUpload";
import { RobeSleeveSection } from "@/components/catalog/RobeSleeveSection";
import type { FullSetPackage } from "@/lib/catalog";
import type {
  ConfigureFullSetPayload,
  FullSetSelectionPayload,
  FullSetSashZones,
  FullSetMeasurements,
  FullSetDelivery,
  ConfigureFullSetResult,
} from "@/lib/orders";

// Suppress unused-import warnings for re-exported types used only in JSX type positions
void resolveCatalogMediaUrl;

// ─── Constants ─────────────────────────────────────────────────────────────────

const GOVERNORATES = [
  "بغداد",
  "البصرة",
  "نينوى",
  "أربيل",
  "النجف",
  "كربلاء",
  "كركوك",
  "الأنبار",
  "ديالى",
  "السليمانية",
  "دهوك",
  "صلاح الدين",
  "بابل",
  "واسط",
  "ميسان",
  "ذي قار",
  "المثنى",
  "الديوانية",
];

const STEPS = [
  { id: 1, label: "الروب" },
  { id: 2, label: "القبعة" },
  { id: 3, label: "الوشاح" },
  { id: 4, label: "التوصيل" },
  { id: 5, label: "المراجعة" },
];

function normalizePhone(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[^\d]/g, "");
}

function isValidIraqiPhone(raw: string): boolean {
  const n = normalizePhone(raw);
  return /^07\d{9}$/.test(n);
}

const SS_KEY = "full_set_wizard_state";

// ─── Types ──────────────────────────────────────────────────────────────────────

type ProductSelectionValue = string | boolean;

interface WizardSelections {
  robe: Record<string, ProductSelectionValue>;
  cap: Record<string, ProductSelectionValue>;
  sash: Record<string, string>;
  customerTexts: Record<string, string>;
  customerImageUrls: Record<string, string>;
}

interface WizardState {
  selections: WizardSelections;
  measurements: FullSetMeasurements;
  sashZones: FullSetSashZones;
  delivery: FullSetDelivery;
  eventDate: string;
  notes: string;
}

function defaultState(): WizardState {
  return {
    selections: {
      robe: {},
      cap: {},
      sash: {},
      customerTexts: {},
      customerImageUrls: {},
    },
    measurements: { shoulder_cm: 0, chest_cm: 0, robe_length_cm: 0, sleeve_length_cm: 0, tailor_notes: "", receipt_image_url: "" },
    sashZones: { right_text: "", left_mode: "logo_year" },
    delivery: {
      customer_name: "",
      instagram_username: "",
      phone_primary: "",
      phone_secondary: "",
      governorate: "",
      area_details: "",
    },
    eventDate: "",
    notes: "",
  };
}

function loadFromSession(): WizardState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return defaultState();
    return JSON.parse(raw) as WizardState;
  } catch {
    return defaultState();
  }
}

function saveToSession(state: WizardState) {
  try {
    sessionStorage.setItem(SS_KEY, JSON.stringify(state));
  } catch {
    // storage may be blocked
  }
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

function WizardSkeleton() {
  return (
    <div className="animate-fade-page-in space-y-5 pb-28" aria-busy="true">
      <span className="sr-only">جارٍ تحميل الطقم…</span>
      <div className="skeleton h-2 w-full rounded-pill" />
      <div className="skeleton h-7 w-2/3 rounded-xl" />
      <div className="skeleton h-4 w-1/2 rounded-pill" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton h-24 w-full rounded-2xl" />
      ))}
      <div className="skeleton h-12 w-full rounded-pill" />
    </div>
  );
}

function StepBar({ current, total }: { current: number; total: number }) {
  const pct = Math.round((current / total) * 100);
  return (
    <div className="sticky top-0 z-20 -mx-4 bg-cream/95 px-4 py-3 backdrop-blur-sm md:-mx-6 md:px-6">
      <div className="mb-2.5 h-1 w-full overflow-hidden rounded-pill bg-line">
        <div
          className="h-full rounded-pill bg-orange transition-all duration-500"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={1}
          aria-valuemax={total}
        />
      </div>
      <div className="flex items-center justify-between">
        {STEPS.map((s) => (
          <div key={s.id} className="flex flex-col items-center gap-0.5">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                s.id === current
                  ? "bg-orange text-white shadow-[var(--shadow-soft)]"
                  : s.id < current
                  ? "bg-orange-ink/15 text-orange-ink"
                  : "bg-line text-muted"
              }`}
            >
              {s.id < current ? (
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                s.id
              )}
            </span>
            <span
              className={`text-[10px] font-medium ${
                s.id === current
                  ? "text-orange-ink"
                  : s.id < current
                  ? "text-ink-soft"
                  : "text-muted"
              }`}
            >
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BottomBar({
  step,
  total,
  basePrice,
  onBack,
  onNext,
  nextLabel,
  loading,
  nextDisabled,
  disabledReason,
}: {
  step: number;
  total: number;
  basePrice: number;
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
  loading?: boolean;
  nextDisabled?: boolean;
  disabledReason?: string;
}) {
  // basePrice used to avoid unused-variable TS error
  void basePrice;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-cream/95 px-4 py-3 shadow-[var(--shadow-float)] backdrop-blur-sm">
      <div className="mx-auto max-w-lg">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink-soft">المجموع التقديري</span>
          <span className="font-display-ar text-lg font-bold text-ink" dir="ltr">
            {formatIQD(total)}
          </span>
        </div>
        <p className="mb-2.5 text-center text-xs text-muted">
          السعر شامل التوصيل — الدفع كاش عند الاستلام
        </p>
        <div className="flex gap-2">
          {step > 1 && (
            <Button
              variant="ghost"
              size="lg"
              onClick={onBack}
              disabled={loading}
              className="flex-1"
            >
              السابق
            </Button>
          )}
          <Button
            size="lg"
            onClick={onNext}
            loading={loading}
            disabled={nextDisabled || loading}
            fullWidth={step === 1}
            className={step > 1 ? "flex-[2]" : ""}
            title={nextDisabled && disabledReason ? disabledReason : undefined}
          >
            {nextLabel}
          </Button>
        </div>
        {nextDisabled && disabledReason && (
          <p className="mt-1.5 text-center text-xs text-danger">{disabledReason}</p>
        )}
      </div>
    </div>
  );
}

function OptionChip({
  option,
  selected,
  onSelect,
}: {
  option: CatalogOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl border px-3 py-2 text-center text-xs font-semibold transition-all duration-200 active:scale-[0.97] ${
        selected
          ? "border-orange/50 bg-orange/8 text-ink shadow-[var(--shadow-soft)] ring-2 ring-orange/30"
          : "border-line bg-beige text-ink-soft hover:border-orange/30 hover:bg-[var(--shop-sink)]"
      }`}
    >
      {option.imageUrl && (
        <div className="relative h-10 w-10 overflow-hidden rounded-xl">
          <Image
            src={option.imageUrl}
            alt={option.labelAr}
            fill
            className="object-cover"
            sizes="40px"
            unoptimized
          />
        </div>
      )}
      <span className="leading-tight">{option.labelAr}</span>
      {option.priceDelta > 0 && (
        <span className="font-normal text-orange-ink" dir="ltr">
          +{formatIQD(option.priceDelta)}
        </span>
      )}
    </button>
  );
}

function OptionGroupSection({
  group,
  productType,
  selectionValue,
  customerText,
  customerImageUrl,
  onSelect,
  onToggle,
  onTextChange,
  onImageChange,
  errors,
  showErrors,
}: {
  group: CatalogOptionGroup;
  productType: "robe" | "cap" | "sash";
  selectionValue: ProductSelectionValue | undefined;
  customerText: string | undefined;
  customerImageUrl: string | undefined;
  onSelect: (optionId: string) => void;
  onToggle: (checked: boolean) => void;
  onTextChange: (optionId: string, text: string) => void;
  onImageChange: (optionId: string, url: string) => void;
  errors: Record<string, string>;
  showErrors: boolean;
}) {
  const activeOptions = group.options.filter((o) => o.active);
  const selectedOptionId =
    typeof selectionValue === "string" ? selectionValue : undefined;
  const selectedOpt = activeOptions.find((o) => o.id === selectedOptionId);
  const isCapEmbroideryGroup =
    productType === "cap" &&
    (group.nameAr === "القبعة من الجانب" || group.nameAr === "القبعة من الأعلى");
  const isRobeSleeveToggle =
    productType === "robe" &&
    group.inputType === "toggle" &&
    group.nameAr.startsWith("تطريز ردن الروب");

  if (group.lockedOptionId) {
    const lockedOpt = activeOptions.find((o) => o.id === group.lockedOptionId);
    return (
      <div className="rounded-2xl bg-[var(--shop-sink)] p-4 ring-1 ring-line">
        <p className="mb-1 text-xs font-semibold text-ink-soft">{group.nameAr}</p>
        <p className="text-sm font-medium text-ink">
          {lockedOpt?.labelAr ?? "—"}
          <span className="ms-2 rounded-full bg-orange/10 px-2 py-0.5 text-xs text-orange-ink">
            محدد مسبقاً
          </span>
        </p>
      </div>
    );
  }

  if (group.inputType === "toggle") {
    const opt = activeOptions[0];
    const checked = selectionValue === true;
    const optionId = opt?.id;
    return (
      <div className="space-y-3">
        <label
          className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-all ${
            checked
              ? "border-orange bg-orange/5 ring-1 ring-orange/20"
              : "border-line hover:border-orange/40"
          }`}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-5 w-5 accent-orange"
          />
          <span className="text-sm font-medium text-ink">
            {group.nameAr}
          </span>
          {opt && opt.priceDelta > 0 && (
            <span className="ms-auto text-xs font-semibold tabular-nums text-orange-ink" dir="ltr">
              +{formatIQD(resolveOptionPrice(opt, "retail"))}
            </span>
          )}
        </label>
        {checked && optionId && (
          <CustomerImageUpload
            group={group}
            optionId={optionId}
            value={customerImageUrl}
            onChange={(url) => onImageChange(optionId, url)}
            textValue={customerText}
            onTextChange={(text) => onTextChange(optionId, text)}
            allowOptionalImage={isRobeSleeveToggle}
            showErrors={showErrors}
          />
        )}
        {showErrors && errors[`text_${group.id}`] && (
          <p className="text-xs text-danger">{errors[`text_${group.id}`]}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          {group.nameAr}
          {group.required && <span className="ms-1 text-danger">*</span>}
        </p>
        {group.hintAr && <p className="text-xs text-muted">{group.hintAr}</p>}
      </div>
      {errors[group.id] && (
        <p className="text-xs text-danger">{errors[group.id]}</p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {activeOptions.map((opt) => (
          <OptionChip
            key={opt.id}
            option={opt}
            selected={selectedOptionId === opt.id}
            onSelect={() => onSelect(opt.id)}
          />
        ))}
      </div>
      {selectedOpt?.requiresCustomerText && selectedOptionId && (
        <CustomerImageUpload
          group={group}
          optionId={selectedOptionId}
          value={customerImageUrl}
          onChange={(url) => onImageChange(selectedOptionId, url)}
          textValue={customerText}
          onTextChange={(text) => onTextChange(selectedOptionId, text)}
          allowOptionalImage={isCapEmbroideryGroup}
          showErrors={showErrors}
        />
      )}
      {showErrors && errors[`text_${group.id}`] && !selectedOpt?.requiresCustomerText && (
        <p className="text-xs text-danger">{errors[`text_${group.id}`]}</p>
      )}
    </div>
  );
}

// ─── Main Wizard ────────────────────────────────────────────────────────────────

export default function FullSetWizardPage() {
  const { id: packageId } = useParams<{ id: string }>();
  const router = useRouter();

  const [pkg, setPkg] = useState<FullSetPackage | null>(null);
  const [robeProduct, setRobeProduct] = useState<CatalogProduct | null>(null);
  const [capProduct, setCapProduct] = useState<CatalogProduct | null>(null);
  const [sashProduct, setSashProduct] = useState<CatalogProduct | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(() => loadFromSession());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<ConfigureFullSetResult | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  // Browsing the configurator is open to everyone — guests can explore the whole
  // طقم wizard. The account gate fires only when they confirm the order (see
  // handleSubmit), mirroring the product page's add-to-cart flow.
  const loadData = useCallback(async () => {
    setDataLoading(true);
    setLoadError(null);
    try {
      const packages = await listFullSetPackages();
      const foundPkg = packages.find((p) => p.id === packageId);
      if (!foundPkg) {
        setLoadError("لم يتم العثور على هذا الطقم.");
        setDataLoading(false);
        return;
      }
      setPkg(foundPkg);

      const { getShopFeed } = await import("@/lib/catalog");
      const feed = await getShopFeed();

      // The package's admin-chosen composition wins; fall back to first-by-type.
      const pinned: Record<string, string> = {};
      for (const p of foundPkg.products ?? []) pinned[p.type] = p.id;
      const robeId = pinned.robe ?? feed.byType?.robe?.[0]?.id;
      const capId = pinned.cap ?? feed.byType?.cap?.[0]?.id;
      const sashId = pinned.sash ?? feed.byType?.sash?.[0]?.id;

      const [robe, cap, sash] = await Promise.all([
        robeId ? getProductFull(robeId) : null,
        capId ? getProductFull(capId) : null,
        sashId ? getProductFull(sashId) : null,
      ]);

      setRobeProduct(robe);
      setCapProduct(cap);
      setSashProduct(sash);

      // Prefill delivery from the account — logged-in shoppers only (a guest has
      // no /auth/me, and calling it would trip the 401 auto-logout interceptor).
      if (isAuthenticated()) {
        try {
          const me = await fetchMe();
          const meAny = me as unknown as Record<string, unknown>;
          const student = meAny.student as Record<string, unknown> | undefined;
          setState((prev) => {
            const updated: WizardState = {
              ...prev,
              delivery: {
                ...prev.delivery,
                customer_name: prev.delivery.customer_name || String(me.name || ""),
                instagram_username:
                  prev.delivery.instagram_username ||
                  String(student?.instagram_username || ""),
                phone_primary: prev.delivery.phone_primary || String(me.phone || ""),
              },
            };
            saveToSession(updated);
            return updated;
          });
        } catch {
          // /auth/me failure is non-fatal
        }
      }
    } catch (e) {
      setLoadError(getApiErrorMessage(e, "تعذر تحميل بيانات الطقم"));
    } finally {
      setDataLoading(false);
    }
  }, [packageId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    saveToSession(state);
  }, [state]);

  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  // ─── Running total ──────────────────────────────────────────────────────────

  const runningTotal = (() => {
    if (!pkg) return 0;
    let total = pkg.price;
    if (robeProduct) {
      for (const group of robeProduct.optionGroups) {
        const sel = state.selections.robe[group.id];
        if (group.inputType === "toggle" && sel === true) {
          const opt = group.options.find((o) => o.active) ?? group.options[0];
          if (opt) total += opt.priceDelta;
        } else if (typeof sel === "string" && sel) {
          const opt = group.options.find((o) => o.id === sel);
          if (opt) total += opt.priceDelta;
        }
      }
    }
    if (capProduct) {
      for (const group of capProduct.optionGroups) {
        const sel = state.selections.cap[group.id];
        if (typeof sel === "string" && sel) {
          const opt = group.options.find((o) => o.id === sel);
          if (opt) total += opt.priceDelta;
        }
      }
    }
    if (sashProduct) {
      for (const group of sashProduct.optionGroups) {
        const sel = state.selections.sash[group.id];
        if (sel) {
          const opt = group.options.find((o) => o.id === sel);
          if (opt) total += opt.priceDelta;
        }
      }
    }
    return total;
  })();

  // ─── Selection helpers ──────────────────────────────────────────────────────

  function setSelection(
    type: "robe" | "cap" | "sash",
    groupId: string,
    optionId: string
  ) {
    setState((prev) => ({
      ...prev,
      selections: {
        ...prev.selections,
        [type]: { ...prev.selections[type], [groupId]: optionId },
      },
    }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
  }

  function setToggle(
    type: "robe" | "cap",
    groupId: string,
    checked: boolean
  ) {
    setState((prev) => {
      const nextTexts = { ...prev.selections.customerTexts };
      const nextImages = { ...prev.selections.customerImageUrls };
      if (!checked) {
        for (const k of Object.keys(nextTexts)) {
          if (k.startsWith(`${groupId}__`)) delete nextTexts[k];
        }
        for (const k of Object.keys(nextImages)) {
          if (k.startsWith(`${groupId}__`)) delete nextImages[k];
        }
      }
      return {
        ...prev,
        selections: {
          ...prev.selections,
          [type]: { ...prev.selections[type], [groupId]: checked },
          customerTexts: nextTexts,
          customerImageUrls: nextImages,
        },
      };
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next[groupId];
      delete next[`text_${groupId}`];
      return next;
    });
  }

  function setCustomerText(groupId: string, optionId: string, text: string) {
    const key = `${groupId}__${optionId}`;
    setState((prev) => ({
      ...prev,
      selections: {
        ...prev.selections,
        customerTexts: { ...prev.selections.customerTexts, [key]: text },
      },
    }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[`text_${groupId}`];
      return next;
    });
  }

  function setCustomerImage(groupId: string, optionId: string, url: string) {
    const key = `${groupId}__${optionId}`;
    setState((prev) => ({
      ...prev,
      selections: {
        ...prev.selections,
        customerImageUrls: { ...prev.selections.customerImageUrls, [key]: url },
      },
    }));
  }

  // ─── Validation ─────────────────────────────────────────────────────────────

  function validateStep(s: number): Record<string, string> {
    const errs: Record<string, string> = {};

    if (s === 1 && robeProduct) {
      for (const group of robeProduct.optionGroups) {
        if (group.lockedOptionId) continue;
        const sel = state.selections.robe[group.id];
        if (group.inputType === "toggle") {
          if (sel === true) {
            const opt = group.options.find((o) => o.active) ?? group.options[0];
            if (opt?.requiresCustomerText) {
              const key = `${group.id}__${opt.id}`;
              if (!state.selections.customerTexts[key]?.trim()) {
                errs[`text_${group.id}`] = "يرجى إدخال نص التطريز";
              }
            }
          }
          continue;
        }
        if (group.required && !sel) {
          errs[group.id] = `يرجى اختيار ${group.nameAr}`;
        }
        if (typeof sel === "string") {
          const opt = group.options.find((o) => o.id === sel);
          if (opt?.requiresCustomerText) {
            const key = `${group.id}__${sel}`;
            if (!state.selections.customerTexts[key]?.trim()) {
              errs[`text_${group.id}`] = "يرجى إدخال نص التطريز";
            }
          }
        }
      }
      const { shoulder_cm, chest_cm, robe_length_cm, sleeve_length_cm } = state.measurements;
      if (!shoulder_cm || shoulder_cm < 25 || shoulder_cm > 80)
        errs.shoulder_cm = "عرض الكتف يجب أن يكون بين ٢٥–٨٠ سم";
      if (chest_cm && (chest_cm < 60 || chest_cm > 180))
        errs.chest_cm = "محيط الصدر يجب أن يكون بين ٦٠–١٨٠ سم";
      if (!robe_length_cm || robe_length_cm < 70 || robe_length_cm > 190)
        errs.robe_length_cm = "طول الروب يجب أن يكون بين ٧٠–١٩٠ سم";
      if (!sleeve_length_cm || sleeve_length_cm < 30 || sleeve_length_cm > 100)
        errs.sleeve_length_cm = "طول الردن يجب أن يكون بين ٣٠–١٠٠ سم";
    }

    if (s === 2 && capProduct) {
      for (const group of capProduct.optionGroups) {
        if (group.lockedOptionId) continue;
        if (group.required && !state.selections.cap[group.id]) {
          errs[group.id] = `يرجى اختيار ${group.nameAr}`;
        }
        const sel = state.selections.cap[group.id];
        if (typeof sel === "string") {
          const opt = group.options.find((o) => o.id === sel);
          if (opt?.requiresCustomerText) {
            const key = `${group.id}__${sel}`;
            if (!state.selections.customerTexts[key]?.trim()) {
              errs[`text_${group.id}`] = "يرجى إدخال نص التطريز";
            }
          }
        }
      }
    }

    if (s === 3) {
      if (sashProduct) {
        for (const group of sashProduct.optionGroups) {
          if (group.lockedOptionId) continue;
          if (group.required && !state.selections.sash[group.id]) {
            errs[group.id] = `يرجى اختيار ${group.nameAr}`;
          }
          const sel = state.selections.sash[group.id];
          const opt = group.options.find((o) => o.id === sel);
          if (opt?.requiresCustomerText) {
            const key = `${group.id}__${sel}`;
            if (!state.selections.customerTexts[key]?.trim()) {
              errs[`text_${group.id}`] = "يرجى إدخال نص التطريز";
            }
          }
        }
      }
      if (!state.sashZones.right_text?.trim())
        errs.right_text = "يرجى إدخال اسم الخريج (الجهة اليمنى)";
      if (
        state.sashZones.left_mode === "logo_year" &&
        !state.sashZones.left_logo_url &&
        !logoFile
      )
        errs.left_logo = "يرجى رفع شعار الكلية";
      if (
        state.sashZones.left_mode === "text" &&
        !state.sashZones.left_text?.trim()
      )
        errs.left_text = "يرجى إدخال نص الجهة اليسرى";
    }

    if (s === 4) {
      if (!state.delivery.customer_name?.trim())
        errs.customer_name = "يرجى إدخال الاسم الكامل";
      if (!state.delivery.phone_primary?.trim())
        errs.phone_primary = "يرجى إدخال رقم الهاتف";
      else if (!isValidIraqiPhone(state.delivery.phone_primary))
        errs.phone_primary = "رقم الهاتف يجب أن يبدأ بـ 07 ويتكون من ١١ رقم";
      if (
        state.delivery.phone_secondary?.trim() &&
        !isValidIraqiPhone(state.delivery.phone_secondary)
      )
        errs.phone_secondary = "رقم الهاتف الثاني غير صحيح";
      if (!state.delivery.governorate)
        errs.governorate = "يرجى اختيار المحافظة";
      if (state.eventDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (new Date(state.eventDate) < today)
          errs.event_date = "تاريخ التخرج لا يمكن أن يكون في الماضي";
      }
    }

    return errs;
  }

  // ─── Navigation ──────────────────────────────────────────────────────────────

  function handleNext() {
    const errs = validateStep(step);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      const firstKey = Object.keys(errs)[0];
      const el = document.getElementById(`field_${firstKey}`);
      if (el) el.focus();
      return;
    }
    setErrors({});
    if (step < 5) setStep(step + 1);
    else handleSubmit();
  }

  function handleBack() {
    setErrors({});
    if (step > 1) setStep(step - 1);
  }

  // ─── Logo upload ──────────────────────────────────────────────────────────────

  async function handleLogoUpload(file: File) {
    setLogoFile(file);
    setLogoUploading(true);
    try {
      const url = await uploadSashLogo(file);
      setState((prev) => ({
        ...prev,
        sashZones: { ...prev.sashZones, left_logo_url: url },
      }));
      setErrors((prev) => {
        const n = { ...prev };
        delete n.left_logo;
        return n;
      });
      toast.success("تم رفع الشعار");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر رفع الشعار"));
    } finally {
      setLogoUploading(false);
    }
  }

  // ─── Build payload ────────────────────────────────────────────────────────────

  function buildSelectionsForProduct(
    product: CatalogProduct | null,
    typeKey: "robe" | "cap" | "sash"
  ): FullSetSelectionPayload[] {
    if (!product) return [];
    const out: FullSetSelectionPayload[] = [];
    for (const group of product.optionGroups) {
      if (group.lockedOptionId) {
        out.push({ group_id: group.id, option_id: group.lockedOptionId });
        continue;
      }
      const sel = state.selections[typeKey][group.id];
      let optionId: string | null = null;
      if (group.inputType === "single_select" && typeof sel === "string") {
        optionId = sel;
      } else if (group.inputType === "toggle" && sel === true) {
        optionId =
          group.options.find((o) => o.active)?.id ?? group.options[0]?.id ?? null;
      }
      if (!optionId) continue;
      const key = `${group.id}__${optionId}`;
      const row: FullSetSelectionPayload = { group_id: group.id, option_id: optionId };
      if (state.selections.customerTexts[key])
        row.customer_text = state.selections.customerTexts[key];
      if (state.selections.customerImageUrls[key])
        row.customer_image_url = state.selections.customerImageUrls[key];
      out.push(row);
    }
    return out;
  }

  async function handleSubmit() {
    // Account gate at the finish line — guests configure freely, then sign in to
    // confirm and come straight back to this طقم.
    if (!isAuthenticated()) {
      toast("سجّل دخولك كطالب لتأكيد الطلب");
      router.push(loginHref(`/full-set/${packageId}`));
      return;
    }
    setSubmitting(true);
    try {
      const payload: ConfigureFullSetPayload = {
        package_id: packageId,
        robe: {
          selections: buildSelectionsForProduct(robeProduct, "robe"),
          measurements: state.measurements,
        },
        cap: { selections: buildSelectionsForProduct(capProduct, "cap") },
        sash: {
          selections: buildSelectionsForProduct(sashProduct, "sash"),
          zones: state.sashZones,
        },
        delivery: {
          customer_name: state.delivery.customer_name.trim(),
          instagram_username:
            state.delivery.instagram_username?.trim() || undefined,
          phone_primary: normalizePhone(state.delivery.phone_primary),
          phone_secondary: state.delivery.phone_secondary?.trim()
            ? normalizePhone(state.delivery.phone_secondary)
            : undefined,
          governorate: state.delivery.governorate,
          area_details: state.delivery.area_details?.trim() || undefined,
        },
      };
      if (state.eventDate) payload.event_date = state.eventDate;
      if (state.notes?.trim()) payload.notes = state.notes.trim();

      const res = await configureFullSet(payload);
      setResult(res);
      setSubmitted(true);
      sessionStorage.removeItem(SS_KEY);
    } catch (e) {
      const msg = getApiErrorMessage(e, "تعذر إرسال الطلب — حاول مجدداً");
      toast.error(msg);
      setErrors({ submit: msg });
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Render guards ────────────────────────────────────────────────────────────

  if (dataLoading) return <WizardSkeleton />;

  if (loadError) {
    return (
      <div className="space-y-4 py-8">
        <BackLink />
        <div className="flex flex-col items-center gap-4 rounded-card border border-dashed border-orange/25 bg-beige px-6 py-14 text-center">
          <p className="max-w-[32ch] text-sm font-medium text-ink-soft">{loadError}</p>
          <Button onClick={loadData}>إعادة المحاولة</Button>
        </div>
      </div>
    );
  }

  if (submitted && result) {
    return <SuccessScreen result={result} />;
  }

  const _disabledReason = (() => {
    const errs = validateStep(step);
    if (Object.keys(errs).length === 0) return undefined;
    return Object.values(errs)[0];
  })();

  return (
    <div className="space-y-0 pb-36" ref={topRef}>
      <BackLink />

      {pkg && (
        <div className="mb-4 mt-2">
          <h1 className="font-display-ar text-2xl font-bold leading-tight text-ink">
            طقم التخرج الكامل
          </h1>
          <p className="mt-1 text-sm text-ink-soft">{pkg.nameAr}</p>
          {pkg.description && (
            <p className="mt-1 text-xs text-muted">{pkg.description}</p>
          )}
        </div>
      )}

      <StepBar current={step} total={STEPS.length} />

      <div className="mt-6 space-y-6">
        {step === 1 && (
          <StepRobe
            product={robeProduct}
            selections={state.selections.robe}
            customerTexts={state.selections.customerTexts}
            customerImageUrls={state.selections.customerImageUrls}
            measurements={state.measurements}
            errors={errors}
            showErrors={Object.keys(errors).length > 0}
            onSelect={(gId, oId) => setSelection("robe", gId, oId)}
            onToggle={(gId, checked) => setToggle("robe", gId, checked)}
            onTextChange={(gId, oId, t) => setCustomerText(gId, oId, t)}
            onImageChange={(gId, oId, url) => setCustomerImage(gId, oId, url)}
            onMeasureChange={(field, val) =>
              setState((prev) => ({
                ...prev,
                measurements: { ...prev.measurements, [field]: val },
              }))
            }
            onNotesChange={(val) =>
              setState((prev) => ({
                ...prev,
                measurements: { ...prev.measurements, tailor_notes: val },
              }))
            }
            onReceiptChange={(url) =>
              setState((prev) => ({
                ...prev,
                measurements: { ...prev.measurements, receipt_image_url: url },
              }))
            }
            onErrorClear={(key) =>
              setErrors((prev) => {
                const n = { ...prev };
                delete n[key];
                return n;
              })
            }
          />
        )}

        {step === 2 && (
          <StepCap
            product={capProduct}
            selections={state.selections.cap}
            customerTexts={state.selections.customerTexts}
            customerImageUrls={state.selections.customerImageUrls}
            errors={errors}
            showErrors={Object.keys(errors).length > 0}
            onSelect={(gId, oId) => setSelection("cap", gId, oId)}
            onTextChange={(gId, oId, t) => setCustomerText(gId, oId, t)}
            onImageChange={(gId, oId, url) => setCustomerImage(gId, oId, url)}
          />
        )}

        {step === 3 && (
          <StepSash
            product={sashProduct}
            selections={state.selections.sash}
            customerTexts={state.selections.customerTexts}
            sashZones={state.sashZones}
            errors={errors}
            logoFile={logoFile}
            logoUploading={logoUploading}
            onSelect={(gId, oId) => setSelection("sash", gId, oId)}
            onTextChange={(gId, oId, t) => setCustomerText(gId, oId, t)}
            onZoneChange={(field, val) =>
              setState((prev) => ({
                ...prev,
                sashZones: { ...prev.sashZones, [field]: val },
              }))
            }
            onLogoUpload={handleLogoUpload}
            onErrorClear={(key) =>
              setErrors((prev) => {
                const n = { ...prev };
                delete n[key];
                return n;
              })
            }
          />
        )}

        {step === 4 && (
          <StepDelivery
            delivery={state.delivery}
            eventDate={state.eventDate}
            notes={state.notes}
            errors={errors}
            onDeliveryChange={(field, val) =>
              setState((prev) => ({
                ...prev,
                delivery: { ...prev.delivery, [field]: val },
              }))
            }
            onEventDateChange={(v) => setState((prev) => ({ ...prev, eventDate: v }))}
            onNotesChange={(v) => setState((prev) => ({ ...prev, notes: v }))}
            onErrorClear={(key) =>
              setErrors((prev) => {
                const n = { ...prev };
                delete n[key];
                return n;
              })
            }
          />
        )}

        {step === 5 && (
          <StepReview
            state={state}
            pkg={pkg}
            robeProduct={robeProduct}
            capProduct={capProduct}
            sashProduct={sashProduct}
            runningTotal={runningTotal}
            submitError={errors.submit}
          />
        )}
      </div>

      <BottomBar
        step={step}
        total={runningTotal}
        basePrice={pkg?.price ?? 0}
        onBack={handleBack}
        onNext={handleNext}
        nextLabel={step === 5 ? "تأكيد الطلب" : "التالي"}
        loading={submitting || logoUploading}
        nextDisabled={step === 5 ? submitting : false}
        disabledReason={step === 5 ? errors.submit : undefined}
      />
    </div>
  );
}

// ─── Step 1: Robe ───────────────────────────────────────────────────────────────

function StepRobe({
  product,
  selections,
  customerTexts,
  customerImageUrls,
  measurements,
  errors,
  showErrors,
  onSelect,
  onToggle,
  onTextChange,
  onImageChange,
  onMeasureChange,
  onNotesChange,
  onReceiptChange,
  onErrorClear,
}: {
  product: CatalogProduct | null;
  selections: Record<string, ProductSelectionValue>;
  customerTexts: Record<string, string>;
  customerImageUrls: Record<string, string>;
  measurements: FullSetMeasurements;
  errors: Record<string, string>;
  showErrors: boolean;
  onSelect: (groupId: string, optionId: string) => void;
  onToggle: (groupId: string, checked: boolean) => void;
  onTextChange: (groupId: string, optionId: string, text: string) => void;
  onImageChange: (groupId: string, optionId: string, url: string) => void;
  onMeasureChange: (field: keyof FullSetMeasurements, value: number) => void;
  onNotesChange: (value: string) => void;
  onReceiptChange: (url: string) => void;
  onErrorClear: (key: string) => void;
}) {
  function optionIdForGroup(group: CatalogOptionGroup): string | undefined {
    const sel = selections[group.id];
    if (group.inputType === "toggle" && sel === true) {
      return group.options.find((o) => o.active)?.id ?? group.options[0]?.id;
    }
    return typeof sel === "string" ? sel : undefined;
  }

  return (
    <div className="space-y-6">
      <StepHeader step={1} title="الروب" subtitle="اختر مواصفات روب التخرج ومقاساتك" />

      {product ? (
        <div className="space-y-5">
          {(() => {
            const { sleeveGroups, otherGroups } = partitionRobeSleeveGroups(
              product.optionGroups
            );
            return (
              <>
                {otherGroups.map((group) => {
                  const optionId = optionIdForGroup(group);
                  return (
                    <div
                      key={group.id}
                      className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-soft)] ring-1 ring-line"
                    >
                      <OptionGroupSection
                        group={group}
                        productType="robe"
                        selectionValue={selections[group.id]}
                        customerText={
                          optionId
                            ? customerTexts[`${group.id}__${optionId}`]
                            : undefined
                        }
                        customerImageUrl={
                          optionId
                            ? customerImageUrls[`${group.id}__${optionId}`]
                            : undefined
                        }
                        onSelect={(oId) => onSelect(group.id, oId)}
                        onToggle={(checked) => onToggle(group.id, checked)}
                        onTextChange={(oId, text) =>
                          onTextChange(group.id, oId, text)
                        }
                        onImageChange={(oId, url) =>
                          onImageChange(group.id, oId, url)
                        }
                        errors={errors}
                        showErrors={showErrors}
                      />
                    </div>
                  );
                })}
                {sleeveGroups.length > 0 && (
                  <RobeSleeveSection
                    groups={sleeveGroups}
                    role="retail"
                    selection={selections}
                    customerTexts={customerTexts}
                    customerImages={customerImageUrls}
                    onToggle={onToggle}
                    onTextChange={onTextChange}
                    onImageChange={onImageChange}
                    fieldKey={(groupId, optionId) =>
                      `${groupId}__${optionId}`
                    }
                    showErrors={showErrors}
                    errors={errors}
                  />
                )}
              </>
            );
          })()}
        </div>
      ) : (
        <p className="text-sm text-muted">لا توجد خيارات متاحة للروب</p>
      )}

      <div className="rounded-2xl bg-surface p-5 shadow-[var(--shadow-soft)] ring-1 ring-line">
        <p className="mb-4 font-display-ar text-base font-bold text-ink">
          قياسات الروب (سم)
        </p>
        <div className="space-y-4">
          <MeasurementInput
            id="field_shoulder_cm"
            label="عرض الكتف"
            hint="قس من طرف الكتف الأيمن إلى الأيسر"
            value={measurements.shoulder_cm}
            min={25}
            max={80}
            error={errors.shoulder_cm}
            onChange={(v) => {
              onMeasureChange("shoulder_cm", v);
              onErrorClear("shoulder_cm");
            }}
          />
          <MeasurementInput
            id="field_chest_cm"
            label="محيط الصدر (اختياري)"
            hint="قس حول أعرض جزء من الصدر"
            value={measurements.chest_cm ?? 0}
            min={60}
            max={180}
            error={errors.chest_cm}
            onChange={(v) => {
              onMeasureChange("chest_cm", v);
              onErrorClear("chest_cm");
            }}
          />
          <MeasurementInput
            id="field_robe_length_cm"
            label="طول الروب"
            hint="من أعلى الكتف حتى الأرض"
            value={measurements.robe_length_cm}
            min={70}
            max={190}
            error={errors.robe_length_cm}
            onChange={(v) => {
              onMeasureChange("robe_length_cm", v);
              onErrorClear("robe_length_cm");
            }}
          />
          <MeasurementInput
            id="field_sleeve_length_cm"
            label="طول الكُم (الردن)"
            hint="من منتصف الكتف حتى الرسغ"
            value={measurements.sleeve_length_cm}
            min={30}
            max={100}
            error={errors.sleeve_length_cm}
            onChange={(v) => {
              onMeasureChange("sleeve_length_cm", v);
              onErrorClear("sleeve_length_cm");
            }}
          />
          {/* ملاحظات لفصال الروب — optional tailoring note (rides measurements.tailor_notes) */}
          <div>
            <label
              htmlFor="field_tailor_notes"
              className="block text-sm font-semibold text-ink"
            >
              ملاحظات لفصال الروب
              <span className="ms-1 text-xs font-normal text-muted">(اختياري)</span>
            </label>
            <textarea
              id="field_tailor_notes"
              dir="rtl"
              rows={3}
              maxLength={500}
              placeholder="أي تفاصيل إضافية عن الفصال…"
              value={measurements.tailor_notes ?? ""}
              onChange={(e) => onNotesChange(e.target.value)}
              className="mt-1.5 w-full resize-none rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink/30 outline-none transition-colors focus:border-orange focus:ring-2 focus:ring-orange/30"
            />
          </div>
        </div>
        {/* صورة الوصل — optional receipt photo (rides measurements.receipt_image_url) */}
        <ReceiptUpload value={measurements.receipt_image_url} onChange={onReceiptChange} />
      </div>
    </div>
  );
}

// ─── Step 2: Cap ────────────────────────────────────────────────────────────────

function StepCap({
  product,
  selections,
  customerTexts,
  customerImageUrls,
  errors,
  showErrors,
  onSelect,
  onTextChange,
  onImageChange,
}: {
  product: CatalogProduct | null;
  selections: Record<string, ProductSelectionValue>;
  customerTexts: Record<string, string>;
  customerImageUrls: Record<string, string>;
  errors: Record<string, string>;
  showErrors: boolean;
  onSelect: (groupId: string, optionId: string) => void;
  onTextChange: (groupId: string, optionId: string, text: string) => void;
  onImageChange: (groupId: string, optionId: string, url: string) => void;
}) {
  return (
    <div className="space-y-6">
      <StepHeader step={2} title="القبعة" subtitle="اختر نوع ومواصفات قبعة التخرج" />

      {product ? (
        <div className="space-y-5">
          {product.optionGroups.map((group) => {
            const sel = selections[group.id];
            const optionId = typeof sel === "string" ? sel : undefined;
            return (
              <div
                key={group.id}
                className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-soft)] ring-1 ring-line"
              >
                <OptionGroupSection
                  group={group}
                  productType="cap"
                  selectionValue={sel}
                  customerText={
                    optionId
                      ? customerTexts[`${group.id}__${optionId}`]
                      : undefined
                  }
                  customerImageUrl={
                    optionId
                      ? customerImageUrls[`${group.id}__${optionId}`]
                      : undefined
                  }
                  onSelect={(oId) => onSelect(group.id, oId)}
                  onToggle={() => {}}
                  onTextChange={(oId, text) => onTextChange(group.id, oId, text)}
                  onImageChange={(oId, url) => onImageChange(group.id, oId, url)}
                  errors={errors}
                  showErrors={showErrors}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted">لا توجد خيارات متاحة للقبعة</p>
      )}
    </div>
  );
}

// ─── Step 3: Sash ───────────────────────────────────────────────────────────────

function StepSash({
  product,
  selections,
  customerTexts,
  sashZones,
  errors,
  logoFile,
  logoUploading,
  onSelect,
  onTextChange,
  onZoneChange,
  onLogoUpload,
  onErrorClear,
}: {
  product: CatalogProduct | null;
  selections: Record<string, string>;
  customerTexts: Record<string, string>;
  sashZones: FullSetSashZones;
  errors: Record<string, string>;
  logoFile: File | null;
  logoUploading: boolean;
  onSelect: (groupId: string, optionId: string) => void;
  onTextChange: (groupId: string, optionId: string, text: string) => void;
  onZoneChange: (field: string, value: string) => void;
  onLogoUpload: (file: File) => void;
  onErrorClear: (key: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // logoFile is passed for future use (e.g. showing preview filename)
  void logoFile;

  return (
    <div className="space-y-6">
      <StepHeader
        step={3}
        title="الوشاح"
        subtitle="خصّص وشاح تخرجك — الجهتان والتطريز"
      />

      {product && product.optionGroups.length > 0 && (
        <div className="space-y-5">
          {product.optionGroups.map((group) => (
            <div
              key={group.id}
              className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-soft)] ring-1 ring-line"
            >
              <OptionGroupSection
                group={group}
                productType="sash"
                selectionValue={selections[group.id]}
                customerText={
                  selections[group.id]
                    ? customerTexts[`${group.id}__${selections[group.id]}`]
                    : undefined
                }
                customerImageUrl={undefined}
                onSelect={(oId) => onSelect(group.id, oId)}
                onToggle={() => {}}
                onTextChange={(oId, text) => onTextChange(group.id, oId, text)}
                onImageChange={() => {}}
                errors={errors}
                showErrors={Object.keys(errors).length > 0}
              />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-5 rounded-2xl bg-surface p-5 shadow-[var(--shadow-soft)] ring-1 ring-line">
        <p className="font-display-ar text-base font-bold text-ink">مناطق الوشاح</p>

        {/* Zone 1: Right side */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">
              الجهة اليمنى
              <span className="ms-1 text-danger">*</span>
            </p>
            <span className="rounded-full bg-orange/10 px-2 py-0.5 text-xs font-medium text-orange-ink">
              اسم الجامعة والكلية
            </span>
          </div>
          <div className="rounded-xl border border-orange/20 bg-orange/5 px-3 py-2.5">
            <p className="text-xs leading-relaxed text-ink-soft">
              الجهة اليمنى تحتوي على: اسم الجامعة، الكلية، القسم، سنة التخرج
              — تُكتب من الإدارة بناءً على بياناتك.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">
              اسم الخريج الكامل (للتطريز)
              <span className="ms-1 text-danger">*</span>
            </label>
            <input
              id="field_right_text"
              type="text"
              value={sashZones.right_text}
              onChange={(e) => {
                onZoneChange("right_text", e.target.value);
                onErrorClear("right_text");
              }}
              placeholder="مثال: المهندس سيف مهند ضياء"
              className={`min-h-11 w-full rounded-xl border bg-beige px-3.5 py-2.5 text-ink shadow-[var(--shadow-soft)] outline-none transition-colors placeholder:text-ink/50 hover:border-ink/30 focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20 ${
                errors.right_text
                  ? "border-danger focus:border-danger focus:ring-danger/20"
                  : "border-line"
              }`}
            />
            {errors.right_text && (
              <p className="mt-1 text-xs text-danger">{errors.right_text}</p>
            )}
          </div>
        </div>

        {/* Zone 2: Left side */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-ink">الجهة اليسرى</p>
          <div className="grid grid-cols-3 gap-2">
            {(["logo_year", "text", "plain"] as const).map((mode) => {
              const labels = {
                logo_year: "شعار + سنة",
                text: "كتابة",
                plain: "سادة",
              };
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    onZoneChange("left_mode", mode);
                    onErrorClear("left_logo");
                    onErrorClear("left_text");
                  }}
                  aria-pressed={sashZones.left_mode === mode}
                  className={`min-h-12 rounded-xl border px-3 py-2.5 text-center text-sm font-semibold transition-all ${
                    sashZones.left_mode === mode
                      ? "border-orange/50 bg-orange/8 text-ink ring-2 ring-orange/30"
                      : "border-line bg-[var(--shop-sink)] text-ink-soft hover:border-orange/30"
                  }`}
                >
                  {labels[mode]}
                </button>
              );
            })}
          </div>

          {sashZones.left_mode === "logo_year" && (
            <div className="animate-fade-page-in space-y-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink">
                  شعار الكلية
                  <span className="ms-1 text-danger">*</span>
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onLogoUpload(file);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={logoUploading}
                  className={`flex min-h-14 w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed transition-colors ${
                    errors.left_logo
                      ? "border-danger bg-danger/5"
                      : sashZones.left_logo_url
                      ? "border-orange/40 bg-orange/5"
                      : "border-line bg-[var(--shop-sink)] hover:border-orange/40"
                  }`}
                >
                  {logoUploading ? (
                    <span className="flex items-center gap-2 text-sm text-ink-soft">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      جارٍ الرفع…
                    </span>
                  ) : sashZones.left_logo_url ? (
                    <span className="text-sm font-semibold text-orange-ink">
                      ✓ تم رفع الشعار — اضغط لتغييره
                    </span>
                  ) : (
                    <>
                      <svg
                        viewBox="0 0 24 24"
                        className="h-6 w-6 text-muted"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      <span className="text-sm text-ink-soft">ارفع شعار الكلية</span>
                      <span className="text-xs text-muted">JPG أو PNG</span>
                    </>
                  )}
                </button>
                {errors.left_logo && (
                  <p className="mt-1 text-xs text-danger">{errors.left_logo}</p>
                )}
              </div>
              <Input
                label="سنة التخرج"
                value={sashZones.left_text ?? ""}
                onChange={(e) => onZoneChange("left_text", e.target.value)}
                placeholder="مثال: ٢٠٢٥"
              />
            </div>
          )}

          {sashZones.left_mode === "text" && (
            <div className="animate-fade-page-in">
              <label className="mb-1.5 block text-sm font-medium text-ink">
                النص
                <span className="ms-1 text-danger">*</span>
              </label>
              <input
                id="field_left_text"
                type="text"
                value={sashZones.left_text ?? ""}
                onChange={(e) => {
                  onZoneChange("left_text", e.target.value);
                  onErrorClear("left_text");
                }}
                placeholder="النص الذي تريده على الجهة اليسرى"
                className={`min-h-11 w-full rounded-xl border bg-beige px-3.5 py-2.5 text-ink shadow-[var(--shadow-soft)] outline-none transition-colors placeholder:text-ink/50 hover:border-ink/30 focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20 ${
                  errors.left_text ? "border-danger" : "border-line"
                }`}
              />
              {errors.left_text && (
                <p className="mt-1 text-xs text-danger">{errors.left_text}</p>
              )}
            </div>
          )}
        </div>

        {/* Zone 3: Back (always shown, optional) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">الوشاح من الخلف</p>
            <span className="text-xs text-muted">اختياري</span>
          </div>
          <textarea
            value={sashZones.back_text ?? ""}
            onChange={(e) => onZoneChange("back_text", e.target.value)}
            placeholder="عبارة شعرية أو اسم — تظهر على ظهر الوشاح (اختياري)"
            rows={2}
            className="min-h-[72px] w-full resize-none rounded-xl border border-line bg-beige px-3.5 py-2.5 text-sm text-ink shadow-[var(--shadow-soft)] outline-none transition-colors placeholder:text-ink/50 hover:border-ink/30 focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Step 4: Delivery ───────────────────────────────────────────────────────────

function StepDelivery({
  delivery,
  eventDate,
  notes,
  errors,
  onDeliveryChange,
  onEventDateChange,
  onNotesChange,
  onErrorClear,
}: {
  delivery: FullSetDelivery;
  eventDate: string;
  notes: string;
  errors: Record<string, string>;
  onDeliveryChange: (field: keyof FullSetDelivery, val: string) => void;
  onEventDateChange: (v: string) => void;
  onNotesChange: (v: string) => void;
  onErrorClear: (key: string) => void;
}) {
  const govOptions = [
    { value: "", label: "اختر المحافظة" },
    ...GOVERNORATES.map((g) => ({ value: g, label: g })),
  ];

  return (
    <div className="space-y-6">
      <StepHeader
        step={4}
        title="عنوان التوصيل"
        subtitle="نحتاج هذه البيانات للتواصل معك وتوصيل طقمك"
      />

      <div className="space-y-4 rounded-2xl bg-surface p-5 shadow-[var(--shadow-soft)] ring-1 ring-line">
        <Input
          id="field_customer_name"
          label="الاسم الكامل"
          value={delivery.customer_name}
          onChange={(e) => {
            onDeliveryChange("customer_name", e.target.value);
            onErrorClear("customer_name");
          }}
          error={errors.customer_name}
          placeholder="ثلاثي أو رباعي"
        />
        <Input
          label="اسم المستخدم على إنستغرام"
          value={delivery.instagram_username ?? ""}
          onChange={(e) => onDeliveryChange("instagram_username", e.target.value)}
          placeholder="@username"
        />
        <div>
          <Input
            id="field_phone_primary"
            label="رقم الهاتف الأساسي"
            value={delivery.phone_primary}
            onChange={(e) => {
              onDeliveryChange("phone_primary", e.target.value);
              onErrorClear("phone_primary");
            }}
            error={errors.phone_primary}
            placeholder="07xxxxxxxxx"
          />
          <p className="mt-1 text-xs text-muted">يبدأ بـ 07 — ١١ رقم</p>
        </div>
        <div>
          <Input
            id="field_phone_secondary"
            label="رقم هاتف ثانٍ (اختياري)"
            value={delivery.phone_secondary ?? ""}
            onChange={(e) => {
              onDeliveryChange("phone_secondary", e.target.value);
              onErrorClear("phone_secondary");
            }}
            error={errors.phone_secondary}
            placeholder="07xxxxxxxxx"
          />
          <p className="mt-1 text-xs text-muted">يُفضَّل لضمان التواصل</p>
        </div>
        <Select
          id="field_governorate"
          label="المحافظة"
          value={delivery.governorate}
          onChange={(e) => {
            onDeliveryChange("governorate", e.target.value);
            onErrorClear("governorate");
          }}
          options={govOptions}
          error={errors.governorate}
        />
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">
            تفاصيل العنوان
          </label>
          <textarea
            value={delivery.area_details ?? ""}
            onChange={(e) => onDeliveryChange("area_details", e.target.value)}
            placeholder="القضاء / الناحية + أقرب نقطة دالة (مطعم، مسجد، مدرسة…)"
            rows={3}
            className="min-h-[88px] w-full resize-none rounded-xl border border-line bg-beige px-3.5 py-2.5 text-sm text-ink shadow-[var(--shadow-soft)] outline-none transition-colors placeholder:text-ink/50 hover:border-ink/30 focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
          />
        </div>
      </div>

      <div className="space-y-4 rounded-2xl bg-surface p-5 shadow-[var(--shadow-soft)] ring-1 ring-line">
        <div>
          <Input
            id="field_event_date"
            label="تاريخ حفل التخرج (اختياري)"
            type="date"
            value={eventDate}
            onChange={(e) => {
              onEventDateChange(e.target.value);
              onErrorClear("event_date");
            }}
            error={errors.event_date}
          />
          <p className="mt-1 text-xs text-muted">
            نحتاج وقتاً كافياً للتفصيل — أخبرنا مبكراً
          </p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">
            ملاحظات إضافية (اختياري)
          </label>
          <textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="أي طلبات خاصة أو ملاحظات إضافية"
            rows={3}
            className="min-h-[88px] w-full resize-none rounded-xl border border-line bg-beige px-3.5 py-2.5 text-sm text-ink shadow-[var(--shadow-soft)] outline-none transition-colors placeholder:text-ink/50 hover:border-ink/30 focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Step 5: Review ─────────────────────────────────────────────────────────────

function StepReview({
  state,
  pkg,
  robeProduct,
  capProduct,
  sashProduct,
  runningTotal,
  submitError,
}: {
  state: WizardState;
  pkg: FullSetPackage | null;
  robeProduct: CatalogProduct | null;
  capProduct: CatalogProduct | null;
  sashProduct: CatalogProduct | null;
  runningTotal: number;
  submitError?: string;
}) {
  function getLabel(
    product: CatalogProduct | null,
    groupId: string,
    selection: ProductSelectionValue | string | undefined
  ): string {
    if (!product || selection == null || selection === false) return "—";
    for (const g of product.optionGroups) {
      if (g.id !== groupId) continue;
      if (g.inputType === "toggle" && selection === true) {
        return g.options.find((o) => o.active)?.labelAr ?? "نعم";
      }
      if (typeof selection === "string") {
        const opt = g.options.find((o) => o.id === selection);
        return opt?.labelAr ?? "—";
      }
    }
    return "—";
  }

  function getEmbroideryDetail(
    product: CatalogProduct | null,
    groupId: string,
    selection: ProductSelectionValue | string | undefined,
    texts: Record<string, string>,
    images: Record<string, string>
  ): string | null {
    if (!product) return null;
    const g = product.optionGroups.find((og) => og.id === groupId);
    if (!g) return null;
    let optionId: string | undefined;
    if (g.inputType === "toggle" && selection === true) {
      optionId = g.options.find((o) => o.active)?.id ?? g.options[0]?.id;
    } else if (typeof selection === "string") {
      optionId = selection;
    }
    if (!optionId) return null;
    const key = `${groupId}__${optionId}`;
    const text = texts[key]?.trim();
    const img = images[key];
    if (!text && !img) return null;
    const parts = [text, img ? "صورة مرفقة" : null].filter(Boolean);
    return parts.join(" · ");
  }

  const leftModeLabels: Record<FullSetSashZones["left_mode"], string> = {
    logo_year: "شعار + سنة التخرج",
    text: "كتابة",
    plain: "سادة",
  };

  return (
    <div className="space-y-5">
      <StepHeader
        step={5}
        title="مراجعة الطلب"
        subtitle="تأكد من جميع التفاصيل قبل الإرسال"
      />

      {pkg && (
        <ReviewSection title="الطقم المختار">
          <ReviewRow label="الباقة" value={pkg.nameAr} />
        </ReviewSection>
      )}

      <ReviewSection title="الروب">
        {robeProduct?.optionGroups.map((g) => {
          const raw = state.selections.robe[g.id];
          if (raw === false || (raw == null && !g.lockedOptionId)) return null;
          const sel = raw ?? g.lockedOptionId;
          if (sel == null) return null;
          const emb = getEmbroideryDetail(
            robeProduct,
            g.id,
            sel,
            state.selections.customerTexts,
            state.selections.customerImageUrls
          );
          return (
            <ReviewRow
              key={g.id}
              label={g.nameAr}
              value={emb ? `${getLabel(robeProduct, g.id, sel)} — ${emb}` : getLabel(robeProduct, g.id, sel)}
            />
          );
        })}
        <ReviewRow label="عرض الكتف" value={`${state.measurements.shoulder_cm} سم`} />
        {(state.measurements.chest_cm ?? 0) > 0 && (
          <ReviewRow label="محيط الصدر" value={`${state.measurements.chest_cm} سم`} />
        )}
        <ReviewRow label="طول الروب" value={`${state.measurements.robe_length_cm} سم`} />
        <ReviewRow label="طول الكُم" value={`${state.measurements.sleeve_length_cm} سم`} />
        {state.measurements.tailor_notes?.trim() && (
          <ReviewRow label="ملاحظات لفصال الروب" value={state.measurements.tailor_notes} />
        )}
        {state.measurements.receipt_image_url?.trim() && (
          <ReviewRow label="صورة الوصل" value="مرفقة ✓" />
        )}
      </ReviewSection>

      <ReviewSection title="القبعة">
        {capProduct?.optionGroups.map((g) => {
          const raw = state.selections.cap[g.id];
          if (raw == null && !g.lockedOptionId) return null;
          const sel = raw ?? g.lockedOptionId;
          if (sel == null || typeof sel === "boolean") return null;
          const emb = getEmbroideryDetail(
            capProduct,
            g.id,
            sel,
            state.selections.customerTexts,
            state.selections.customerImageUrls
          );
          return (
            <ReviewRow
              key={g.id}
              label={g.nameAr}
              value={emb ? `${getLabel(capProduct, g.id, sel)} — ${emb}` : getLabel(capProduct, g.id, sel)}
            />
          );
        })}
        {(!capProduct || capProduct.optionGroups.length === 0) && (
          <ReviewRow label="النوع" value="افتراضي" />
        )}
      </ReviewSection>

      <ReviewSection title="الوشاح">
        {sashProduct?.optionGroups.map((g) => {
          const sel = state.selections.sash[g.id] || g.lockedOptionId;
          if (!sel) return null;
          return (
            <ReviewRow key={g.id} label={g.nameAr} value={getLabel(sashProduct, g.id, sel)} />
          );
        })}
        <ReviewRow
          label="الجهة اليمنى (اسم)"
          value={state.sashZones.right_text || "—"}
        />
        <ReviewRow
          label="الجهة اليسرى"
          value={leftModeLabels[state.sashZones.left_mode]}
        />
        {state.sashZones.left_mode === "logo_year" && (
          <ReviewRow label="سنة التخرج" value={state.sashZones.left_text || "—"} />
        )}
        {state.sashZones.left_mode === "text" && (
          <ReviewRow label="نص اليسرى" value={state.sashZones.left_text || "—"} />
        )}
        {state.sashZones.back_text && (
          <ReviewRow label="الظهر" value={state.sashZones.back_text} />
        )}
      </ReviewSection>

      <ReviewSection title="التوصيل">
        <ReviewRow label="الاسم" value={state.delivery.customer_name} />
        {state.delivery.instagram_username && (
          <ReviewRow label="إنستغرام" value={state.delivery.instagram_username} />
        )}
        <ReviewRow label="الهاتف الأساسي" value={state.delivery.phone_primary} />
        {state.delivery.phone_secondary && (
          <ReviewRow label="الهاتف الثاني" value={state.delivery.phone_secondary} />
        )}
        <ReviewRow label="المحافظة" value={state.delivery.governorate} />
        {state.delivery.area_details && (
          <ReviewRow label="التفاصيل" value={state.delivery.area_details} />
        )}
        {state.eventDate && (
          <ReviewRow label="تاريخ الحفل" value={state.eventDate} />
        )}
      </ReviewSection>

      <div className="rounded-2xl bg-orange/5 p-5 ring-1 ring-orange/20">
        <p className="mb-3 font-display-ar text-base font-bold text-ink">ملخص السعر</p>
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-ink-soft">
            <span>سعر الطقم الأساسي</span>
            <span dir="ltr">{formatIQD(pkg?.price ?? 0)}</span>
          </div>
          {runningTotal > (pkg?.price ?? 0) && (
            <div className="flex justify-between text-sm text-orange-ink">
              <span>إضافات</span>
              <span dir="ltr">+{formatIQD(runningTotal - (pkg?.price ?? 0))}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-2">
            <span className="font-semibold text-ink">المجموع</span>
            <span className="font-display-ar text-lg font-bold text-ink" dir="ltr">
              {formatIQD(runningTotal)}
            </span>
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-muted">
          السعر شامل التوصيل — الدفع كاش عند الاستلام
        </p>
      </div>

      {submitError && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          {submitError}
        </div>
      )}

      {state.notes && (
        <ReviewSection title="ملاحظات">
          <p className="text-sm text-ink-soft">{state.notes}</p>
        </ReviewSection>
      )}
    </div>
  );
}

// ─── Success Screen ─────────────────────────────────────────────────────────────

function SuccessScreen({ result }: { result: ConfigureFullSetResult }) {
  return (
    <div className="animate-page-in space-y-6 py-10 text-center">
      <div className="flex justify-center">
        <span className="flex h-24 w-24 items-center justify-center rounded-full bg-orange/10 text-orange-ink">
          <svg
            viewBox="0 0 24 24"
            className="h-12 w-12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
      </div>
      <div>
        <h1 className="font-display-ar text-2xl font-bold text-ink">تم استلام طلبك!</h1>
        <p className="mx-auto mt-2 max-w-[36ch] text-sm leading-relaxed text-ink-soft">
          سيتواصل معك فريق لولو شوب لتأكيد التفاصيل وترتيب التوصيل.
        </p>
      </div>
      <div className="space-y-3 rounded-2xl bg-surface p-5 text-start shadow-[var(--shadow-soft)] ring-1 ring-line">
        <p className="font-display-ar text-base font-bold text-ink">تفاصيل الطلب</p>
        <ReviewRow label="الباقة" value={result.package_name} />
        <ReviewRow label="المجموع" value={formatIQD(result.total)} />
        <div className="border-t border-line pt-3">
          <p className="text-xs text-muted">أرقام الطلبات</p>
          {result.items.map((item) => (
            <p key={item.order_id} className="mt-1 font-mono text-xs text-ink-soft">
              {item.type === "robe"
                ? "روب"
                : item.type === "cap"
                ? "قبعة"
                : "وشاح"}
              {": "}#{item.order_id.slice(0, 8)}
            </p>
          ))}
        </div>
      </div>
      <div className="rounded-xl bg-orange/5 px-5 py-4 ring-1 ring-orange/20">
        <p className="text-sm font-semibold text-orange-ink">الدفع كاش عند الاستلام</p>
        <p className="mt-1 text-xs text-ink-soft">
          سيتواصل معك فريقنا لتأكيد موعد التوصيل وتحديد المبلغ النهائي.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <Link
          href="/full-set"
          className="btn-shine inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-pill bg-orange-ink px-7 text-sm font-bold text-white shadow-[var(--shadow-card)]"
        >
          العودة للباقات
        </Link>
        <a
          href="https://instagram.com/lolo_shop96"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-pill border border-line bg-beige px-5 text-sm font-semibold text-ink-soft"
        >
          تواصل معنا على إنستغرام
        </a>
      </div>
    </div>
  );
}

// ─── Shared micro-components ────────────────────────────────────────────────────

function StepHeader({
  step,
  title,
  subtitle,
}: {
  step: number;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted">
        الخطوة {step} من {STEPS.length}
      </p>
      <h2 className="font-display-ar text-2xl font-bold leading-tight text-ink">
        {title}
      </h2>
      <p className="text-sm text-ink-soft">{subtitle}</p>
    </div>
  );
}

function MeasurementInput({
  id,
  label,
  hint,
  value,
  min,
  max,
  error,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  error?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
        </label>
        <span className="text-xs text-muted">
          {min}–{max} سم
        </span>
      </div>
      <p className="text-xs text-muted">{hint}</p>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          value={value || ""}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value))}
          placeholder={`${min}–${max}`}
          className={`min-h-11 w-full rounded-xl border bg-beige px-3.5 py-2.5 text-ink shadow-[var(--shadow-soft)] outline-none transition-colors placeholder:text-ink/50 hover:border-ink/30 focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20 ${
            error
              ? "border-danger focus:border-danger focus:ring-danger/20"
              : "border-line"
          }`}
        />
        <span className="pointer-events-none absolute end-3.5 top-1/2 -translate-y-1/2 text-xs text-muted">
          سم
        </span>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function ReviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5 rounded-2xl bg-surface p-4 shadow-[var(--shadow-soft)] ring-1 ring-line">
      <p className="font-display-ar text-sm font-bold text-orange-ink">{title}</p>
      {children}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-xs text-muted">{label}</span>
      <span className="text-start text-xs font-medium text-ink">{value}</span>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/full-set"
      className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-orange-ink transition-colors hover:text-ink"
    >
      <span aria-hidden>→</span>
      الباقات
    </Link>
  );
}
