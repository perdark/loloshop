"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api";
import { getUser, logout } from "@/lib/auth";
import { formatIQD, formatDateShort } from "@/lib/format";
import {
  getMyWorkshopSummary, recordMyProduction,
  type RateRow, type WorkerSummary, type WorkshopOperation, type WorkshopProduct,
  type WorkshopAudience,
} from "@/lib/workshop";

export default function WorkshopWorkerPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<WorkerSummary | null>(null);
  const [tab, setTab] = useState<"record" | "account">("record");

  const load = useCallback(async () => {
    try { setSummary(await getMyWorkshopSummary()); }
    catch (e) { toast.error(getApiErrorMessage(e, "في مشكلة بالتحميل")); }
  }, []);

  useEffect(() => {
    const user = getUser();
    if (user?.role !== "worker") { setAllowed(false); return; }
    setName(user.name || ""); setAllowed(true); void load();
  }, [load]);

  if (allowed === null) return <Loader />;
  if (!allowed) return <div className="flex min-h-dvh items-center justify-center bg-cream px-6 text-center text-ink" dir="rtl">فوت من رابط الورشة الخاص فيك.</div>;

  return (
    <div className="safe-bottom safe-x min-h-dvh bg-cream pb-10" dir="rtl" lang="ar">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <div><p className="text-xs text-ink-soft">ورشة لولو</p><p className="text-lg font-bold text-ink">أهلين {name}</p></div>
        <button className="min-h-11 rounded-full border border-line px-4 text-sm text-ink" onClick={() => { logout(); router.replace("/"); }}>خروج</button>
      </header>
      <main className="mx-auto max-w-lg px-4 pt-4">
        <div className="mb-4 flex gap-2">
          <Tab active={tab === "record"} onClick={() => setTab("record")}>سجّل شغلك</Tab>
          <Tab active={tab === "account"} onClick={() => setTab("account")}>حسابك</Tab>
        </div>
        {!summary ? (
          <Loader />
        ) : tab === "record" ? (
          <ProductionForm rates={summary.rates || []} onDone={load} />
        ) : (
          <Account summary={summary} />
        )}
      </main>
    </div>
  );
}

