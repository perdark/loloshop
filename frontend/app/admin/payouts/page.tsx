"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { getApiErrorMessage } from "@/lib/api";
import { formatDateShort, formatIQD } from "@/lib/format";
import {
  formatPayoutAccountNumber,
  formatPayoutCardNumber,
  getAdminPayouts,
  normalizePayoutAccountNumber,
  normalizePayoutCardNumber,
  recordManualPayout,
  saveAdminPayoutAccount,
  type ManualPayout,
  type PayoutRecipient,
  type PayoutRecipientKind,
} from "@/lib/payments";

type Filter = "all" | PayoutRecipientKind;

/**
 * A destination is both numbers. A recipient saved before migration 073 has a
 * card but no account number — the server refuses to record a transfer for them
 * until an admin completes it here, so the row must read as "not ready".
 */
const isReady = (recipient: PayoutRecipient) =>
  Boolean(recipient.cardNumber && recipient.accountNumber);

const KIND_LABELS: Record<PayoutRecipientKind, string> = {
  staff: "الموظفون",
  tailor: "الفصال",
  workshop: "الورشة",
};

export default function AdminPayoutsPage() {
  const [recipients, setRecipients] = useState<PayoutRecipient[]>([]);
  const [history, setHistory] = useState<ManualPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [sendTarget, setSendTarget] = useState<PayoutRecipient | null>(null);
  const [editTarget, setEditTarget] = useState<PayoutRecipient | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await getAdminPayouts();
      setRecipients(data.recipients);
      setHistory(data.history);
    } catch (caught) {
      setError(getApiErrorMessage(caught, "تعذّر تحميل بيانات الرواتب"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleRecipients = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("ar");
    return recipients.filter((recipient) => {
      if (filter !== "all" && recipient.recipientKind !== filter) return false;
      return !term || recipient.name.toLocaleLowerCase("ar").includes(term);
    });
  }, [filter, recipients, search]);

  const readyCount = recipients.filter(isReady).length;
  const missingCount = recipients.length - readyCount;

  return (
    <div className="animate-step-in" dir="rtl">
      <PageHeader
        title="تحويل الرواتب"
        subtitle="بطاقات SuperQi والتحويلات اليدوية للموظفين والورشة والفصال"
        backHref="/admin"
      />

      <div className="mb-6 flex items-start gap-3 rounded-xl border border-line bg-surface-sink px-4 py-3 text-sm leading-6 text-ink-soft">
        <span
          aria-hidden
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-cream"
        >
          i
        </span>
        <p>
          النظام لا يرسل المال تلقائياً. انسخ رقم البطاقة أو رقم الحساب، حوّل
          المبلغ من تطبيق البنك، ثم اضغط «تم التحويل» لتسجيل العملية.
        </p>
      </div>

      {loading ? (
        <PayoutsSkeleton />
      ) : error ? (
        <div className="rounded-2xl border border-danger/30 bg-surface px-6 py-12 text-center">
          <p className="font-bold text-ink">{error}</p>
          <Button
            className="mt-4"
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            إعادة المحاولة
          </Button>
        </div>
      ) : (
        <>
          <section className="mb-8 border-y border-line">
            <dl className="flex flex-wrap divide-x divide-x-reverse divide-line">
              <Summary label="مستلم راتب" value={recipients.length} />
              <Summary label="بيانات جاهزة" value={readyCount} />
              <Summary label="بانتظار البيانات" value={missingCount} warn={missingCount > 0} />
            </dl>
          </section>

          <section aria-labelledby="recipients-title">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="recipients-title" className="text-lg font-bold text-ink">
                  مستلمو الرواتب
                </h2>
                <p className="mt-1 text-sm text-ink-soft">
                  المبلغ الظاهر مقترح من حساب الراتب أو أجور القطع، ويمكن تعديله
                  قبل التسجيل.
                </p>
              </div>
              <div className="w-full sm:w-64">
                <Input
                  aria-label="بحث باسم المستلم"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="ابحث بالاسم…"
                />
              </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="تصفية المستلمين">
              {(
                [
                  ["all", "الكل"],
                  ["staff", "الموظفون"],
                  ["workshop", "الورشة"],
                  ["tailor", "الفصال"],
                ] as [Filter, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  aria-pressed={filter === key}
                  className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors ${
                    filter === key
                      ? "border-ink bg-ink text-cream"
                      : "border-line bg-surface text-ink hover:border-ink/35"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {visibleRecipients.length === 0 ? (
              <div className="rounded-2xl border border-line bg-surface px-5 py-12 text-center text-sm text-ink-soft">
                لا يوجد مستلمون يطابقون البحث.
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-line bg-surface">
                <ul className="divide-y divide-line">
                  {visibleRecipients.map((recipient) => (
                    <RecipientRow
                      key={`${recipient.recipientKind}:${recipient.sourceId}`}
                      recipient={recipient}
                      onSend={() => setSendTarget(recipient)}
                      onEdit={() => setEditTarget(recipient)}
                    />
                  ))}
                </ul>
              </div>
            )}
          </section>

          <HistoryList history={history} />
        </>
      )}

      {sendTarget && (
        <SendPayoutModal
          recipient={sendTarget}
          onClose={() => setSendTarget(null)}
          onSaved={async () => {
            setSendTarget(null);
            await load();
          }}
        />
      )}
      {editTarget && (
        <EditCardModal
          recipient={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={async () => {
            setEditTarget(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function Summary({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div className="min-w-32 flex-1 px-4 py-5">
      <dt className="text-xs font-medium text-ink-soft">{label}</dt>
      <dd className={`mt-1 text-2xl font-bold ${warn ? "text-danger" : "text-ink"}`}>
        {value.toLocaleString("ar-IQ")}
      </dd>
    </div>
  );
}

function RecipientRow({
  recipient,
  onSend,
  onEdit,
}: {
  recipient: PayoutRecipient;
  onSend: () => void;
  onEdit: () => void;
}) {
  return (
    <li className="grid gap-4 px-4 py-4 md:grid-cols-[minmax(170px,1fr)_minmax(190px,1fr)_minmax(150px,0.7fr)_auto] md:items-center md:px-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-bold text-ink">{recipient.name}</p>
          <span className="rounded-full bg-surface-sink px-2.5 py-1 text-xs font-medium text-ink-soft">
            {KIND_LABELS[recipient.recipientKind]}
          </span>
        </div>
        {recipient.lastPayoutAt && (
          <p className="mt-1 text-xs text-ink-soft">
            آخر تحويل {formatDateShort(recipient.lastPayoutAt)}
            {recipient.lastPayoutAmount != null
              ? ` · ${formatIQD(recipient.lastPayoutAmount)}`
              : ""}
          </p>
        )}
      </div>

      {recipient.cardNumber ? (
        <div className="min-w-0">
          <p className="text-xs text-ink-soft">SuperQi Mastercard</p>
          <p
            dir="ltr"
            className="mt-1 text-left font-semibold tracking-[0.08em] text-ink tabular-nums"
          >
            {formatPayoutCardNumber(recipient.cardNumber)}
          </p>
          {recipient.accountNumber ? (
            <p className="mt-1 text-xs text-ink-soft">
              رقم الحساب{" "}
              <span dir="ltr" className="font-semibold tabular-nums text-ink">
                {formatPayoutAccountNumber(recipient.accountNumber)}
              </span>
            </p>
          ) : (
            <button
              type="button"
              onClick={onEdit}
              className="mt-1 inline-flex min-h-11 items-center text-xs font-semibold text-danger underline underline-offset-4"
            >
              + أضف رقم حساب SuperQi
            </button>
          )}
          <p className="mt-1 truncate text-xs text-ink-soft">
            {recipient.cardholderName || recipient.name}
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={onEdit}
          className="min-h-11 justify-self-start rounded-full border border-dashed border-danger/45 px-4 text-sm font-semibold text-danger hover:bg-danger/5"
        >
          + إضافة البطاقة والحساب
        </button>
      )}

      <div>
        <p className="text-xs text-ink-soft">المبلغ المقترح</p>
        <p className="mt-1 font-bold text-ink">{formatIQD(recipient.suggestedAmount)}</p>
      </div>

      <div className="flex flex-wrap gap-2 md:justify-end">
        {recipient.cardNumber && (
          <>
            <CopyButton text={recipient.cardNumber} label="نسخ البطاقة" />
            {recipient.accountNumber && (
              <CopyButton text={recipient.accountNumber} label="نسخ الحساب" />
            )}
            <Button size="sm" variant="ghost" onClick={onEdit}>
              تعديل
            </Button>
          </>
        )}
        <Button size="sm" onClick={onSend} disabled={!isReady(recipient)}>
          إرسال المبلغ
        </Button>
      </div>
    </li>
  );
}

function SendPayoutModal({
  recipient,
  onClose,
  onSaved,
}: {
  recipient: PayoutRecipient;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [amount, setAmount] = useState(
    recipient.suggestedAmount > 0 ? String(recipient.suggestedAmount) : ""
  );
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const parsed = Number(String(amount).replace(/\D/g, ""));
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      toast.error("أدخل مبلغاً صحيحاً");
      return;
    }
    setSaving(true);
    try {
      await recordManualPayout(recipient, parsed, note);
      toast.success("تم تسجيل التحويل اليدوي");
      await onSaved();
    } catch (caught) {
      toast.error(getApiErrorMessage(caught, "تعذّر تسجيل التحويل"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`إرسال راتب — ${recipient.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save} loading={saving}>
            تم التحويل — سجل العملية
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-ink p-4 text-cream">
          <p className="text-xs text-cream/60">SuperQi Mastercard</p>
          <p
            dir="ltr"
            className="mt-2 text-left text-lg font-semibold tracking-[0.1em] tabular-nums"
          >
            {formatPayoutCardNumber(recipient.cardNumber)}
          </p>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-cream/15 pt-3">
            <div className="min-w-0">
              <p className="text-xs text-cream/60">رقم حساب SuperQi</p>
              <p dir="ltr" className="mt-1 text-left font-semibold tabular-nums">
                {formatPayoutAccountNumber(recipient.accountNumber)}
              </p>
            </div>
            <CopyButton
              text={recipient.accountNumber || ""}
              label="نسخ الحساب"
              className="border-cream/25 bg-transparent text-cream hover:border-cream/45 hover:text-cream"
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="truncate text-sm">
              {recipient.cardholderName || recipient.name}
            </p>
            <CopyButton
              text={recipient.cardNumber || ""}
              label="نسخ الرقم"
              className="border-cream/25 bg-transparent text-cream hover:border-cream/45 hover:text-cream"
            />
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface-sink p-3 text-sm leading-6 text-ink-soft">
          حوّل المبلغ أولاً من تطبيق البنك. هذا الزر يسجل العملية فقط ولا يرسل
          أي أموال.
        </div>
        <Input
          label="المبلغ المحوّل (د.ع)"
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          dir="ltr"
        />
        <Input
          label="ملاحظة (اختياري)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
          placeholder="مثال: راتب شهر تموز"
        />
      </div>
    </Modal>
  );
}

function EditCardModal({
  recipient,
  onClose,
  onSaved,
}: {
  recipient: PayoutRecipient;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [cardNumber, setCardNumber] = useState(recipient.cardNumber || "");
  const [accountNumber, setAccountNumber] = useState(recipient.accountNumber || "");
  const [cardholderName, setCardholderName] = useState(
    recipient.cardholderName || recipient.name
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    const normalizedCard = normalizePayoutCardNumber(cardNumber);
    if (normalizedCard.length !== 16) {
      toast.error("رقم البطاقة يجب أن يتكون من 16 رقماً");
      return;
    }
    const normalizedAccount = normalizePayoutAccountNumber(accountNumber);
    if (!normalizedAccount) {
      toast.error("أدخل رقم حساب SuperQi");
      return;
    }
    setSaving(true);
    try {
      await saveAdminPayoutAccount(recipient.userId, {
        cardNumber: normalizedCard,
        accountNumber: normalizedAccount,
        cardholderName,
      });
      toast.success("تم حفظ بيانات المستلم");
      await onSaved();
    } catch (caught) {
      toast.error(getApiErrorMessage(caught, "تعذّر حفظ البيانات"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`بيانات SuperQi — ${recipient.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save} loading={saving}>
            حفظ البيانات
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="رقم البطاقة"
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
          label="رقم حساب SuperQi"
          value={formatPayoutAccountNumber(accountNumber)}
          onChange={(event) =>
            setAccountNumber(normalizePayoutAccountNumber(event.target.value))
          }
          inputMode="numeric"
          autoComplete="off"
          placeholder="أدخل الرقم كما هو"
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
          احفظ رقم البطاقة ورقم الحساب فقط. لا تطلب أو تسجل PIN أو CVV.
        </p>
      </div>
    </Modal>
  );
}

function HistoryList({ history }: { history: ManualPayout[] }) {
  return (
    <section className="mt-10" aria-labelledby="history-title">
      <div className="mb-4">
        <h2 id="history-title" className="text-lg font-bold text-ink">
          سجل التحويلات اليدوية
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          سجل إداري للعمليات التي تم تحويلها خارج النظام.
        </p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {history.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-soft">
            لا توجد تحويلات مسجلة بعد.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {history.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink">{entry.name}</p>
                    <span className="text-xs text-ink-soft">
                      {KIND_LABELS[entry.recipientKind]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">
                    {formatDateShort(entry.paidAt)}
                    {entry.createdByName ? ` · سجله ${entry.createdByName}` : ""}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-ink">{formatIQD(entry.amount)}</span>
                  <CopyButton text={entry.cardNumberSnapshot} label="نسخ البطاقة" />
                  {entry.accountNumberSnapshot && (
                    <CopyButton
                      text={entry.accountNumberSnapshot}
                      label="نسخ الحساب"
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PayoutsSkeleton() {
  return (
    <div className="space-y-4" aria-label="جارٍ تحميل بيانات الرواتب">
      <div className="skeleton h-24 rounded-2xl" />
      <div className="skeleton h-12 w-full max-w-xs rounded-xl" />
      <div className="space-y-px overflow-hidden rounded-2xl border border-line">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse bg-surface" />
        ))}
      </div>
    </div>
  );
}
