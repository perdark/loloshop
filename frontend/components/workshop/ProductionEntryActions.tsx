"use client";

/* «تعديل» و«حذف» لسطر قطع مسجّل — مشتركة بين شاشة العامل (`/workshop`) ولوحة الإدارة
   (`/admin/workshop`).
   ⚠️ مكوّن واحد عن قصد: الشاشتين تعدّلان نفس السطر ونفس الفلوس، ونسخة ثانية معناها
   يوم تختلف فيه قواعد «شنو يصير تعدّله» بين الاثنين بدون ما ينتبه أحد.
   ⚠️ السعر والمجموع ما ينرسلون أبداً — السيرفر يحسبهم من `workshop_piece_rates` حسب
   (القطعة، نوع الشغل، لمين). اللي هنا مجرد معاينة للمستخدم. */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { formatIQD } from "@/lib/format";
import { getApiErrorMessage } from "@/lib/api";
import {
  deleteProductionEntry, updateProductionEntry,
  type RateRow, type WorkshopAudience, type WorkshopLedgerEntry,
  type WorkshopOperation, type WorkshopProduct,
} from "@/lib/workshop";

/** The row this component can act on: a `production` entry with its own id. */
export interface EditableEntry {
  id: string;
  kind: WorkshopLedgerEntry["kind"];
  product: WorkshopProduct | null;
  operation: WorkshopOperation | null;
  audience: WorkshopAudience | null;
  qty: number;
  amount: number;
  entry_date: string;
  reason: string | null;
  product_label_ar: string | null;
  operation_label_ar: string | null;
}

/** حافز/خصم ما إله سعر قطعة، فما ينعدّل من هنا — القرار مالته إداري، مو تصحيح تسجيل. */
export function isEditableEntry(e: { kind: string }): boolean {
  return e.kind === "production";
}

export function ProductionEntryActions({
  entry, rates, onDone, size = "sm",
}: {
  entry: EditableEntry;
  rates: RateRow[];
  onDone: () => Promise<void> | void;
  size?: "sm" | "md";
}) {
  const [mode, setMode] = useState<null | "edit" | "delete">(null);
  if (!isEditableEntry(entry)) return null;
  return (
    <>
      <div className="flex shrink-0 gap-2">
        <Button size={size} variant="secondary" onClick={() => setMode("edit")}>تعديل</Button>
        <Button size={size} variant="danger" onClick={() => setMode("delete")}>حذف</Button>
      </div>
      {mode === "edit" && (
        <EditEntryModal entry={entry} rates={rates}
          onClose={() => setMode(null)}
          onDone={async () => { setMode(null); await onDone(); }} />
      )}
      {mode === "delete" && (
        <DeleteEntryModal entry={entry}
          onClose={() => setMode(null)}
          onDone={async () => { setMode(null); await onDone(); }} />
      )}
    </>
  );
}

function EditEntryModal({ entry, rates, onClose, onDone }: {
  entry: EditableEntry; rates: RateRow[]; onClose: () => void; onDone: () => Promise<void> | void;
}) {
  const [audience, setAudience] = useState<WorkshopAudience>(entry.audience || "wholesale");
  const [product, setProduct] = useState<WorkshopProduct>(entry.product || "sash");
  const [operation, setOperation] = useState<WorkshopOperation>(entry.operation || "cut");
  const [qty, setQty] = useState(String(entry.qty));
  const [date, setDate] = useState((entry.entry_date || "").slice(0, 10));
  const [note, setNote] = useState(entry.reason || "");
  const [busy, setBusy] = useState(false);

  // The rate matrix is the vocabulary: which products exist, and which jobs each one allows.
  // Reading it here (instead of a second hard-coded list) is what keeps this modal correct
  // when a new operation is added — the backend's PRODUCT_OPS is the only source.
  const jobs = useMemo(() => rates.filter((r) => r.audience === audience), [rates, audience]);
  const products = useMemo(() => {
    const seen = new Map<WorkshopProduct, string>();
    for (const r of jobs) if (!seen.has(r.product)) seen.set(r.product, r.product_label_ar);
    return [...seen.entries()];
  }, [jobs]);
  const available = useMemo(() => jobs.filter((r) => r.product === product), [jobs, product]);
  const rate = available.find((r) => r.operation === operation)?.amount ?? 0;

  function changeProduct(next: WorkshopProduct) {
    setProduct(next);
    const first = jobs.find((r) => r.product === next)?.operation;
    if (first && !jobs.some((r) => r.product === next && r.operation === operation)) setOperation(first);
  }

  async function save() {
    const count = Math.floor(Number(qty));
    if (!(count >= 1)) { toast.error("الكمية غير صحيحة"); return; }
    setBusy(true);
    try {
      await updateProductionEntry(entry.id, {
        product, operation, audience, qty: count,
        work_date: date || undefined, note: note.trim(),
      });
      toast.success("تم تعديل التسجيل");
      await onDone();
    } catch (e) { toast.error(getApiErrorMessage(e, "تعذّر التعديل")); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="تعديل التسجيل"
      footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button onClick={save} loading={busy}>حفظ</Button></>}>
      <div className="space-y-3">
        <Select label="لمين هالشغل" value={audience}
          onChange={(e) => setAudience(e.target.value as WorkshopAudience)}
          options={[{ value: "wholesale", label: "ممثلين" }, { value: "retail", label: "تجزئة" }]} />
        <Select label="القطعة" value={product}
          onChange={(e) => changeProduct(e.target.value as WorkshopProduct)}
          options={products.map(([value, label]) => ({ value, label }))} />
        <Select label="نوع الشغل" value={operation}
          onChange={(e) => setOperation(e.target.value as WorkshopOperation)}
          options={available.map((r) => ({ value: r.operation, label: r.operation_label_ar }))} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="عدد القطع" type="number" min={1} inputMode="numeric"
            value={qty} onChange={(e) => setQty(e.target.value)} />
          <Input label="التاريخ" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <Input label="ملاحظة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="rounded-xl bg-surface-sink p-3 text-sm text-ink-soft">
          سعر القطعة {formatIQD(rate)} · المجموع الجديد{" "}
          <b className="text-ink">{formatIQD((Number(qty) || 0) * rate)}</b>
          {entry.amount ? <> · كان <b className="text-ink">{formatIQD(entry.amount)}</b></> : null}
        </p>
      </div>
    </Modal>
  );
}

function DeleteEntryModal({ entry, onClose, onDone }: {
  entry: EditableEntry; onClose: () => void; onDone: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await deleteProductionEntry(entry.id);
      toast.success("تم حذف التسجيل");
      await onDone();
    } catch (e) { toast.error(getApiErrorMessage(e, "تعذّر الحذف")); }
    finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="حذف التسجيل"
      footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button variant="danger" onClick={confirm} loading={busy}>حذف</Button></>}>
      <div className="space-y-2 text-sm">
        <p className="text-ink">
          راح ينحذف <b>{entry.operation_label_ar} · {entry.product_label_ar} × {entry.qty}</b> ومعاه{" "}
          <b className="text-orange-ink">{formatIQD(entry.amount)}</b> من الأجور.
        </p>
        <p className="text-ink-soft">إذا الغلط بالعدد بس، «تعديل» أفضل من الحذف.</p>
      </div>
    </Modal>
  );
}
