"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { getApiErrorMessage } from "@/lib/api";
import { Select } from "@/components/ui/Select";
import type { SalaryTxnType, StaffActivity, StaffGoal, StaffOrderScope, StaffSalary, StaffType, User } from "@/lib/types";
import { ORDER_SCOPE_LABELS, SALARY_TXN_LABELS, STAFF_TYPE_LABELS, PASSWORD_MIN_PRIVILEGED } from "@/lib/constants";
import { formatDateShort, formatIQD } from "@/lib/format";
import {
  addStaffBonus,
  addStaffDeduction,
  createStaff,
  deleteStaff,
  getAdminStaff,
  getStaffActivity,
  getStaffGoal,
  getStaffSalary,
  removeStaffSalaryTransaction,
  resetStaffPassword,
  setStaffGoal,
  setStaffSalary,
  updateStaffScope,
  updateStaffType,
} from "@/lib/admin";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function txnTypeColor(type: SalaryTxnType): string {
  if (type === "bonus") return "text-emerald-700";
  if (type === "deduction") return "text-danger";
  return "text-ink-soft";
}

function txnSign(type: SalaryTxnType): string {
  if (type === "bonus") return "+";
  if (type === "deduction") return "−";
  return "=";
}

// ─── Salary panel ─────────────────────────────────────────────────────────────

interface SalaryPanelProps {
  userId: string;
  userName: string;
}

