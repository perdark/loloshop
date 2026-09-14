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
import { CalculationDetails } from "@/components/admin/CalculationDetails";
import {
  ProductionEntryActions, isEditableEntry, type EditableEntry,
} from "@/components/workshop/ProductionEntryActions";
import {
  addWorkshopAdjustment, createWorkshopWorker, deleteWorkshopWorker, getLinkCandidates,
  getWorkshopDashboard, listRates, recordProductionForWorker, updateWorkshopWorker, upsertRate,
  type PortalMember, type RateRow, type WorkshopDashboard, type WorkshopOperation,
  type WorkshopProduct, type WorkshopWorker, type WorkshopAudience,
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
    {loading ? <p className="py-16 text-center text-ink-soft">جارٍ التحميل…</p> : fetchError || !data ? <div className="rounded-2xl border border-danger/25 bg-surface px-6 py-12 text-center"><p className="font-bold text-ink">تعذّر تحميل بيانات الورشة</p><p className="mt-1 text-sm text-ink-soft">تحقق من الاتصال ثم أعد المحاولة.</p><Button className="mt-4" onClick={load}>إعادة المحاولة</Button></div> : tab === "overview" ? <Overview data={data} rates={rates} onChanged={load} /> : tab === "record" ? <RecordForm workers={data.workers} rates={rates} onDone={load} /> : tab === "rates" ? <Rates rows={rates} onDone={load} /> : <Workers workers={data.workers} onDone={load} />}
  </>;
}