function ProductionForm({ rates, onDone }: { rates: RateRow[]; onDone: () => Promise<void> }) {
  // rates now holds one row per (product, operation, audience). The job list is the same
  // for both audiences, so derive the pickers from one of them to avoid duplicate options.
  const jobs = useMemo(() => rates.filter((r) => r.audience === "wholesale"), [rates]);
  const [product, setProduct] = useState<WorkshopProduct>(jobs[0]?.product || "robe");
  const available = useMemo(() => jobs.filter((r) => r.product === product), [jobs, product]);
  const [operation, setOperation] = useState<WorkshopOperation>(available[0]?.operation || "cut");
  // No default: the audience decides the wage, so it must be tapped, never guessed.
  const [audience, setAudience] = useState<WorkshopAudience | null>(null);
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const rate = audience
    ? rates.find((r) => r.product === product && r.operation === operation && r.audience === audience)?.amount || 0
    : 0;

  function changeProduct(next: WorkshopProduct) {
    setProduct(next); setOperation(jobs.find((r) => r.product === next)?.operation || "cut");
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); const count = Math.floor(Number(qty));
    if (!audience) { toast.error("حدد لمين هالشغل: ممثلين أو تجزئة"); return; }
    if (count < 1) { toast.error("حطّ عدد القطع"); return; }
    setBusy(true);
    try {
      const result = await recordMyProduction({ product, operation, audience, qty: count, work_date: date, note });
      toast.success(`تسجّل ${count} قطعة — ${formatIQD(result.amount)}`); setQty(""); setNote(""); await onDone();
    } catch (e) { toast.error(getApiErrorMessage(e, "ما زبط التسجيل")); }
    finally { setBusy(false); }
  }
  const products = Array.from(new Map(jobs.map((r) => [r.product, r.product_label_ar])).entries());
  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <div><h1 className="text-lg font-bold text-ink">شو اشتغلت اليوم؟</h1><p className="mt-1 text-sm text-ink-soft">اختار لمين الشغل والقطعة، وبعدين اكتب العدد.</p></div>
      <Field label="لمين هالشغل؟">
        <div className="grid grid-cols-2 gap-3">
          {([["wholesale", "ممثلين"], ["retail", "تجزئة"]] as [WorkshopAudience, string][]).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setAudience(value)} aria-pressed={audience === value}
              className={`min-h-12 rounded-xl border px-4 font-semibold transition-colors ${audience === value ? "border-orange-ink bg-orange-ink text-white" : "border-line bg-white text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="القطعة"><select value={product} onChange={(e) => changeProduct(e.target.value as WorkshopProduct)} className="min-h-12 w-full rounded-xl border border-line bg-white px-3 text-ink outline-none focus:border-orange-ink">{products.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="نوع الشغل"><select value={operation} onChange={(e) => setOperation(e.target.value as WorkshopOperation)} className="min-h-12 w-full rounded-xl border border-line bg-white px-3 text-ink outline-none focus:border-orange-ink">{available.map((r) => <option key={r.operation} value={r.operation}>{r.operation_label_ar}</option>)}</select></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="عدد القطع"><input className="min-h-12 w-full rounded-xl border border-line bg-white px-3 text-ink outline-none focus:border-orange-ink" inputMode="numeric" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="مثال: 50" /></Field>
        <Field label="التاريخ"><input className="min-h-12 w-full rounded-xl border border-line bg-white px-3 text-ink outline-none focus:border-orange-ink" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="ملاحظة (اختياري)"><input className="min-h-12 w-full rounded-xl border border-line bg-white px-3 text-ink outline-none focus:border-orange-ink" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="rounded-xl bg-surface-sink p-3 text-sm text-ink-soft">سعر القطعة: <b className="text-ink">{formatIQD(rate)}</b> · المجموع: <b className="text-orange-ink">{formatIQD((Number(qty) || 0) * rate)}</b></div>
      <button disabled={busy || !audience} className="min-h-12 w-full rounded-full bg-orange-ink px-4 font-semibold text-white disabled:opacity-50">{busy ? "عم نسجّل…" : !audience ? "حدد لمين هالشغل أول" : "سجّل الشغل"}</button>
    </form>
  );
}

function Account({ summary }: { summary: WorkerSummary }) {
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3"><Metric label="أجور ممثلين" value={formatIQD(summary.production_wholesale)} /><Metric label="أجور تجزئة" value={formatIQD(summary.production_retail)} /><Metric label="حوافز" value={formatIQD(summary.bonuses)} /><Metric label="خصومات" value={formatIQD(summary.deductions)} /><Metric label="المستحق" value={formatIQD(summary.payable)} accent /></div>
    <section><h2 className="mb-2 font-bold text-ink">آخر الحركات</h2><div className="divide-y divide-line rounded-2xl border border-line bg-surface px-4">{summary.entries.length ? summary.entries.map((e) => <div key={e.id} className="flex items-center justify-between gap-3 py-3 text-sm"><div><p className="font-medium text-ink">{e.kind === "production" ? `${e.operation_label_ar} · ${e.product_label_ar} × ${e.qty} · ${e.audience_label_ar}` : e.kind === "bonus" ? "حافز" : "خصم"}</p><p className="text-xs text-ink-soft">{e.reason || formatDateShort(e.entry_date)}</p></div><b className={e.kind === "deduction" ? "text-danger" : "text-ink"}>{e.kind === "deduction" ? "−" : "+"}{formatIQD(e.amount)}</b></div>) : <p className="py-10 text-center text-sm text-ink-soft">ما في حركات بعد.</p>}</div></section>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-ink"><span className="mb-1.5 block">{label}</span>{children}</label>; }
function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} className={`min-h-11 flex-1 rounded-full border px-4 text-sm font-semibold ${active ? "border-orange-ink bg-orange-ink text-white" : "border-line bg-surface text-ink"}`}>{children}</button>; }
function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) { return <div className="rounded-2xl border border-line bg-surface p-4"><p className="text-xs text-ink-soft">{label}</p><p className={`mt-1 font-bold ${accent ? "text-orange-ink" : "text-ink"}`}>{value}</p></div>; }
function Loader() { return <div className="flex min-h-48 items-center justify-center"><span className="h-7 w-7 animate-spin rounded-full border-2 border-ink/20 border-t-orange-ink" /></div>; }
