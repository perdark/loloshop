"use client";

/**
 * «بنود التكلفة» — the raw price list (fabric, thread, embroidery run, a box, an hour of
 * electricity…) that recipes on the next tab multiply into a per-piece cost. Grouped by
 * category so the admin can find "قماش الوشاح" without scrolling past packaging tape.
 *
 * `confirmed` is per-item, not a page-wide switch: an admin who knows fabric costs 4,000 د.ع
 * but is only guessing at packaging can confirm one and leave the other estimated, and tab 1's
 * confidence badge reflects exactly that mix.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { formatIQD, toArabicDigits } from "@/lib/format";
import { getApiErrorMessage } from "@/lib/api";
import {
  COST_CATEGORY_LABEL,
  createCostItem,
  deleteCostItem,
  updateCostItem,
  type CostCategory,
  type CostItem,
  type CostLine,
} from "@/lib/costs";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

const CATEGORIES = Object.keys(COST_CATEGORY_LABEL) as CostCategory[];

export function CostItemsTab({
  items,
  lines,
  onChanged,
}: {
  items: CostItem[];
  lines: CostLine[];
  onChanged: () => Promise<void>;
}) {
  const [addingCategory, setAddingCategory] = useState<CostCategory | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CostItem | null>(null);

  const usageCount = (itemId: string) => lines.filter((l) => l.cost_item_id === itemId).length;

  return (
    <div className="space-y-8">
      {CATEGORIES.map((category) => {
        const rows = items
          .filter((i) => i.category === category)
          .sort((a, b) => a.sort - b.sort || a.name_ar.localeCompare(b.name_ar, "ar"));
        return (
          <section key={category}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-ink">{COST_CATEGORY_LABEL[category]}</h3>
              <Button size="sm" variant="ghost" onClick={() => setAddingCategory(category)}>
                + بند جديد
              </Button>
            </div>
            {rows.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line bg-surface-sink px-4 py-6 text-center text-sm text-ink-soft">
                لا توجد بنود في هذه الفئة بعد.
              </p>
            ) : (
              <div className="space-y-2">
                {rows.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    usage={usageCount(item.id)}
                    onChanged={onChanged}
                    onDelete={() => setRemoveTarget(item)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {addingCategory && (
        <AddItemModal
          category={addingCategory}
          onClose={() => setAddingCategory(null)}
          onDone={async () => {
            setAddingCategory(null);
            await onChanged();
          }}
        />
      )}

      {removeTarget && (
        <ConfirmDeleteModal
          title={`حذف — ${removeTarget.name_ar}`}
          warning={
            usageCount(removeTarget.id) > 0
              ? `هذا البند مستخدم في ${toArabicDigits(usageCount(removeTarget.id))} سطر وصفة. حذفه سيحذف تلك السطور أيضاً، وستحتاج لإعادة ربطها ببند آخر.`
              : "هذا البند غير مستخدم في أي وصفة حالياً."
          }
          onConfirm={() => deleteCostItem(removeTarget.id)}
          onClose={() => setRemoveTarget(null)}
          onDone={async () => {
            setRemoveTarget(null);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function ItemRow({
  item,
  usage,
  onChanged,
  onDelete,
}: {
  item: CostItem;
  usage: number;
  onChanged: () => Promise<void>;
  onDelete: () => void;
}) {
  const [nameAr, setNameAr] = useState(item.name_ar);
  const [unitAr, setUnitAr] = useState(item.unit_ar);
  const [unitCost, setUnitCost] = useState(String(item.unit_cost));
  const [noteAr, setNoteAr] = useState(item.note_ar || "");
  const [saving, setSaving] = useState(false);

  const dirty =
    nameAr !== item.name_ar ||
    unitAr !== item.unit_ar ||
    Number(unitCost) !== item.unit_cost ||
    noteAr !== (item.note_ar || "");

  async function save() {
    const cost = Number(unitCost.replace(/[^\d.]/g, ""));
    if (!nameAr.trim() || !unitAr.trim() || !Number.isFinite(cost) || cost < 0) {
      toast.error("تحقق من الاسم والوحدة والسعر");
      return;
    }
    setSaving(true);
    try {
      await updateCostItem(item.id, {
        name_ar: nameAr.trim(),
        unit_ar: unitAr.trim(),
        unit_cost: cost,
        note_ar: noteAr.trim() || null,
      });
      toast.success("تم الحفظ");
      await onChanged();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّر الحفظ"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleConfirmed() {
    try {
      await updateCostItem(item.id, { confirmed: !item.confirmed });
      await onChanged();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّر التحديث"));
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-[1.3fr_0.8fr_0.9fr_1.2fr]">
        <Input aria-label="الاسم" value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="الاسم" />
        <Input aria-label="الوحدة" value={unitAr} onChange={(e) => setUnitAr(e.target.value)} placeholder="الوحدة (متر، قطعة…)" />
        <Input
          aria-label="السعر"
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={unitCost}
          onChange={(e) => setUnitCost(e.target.value)}
          placeholder="السعر (د.ع)"
        />
        <Input aria-label="ملاحظة" value={noteAr} onChange={(e) => setNoteAr(e.target.value)} placeholder="ملاحظة (اختياري)" />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={toggleConfirmed}
            aria-pressed={item.confirmed}
            className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors ${
              item.confirmed
                ? "border-green-600/40 bg-green-50 text-green-800"
                : "border-amber-300 bg-amber-50 text-amber-900"
            }`}
          >
            {item.confirmed ? "مؤكد" : "تقديري"}
          </button>
          <span className="text-xs text-ink-soft">
            {usage > 0 ? `مستخدم في ${toArabicDigits(usage)} وصفة` : "غير مستخدم"}
          </span>
          <span className="text-xs text-ink-soft" dir="ltr">
            = {formatIQD(item.unit_cost)}
          </span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
            حفظ
          </Button>
          <Button size="sm" variant="danger" onClick={onDelete}>
            حذف
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddItemModal({
  category,
  onClose,
  onDone,
}: {
  category: CostCategory;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [nameAr, setNameAr] = useState("");
  const [unitAr, setUnitAr] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [noteAr, setNoteAr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const cost = Number(unitCost.replace(/[^\d.]/g, ""));
    if (!nameAr.trim() || !unitAr.trim() || !Number.isFinite(cost) || cost < 0) {
      toast.error("تحقق من الاسم والوحدة والسعر");
      return;
    }
    setSaving(true);
    try {
      await createCostItem({
        category,
        name_ar: nameAr.trim(),
        unit_ar: unitAr.trim(),
        unit_cost: cost,
        confirmed,
        note_ar: noteAr.trim() || null,
      });
      toast.success("تمت الإضافة");
      await onDone();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّرت الإضافة"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`بند جديد — ${COST_CATEGORY_LABEL[category]}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save} loading={saving}>
            إضافة
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input label="الاسم" value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="مثال: قماش وشاح" />
        <Input label="الوحدة" value={unitAr} onChange={(e) => setUnitAr(e.target.value)} placeholder="متر، قطعة، علبة…" />
        <Input
          label="السعر (د.ع)"
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={unitCost}
          onChange={(e) => setUnitCost(e.target.value)}
        />
        <Select
          label="الحالة"
          value={confirmed ? "1" : "0"}
          onChange={(e) => setConfirmed(e.target.value === "1")}
          options={[
            { value: "0", label: "تقديري" },
            { value: "1", label: "مؤكد" },
          ]}
        />
        <Input label="ملاحظة (اختياري)" value={noteAr} onChange={(e) => setNoteAr(e.target.value)} />
      </div>
    </Modal>
  );
}