function Overview({ data, rates, onChanged }: { data: WorkshopDashboard; rates: RateRow[]; onChanged: () => Promise<void> }) {
  const [adjust, setAdjust] = useState<WorkshopWorker | null>(null);
  const [audience, setAudience] = useState<"all" | WorkshopAudience>("all");
  const pieces = audience === "all" ? data.totals.pieces : audience === "retail" ? data.totals.pieces_retail : data.totals.pieces_wholesale;
  const production = audience === "all" ? data.totals.production : audience === "retail" ? data.totals.production_retail : data.totals.production_wholesale;
  return <div className="space-y-6">
    <div className="flex flex-wrap gap-2" role="group" aria-label="تصفية حسب نوع الزبون">
      {([["all","الكل"],["wholesale","ممثلين"],["retail","تجزئة"]] as ["all"|WorkshopAudience,string][]).map(([key,label]) => (
        <button key={key} type="button" onClick={() => setAudience(key)} aria-pressed={audience === key}
          className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${audience === key ? 'border-orange-ink bg-orange-ink text-white' : 'border-line bg-surface text-ink'}`}>
          {label}
        </button>
      ))}
    </div>
    {/* الحوافز/الخصومات belong to no audience, so المستحق is only meaningful under الكل. */}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5"><Stat label="القطع" value={String(pieces)} /><Stat label="أجور القطع" value={formatIQD(production)} />{audience === "all" && <><Stat label="الحوافز" value={formatIQD(data.totals.bonuses)} /><Stat label="الخصومات" value={formatIQD(data.totals.deductions)} /><Stat label="المستحق" value={formatIQD(data.totals.payable)} accent /></>}</div>
    <CalculationDetails summary="كيف حُسبت مستحقات الورشة؟">
      <p>أجر كل تسجيل إنتاج = عدد القطع × سعر القطعة المحفوظ وقت التسجيل.</p>
      <p className="mt-1 rounded-lg bg-ink/[0.04] px-2.5 py-2 text-ink">
        إجمالي المستحق = أجور القطع {formatIQD(data.totals.production)} + الحوافز {formatIQD(data.totals.bonuses)} − الخصومات {formatIQD(data.totals.deductions)} = {formatIQD(data.totals.payable)}
      </p>
    </CalculationDetails>
    {data.workers.length === 0 ? <EmptyState title="لا يوجد عمّال" message="أضف عمّال الورشة من تبويب العمّال." /> : <div className="overflow-x-auto rounded-2xl border border-line bg-surface"><table className="w-full min-w-[720px] text-sm"><thead className="border-b border-line text-ink-soft"><tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:text-start"><th>العامل</th><th>القطع</th><th>أجور القطع</th><th>الحوافز</th><th>الخصومات</th><th>المستحق</th><th></th></tr></thead><tbody className="divide-y divide-line">{data.workers.map((w) => <tr key={w.id} className="[&>td]:px-4 [&>td]:py-3"><td className="font-semibold text-ink">{w.name}</td><td>{w.pieces}</td><td>{formatIQD(w.production)}</td><td>{formatIQD(w.bonuses)}</td><td>{formatIQD(w.deductions)}</td><td className="font-bold text-orange-ink">{formatIQD(w.payable)}</td><td><Button size="sm" variant="secondary" onClick={() => setAdjust(w)}>حافز / خصم</Button></td></tr>)}</tbody></table></div>}
    <section><h2 className="mb-3 text-base font-bold text-ink">آخر التسجيلات</h2>{/* «تعديل»/«حذف» على سطر القطع فقط — الحافز والخصم يُصحَّحان من «حافز / خصم»، مو من هنا. */}<div className="divide-y divide-line rounded-2xl border border-line bg-surface px-4">{data.recent.length ? data.recent.map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div className="min-w-0 flex-1"><p className="font-semibold text-ink">{entry.worker_name} · {entry.kind === 'production' ? `${entry.operation_label_ar} ${entry.product_label_ar} × ${entry.qty}` : entry.kind === 'bonus' ? 'حافز' : 'خصم'}</p><p className="text-xs text-ink-soft">{entry.reason || entry.entry_date}</p></div><b className={entry.kind === 'deduction' ? 'text-danger' : 'text-ink'}>{entry.kind === 'deduction' ? '−' : '+'}{formatIQD(entry.amount)}</b>{isEditableEntry(entry) && <ProductionEntryActions entry={entry as EditableEntry} rates={rates} onDone={onChanged} />}</div>) : <p className="py-8 text-center text-sm text-ink-soft">لا توجد تسجيلات بعد.</p>}</div></section>
    {adjust && <AdjustmentModal worker={adjust} onClose={() => setAdjust(null)} onDone={async () => { setAdjust(null); await onChanged(); }} />}
  </div>;
}

function RecordForm({ workers, rates, onDone }: { workers: WorkshopWorker[]; rates: RateRow[]; onDone: () => Promise<void> }) {
  const active = workers.filter((w) => w.active);
  const [workerId, setWorkerId] = useState(active[0]?.id || "");
  // rates carries one row per (product, operation, audience); derive the job pickers from a
  // single audience so each product/operation appears once.
  const jobs = useMemo(() => rates.filter((r) => r.audience === "wholesale"), [rates]);
  const [product, setProduct] = useState<WorkshopProduct>(jobs[0]?.product || "robe");
  const available = useMemo(() => jobs.filter((r) => r.product === product), [jobs, product]);
  const [operation, setOperation] = useState<WorkshopOperation>(available[0]?.operation || "cut");
  // No default — the audience decides the wage, so it must be chosen explicitly.
  const [audience, setAudience] = useState<WorkshopAudience | null>(null);
  const [qty, setQty] = useState(""); const [date, setDate] = useState(new Date().toISOString().slice(0,10)); const [note,setNote] = useState(""); const [busy,setBusy] = useState(false);
  const productOptions = Array.from(new Map(jobs.map((r) => [r.product,r.product_label_ar])).entries()).map(([value,label]) => ({ value,label }));
  const rate = audience ? rates.find((r) => r.product === product && r.operation === operation && r.audience === audience)?.amount || 0 : 0;
  async function submit() { const count = Math.floor(Number(qty)); if (!audience) { toast.error("حدد لمين هالشغل: ممثلين أو تجزئة"); return; } if (!workerId || count < 1) { toast.error("اختر العامل وأدخل الكمية"); return; } setBusy(true); try { await recordProductionForWorker({ worker_id: workerId,product,operation,audience,qty:count,work_date:date,note }); toast.success("تم تسجيل القطع"); setQty("");setNote("");await onDone(); } catch(e){toast.error(getApiErrorMessage(e,"تعذّر التسجيل"));} finally{setBusy(false);} }
  return <div className="max-w-2xl space-y-4 rounded-2xl border border-line bg-surface p-5"><div><h2 className="font-bold text-ink">تسجيل إنتاج عامل</h2><p className="text-sm text-ink-soft">مثال: محمود صنع 50 قطعة من نوع محدد.</p></div><div className="grid gap-3 sm:grid-cols-2"><Select label="العامل" value={workerId} onChange={(e) => setWorkerId(e.target.value)} options={active.map((w) => ({value:w.id,label:w.name}))} /><Select label="لمين هالشغل" value={audience ?? ""} onChange={(e) => setAudience((e.target.value || null) as WorkshopAudience | null)} options={[{value:"",label:"— اختر —"},{value:"wholesale",label:"ممثلين"},{value:"retail",label:"تجزئة"}]} /><Select label="القطعة" value={product} onChange={(e) => { const p=e.target.value as WorkshopProduct;setProduct(p);setOperation(jobs.find((r)=>r.product===p)?.operation||'cut'); }} options={productOptions} /><Select label="نوع الشغل" value={operation} onChange={(e) => setOperation(e.target.value as WorkshopOperation)} options={available.map((r)=>({value:r.operation,label:r.operation_label_ar}))} /><Input label="الكمية" type="number" min={1} value={qty} onChange={(e)=>setQty(e.target.value)} /><Input label="التاريخ" type="date" value={date} onChange={(e)=>setDate(e.target.value)} /><Input label="ملاحظة (اختياري)" value={note} onChange={(e)=>setNote(e.target.value)} /></div><p className="rounded-xl bg-surface-sink p-3 text-sm text-ink-soft">سعر القطعة {formatIQD(rate)} · المجموع <b className="text-ink">{formatIQD((Number(qty)||0)*rate)}</b></p><Button onClick={submit} loading={busy}>تسجيل</Button></div>;
}

function Rates({ rows, onDone }: { rows: RateRow[]; onDone: () => Promise<void> }) {
  const [drafts,setDrafts]=useState<Record<string,string>>(()=>Object.fromEntries(rows.map((r)=>[`${r.product}:${r.operation}:${r.audience}`,String(r.amount)]))); const [busy,setBusy]=useState<string|null>(null);
  // One card per job, two prices on it — the rows arrive split by audience.
  const jobs = Array.from(new Map(rows.map((r)=>[`${r.product}:${r.operation}`,r])).values());
  async function save(job:RateRow){
    const jobKey=`${job.product}:${job.operation}`;
    const pending=(["wholesale","retail"] as const).map((audience)=>({audience,amount:Math.floor(Number(drafts[`${jobKey}:${audience}`]))}));
    if(pending.some((p)=>!Number.isFinite(p.amount)||p.amount<0)){toast.error("السعر غير صحيح");return;}
    setBusy(jobKey);
    try{for(const p of pending){await upsertRate(job.operation,job.product,p.audience,p.amount);}toast.success("تم حفظ السعرين");await onDone();}
    catch(e){toast.error(getApiErrorMessage(e,"تعذّر الحفظ"));}finally{setBusy(null);}
  }
  return <div className="grid gap-3 sm:grid-cols-2">{jobs.map((job)=>{const jobKey=`${job.product}:${job.operation}`;return <div key={jobKey} className="rounded-2xl border border-line bg-surface p-4"><p className="mb-3 text-sm font-bold text-ink">{job.operation_label_ar} · {job.product_label_ar}</p><div className="grid grid-cols-2 gap-3">{(["wholesale","retail"] as const).map((audience)=><Input key={audience} label={audience==="retail"?"تجزئة":"ممثلين"} type="number" min={0} value={drafts[`${jobKey}:${audience}`]??''} onChange={(e)=>setDrafts((d)=>({...d,[`${jobKey}:${audience}`]:e.target.value}))} />)}</div><Button className="mt-3" size="sm" onClick={()=>save(job)} loading={busy===jobKey}>حفظ</Button></div>;})}</div>;
}

function Workers({ workers, onDone }: { workers: WorkshopWorker[]; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<PortalMember[]>([]);
  const [edit, setEdit] = useState<WorkshopWorker | null>(null);
  const [remove, setRemove] = useState<WorkshopWorker | null>(null);
  async function toggle(w: WorkshopWorker) {
    try { await updateWorkshopWorker(w.id, { active: !w.active }); await onDone(); }
    catch (e) { toast.error(getApiErrorMessage(e, "تعذّر التحديث")); }
  }
  return <div className="space-y-4">
    <div className="flex justify-end"><Button onClick={async () => { setCandidates(await getLinkCandidates()); setOpen(true); }}>+ عامل</Button></div>
    {workers.length === 0 ? <EmptyState title="لا يوجد عمّال" message="أضف أول عامل للورشة." /> : <div className="grid gap-3 sm:grid-cols-2">{workers.map((w) => <div key={w.id} className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-ink">{w.name}</p>
          <p className="text-xs text-ink-soft">{w.active ? 'نشط' : 'متوقف'} · {w.pieces} قطعة{w.is_lead ? ' · قائد الورشة' : ''}{w.is_staff ? ' · موظف مرتبط' : ''}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => toggle(w)}>{w.active ? 'إيقاف' : 'تفعيل'}</Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setEdit(w)}>تعديل</Button>
        <Button size="sm" variant="danger" onClick={() => setRemove(w)}>حذف</Button>
      </div>
    </div>)}</div>}
    {open && <AddWorkerModal candidates={candidates} onClose={() => setOpen(false)} onDone={async () => { setOpen(false); await onDone(); }} />}
    {edit && <EditWorkerModal worker={edit} onClose={() => setEdit(null)} onDone={async () => { setEdit(null); await onDone(); }} />}
    {remove && <DeleteWorkerModal worker={remove} onClose={() => setRemove(null)} onDone={async () => { setRemove(null); await onDone(); }} />}
  </div>;
}

/* ⚠️ الاسم ورمز الدخول ينعدّلون بس لعامل الورشة نفسه (`role = 'worker'`). العامل المرتبط
   بحساب موظف — `is_staff` — اسمه ورمزه يخصّون حساب الموظف، وupdateWorker بالسيرفر يتجاهلهم
   بصمت. نعطّل الحقلين ونكتب السبب بدل ما نخلي المدير يضغط «حفظ» وما يتغير شي. */
function EditWorkerModal({ worker, onClose, onDone }: { worker: WorkshopWorker; onClose: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState(worker.name);
  const [password, setPassword] = useState('');
  const [isLead, setIsLead] = useState(worker.is_lead);
  const [active, setActive] = useState(worker.active);
  const [busy, setBusy] = useState(false);
  async function save() {
    const body: { is_lead?: boolean; active?: boolean; name?: string; password?: string } = {};
    if (isLead !== worker.is_lead) body.is_lead = isLead;
    if (active !== worker.active) body.active = active;
    if (!worker.is_staff) {
      const trimmed = name.trim();
      if (!trimmed) { toast.error("الاسم مطلوب"); return; }
      if (trimmed !== worker.name) body.name = trimmed;
      if (password) {
        if (password.length < 8) { toast.error("رمز الدخول 8 أحرف على الأقل"); return; }
        body.password = password;
      }
    }
    if (Object.keys(body).length === 0) { toast.error("ما غيّرت شي"); return; }
    setBusy(true);
    try { await updateWorkshopWorker(worker.id, body); toast.success("تم حفظ التعديل"); await onDone(); }
    catch (e) { toast.error(getApiErrorMessage(e, "تعذّر الحفظ")); }
    finally { setBusy(false); }
  }
  return <Modal open onClose={onClose} title={`تعديل — ${worker.name}`} footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button onClick={save} loading={busy}>حفظ</Button></>}>
    <div className="space-y-3">
      {worker.is_staff
        ? <p className="rounded-xl bg-surface-sink p-3 text-sm text-ink-soft">هذا عامل مرتبط بحساب موظف — اسمه ورمز دخوله ينعدّلون من صفحة الموظفين، مو من هنا.</p>
        : <>
            <Input label="الاسم" value={name} onChange={(e) => setName(e.target.value)} />
            <Input label="رمز دخول جديد (اتركه فارغ إذا ما تريد تغييره)" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </>}
      <Select label="قائد الورشة" value={isLead ? '1' : '0'} onChange={(e) => setIsLead(e.target.value === '1')} options={[{ value: '0', label: 'لا' }, { value: '1', label: 'نعم — يشوف كل العمّال ويسجّل قطعهم' }]} />
      <Select label="الحالة" value={active ? '1' : '0'} onChange={(e) => setActive(e.target.value === '1')} options={[{ value: '1', label: 'نشط' }, { value: '0', label: 'متوقف — ما يظهر بتسجيل القطع' }]} />
    </div>
  </Modal>;
}

/* ⚠️ الحذف يمسح سطر الورشة بس. السيرفر يرفض أي عامل عنده سجل أجور (409) لأن سجل القطع
   والحوافز CASCADE وينمسح وياه — نخلي رسالته العربية تطلع مثل ما هي بدل ما نخترع وحدة. */
function DeleteWorkerModal({ worker, onClose, onDone }: { worker: WorkshopWorker; onClose: () => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const paid = worker.pieces > 0 || worker.bonuses > 0 || worker.deductions > 0;
  async function confirm() {
    setBusy(true);
    try {
      const { account_retired } = await deleteWorkshopWorker(worker.id);
      toast.success(account_retired ? "تم حذف العامل وإلغاء حسابه" : "تم شيل العامل من الورشة");
      await onDone();
    } catch (e) { toast.error(getApiErrorMessage(e, "تعذّر الحذف")); }
    finally { setBusy(false); }
  }
  return <Modal open onClose={onClose} title={`حذف — ${worker.name}`} footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button variant="danger" onClick={confirm} loading={busy}>حذف</Button></>}>
    <div className="space-y-3 text-sm">
      {paid
        ? <p className="rounded-xl border border-danger/25 bg-danger/5 p-3 font-semibold text-danger">عند {worker.name} سجل أجور ({worker.pieces} قطعة). الحذف راح ينرفض — استخدم «إيقاف» حتى يبقى السجل محفوظ.</p>
        : <p className="text-ink">راح ينشال {worker.name} من الورشة نهائياً.{worker.is_staff ? ' حساب الموظف نفسه ما يتأثر — يبقى شغّال بالمحل.' : ' وحسابه بالورشة ما يقدر يسجّل دخول بعدها.'}</p>}
      <p className="text-ink-soft">إذا تريده يبقى بالسجل بس ما يشتغل، استخدم «إيقاف» بدل الحذف.</p>
    </div>
  </Modal>;
}

function AdjustmentModal({worker,onClose,onDone}:{worker:WorkshopWorker;onClose:()=>void;onDone:()=>Promise<void>}){const[kind,setKind]=useState<'bonus'|'deduction'>('bonus');const[amount,setAmount]=useState('');const[reason,setReason]=useState('');const[busy,setBusy]=useState(false);async function save(){const n=Math.floor(Number(amount));if(n<1||!reason.trim()){toast.error("المبلغ والسبب مطلوبان");return;}setBusy(true);try{await addWorkshopAdjustment({worker_id:worker.id,kind,amount:n,reason:reason.trim()});toast.success(kind==='bonus'?'تمت إضافة الحافز':'تم تطبيق الخصم');await onDone();}catch(e){toast.error(getApiErrorMessage(e,"تعذّر الحفظ"));}finally{setBusy(false);}}return <Modal open onClose={onClose} title={`حافز أو خصم — ${worker.name}`} footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button onClick={save} loading={busy}>حفظ</Button></>}><div className="space-y-3"><Select label="النوع" value={kind} onChange={(e)=>setKind(e.target.value as 'bonus'|'deduction')} options={[{value:'bonus',label:'حافز'},{value:'deduction',label:'خصم'}]}/><Input label="المبلغ" type="number" min={1} value={amount} onChange={(e)=>setAmount(e.target.value)}/><Input label="السبب" value={reason} onChange={(e)=>setReason(e.target.value)}/></div></Modal>}

function AddWorkerModal({candidates,onClose,onDone}:{candidates:PortalMember[];onClose:()=>void;onDone:()=>Promise<void>}){const[name,setName]=useState('');const[password,setPassword]=useState('');const[link,setLink]=useState('');const[busy,setBusy]=useState(false);async function save(){setBusy(true);try{await createWorkshopWorker(link?{link_user_id:link}:{name,password});toast.success("تمت إضافة العامل");await onDone();}catch(e){toast.error(getApiErrorMessage(e,"تعذّرت الإضافة"));}finally{setBusy(false);}}return <Modal open onClose={onClose} title="إضافة عامل" footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button onClick={save} loading={busy}>إضافة</Button></>}><div className="space-y-3">{candidates.length>0&&<Select label="ربط موظف موجود (اختياري)" value={link} onChange={(e)=>setLink(e.target.value)} options={[{value:'',label:'عامل جديد'},...candidates.map((c)=>({value:c.id,label:c.name}))]}/>} {!link&&<><Input label="الاسم" value={name} onChange={(e)=>setName(e.target.value)}/><Input label="رمز الدخول (8 أحرف على الأقل)" type="password" value={password} onChange={(e)=>setPassword(e.target.value)}/></>}</div></Modal>}
function Stat({label,value,accent}:{label:string;value:string;accent?:boolean}){return <div className="rounded-2xl border border-line bg-surface p-4"><p className="text-xs text-ink-soft">{label}</p><p className={`mt-1 font-bold ${accent?'text-orange-ink':'text-ink'}`}>{value}</p></div>}
