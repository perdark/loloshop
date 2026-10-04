"use client";

/**
 * «المصاريف والخسائر» — everything that isn't a per-piece material: rent-like monthly
 * costs, a one-time purchase, or a loss (ruined fabric, a free redo). Plus the two settings
 * every other tab's numbers depend on — the USD→IQD rate (the AI bill is billed in USD) and
 * the estimated day rate for a worker with no registered salary.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { formatIQD } from "@/lib/format";
import { getApiErrorMessage } from "@/lib/api";
import {
  createExpense,
  deleteExpense,
  updateCostSettings,
  updateExpense,
  type CostSettings,
  type Expense,
  type ExpenseKind,
  parseAmount,
} from "@/lib/costs";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

const SECTIONS: { kind: ExpenseKind; title: string; hint: string }[] = [
  { kind: "monthly", title: "شهرية ثابتة", hint: "مبلغ يتكرر كل شهر — إيجار، اشتراك، صيانة…" },
  { kind: "one_off", title: "لمرة واحدة", hint: "شراء أو مصروف حصل مرة واحدة بتاريخ محدد" },
  { kind: "loss", title: "خسائر", hint: "قماش تالف، طلب أُعيد مجاناً، أي خسارة فعلية" },
];

export function ExpensesTab({
  expenses,
  settings,
  onChanged,
}: {
  expenses: Expense[];
  settings: CostSettings;
  onChanged: () => Promise<void>;
}) {
  const [addingKind, setAddingKind] = useState<ExpenseKind | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Expense | null>(null);

  return (
    <div className="space-y-8">
      <SettingsBox settings={settings} onChanged={onChanged} />

      {SECTIONS.map((section) => {
        const rows = expenses
          .filter((e) => e.kind === section.kind)
          .sort((a, b) => b.starts_on.localeCompare(a.starts_on));
        return (
          <section key={section.kind}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-ink">{section.title}</h3>
                <p className="text-xs text-ink-soft">{section.hint}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setAddingKind(section.kind)}>
                + إضافة
              </Button>
            </div>
            {rows.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line bg-surface-sink px-4 py-6 text-center text-sm text-ink-soft">
                لا توجد بنود هنا بعد.
              </p>
            ) : (
              <div className="space-y-2">
                {rows.map((expense) => (
                  <ExpenseRow
                    key={expense.id}
                    expense={expense}
                    onChanged={onChanged}
                    onDelete={() => setRemoveTarget(expense)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {addingKind && (
        <AddExpenseModal
          kind={addingKind}
          onClose={() => setAddingKind(null)}
          onDone={async () => {
            setAddingKind(null);
            await onChanged();
          }}
        />
      )}

      {removeTarget && (
        <ConfirmDeleteModal
          title={`حذف — ${removeTarget.name_ar}`}
          warning="سيُحذف هذا البند نهائياً من تقرير الربح لكل الأشهر التي يشملها."
          onConfirm={() => deleteExpense(removeTarget.id)}
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

function ExpenseRow({
  expense,
  onChanged,
  onDelete,
}: {
  expense: Expense;
  onChanged: () => Promise<void>;
  onDelete: () => void;
}) {
  const [nameAr, setNameAr] = useState(expense.name_ar);
  const [category, setCategory] = useState(expense.category);
  const [amount, setAmount] = useState(String(expense.amount));
  const [startsOn, setStartsOn] = useState(expense.starts_on.slice(0, 10));
  const [endsOn, setEndsOn] = useState(expense.ends_on ? expense.ends_on.slice(0, 10) : "");
  const [noteAr, setNoteAr] = useState(expense.note_ar || "");
  const [saving, setSaving] = useState(false);

  const dirty =
    nameAr !== expense.name_ar ||
    category !== expense.category ||
    Number(amount) !== expense.amount ||
    startsOn !== expense.starts_on.slice(0, 10) ||
    endsOn !== (expense.ends_on ? expense.ends_on.slice(0, 10) : "") ||
    noteAr !== (expense.note_ar || "");

  async function save() {
    const amt = parseAmount(amount);
    if (!nameAr.trim() || !Number.isFinite(amt) || amt < 0 || !startsOn) {
      toast.error("تحقق من الاسم والمبلغ والتاريخ");
      return;
    }
    setSaving(true);
    try {
      await updateExpense(expense.id, {
        name_ar: nameAr.trim(),
        category: category.trim() || "أخرى",
        amount: amt,
        starts_on: startsOn,
        ends_on: expense.kind === "monthly" ? endsOn || null : expense.ends_on,
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
      await updateExpense(expense.id, { confirmed: !expense.confirmed });
      await onChanged();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّر التحديث"));
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-[1.2fr_0.8fr_0.8fr]">
        <Input aria-label="الاسم" value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="الاسم" />
        <Input aria-label="الفئة" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="الفئة" />
        <Input
          aria-label="المبلغ"
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="المبلغ (د.ع)"
        />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[0.7fr_0.7fr_1.2fr]">
        <Input
          aria-label={expense.kind === "monthly" ? "يبدأ من شهر" : "التاريخ"}
          type="date"
          dir="ltr"
          value={startsOn}
          onChange={(e) => setStartsOn(e.target.value)}
        />
        {expense.kind === "monthly" && (
          <Input
            aria-label="ينتهي في (اختياري)"
            type="date"
            dir="ltr"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            placeholder="مستمر"
          />
        )}
        <Input aria-label="ملاحظة" value={noteAr} onChange={(e) => setNoteAr(e.target.value)} placeholder="ملاحظة (اختياري)" />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={toggleConfirmed}
            aria-pressed={expense.confirmed}
            className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors ${
              expense.confirmed
                ? "border-green-600/40 bg-green-50 text-green-800"
                : "border-amber-300 bg-amber-50 text-amber-900"
            }`}
          >
            {expense.confirmed ? "مؤكد" : "تقديري"}
          </button>
          <span className="text-xs text-ink-soft" dir="ltr">
            = {formatIQD(expense.amount)}
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

function AddExpenseModal({
  kind,
  onClose,
  onDone,
}: {
  kind: ExpenseKind;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [nameAr, setNameAr] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [startsOn, setStartsOn] = useState(new Date().toISOString().slice(0, 10));
  const [confirmed, setConfirmed] = useState(false);
  const [noteAr, setNoteAr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const amt = parseAmount(amount);
    if (!nameAr.trim() || !Number.isFinite(amt) || amt < 0 || !startsOn) {
      toast.error("تحقق من الاسم والمبلغ والتاريخ");
      return;
    }
    setSaving(true);
    try {
      await createExpense({
        kind,
        category: category.trim() || "أخرى",
        name_ar: nameAr.trim(),
        amount: amt,
        starts_on: startsOn,
        ends_on: null,
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
      title="بند جديد"
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
        <Input label="الاسم" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        <Input label="الفئة" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="إيجار، صيانة، مواد…" />
        <Input
          label="المبلغ (د.ع)"
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input
          label={kind === "monthly" ? "يبدأ من (تاريخ داخل الشهر الأول)" : "التاريخ"}
          type="date"
          dir="ltr"
          value={startsOn}
          onChange={(e) => setStartsOn(e.target.value)}
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

function SettingsBox({
  settings,
  onChanged,
}: {
  settings: CostSettings;
  onChanged: () => Promise<void>;
}) {
  const [usdIqd, setUsdIqd] = useState(String(settings.usd_iqd));
  const [dayRate, setDayRate] = useState(String(settings.unsalaried_day_rate));
  const [saving, setSaving] = useState(false);

  const dirty = Number(usdIqd) !== settings.usd_iqd || Number(dayRate) !== settings.unsalaried_day_rate;

  async function save() {
    const rate = parseAmount(usdIqd);
    const day = parseAmount(dayRate);
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(day) || day < 0) {
      toast.error("تحقق من الأرقام");
      return;
    }
    setSaving(true);
    try {
      await updateCostSettings({ usd_iqd: rate, unsalaried_day_rate: day });
      toast.success("تم حفظ الإعدادات");
      await onChanged();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّر الحفظ"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-surface-sink p-4">
      <h3 className="mb-3 text-base font-bold text-ink">الإعدادات العامة</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="سعر صرف الدولار (د.ع لكل دولار)"
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={usdIqd}
          onChange={(e) => setUsdIqd(e.target.value)}
        />
        <Input
          label="أجر اليوم التقديري للموظف اللي ماله راتب (د.ع)"
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={dayRate}
          onChange={(e) => setDayRate(e.target.value)}
        />
      </div>
      <Button className="mt-3" size="sm" onClick={save} loading={saving} disabled={!dirty}>
        حفظ الإعدادات
      </Button>
    </section>
  );
}
