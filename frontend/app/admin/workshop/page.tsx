"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatIQD } from "@/lib/format";
import { getApiErrorMessage } from "@/lib/api";
import {
  addWorkshopAdjustment, createWorkshopWorker, getLinkCandidates, getWorkshopDashboard,
  listRates, recordProductionForWorker, updateWorkshopWorker, upsertRate,
  type PortalMember, type RateRow, type WorkshopDashboard, type WorkshopOperation,
  type WorkshopProduct, type WorkshopWorker,
} from "@/lib/workshop";

type Tab = "overview" | "record" | "rates" | "workers";

export default function AdminWorkshopPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<WorkshopDashboard | null>(null);
  const [rates, setRates] = useState<RateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try { const [dashboard, rateRows] = await Promise.all([getWorkshopDashboard(), listRates()]); setData(dashboard); setRates(rateRows); }
    catch (e) { setFetchError(true); toast.error(getApiErrorMessage(e, "تعذّر تحميل الورشة")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <>
    <PageHeader title="الورشة" subtitle="تسجيل القطع وأجور فريق ب" backHref="/admin" />
    <div className="mb-6 flex flex-wrap gap-2">{([['overview','نظرة عامة'],['record','تسجيل القطع'],['rates','أسعار القطع'],['workers','العمّال']] as [Tab,string][]).map(([key,label]) => <button key={key} onClick={() => setTab(key)} className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${tab === key ? 'border-orange-ink bg-orange-ink text-white' : 'border-line bg-surface text-ink'}`}>{label}</button>)}</div>
    {loading ? <p className="py-16 text-center text-ink-soft">جارٍ التحميل…</p> : fetchError || !data ? <div className="rounded-2xl border border-danger/25 bg-surface px-6 py-12 text-center"><p className="font-bold text-ink">تعذّر تحميل بيانات الورشة</p><p className="mt-1 text-sm text-ink-soft">تحقق من الاتصال ثم أعد المحاولة.</p><Button className="mt-4" onClick={load}>إعادة المحاولة</Button></div> : tab === "overview" ? <Overview data={data} onChanged={load} /> : tab === "record" ? <RecordForm workers={data.workers} rates={rates} onDone={load} /> : tab === "rates" ? <Rates rows={rates} onDone={load} /> : <Workers workers={data.workers} onDone={load} />}
  </>;
}

function Overview({ data, onChanged }: { data: WorkshopDashboard; onChanged: () => Promise<void> }) {
  const [adjust, setAdjust] = useState<WorkshopWorker | null>(null);
  return <div className="space-y-6">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5"><Stat label="القطع" value={String(data.totals.pieces)} /><Stat label="أجور القطع" value={formatIQD(data.totals.production)} /><Stat label="الحوافز" value={formatIQD(data.totals.bonuses)} /><Stat label="الخصومات" value={formatIQD(data.totals.deductions)} /><Stat label="المستحق" value={formatIQD(data.totals.payable)} accent /></div>
    {data.workers.length === 0 ? <EmptyState title="لا يوجد عمّال" message="أضف عمّال الورشة من تبويب العمّال." /> : <div className="overflow-x-auto rounded-2xl border border-line bg-surface"><table className="w-full min-w-[720px] text-sm"><thead className="border-b border-line text-ink-soft"><tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:text-start"><th>العامل</th><th>القطع</th><th>أجور القطع</th><th>الحوافز</th><th>الخصومات</th><th>المستحق</th><th></th></tr></thead><tbody className="divide-y divide-line">{data.workers.map((w) => <tr key={w.id} className="[&>td]:px-4 [&>td]:py-3"><td className="font-semibold text-ink">{w.name}</td><td>{w.pieces}</td><td>{formatIQD(w.production)}</td><td>{formatIQD(w.bonuses)}</td><td>{formatIQD(w.deductions)}</td><td className="font-bold text-orange-ink">{formatIQD(w.payable)}</td><td><Button size="sm" variant="secondary" onClick={() => setAdjust(w)}>حافز / خصم</Button></td></tr>)}</tbody></table></div>}
    <section><h2 className="mb-3 text-base font-bold text-ink">آخر التسجيلات</h2><div className="divide-y divide-line rounded-2xl border border-line bg-surface px-4">{data.recent.length ? data.recent.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-3 py-3 text-sm"><div><p className="font-semibold text-ink">{entry.worker_name} · {entry.kind === 'production' ? `${entry.operation_label_ar} ${entry.product_label_ar} × ${entry.qty}` : entry.kind === 'bonus' ? 'حافز' : 'خصم'}</p><p className="text-xs text-ink-soft">{entry.reason || entry.entry_date}</p></div><b className={entry.kind === 'deduction' ? 'text-danger' : 'text-ink'}>{entry.kind === 'deduction' ? '−' : '+'}{formatIQD(entry.amount)}</b></div>) : <p className="py-8 text-center text-sm text-ink-soft">لا توجد تسجيلات بعد.</p>}</div></section>
    {adjust && <AdjustmentModal worker={adjust} onClose={() => setAdjust(null)} onDone={async () => { setAdjust(null); await onChanged(); }} />}
  </div>;
}

function RecordForm({ workers, rates, onDone }: { workers: WorkshopWorker[]; rates: RateRow[]; onDone: () => Promise<void> }) {
  const active = workers.filter((w) => w.active);
  const [workerId, setWorkerId] = useState(active[0]?.id || "");
  const [product, setProduct] = useState<WorkshopProduct>(rates[0]?.product || "robe");
  const available = useMemo(() => rates.filter((r) => r.product === product), [rates, product]);
  const [operation, setOperation] = useState<WorkshopOperation>(available[0]?.operation || "cut");
  const [qty, setQty] = useState(""); const [date, setDate] = useState(new Date().toISOString().slice(0,10)); const [note,setNote] = useState(""); const [busy,setBusy] = useState(false);
  const productOptions = Array.from(new Map(rates.map((r) => [r.product,r.product_label_ar])).entries()).map(([value,label]) => ({ value,label }));
  const rate = rates.find((r) => r.product === product && r.operation === operation)?.amount || 0;
  async function submit() { const count = Math.floor(Number(qty)); if (!workerId || count < 1) { toast.error("اختر العامل وأدخل الكمية"); return; } setBusy(true); try { await recordProductionForWorker({ worker_id: workerId,product,operation,qty:count,work_date:date,note }); toast.success("تم تسجيل القطع"); setQty("");setNote("");await onDone(); } catch(e){toast.error(getApiErrorMessage(e,"تعذّر التسجيل"));} finally{setBusy(false);} }
  return <div className="max-w-2xl space-y-4 rounded-2xl border border-line bg-surface p-5"><div><h2 className="font-bold text-ink">تسجيل إنتاج عامل</h2><p className="text-sm text-ink-soft">مثال: محمود صنع 50 قطعة من نوع محدد.</p></div><div className="grid gap-3 sm:grid-cols-2"><Select label="العامل" value={workerId} onChange={(e) => setWorkerId(e.target.value)} options={active.map((w) => ({value:w.id,label:w.name}))} /><Select label="القطعة" value={product} onChange={(e) => { const p=e.target.value as WorkshopProduct;setProduct(p);setOperation(rates.find((r)=>r.product===p)?.operation||'cut'); }} options={productOptions} /><Select label="نوع الشغل" value={operation} onChange={(e) => setOperation(e.target.value as WorkshopOperation)} options={available.map((r)=>({value:r.operation,label:r.operation_label_ar}))} /><Input label="الكمية" type="number" min={1} value={qty} onChange={(e)=>setQty(e.target.value)} /><Input label="التاريخ" type="date" value={date} onChange={(e)=>setDate(e.target.value)} /><Input label="ملاحظة (اختياري)" value={note} onChange={(e)=>setNote(e.target.value)} /></div><p className="rounded-xl bg-surface-sink p-3 text-sm text-ink-soft">سعر القطعة {formatIQD(rate)} · المجموع <b className="text-ink">{formatIQD((Number(qty)||0)*rate)}</b></p><Button onClick={submit} loading={busy}>تسجيل</Button></div>;
}

function Rates({ rows, onDone }: { rows: RateRow[]; onDone: () => Promise<void> }) {
  const [drafts,setDrafts]=useState<Record<string,string>>(()=>Object.fromEntries(rows.map((r)=>[`${r.product}:${r.operation}`,String(r.amount)]))); const [busy,setBusy]=useState<string|null>(null);
  async function save(r:RateRow){const key=`${r.product}:${r.operation}`,amount=Math.floor(Number(drafts[key]));if(amount<0||!Number.isFinite(amount)){toast.error("السعر غير صحيح");return;}setBusy(key);try{await upsertRate(r.operation,r.product,amount);toast.success("تم حفظ السعر");await onDone();}catch(e){toast.error(getApiErrorMessage(e,"تعذّر الحفظ"));}finally{setBusy(null);}}
  return <div className="grid gap-3 sm:grid-cols-2">{rows.map((r)=>{const key=`${r.product}:${r.operation}`;return <div key={key} className="flex items-end gap-3 rounded-2xl border border-line bg-surface p-4"><div className="flex-1"><p className="mb-2 text-sm font-bold text-ink">{r.operation_label_ar} · {r.product_label_ar}</p><Input type="number" min={0} value={drafts[key]??''} onChange={(e)=>setDrafts((d)=>({...d,[key]:e.target.value}))} /></div><Button size="sm" onClick={()=>save(r)} loading={busy===key}>حفظ</Button></div>;})}</div>;
}

function Workers({ workers, onDone }: { workers: WorkshopWorker[]; onDone: () => Promise<void> }) {
  const [open,setOpen]=useState(false); const [candidates,setCandidates]=useState<PortalMember[]>([]);
  async function toggle(w:WorkshopWorker){try{await updateWorkshopWorker(w.id,{active:!w.active});await onDone();}catch(e){toast.error(getApiErrorMessage(e,"تعذّر التحديث"));}}
  return <div className="space-y-4"><div className="flex justify-end"><Button onClick={async()=>{setCandidates(await getLinkCandidates());setOpen(true);}}>+ عامل</Button></div>{workers.length===0?<EmptyState title="لا يوجد عمّال" message="أضف أول عامل للورشة."/>:<div className="grid gap-3 sm:grid-cols-2">{workers.map((w)=><div key={w.id} className="flex items-center justify-between rounded-2xl border border-line bg-surface p-4"><div><p className="font-bold text-ink">{w.name}</p><p className="text-xs text-ink-soft">{w.active?'نشط':'متوقف'} · {w.pieces} قطعة</p></div><Button size="sm" variant="secondary" onClick={()=>toggle(w)}>{w.active?'إيقاف':'تفعيل'}</Button></div>)}</div>}{open&&<AddWorkerModal candidates={candidates} onClose={()=>setOpen(false)} onDone={async()=>{setOpen(false);await onDone();}}/>}</div>;
}

function AdjustmentModal({worker,onClose,onDone}:{worker:WorkshopWorker;onClose:()=>void;onDone:()=>Promise<void>}){const[kind,setKind]=useState<'bonus'|'deduction'>('bonus');const[amount,setAmount]=useState('');const[reason,setReason]=useState('');const[busy,setBusy]=useState(false);async function save(){const n=Math.floor(Number(amount));if(n<1||!reason.trim()){toast.error("المبلغ والسبب مطلوبان");return;}setBusy(true);try{await addWorkshopAdjustment({worker_id:worker.id,kind,amount:n,reason:reason.trim()});toast.success(kind==='bonus'?'تمت إضافة الحافز':'تم تطبيق الخصم');await onDone();}catch(e){toast.error(getApiErrorMessage(e,"تعذّر الحفظ"));}finally{setBusy(false);}}return <Modal open onClose={onClose} title={`حافز أو خصم — ${worker.name}`} footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button onClick={save} loading={busy}>حفظ</Button></>}><div className="space-y-3"><Select label="النوع" value={kind} onChange={(e)=>setKind(e.target.value as 'bonus'|'deduction')} options={[{value:'bonus',label:'حافز'},{value:'deduction',label:'خصم'}]}/><Input label="المبلغ" type="number" min={1} value={amount} onChange={(e)=>setAmount(e.target.value)}/><Input label="السبب" value={reason} onChange={(e)=>setReason(e.target.value)}/></div></Modal>}

function AddWorkerModal({candidates,onClose,onDone}:{candidates:PortalMember[];onClose:()=>void;onDone:()=>Promise<void>}){const[name,setName]=useState('');const[password,setPassword]=useState('');const[link,setLink]=useState('');const[busy,setBusy]=useState(false);async function save(){setBusy(true);try{await createWorkshopWorker(link?{link_user_id:link}:{name,password});toast.success("تمت إضافة العامل");await onDone();}catch(e){toast.error(getApiErrorMessage(e,"تعذّرت الإضافة"));}finally{setBusy(false);}}return <Modal open onClose={onClose} title="إضافة عامل" footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button onClick={save} loading={busy}>إضافة</Button></>}><div className="space-y-3">{candidates.length>0&&<Select label="ربط موظف موجود (اختياري)" value={link} onChange={(e)=>setLink(e.target.value)} options={[{value:'',label:'عامل جديد'},...candidates.map((c)=>({value:c.id,label:c.name}))]}/>} {!link&&<><Input label="الاسم" value={name} onChange={(e)=>setName(e.target.value)}/><Input label="رمز الدخول (6 أحرف على الأقل)" type="password" value={password} onChange={(e)=>setPassword(e.target.value)}/></>}</div></Modal>}
function Stat({label,value,accent}:{label:string;value:string;accent?:boolean}){return <div className="rounded-2xl border border-line bg-surface p-4"><p className="text-xs text-ink-soft">{label}</p><p className={`mt-1 font-bold ${accent?'text-orange-ink':'text-ink'}`}>{value}</p></div>}
