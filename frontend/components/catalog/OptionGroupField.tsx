"use client";

import { useEffect } from "react";
import Image from "next/image";
import { SASH_COLOR_HEX } from "@/lib/designer-colors";
import type { CatalogOptionGroup } from "@/lib/types";
import type { OptionSelection } from "@/lib/pricing";
import { formatIQD } from "@/lib/format";
import { resolveOptionPrice } from "@/lib/pricing";
import type { PriceRole } from "@/lib/types";

interface OptionGroupFieldProps {
  group: CatalogOptionGroup;
  selection: OptionSelection;
  role: PriceRole;
  /** When set, this group is locked by admin to one fixed option — read-only. */
  lockedOptionId?: string | null;
  onChange: (groupId: string, value: OptionSelection[string]) => void;
}

export function OptionGroupField({
  group,
  selection,
  role,
  lockedOptionId,
  onChange,
}: OptionGroupFieldProps) {
  const value = selection[group.id];
  const isColorGroup = group.nameAr.includes("لون");

  // Admin locked this group to a single fixed option that the student must keep.
  const lockedOption = lockedOptionId
    ? group.options.find((o) => o.id === lockedOptionId)
    : null;
  const isLocked = Boolean(lockedOption);

  // Auto-select the locked option so price + order payload include it.
  useEffect(() => {
    if (lockedOption && value !== lockedOption.id) {
      onChange(group.id, lockedOption.id);
    }
  }, [lockedOption, value, group.id, onChange]);

  if (isLocked && lockedOption) {
    return (
      <fieldset className="surface-card rounded-2xl p-4">
        <legend className="px-1 font-display text-sm font-bold text-ink">
          {group.nameAr}
        </legend>
        <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-orange/30 bg-orange/5 px-3.5 py-2.5">
          <span className="flex items-center gap-2 text-sm font-medium text-ink">
            {lockedOption.labelAr}
            <span className="rounded-full bg-orange/15 px-2 py-0.5 text-[11px] font-medium text-orange-ink">
              مثبتة
            </span>
          </span>
          {lockedOption.priceDelta > 0 && (
            <span className="text-xs font-semibold tabular-nums text-orange-ink" dir="ltr">
              +{formatIQD(resolveOptionPrice(lockedOption, role))}
            </span>
          )}
        </div>
      </fieldset>
    );
  }

  return (
    <fieldset className="surface-card rounded-2xl p-4">
      <legend className="px-1 font-display text-sm font-bold text-ink">
        {group.nameAr}
        {group.required && (
          <span className="ms-1 text-orange-ink">*</span>
        )}
      </legend>

      {(group.hintAr || group.imageUrl) && (
        <div className="mb-3 rounded-xl border border-ink/8 bg-cream/60 p-2.5">
          <p className="text-[11px] font-medium text-[var(--shop-muted)]">
            صورة توضيحية من الأدمن
          </p>
          {group.hintAr && (
            <p className="mt-1 text-xs text-ink-soft">{group.hintAr}</p>
          )}
          {group.imageUrl && (
            <div className="relative mt-2 h-32 w-full overflow-hidden rounded-lg bg-peach/40">
              <Image
                src={group.imageUrl}
                alt={group.nameAr}
                fill
                sizes="(max-width: 768px) calc(100vw - 4rem), 480px"
                className="object-contain"
              />
            </div>
          )}
        </div>
      )}

      {group.inputType === "single_select" && (
        <div className="space-y-2">
          {isColorGroup ? (
            <div role="radiogroup" aria-label={group.nameAr} className="flex flex-wrap gap-3">
              {group.options
                .filter((o) => o.active)
                .map((opt) => {
                  const hex =
                    SASH_COLOR_HEX[opt.labelAr]?.base ?? "#e0e0e0";
                  const selected = value === opt.id;
                  return (
                    <label
                      key={opt.id}
                      className={`flex min-h-11 min-w-11 cursor-pointer flex-col items-center gap-1 rounded-xl border-2 p-1.5 transition-all ${
                        selected
                          ? "border-orange bg-orange/5 ring-2 ring-orange/25"
                          : "border-neutral hover:border-orange/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name={group.id}
                        value={opt.id}
                        checked={selected}
                        onChange={() => onChange(group.id, opt.id)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden
                        className="h-10 w-10 rounded-full shadow-[var(--shadow-soft)] ring-1 ring-ink/15"
                        style={{ background: hex }}
                      />
                      <span className="text-[10px] font-medium text-ink/80">{opt.labelAr}</span>
                    </label>
                  );
                })}
            </div>
          ) : (
            group.options
              .filter((o) => o.active)
              .map((opt) => (
                <label
                  key={opt.id}
                  className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 transition-all ${
                    value === opt.id
                      ? "border-orange bg-orange/5 ring-1 ring-orange/20"
                      : "border-neutral hover:border-orange/40"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-ink">
                    <input
                      type="radio"
                      name={group.id}
                      checked={value === opt.id}
                      onChange={() => onChange(group.id, opt.id)}
                      className="accent-orange"
                    />
                    {opt.labelAr}
                  </span>
                  {opt.priceDelta > 0 && (
                    <span className="text-xs font-semibold tabular-nums text-orange-ink" dir="ltr">
                      +{formatIQD(resolveOptionPrice(opt, role))}
                    </span>
                  )}
                </label>
              ))
          )}
          {group.inputType === "single_select" &&
            typeof value === "string" &&
            (() => {
              const sel = group.options.find((o) => o.id === value);
              return sel?.imageUrl ? (
                <div className="mt-2 rounded-xl border border-ink/8 bg-cream/60 p-2.5">
                  <p className="text-[11px] font-medium text-[var(--shop-muted)]">
                    توضيح للخيار: {sel.labelAr}
                  </p>
                  <div className="relative mt-2 h-28 w-full overflow-hidden rounded-lg bg-peach/40">
                    <Image
                      src={sel.imageUrl}
                      alt={sel.labelAr}
                      fill
                      sizes="(max-width: 768px) calc(100vw - 4rem), 480px"
                      className="object-contain"
                    />
                  </div>
                </div>
              ) : null;
            })()}
        </div>
      )}

      {group.inputType === "toggle" && (
        <label
          className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-all ${
            value === true
              ? "border-orange bg-orange/5 ring-1 ring-orange/20"
              : "border-neutral hover:border-orange/40"
          }`}
        >
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(group.id, e.target.checked)}
            className="h-5 w-5 accent-orange"
          />
          <span className="text-sm font-medium text-ink">{group.options[0]?.labelAr ?? "نعم"}</span>
          {group.options[0] && (
            <span className="ms-auto text-xs font-semibold tabular-nums text-orange-ink" dir="ltr">
              +{formatIQD(resolveOptionPrice(group.options[0], role))}
            </span>
          )}
        </label>
      )}

      {group.inputType === "counter" && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="تقليل العدد"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-neutral text-lg text-ink transition-colors hover:border-orange/50 hover:bg-orange/5"
            onClick={() =>
              onChange(group.id, Math.max(0, Number(value || 0) - 1))
            }
          >
            −
          </button>
          <span className="min-w-[2.5rem] text-center text-lg font-bold tabular-nums text-ink">
            {Number(value || 0)}
          </span>
          <button
            type="button"
            aria-label="زيادة العدد"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-neutral text-lg text-ink transition-colors hover:border-orange/50 hover:bg-orange/5"
            onClick={() => {
              const next = Number(value || 0) + 1;
              const max = group.maxSelect ?? 99;
              onChange(group.id, Math.min(next, max));
            }}
          >
            +
          </button>
          {group.maxSelect && (
            <span className="text-xs text-[var(--shop-muted)]">حد أقصى {group.maxSelect}</span>
          )}
        </div>
      )}
    </fieldset>
  );
}