function SalaryPanel({ userId, userName }: SalaryPanelProps) {
  const [salary, setSalaryData] = useState<StaffSalary | null>(null);
  const [activity, setActivity] = useState<StaffActivity[]>([]);
  const [loadingSalary, setLoadingSalary] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Modals
  const [setSalaryOpen, setSetSalaryOpen] = useState(false);
  const [bonusOpen, setBonusOpen] = useState(false);
  const [deductionOpen, setDeductionOpen] = useState(false);

  // Form state
  const [newBaseSalary, setNewBaseSalary] = useState("");
  const [bonusAmount, setBonusAmount] = useState("");
  const [bonusReason, setBonusReason] = useState("");
  const [deductionAmount, setDeductionAmount] = useState("");
  const [deductionReason, setDeductionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [removingTxnId, setRemovingTxnId] = useState<string | null>(null);

  // Goal
  const [goal, setGoal] = useState<StaffGoal | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalTarget, setGoalTarget] = useState("");
  const [goalBonus, setGoalBonus] = useState("");
  const [goalDeadline, setGoalDeadline] = useState("");
  const [goalTitle, setGoalTitle] = useState("");

  const loadSalary = useCallback(async () => {
    setLoadingSalary(true);
    try {
      const [salaryData, activityData, goalData] = await Promise.all([
        getStaffSalary(userId),
        getStaffActivity(userId),
        getStaffGoal(userId),
      ]);
      setSalaryData(salaryData);
      setNewBaseSalary(String(salaryData.baseSalary));
      setActivity(activityData);
      setGoal(goalData);
    } catch {
      toast.error("تعذر تحميل بيانات الراتب");
    } finally {
      setLoadingSalary(false);
    }
  }, [userId]);

  useEffect(() => {
    if (expanded && !salary) {
      loadSalary();
    }
  }, [expanded, salary, loadSalary]);

  async function handleSetSalary() {
    const amount = Number.parseInt(newBaseSalary.replace(/[^\d]/g, ""), 10);
    if (Number.isNaN(amount) || amount < 0) {
      toast.error("أدخل مبلغاً صحيحاً");
      return;
    }
    setSubmitting(true);
    try {
      await setStaffSalary(userId, amount);
      toast.success("تم تحديث الراتب الأساسي");
      setSetSalaryOpen(false);
      setSalaryData(null);
      await loadSalary();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحديث الراتب"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBonus() {
    const amount = Number.parseInt(bonusAmount.replace(/[^\d]/g, ""), 10);
    if (Number.isNaN(amount) || amount <= 0) {
      toast.error("أدخل مبلغ الحافز");
      return;
    }
    setSubmitting(true);
    try {
      await addStaffBonus(userId, amount, bonusReason || undefined);
      toast.success("تمت إضافة الحافز");
      setBonusOpen(false);
      setBonusAmount("");
      setBonusReason("");
      setSalaryData(null);
      await loadSalary();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر إضافة الحافز"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeduction() {
    const amount = Number.parseInt(deductionAmount.replace(/[^\d]/g, ""), 10);
    if (Number.isNaN(amount) || amount <= 0) {
      toast.error("أدخل مبلغ الخصم");
      return;
    }
    setSubmitting(true);
    try {
      await addStaffDeduction(userId, amount, deductionReason || undefined);
      toast.success("تمت إضافة الخصم");
      setDeductionOpen(false);
      setDeductionAmount("");
      setDeductionReason("");
      setSalaryData(null);
      await loadSalary();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر إضافة الخصم"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveTransaction(txnId: string) {
    if (!window.confirm("حذف هذه المعاملة من الراتب؟")) return;
    setRemovingTxnId(txnId);
    try {
      const next = await removeStaffSalaryTransaction(userId, txnId, "حذف من الأدمن");
      setSalaryData(next);
      toast.success("تم حذف المعاملة");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حذف المعاملة"));
    } finally {
      setRemovingTxnId(null);
    }
  }

  async function handleSetGoal() {
    const target = Number.parseInt(goalTarget.replace(/[^\d]/g, ""), 10);
    if (Number.isNaN(target) || target <= 0) {
      toast.error("أدخل عدد الطلبات");
      return;
    }
    const bonus = goalBonus ? Number.parseInt(goalBonus.replace(/[^\d]/g, ""), 10) : 0;
    if (Number.isNaN(bonus) || bonus < 0) {
      toast.error("أدخل مبلغ الحافز");
      return;
    }
    if (!goalDeadline || new Date(goalDeadline).getTime() <= Date.now()) {
      toast.error("اختر موعداً نهائياً في المستقبل");
      return;
    }
    setSubmitting(true);
    try {
      const g = await setStaffGoal(userId, {
        targetCount: target,
        bonusAmount: bonus,
        deadline: new Date(goalDeadline).toISOString(),
        titleAr: goalTitle || undefined,
      });
      setGoal(g);
      toast.success("تم تحديد الهدف");
      setGoalOpen(false);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحديد الهدف"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 border-t border-ink/8 pt-3">
      {/* Toggle */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl bg-surface-sink px-3 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:bg-beige min-h-[44px]"
      >
        <span className="flex items-center gap-2">
          <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4l3 3" />
          </svg>
          الراتب والنشاط
        </span>
        <svg
          aria-hidden
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-3 space-y-4">
          {loadingSalary ? (
            <div className="space-y-2">
              <div className="skeleton h-16 w-full rounded-xl" />
              <div className="skeleton h-24 w-full rounded-xl" />
            </div>
          ) : salary ? (
            <>
              {/* Balance summary */}
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-orange-ink/15 bg-orange-ink/5 p-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted">الراتب الأساسي</p>
                  <p className="mt-0.5 font-bold tabular-nums text-ink" dir="ltr">
                    {formatIQD(salary.baseSalary)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted">الرصيد الحالي</p>
                  <p
                    className={`mt-0.5 font-bold tabular-nums ${salary.balance < 0 ? "text-danger" : "text-emerald-700"}`}
                    dir="ltr"
                  >
                    {formatIQD(salary.balance)}
                  </p>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <p className="text-xs text-muted">آخر معاملة</p>
                  <p className="mt-0.5 text-sm font-medium text-ink-soft">
                    {salary.transactions.length > 0
                      ? formatDateShort(salary.transactions[0].createdAt)
                      : "—"}
                  </p>
                </div>
              </div>

              {/* Actions row */}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setNewBaseSalary(String(salary.baseSalary));
                    setSetSalaryOpen(true);
                  }}
                >
                  تحديث الراتب
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="border-emerald-600/30 text-emerald-700 hover:border-emerald-600/50 hover:text-emerald-800"
                  onClick={() => {
                    setBonusAmount("");
                    setBonusReason("");
                    setBonusOpen(true);
                  }}
                >
                  + حافز
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    setDeductionAmount("");
                    setDeductionReason("");
                    setDeductionOpen(true);
                  }}
                >
                  − خصم
                </Button>
              </div>

              {/* Incentive goal + progress */}
              <div className="rounded-xl border border-orange-ink/20 bg-warm-veil p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-ink">هدف الحافز</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setGoalTarget(goal ? String(goal.targetCount) : "");
                      setGoalBonus(goal ? String(goal.bonusAmount) : "");
                      setGoalTitle(goal?.titleAr ?? "");
                      setGoalDeadline("");
                      setGoalOpen(true);
                    }}
                  >
                    {goal ? "تعديل الهدف" : "إضافة هدف"}
                  </Button>
                </div>
                {goal ? (
                  <div className="mt-2">
                    <p className="text-sm text-ink">
                      {/* A goal counts staff_activity_log rows for 'advance'/'approve_design'
                          (salaryController.js:86-90) — one action per PIECE, never per bundle. */}
                      {goal.titleAr || `أكمل ${goal.targetCount} قطعة`}
                      {goal.bonusAmount > 0 && ` · حافز ${formatIQD(goal.bonusAmount)}`}
                    </p>
                    <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-surface-sink">
                      <div
                        className={`h-full rounded-full ${goal.achieved ? "bg-emerald-500" : "bg-orange-ink"}`}
                        style={{ width: `${Math.min(100, Math.round((goal.progress / goal.targetCount) * 100))}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-ink-soft">
                      <span className="font-semibold">{goal.progress} / {goal.targetCount}</span>
                      <span>
                        {goal.achieved
                          ? goal.awarded
                            ? "✓ تم منح الحافز"
                            : "✓ تحقق"
                          : goal.expired
                            ? "انتهى الوقت"
                            : `حتى ${formatDateShort(goal.deadline)}`}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-muted">لا يوجد هدف محدد</p>
                )}
              </div>

              {/* Transactions ledger */}
              {salary.transactions.length > 0 && (
                <div className="rounded-xl border border-line overflow-hidden">
                  <p className="border-b border-line bg-surface-sink px-3 py-2 text-xs font-semibold text-muted">
                    سجل المعاملات ({salary.transactions.length})
                  </p>
                  <ul className="divide-y divide-line">
                    {salary.transactions.slice(0, 10).map((txn) => (
                      <li key={txn.id} className="flex items-center gap-3 px-3 py-2.5">
                        <span
                          className={`shrink-0 w-6 text-center font-bold text-base ${txnTypeColor(txn.type)}`}
                          aria-hidden
                        >
                          {txnSign(txn.type)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-semibold ${txnTypeColor(txn.type)}`}>
                            {SALARY_TXN_LABELS[txn.type]}
                            {txn.reasonAr && (
                              <span className="ms-1.5 font-normal text-ink-soft">
                                — {txn.reasonAr}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-muted">{formatDateShort(txn.createdAt)}</p>
                        </div>
                        <span
                          className={`shrink-0 text-sm font-bold tabular-nums ${txnTypeColor(txn.type)}`}
                          dir="ltr"
                        >
                          {formatIQD(txn.amount)}
                        </span>
                        {txn.sourceType === "manual" && (txn.type === "bonus" || txn.type === "deduction") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemoveTransaction(txn.id)}
                            loading={removingTxnId === txn.id}
                          >
                            حذف
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recent activity */}
              {activity.length > 0 && (
                <div className="rounded-xl border border-line overflow-hidden">
                  <p className="border-b border-line bg-surface-sink px-3 py-2 text-xs font-semibold text-muted">
                    النشاط الأخير ({activity.length})
                  </p>
                  <ul className="divide-y divide-line">
                    {activity.slice(0, 8).map((act) => (
                      <li key={act.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-orange-ink/60 ring-2 ring-orange-ink/20" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-ink">{act.action}</p>
                          {act.fromStage && act.toStage && (
                            <p className="text-xs text-muted">
                              {act.fromStage} ← {act.toStage}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 text-xs text-muted">{formatDateShort(act.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-line bg-surface-sink px-4 py-6 text-center">
              <p className="text-sm text-ink-soft">تعذر تحميل بيانات الراتب</p>
              <Button size="sm" variant="ghost" className="mt-2" onClick={loadSalary}>
                إعادة المحاولة
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Set salary modal ── */}
      <Modal
        open={setSalaryOpen}
        onClose={() => setSetSalaryOpen(false)}
        title={`تحديث الراتب — ${userName}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSetSalaryOpen(false)}>إلغاء</Button>
            <Button onClick={handleSetSalary} loading={submitting}>حفظ</Button>
          </>
        }
      >
        <div className="space-y-2">
          <Input
            label="الراتب الأساسي (د.ع)"
            type="text"
            inputMode="numeric"
            dir="ltr"
            value={newBaseSalary}
            onChange={(e) => setNewBaseSalary(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="0"
          />
          <p className="text-xs text-muted">الراتب الأساسي الشهري للموظف بالدينار العراقي.</p>
        </div>
      </Modal>

      {/* ── Bonus modal ── */}
      <Modal
        open={bonusOpen}
        onClose={() => setBonusOpen(false)}
        title={`إضافة حافز — ${userName}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBonusOpen(false)}>إلغاء</Button>
            <Button onClick={handleBonus} loading={submitting}>إضافة</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="مبلغ الحافز (د.ع)"
            type="text"
            inputMode="numeric"
            dir="ltr"
            value={bonusAmount}
            onChange={(e) => setBonusAmount(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="0"
          />
          <Input
            label="السبب (اختياري)"
            value={bonusReason}
            onChange={(e) => setBonusReason(e.target.value)}
            placeholder="مثال: أداء ممتاز هذا الشهر"
          />
        </div>
      </Modal>

      {/* ── Deduction modal ── */}
      <Modal
        open={deductionOpen}
        onClose={() => setDeductionOpen(false)}
        title={`إضافة خصم — ${userName}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeductionOpen(false)}>إلغاء</Button>
            <Button variant="danger" onClick={handleDeduction} loading={submitting}>تطبيق الخصم</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="مبلغ الخصم (د.ع)"
            type="text"
            inputMode="numeric"
            dir="ltr"
            value={deductionAmount}
            onChange={(e) => setDeductionAmount(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="0"
          />
          <Input
            label="سبب الخصم (اختياري)"
            value={deductionReason}
            onChange={(e) => setDeductionReason(e.target.value)}
            placeholder="مثال: غياب بدون إذن"
          />
        </div>
      </Modal>

      {/* ── Goal modal ── */}
      <Modal
        open={goalOpen}
        onClose={() => setGoalOpen(false)}
        title={`هدف الحافز — ${userName}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setGoalOpen(false)}>إلغاء</Button>
            <Button onClick={handleSetGoal} loading={submitting}>حفظ الهدف</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="عدد الطلبات المطلوبة"
            type="text"
            inputMode="numeric"
            dir="ltr"
            value={goalTarget}
            onChange={(e) => setGoalTarget(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="15"
          />
          <Input
            label="قيمة الحافز عند الإنجاز (د.ع)"
            type="text"
            inputMode="numeric"
            dir="ltr"
            value={goalBonus}
            onChange={(e) => setGoalBonus(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="50000"
          />
          <Input
            label="الموعد النهائي"
            type="datetime-local"
            dir="ltr"
            value={goalDeadline}
            onChange={(e) => setGoalDeadline(e.target.value)}
          />
          <Input
            label="وصف الهدف (اختياري)"
            value={goalTitle}
            onChange={(e) => setGoalTitle(e.target.value)}
            placeholder="مثال: أكمل 15 طلب قبل الغد"
          />
        </div>
      </Modal>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/** All production roles a staff row holds (multi-role), falling back to the legacy single role. */
function rolesOf(u: User): StaffType[] {
  if (u.staff_types && u.staff_types.length) return u.staff_types;
  return u.staff_type ? [u.staff_type] : [];
}

/** Multi-select role picker (toggle chips). Used inline per-row and in the create form. */
function RoleChips({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: StaffType[];
  onChange: (next: StaffType[]) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={ariaLabel}>
      {(Object.entries(STAFF_TYPE_LABELS) as [StaffType, string][]).map(([val, label]) => {
        const on = value.includes(val);
        return (
          <button
            key={val}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== val) : [...value, val])}
            className={`min-h-11 rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-60 ${
              on
                ? "border-orange-ink bg-orange-ink/10 text-orange-ink"
                : "border-line bg-beige text-ink-soft hover:border-orange-ink/40"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default function AdminStaffPage() {
  const [rows, setRows] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [selected, setSelected] = useState<User | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [staffTypesField, setStaffTypesField] = useState<StaffType[]>(["designer"]);
  const [orderScopeField, setOrderScopeField] = useState<StaffOrderScope>("both");

  const [newPassword, setNewPassword] = useState("");
  const [typeUpdating, setTypeUpdating] = useState<string | null>(null);
  const [scopeUpdating, setScopeUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const data = await getAdminStaff();
      setRows(data);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحميل الموظفين"));
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    if (!name.trim() || password.length < PASSWORD_MIN_PRIVILEGED) {
      toast.error(`يرجى إدخال الاسم وكلمة مرور ${PASSWORD_MIN_PRIVILEGED} أحرف على الأقل`);
      return;
    }
    setSubmitting(true);
    try {
      await createStaff({ name, phone: phone.trim() || undefined, email, password, staff_types: staffTypesField, order_scope: orderScopeField });
      toast.success("تم إنشاء الموظف");
      setCreateOpen(false);
      setName("");
      setPhone("");
      setEmail("");
      setPassword("");
      setStaffTypesField(["designer"]);
      setOrderScopeField("both");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر إنشاء الموظف"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateType(userId: string, newTypes: StaffType[]) {
    setTypeUpdating(userId);
    try {
      await updateStaffType(userId, newTypes);
      toast.success("تم تحديث الأدوار");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحديث الدور"));
    } finally {
      setTypeUpdating(null);
    }
  }

  async function handleUpdateScope(userId: string, scope: StaffOrderScope) {
    setScopeUpdating(userId);
    try {
      await updateStaffScope(userId, scope);
      toast.success("تم تحديث النطاق");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحديث النطاق"));
    } finally {
      setScopeUpdating(null);
    }
  }

  async function handleResetPassword() {
    if (!selected || newPassword.length < PASSWORD_MIN_PRIVILEGED) {
      toast.error(`كلمة المرور ${PASSWORD_MIN_PRIVILEGED} أحرف على الأقل`);
      return;
    }
    setSubmitting(true);
    try {
      await resetStaffPassword(selected.id, newPassword);
      toast.success("تم تحديث كلمة المرور");
      setResetOpen(false);
      setNewPassword("");
      setSelected(null);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحديث كلمة المرور"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return (
    <div dir="rtl" lang="ar" className="space-y-6 animate-fade-page-in">
      <div className="skeleton h-9 w-40" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton h-20 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );

  if (fetchError) return (
    <div dir="rtl" lang="ar" className="space-y-4">
      <PageHeader title="الموظفون" subtitle="إدارة حسابات الموظفين" />
      <div className="rounded-2xl border border-danger/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
        <p className="text-base font-semibold text-ink">تعذر تحميل الموظفين</p>
        <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
        <Button className="mt-4" onClick={load}>إعادة المحاولة</Button>
      </div>
    </div>
  );

  return (
    <div dir="rtl" lang="ar">
      <PageHeader
        title="الموظفون"
        subtitle="إدارة حسابات الموظفين والرواتب"
        action={<Button onClick={() => setCreateOpen(true)}>إضافة موظف</Button>}
      />

      {rows.length === 0 ? (
        <EmptyState message="لا يوجد موظفون" />
      ) : (
        <div className="space-y-3">
          {rows.map((u) => (
            <article
              key={u.id}
              className="surface-card card-lift rounded-2xl p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-orange/10 font-display text-base font-bold text-orange-ink"
                  >
                    {u.name?.trim().charAt(0) || "م"}
                  </span>
                  <div>
                    <p className="font-semibold text-ink">{u.name}</p>
                    {u.phone ? (
                      <p className="text-sm text-ink-soft" dir="ltr">
                        {u.phone}
                      </p>
                    ) : (
                      <p className="text-xs font-medium text-orange-ink">
                        بدون هاتف · يدخل عبر الرابط الخاص
                      </p>
                    )}
                    {u.email && <p className="text-xs text-[var(--shop-muted)]">{u.email}</p>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {rolesOf(u).map((t) => (
                        <span key={t} className="inline-flex items-center rounded-full border border-orange-ink/25 bg-orange-ink/8 px-2 py-0.5 text-xs font-semibold text-orange-ink">
                          {STAFF_TYPE_LABELS[t]}
                        </span>
                      ))}
                      {u.order_scope && (
                        <span className="inline-flex items-center rounded-full border border-line bg-surface-sink px-2 py-0.5 text-xs font-medium text-ink-soft">
                          {ORDER_SCOPE_LABELS[u.order_scope]}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Inline multi-role change — toggling a chip saves immediately */}
                  <RoleChips
                    value={rolesOf(u)}
                    disabled={typeUpdating === u.id}
                    ariaLabel={`أدوار ${u.name}`}
                    onChange={(next) => handleUpdateType(u.id, next)}
                  />
                  {/* Inline scope change */}
                  <select
                    value={u.order_scope ?? "both"}
                    disabled={scopeUpdating === u.id}
                    onChange={(e) =>
                      handleUpdateScope(u.id, e.target.value as StaffOrderScope)
                    }
                    className="min-h-11 rounded-xl border border-line bg-beige px-3 py-2 text-sm text-ink shadow-[var(--shadow-soft)] outline-none transition-colors hover:border-orange-ink/40 focus:border-orange-ink disabled:opacity-60"
                    aria-label={`نطاق ${u.name}`}
                  >
                    {Object.entries(ORDER_SCOPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSelected(u);
                      setNewPassword("");
                      setResetOpen(true);
                    }}
                  >
                    تغيير كلمة المرور
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => setDeleteTarget(u)}
                  >
                    حذف
                  </Button>
                </div>
              </div>

              {/* Salary panel — lazy-loaded on expand */}
              <SalaryPanel userId={u.id} userName={u.name} />
            </article>
          ))}
        </div>
      )}

      {/* ── Create staff modal ── */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="إضافة موظف"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={handleCreate} loading={submitting}>
              حفظ
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input label="الاسم" value={name} onChange={(e) => setName(e.target.value)} />
          <div>
            <Input
              label="الهاتف (اختياري)"
              type="tel"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <p className="mt-1 text-xs text-[var(--shop-muted)]">
              الموظفون بدون هاتف يدخلون عبر الرابط الخاص (الاسم + كلمة المرور، بدون رمز تحقق).
            </p>
          </div>
          <Input
            label="البريد الإلكتروني (اختياري)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            label="كلمة المرور"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">الأدوار في الإنتاج</label>
            <RoleChips
              value={staffTypesField}
              onChange={setStaffTypesField}
              ariaLabel="أدوار الموظف الجديد"
            />
            <p className="mt-1 text-xs text-[var(--shop-muted)]">يمكن اختيار أكثر من دور للموظف الواحد.</p>
          </div>
          <Select
            label="نطاق الطلبات"
            value={orderScopeField}
            onChange={(e) => setOrderScopeField(e.target.value as StaffOrderScope)}
            options={Object.entries(ORDER_SCOPE_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </div>
      </Modal>

      {/* ── Reset password modal ── */}
      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title={`تغيير كلمة المرور — ${selected?.name ?? ""}`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setResetOpen(false);
                setSelected(null);
              }}
            >
              إلغاء
            </Button>
            <Button onClick={handleResetPassword} loading={submitting}>
              حفظ
            </Button>
          </>
        }
      >
        <Input
          label="كلمة المرور الجديدة"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </Modal>

      {/* ── Confirm: delete staff ── */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="تأكيد حذف الموظف"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button
              variant="danger"
              loading={submitting}
              onClick={async () => {
                if (!deleteTarget) return;
                setSubmitting(true);
                try {
                  await deleteStaff(deleteTarget.id);
                  toast.success("تم حذف الموظف");
                  setDeleteTarget(null);
                  load();
                } catch (err) {
                  toast.error(getApiErrorMessage(err, "تعذر حذف الموظف"));
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              حذف «{deleteTarget?.name}»
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">
          سيُحذف حساب الموظف «{deleteTarget?.name}» نهائياً. لا يمكن التراجع.
        </p>
      </Modal>
    </div>
  );
}
