"use client";

import { CustomerImageUpload } from "@/components/catalog/CustomerImageUpload";
import { getSelectedOptionId } from "@/lib/customerImage";
import { formatIQD } from "@/lib/format";
import { resolveOptionPrice, type OptionSelection } from "@/lib/pricing";
import { robeSleeveToggleLabel } from "@/lib/robeSleeve";
import type { CatalogOptionGroup, PriceRole } from "@/lib/types";

interface RobeSleeveSectionProps {
  groups: CatalogOptionGroup[];
  role: PriceRole;
  selection: OptionSelection;
  customerTexts: Record<string, string>;
  customerImages: Record<string, string>;
  onToggle: (groupId: string, checked: boolean) => void;
  onTextChange: (groupId: string, optionId: string, text: string) => void;
  onImageChange: (groupId: string, optionId: string, url: string) => void;
  /** Build the key used in customerTexts / customerImages maps. */
  fieldKey: (groupId: string, optionId: string) => string;
  showErrors?: boolean;
  errors?: Record<string, string>;
}

export function RobeSleeveSection({
  groups,
  role,
  selection,
  customerTexts,
  customerImages,
  onToggle,
  onTextChange,
  onImageChange,
  fieldKey,
  showErrors = false,
  errors = {},
}: RobeSleeveSectionProps) {
  if (!groups.length) return null;

  return (
    <fieldset className="surface-card rounded-2xl p-4 ring-1 ring-orange/15">
      <legend className="px-1 font-display text-base font-bold text-ink">
        ردن الروب
      </legend>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        الردنان سادة افتراضياً. فعّل التطريز لكل ردن تريد إضافة كتابة عليه (+٥٬٠٠٠ د.ع لكل ردن).
      </p>

      <div className="mt-4 space-y-3">
        {groups.map((group) => {
          const checked = selection[group.id] === true;
          const optionId = getSelectedOptionId(group, selection);
          const opt = group.options.find((o) => o.active) ?? group.options[0];
          const label = robeSleeveToggleLabel(group);
          const textErr = errors[`text_${group.id}`];

          return (
            <div
              key={group.id}
              className={`rounded-2xl border p-3.5 transition-colors ${
                checked
                  ? "border-orange/40 bg-orange/5 ring-1 ring-orange/15"
                  : "border-line bg-[var(--shop-sink)]"
              }`}
            >
              <label className="flex min-h-12 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onToggle(group.id, e.target.checked)}
                  className="h-6 w-6 shrink-0 accent-orange-ink"
                />
                <span className="text-sm font-semibold text-ink">{label}</span>
                {opt && opt.priceDelta > 0 && (
                  <span
                    className="ms-auto text-xs font-bold tabular-nums text-orange-ink"
                    dir="ltr"
                  >
                    +{formatIQD(resolveOptionPrice(opt, role))}
                  </span>
                )}
              </label>

              {checked && optionId && (
                <div className="mt-3 border-t border-line/60 pt-3">
                  <CustomerImageUpload
                    group={group}
                    optionId={optionId}
                    value={customerImages[fieldKey(group.id, optionId)]}
                    onChange={(url) => onImageChange(group.id, optionId, url)}
                    textValue={customerTexts[fieldKey(group.id, optionId)]}
                    onTextChange={(text) => onTextChange(group.id, optionId, text)}
                    allowOptionalImage
                    showErrors={showErrors}
                  />
                </div>
              )}

              {showErrors && textErr && (
                <p className="mt-2 text-xs text-danger">{textErr}</p>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
