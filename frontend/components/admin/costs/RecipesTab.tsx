"use client";

/**
 * «وصفة كل منتج» — how many of which `CostItem` go into one piece. A recipe line is
 * MATERIALS ONLY on purpose: sewing wages already come from the workshop piece-rate log
 * (`/admin/workshop`) and staff salaries from payroll, so a line here for "خياطة" would
 * double-count the exact cost tab 1 already pulls in separately.
 *
 * Lines are either type-wide (`product_id: null` — "كل الأوشحة تاخذ ٢ متر قماش") or scoped to
 * one specific product (an extra on top of the type-wide set, e.g. one VIP variant that also
 * needs a ribbon). The per-piece total the admin actually cares about is the type-wide lines
 * plus whichever product's own extras.
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { formatIQD } from "@/lib/format";
import { getApiErrorMessage } from "@/lib/api";
import {
  COST_LINE_AUDIENCE_LABEL,
  createCostLine,
  deleteCostLine,
  updateCostLine,
  type CostItem,
  type CostLine,
  type CostLineAudience,
  type CostProduct,
  PRODUCT_TYPE_LABEL,
  type ProductType,
  parseAmount,
} from "@/lib/costs";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

const TYPES = Object.keys(PRODUCT_TYPE_LABEL) as ProductType[];
const AUDIENCES = Object.keys(COST_LINE_AUDIENCE_LABEL) as CostLineAudience[];

function lineCost(line: CostLine, items: CostItem[]): number {
  const item = items.find((i) => i.id === line.cost_item_id);
  return item ? item.unit_cost * line.qty : 0;
}

export function RecipesTab({
  lines,
  items,
  products,
  onChanged,
}: {
  lines: CostLine[];
  items: CostItem[];
  products: CostProduct[];
  onChanged: () => Promise<void>;
}) {
  const [type, setType] = useState<ProductType>("sash");
  const [addTarget, setAddTarget] = useState<"type" | string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CostLine | null>(null);

  const typeLines = useMemo(
    () => lines.filter((l) => l.product_type === type && l.product_id === null),
    [lines, type]
  );
  const productsOfType = useMemo(
    () => products.filter((p) => p.type === type && p.active),
    [products, type]
  );
  // Group extra (product-specific) lines by product, but keep a product even if it was
  // later deactivated or renamed elsewhere — a line pointing nowhere would just vanish.
  const extrasByProduct = useMemo(() => {
    const map = new Map<string, CostLine[]>();
    for (const l of lines) {
      if (l.product_type !== type || l.product_id === null) continue;
      const list = map.get(l.product_id) || [];
      list.push(l);
      map.set(l.product_id, list);
    }
    return map;
  }, [lines, type]);
  const productName = (id: string) =>
    products.find((p) => p.id === id)?.name_ar || "منتج محذوف";

  const typeCostAll = typeLines
    .filter((l) => l.audience === "all")
    .reduce((sum, l) => sum + lineCost(l, items), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2" role="group" aria-label="نوع المنتج">
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            aria-pressed={type === t}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors ${
              type === t
                ? "border-orange-ink bg-orange-ink text-white"
                : "border-line bg-surface text-ink hover:border-ink/35"
            }`}
          >
            {PRODUCT_TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <p className="rounded-xl border border-line bg-surface-sink px-4 py-3 text-xs leading-relaxed text-ink-soft">
        الوصفة هنا مواد فقط. أجور الخياطة تُحسب من سجل الورشة بالقطعة، ورواتب الموظفين من الرواتب
        — لا تُضِف أجرة هنا حتى لا تُحتسب مرتين.
      </p>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-ink">
              سطور كل {PRODUCT_TYPE_LABEL[type]} — من نفس النوع
            </h3>
            <p className="mt-0.5 text-xs text-ink-soft">
              تكلفة المواد للقطعة (بنود «الكل» فقط): <b className="text-ink">{formatIQD(typeCostAll)}</b>
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setAddTarget("type")}>
            + سطر جديد
          </Button>
        </div>
        {typeLines.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line bg-surface-sink px-4 py-6 text-center text-sm text-ink-soft">
            لا توجد سطور مشتركة لهذا النوع بعد.
          </p>
        ) : (
          <div className="space-y-2">
            {typeLines.map((line) => (
              <LineRow
                key={line.id}
                line={line}
                items={items}
                onChanged={onChanged}
                onDelete={() => setRemoveTarget(line)}
              />
            ))}
          </div>
        )}
      </section>

      {productsOfType.map((product) => {
        const extras = extrasByProduct.get(product.id) || [];
        const extrasCostAll = extras
          .filter((l) => l.audience === "all")
          .reduce((sum, l) => sum + lineCost(l, items), 0);
        return (
          <section key={product.id}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-ink">{product.name_ar}</h3>
                <p className="mt-0.5 text-xs text-ink-soft">
                  تكلفة المواد للقطعة (النوع + الإضافات، بنود «الكل» فقط):{" "}
                  <b className="text-ink">{formatIQD(typeCostAll + extrasCostAll)}</b>
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setAddTarget(product.id)}>
                + سطر لهذا المنتج فقط
              </Button>
            </div>
            {extras.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line bg-surface-sink px-4 py-5 text-center text-xs text-ink-soft">
                لا توجد إضافات خاصة بهذا المنتج — يستخدم سطور {PRODUCT_TYPE_LABEL[type]} المشتركة فقط.
              </p>
            ) : (
              <div className="space-y-2">
                {extras.map((line) => (
                  <LineRow
                    key={line.id}
                    line={line}
                    items={items}
                    onChanged={onChanged}
                    onDelete={() => setRemoveTarget(line)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {/* Extras pointing at a product no longer in the active list for this type — surfaced
          rather than silently hidden, since the line still costs money on every piece. */}
      {Array.from(extrasByProduct.entries())
        .filter(([productId]) => !productsOfType.some((p) => p.id === productId))
        .map(([productId, extras]) => (
          <section key={productId}>
            <h3 className="mb-3 text-base font-bold text-danger">
              {productName(productId)} — منتج غير نشط أو محذوف
            </h3>
            <div className="space-y-2">
              {extras.map((line) => (
                <LineRow
                  key={line.id}
                  line={line}
                  items={items}
                  onChanged={onChanged}
                  onDelete={() => setRemoveTarget(line)}
                />
              ))}
            </div>
          </section>
        ))}

      {addTarget !== null && (
        <AddLineModal
          type={type}
          target={addTarget}
          items={items}
          products={productsOfType}
          onClose={() => setAddTarget(null)}
          onDone={async () => {
            setAddTarget(null);
            await onChanged();
          }}
        />
      )}

      {removeTarget && (
        <ConfirmDeleteModal
          title="حذف سطر الوصفة"
          warning="سيُحذف هذا السطر من الوصفة ولن يُحتسب بعدها ضمن تكلفة المواد."
          onConfirm={() => deleteCostLine(removeTarget.id)}
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

function LineRow({
  line,
  items,
  onChanged,
  onDelete,
}: {
  line: CostLine;
  items: CostItem[];
  onChanged: () => Promise<void>;
  onDelete: () => void;
}) {
  const [itemId, setItemId] = useState(line.cost_item_id);
  const [qty, setQty] = useState(String(line.qty));
  const [audience, setAudience] = useState<CostLineAudience>(line.audience);
  const [note, setNote] = useState(line.note_ar || "");
  const [saving, setSaving] = useState(false);

  const item = items.find((i) => i.id === itemId);
  const qtyNum = parseAmount(qty);
  const computed = item && Number.isFinite(qtyNum) ? item.unit_cost * qtyNum : 0;

  const dirty =
    itemId !== line.cost_item_id ||
    qtyNum !== line.qty ||
    audience !== line.audience ||
    note !== (line.note_ar || "");

  async function save() {
    if (!item || !Number.isFinite(qtyNum) || qtyNum <= 0) {
      toast.error("تحقق من البند والكمية");
      return;
    }
    setSaving(true);
    try {
      await updateCostLine(line.id, {
        cost_item_id: itemId,
        qty: qtyNum,
        audience,
        note_ar: note.trim() || null,
      });
      toast.success("تم الحفظ");
      await onChanged();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّر الحفظ"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-[1.4fr_0.7fr_0.8fr_1fr]">
        <Select
          aria-label="البند"
          value={itemId}
          onChange={(e) => setItemId(e.target.value)}
          options={items.map((i) => ({
            value: i.id,
            label: `${i.name_ar} (${i.unit_ar} = ${formatIQD(i.unit_cost)})`,
          }))}
        />
        <Input
          aria-label="الكمية"
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder={item?.unit_ar || "الكمية"}
        />
        <Select
          aria-label="لمين"
          value={audience}
          onChange={(e) => setAudience(e.target.value as CostLineAudience)}
          options={AUDIENCES.map((a) => ({ value: a, label: COST_LINE_AUDIENCE_LABEL[a] }))}
        />
        <Input aria-label="ملاحظة" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة (اختياري)" />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-ink-soft">
          تكلفة السطر: <b className="text-ink" dir="ltr">{formatIQD(computed)}</b>
        </span>
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

function AddLineModal({
  type,
  target,
  items,
  products,
  onClose,
  onDone,
}: {
  type: ProductType;
  target: "type" | string;
  items: CostItem[];
  products: CostProduct[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [scope, setScope] = useState<"type" | string>(target);
  const [itemId, setItemId] = useState(items[0]?.id || "");
  const [qty, setQty] = useState("1");
  const [audience, setAudience] = useState<CostLineAudience>("all");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const qtyNum = parseAmount(qty);
    if (!itemId || !Number.isFinite(qtyNum) || qtyNum <= 0) {
      toast.error("تحقق من البند والكمية");
      return;
    }
    setSaving(true);
    try {
      await createCostLine({
        product_type: type,
        product_id: scope === "type" ? null : scope,
        audience,
        cost_item_id: itemId,
        qty: qtyNum,
        note_ar: note.trim() || null,
      });
      toast.success("تمت إضافة السطر");
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
      title="سطر وصفة جديد"
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
        <Select
          label="لمين هذا السطر"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          options={[
            { value: "type", label: `لكل ${PRODUCT_TYPE_LABEL[type]} من هذا النوع` },
            ...products.map((p) => ({ value: p.id, label: `فقط ${p.name_ar}` })),
          ]}
        />
        <Select
          label="البند"
          value={itemId}
          onChange={(e) => setItemId(e.target.value)}
          options={items.map((i) => ({
            value: i.id,
            label: `${i.name_ar} (${i.unit_ar} = ${formatIQD(i.unit_cost)})`,
          }))}
        />
        <Input
          label="الكمية"
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <Select
          label="لمين الجمهور"
          value={audience}
          onChange={(e) => setAudience(e.target.value as CostLineAudience)}
          options={AUDIENCES.map((a) => ({ value: a, label: COST_LINE_AUDIENCE_LABEL[a] }))}
        />
        <Input label="ملاحظة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}
