"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  formatPayoutAccountNumber,
  formatPayoutCardNumber,
  normalizePayoutAccountNumber,
  normalizePayoutCardNumber,
  type PayoutAccount,
  type PayoutAccountInput,
} from "@/lib/payments";

interface PayoutAccountPanelProps {
  account: PayoutAccount | null;
  ownerName: string;
  onSave: (input: PayoutAccountInput) => Promise<PayoutAccount>;
}

/** Both numbers must be on file — a card alone can no longer be saved or paid. */
const isComplete = (account: PayoutAccount | null) =>
  Boolean(account?.cardNumber && account?.accountNumber);

export function PayoutAccountPanel({
  account,
  ownerName,
  onSave,
}: PayoutAccountPanelProps) {
  const [editing, setEditing] = useState(!isComplete(account));
  const [cardNumber, setCardNumber] = useState(account?.cardNumber || "");
  const [accountNumber, setAccountNumber] = useState(account?.accountNumber || "");
  const [cardholderName, setCardholderName] = useState(
    account?.cardholderName || ownerName
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCardNumber(account?.cardNumber || "");
    setAccountNumber(account?.accountNumber || "");
    setCardholderName(account?.cardholderName || ownerName);
    setEditing(!isComplete(account));
  }, [account, ownerName]);

  async function copyValue(value: string | null | undefined, label: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`تم نسخ ${label}`);
    } catch {
      toast.error("تعذّر نسخ الرقم");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalizedCard = normalizePayoutCardNumber(cardNumber);
    if (normalizedCard.length !== 16) {
      toast.error("رقم البطاقة يجب أن يتكون من 16 رقماً");
      return;
    }
    const normalizedAccount = normalizePayoutAccountNumber(accountNumber);
    if (normalizedAccount.length !== 9) {
      toast.error("رقم حساب SuperQi يجب أن يتكون من 9 أرقام");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        cardNumber: normalizedCard,
        accountNumber: normalizedAccount,
        cardholderName,
      });
      setEditing(false);
      toast.success("تم حفظ بيانات استلام الراتب");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="font-bold text-ink">بطاقة استلام الراتب</h2>
          <p className="mt-1 text-sm text-ink-soft">
            بطاقة SuperQi Mastercard ورقم حساب SuperQi اللذان تستلم عليهما
            مستحقاتك.
          </p>
        </div>
        {isComplete(account) && !editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            تعديل البيانات
          </Button>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] items-center gap-5 p-5">
        <div className="relative min-h-48 overflow-hidden rounded-2xl bg-ink p-5 text-cream">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-lg font-bold">SuperQi</p>
              <p className="mt-0.5 text-xs text-cream/65">Mastercard · العراق</p>
            </div>
            <span className="rounded-full border border-cream/20 px-3 py-1 text-xs text-cream/75">
              راتب
            </span>
          </div>
          <p
            className="mt-10 whitespace-nowrap text-left text-lg font-semibold tracking-[0.12em] tabular-nums sm:text-xl"
            dir="ltr"
          >
            {account?.cardNumber
              ? formatPayoutCardNumber(account.cardNumber)
              : "•••• •••• •••• ••••"}
          </p>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-cream/15 pt-3">
            <div className="min-w-0">
              <p className="text-[11px] text-cream/55">رقم حساب SuperQi</p>
              <p
                className="mt-0.5 text-left text-sm font-semibold tracking-[0.12em] tabular-nums"
                dir="ltr"
              >
                {account?.accountNumber
                  ? formatPayoutAccountNumber(account.accountNumber)
                  : "••• ••• •••"}
              </p>
            </div>
            {account?.accountNumber && (
              <button
                type="button"
                onClick={() => copyValue(account.accountNumber, "رقم الحساب")}
                className="min-h-11 shrink-0 rounded-full border border-cream/25 px-4 text-xs font-semibold transition-colors hover:bg-cream/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
              >
                نسخ الحساب
              </button>
            )}
          </div>
          <div className="mt-4 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] text-cream/55">اسم حامل البطاقة</p>
              <p className="mt-0.5 truncate text-sm font-semibold">
                {account?.cardholderName || ownerName}
              </p>
            </div>
            {account?.cardNumber && (
              <button
                type="button"
                onClick={() => copyValue(account.cardNumber, "رقم البطاقة")}
                className="min-h-11 shrink-0 rounded-full border border-cream/25 px-4 text-xs font-semibold transition-colors hover:bg-cream/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
              >
                نسخ الرقم
              </button>
            )}
          </div>
        </div>

        {editing ? (
          <form onSubmit={submit} className="space-y-3">
            <Input
              label="رقم بطاقة SuperQi"
              value={formatPayoutCardNumber(cardNumber)}
              onChange={(event) =>
                setCardNumber(normalizePayoutCardNumber(event.target.value))
              }
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="0000 0000 0000 0000"
              dir="ltr"
            />
            <Input
              label="رقم حساب SuperQi (9 أرقام)"
              value={formatPayoutAccountNumber(accountNumber)}
              onChange={(event) =>
                setAccountNumber(normalizePayoutAccountNumber(event.target.value))
              }
              inputMode="numeric"
              autoComplete="off"
              placeholder="000 000 000"
              dir="ltr"
            />
            <Input
              label="اسم حامل البطاقة (اختياري)"
              value={cardholderName}
              onChange={(event) => setCardholderName(event.target.value)}
              maxLength={120}
              autoComplete="cc-name"
            />
            <p className="text-xs leading-5 text-ink-soft">
              أدخل رقم البطاقة ورقم الحساب فقط. لا تدخل الرمز السري أو CVV أبداً.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="submit" loading={saving}>
                حفظ البيانات
              </Button>
              {isComplete(account) && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCardNumber(account?.cardNumber || "");
                    setAccountNumber(account?.accountNumber || "");
                    setCardholderName(account?.cardholderName || ownerName);
                    setEditing(false);
                  }}
                >
                  إلغاء
                </Button>
              )}
            </div>
          </form>
        ) : (
          <div className="rounded-xl bg-surface-sink p-4">
            <p className="font-semibold text-ink">البيانات جاهزة للاستلام</p>
            <p className="mt-1 text-sm leading-6 text-ink-soft">
              يستطيع المدير نسخ رقم البطاقة أو رقم الحساب من شاشة الرواتب وتحويل
              المبلغ يدوياً عبر تطبيق البنك.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
