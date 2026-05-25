"use client";

import Image from "next/image";
import type { CatalogOptionGroup } from "@/lib/types";
import type { OptionSelection } from "@/lib/pricing";
import { formatIQD } from "@/lib/format";
import { resolveOptionPrice } from "@/lib/pricing";
import type { PriceRole } from "@/lib/types";

interface OptionGroupFieldProps {
  group: CatalogOptionGroup;
  selection: OptionSelection;
  role: PriceRole;
  onChange: (groupId: string, value: OptionSelection[string]) => void;
}

export function OptionGroupField({
  group,
  selection,
  role,
  onChange,
}: OptionGroupFieldProps) {
  const value = selection[group.id];

  return (
    <fieldset className="rounded-xl border border-ink/10 bg-beige p-4">
      <legend className="px-1 text-sm font-semibold text-ink">
        {group.nameAr}
        {group.required && (
          <span className="mr-1 text-orange">*</span>
        )}
      </legend>

      {group.hintAr && (
        <p className="mb-3 text-xs text-ink/60">{group.hintAr}</p>
      )}

      {group.imageUrl && (
        <div className="relative mb-3 h-32 w-full overflow-hidden rounded-lg bg-peach/40">
          <Image
            src={group.imageUrl}
            alt=""
            fill
            className="object-contain"
            unoptimized
          />
        </div>
      )}

      {group.inputType === "single_select" && (
        <div className="space-y-2">
          {group.options
            .filter((o) => o.active)
            .map((opt) => (
              <label
                key={opt.id}
                className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                  value === opt.id
                    ? "border-orange bg-orange/5"
                    : "border-neutral"
                }`}
              >
                <span className="flex items-center gap-2">
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
                  <span className="text-xs text-ink/50" dir="ltr">
                    +{formatIQD(resolveOptionPrice(opt, role))}
                  </span>
                )}
              </label>
            ))}
        </div>
      )}

      {group.inputType === "toggle" && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(group.id, e.target.checked)}
            className="h-5 w-5 accent-orange"
          />
          <span>{group.options[0]?.labelAr ?? "نعم"}</span>
          {group.options[0] && (
            <span className="text-xs text-ink/50" dir="ltr">
              +{formatIQD(resolveOptionPrice(group.options[0], role))}
            </span>
          )}
        </label>
      )}

      {group.inputType === "counter" && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-neutral text-lg"
            onClick={() =>
              onChange(group.id, Math.max(0, Number(value || 0) - 1))
            }
          >
            −
          </button>
          <span className="min-w-[2rem] text-center text-lg font-bold">
            {Number(value || 0)}
          </span>
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-neutral text-lg"
            onClick={() => {
              const next = Number(value || 0) + 1;
              const max = group.maxSelect ?? 99;
              onChange(group.id, Math.min(next, max));
            }}
          >
            +
          </button>
          {group.maxSelect && (
            <span className="text-xs text-ink/50">حد أقصى {group.maxSelect}</span>
          )}
        </div>
      )}
    </fieldset>
  );
}
