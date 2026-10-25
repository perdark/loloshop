"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/Spinner";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { getApiErrorMessage } from "@/lib/api";
import { logout } from "@/lib/auth";
import {
  approveDesignTeamJob,
  claimDesignTeamJob,
  createDesignTeamLead,
  createDesignTeamMember,
  editDesignTeamLine,
  getDesignTeamJobs,
  getDesignTeamMembers,
  getDesignTeamSession,
  readyDesignTeamJob,
  rejectDesignTeamJob,
  removeDesignTeamMember,
  updateDesignTeamMember,
  uploadDesignTeamFinal,
  uploadDesignTeamLineImage,
  type DesignTeamJob,
  type DesignTeamSpecLine,
  type DesignTeamMember,
  type DesignTeamSession,
} from "@/lib/design-team";
import { formatDateShort } from "@/lib/format";
import { PASSWORD_MIN_PRIVILEGED } from "@/lib/constants";
import { matchesAr } from "@/lib/arabic";

type Tab = "jobs" | "team";

function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:4000";
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

const TASK_STATUS: Record<"open" | "ready", { label: string; className: string }> = {
  open: {
    label: "قيد المراجعة",
    className: "border-line bg-surface-sink text-ink-soft",
  },
  ready: {
    label: "جاهز لمراجعة محمد",
    className: "border-orange-ink/30 bg-orange-ink/10 text-orange-ink",
  },
};

function taskPresentation(job: DesignTeamJob) {
  if (job.task.status === "ready") return TASK_STATUS.ready;
  if (job.task.assignedName) {
    return { label: `قيد المراجعة · ${job.task.assignedName}`, className: "border-line bg-surface-sink text-ink-soft" };
  }
  return { label: "جديد", className: "border-line bg-surface text-ink-soft" };
}

function TaskCard({ job, onOpen }: { job: DesignTeamJob; onOpen: () => void }) {
  const task = taskPresentation(job);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card-lift flex min-h-44 w-full flex-col rounded-2xl border border-line bg-surface p-4 text-right shadow-[var(--shadow-soft)] transition-colors hover:border-orange-ink/35"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-display-ar text-xl font-bold text-ink">{job.studentName}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {job.universityName || "—"}
            {job.department ? ` · ${job.department}` : ""}
          </p>
          {job.student.instagram && (
            <p className="mt-0.5 text-xs font-semibold text-orange-ink" dir="ltr">@{job.student.instagram}</p>
          )}
          {job.source === "wholesaler" && (
            <p className="mt-1.5 inline-flex max-w-full rounded-full border border-line bg-surface-sink px-2 py-0.5 text-xs font-semibold text-ink-soft">
              <span className="truncate">
                ممثل: {job.repName ?? "—"}
                {job.batchName ? ` · ${job.batchName}` : ""}
              </span>
            </p>
          )}
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${task.className}`}>
          {task.label}
        </span>
      </div>
      <div className="mt-auto flex items-end justify-between gap-3 border-t border-line pt-3">
        <div>
          <p className="text-sm font-semibold text-ink">{job.productName}</p>
          <p className="mt-1 text-xs text-muted">أُضيف {formatDateShort(job.createdAt)}</p>
        </div>
        <span className="text-sm font-semibold text-orange-ink">فتح ←</span>
      </div>
    </button>
  );
}

function chipClass(on: boolean) {
  return `inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors ${on ? "border-orange-ink bg-orange-ink text-white" : "border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink"}`;
}

const GENDER_AR: Record<string, string> = { male: "ذكر", female: "أنثى" };

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line/70 py-1.5 last:border-0">
      <span className="shrink-0 text-xs font-medium text-ink-soft">{label}</span>
      <span className="min-w-0 break-words text-left text-sm font-semibold text-ink">{children}</span>
    </div>
  );
}

function StudentInfo({ student }: { student: DesignTeamJob["student"] }) {
  const rows: React.ReactNode[] = [];
  if (student.fullName) rows.push(<InfoRow key="name" label="الاسم الكامل">{student.fullName}</InfoRow>);
  if (student.instagram)
    rows.push(
      <InfoRow key="ig" label="انستغرام">
        <a
          href={`https://instagram.com/${student.instagram}`}
          target="_blank"
          rel="noreferrer"
          dir="ltr"
          className="text-orange-ink underline underline-offset-2"
        >
          @{student.instagram}
        </a>
      </InfoRow>
    );
  if (student.phone)
    rows.push(
      <InfoRow key="phone" label="الهاتف">
        <a href={`tel:${student.phone}`} dir="ltr" className="text-orange-ink underline underline-offset-2">
          {student.phone}
        </a>
      </InfoRow>
    );
  if (student.gender) rows.push(<InfoRow key="gender" label="الجنس">{GENDER_AR[student.gender] ?? student.gender}</InfoRow>);
  if (student.governorate) rows.push(<InfoRow key="gov" label="المحافظة">{student.governorate}</InfoRow>);
  if (student.eventDate) rows.push(<InfoRow key="event" label="تاريخ الحفلة">{formatDateShort(student.eventDate)}</InfoRow>);
  if (student.notes) rows.push(<InfoRow key="notes" label="ملاحظات الطالب">{student.notes}</InfoRow>);

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink">معلومات الطالب</h3>
      {rows.length ? (
        <div className="mt-2">{rows}</div>
      ) : (
        <p className="mt-2 text-sm text-ink-soft">لا توجد معلومات إضافية عن الطالب.</p>
      )}
    </section>
  );
}

function SpecPhoto({ url, alt }: { url: string; alt: string }) {
  const src = resolveImageUrl(url);
  if (!src) return null;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block shrink-0">
      <Image
        src={src}
        alt={alt}
        width={96}
        height={96}
        className="h-24 w-24 rounded-xl border border-line object-cover"
      />
    </a>
  );
}

// One order line inside the job modal. Editing writes ONLY the line's text or its photo
// (owner 2026-10-13: «النص والصور بس») — prices, options and the product are untouchable
// from this desk, and the generated plate (plate_image_url) is never written here.
function SpecLineRow({
  line,
  canEdit,
  busy,
  onSaveText,
  onRemoveImage,
  onReplaceImage,
}: {
  line: DesignTeamSpecLine;
  canEdit: boolean;
  busy: boolean;
  onSaveText: (text: string) => Promise<boolean>;
  onRemoveImage: () => Promise<boolean>;
  onReplaceImage: (file: File) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line.text ?? "");
  const fileRef = useRef<HTMLInputElement>(null);
  const editable = canEdit && Boolean(line.itemId);

  async function save() {
    if (await onSaveText(draft)) setEditing(false);
  }

  function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void onReplaceImage(file);
  }

  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-start gap-3">
        {line.imageUrl && <SpecPhoto url={line.imageUrl} alt={line.label ?? "صورة"} />}
        {/* The generated plate is shown BESIDE the student's photo, never instead of
            it. Until migration 080 one column held both, so the plate replaced the
            photo here and the team designed from the machine's output. */}
        {line.plateImageUrl && <SpecPhoto url={line.plateImageUrl} alt="الخط المولّد" />}
        <div className="min-w-0 flex-1">
          {line.label && <p className="text-xs font-semibold text-orange-ink">{line.label}</p>}
          {!editing && line.text && <p className="mt-0.5 whitespace-pre-wrap text-sm leading-6 text-ink">{line.text}</p>}
          {!editing && line.imageUrl && !line.text && <p className="mt-0.5 text-xs text-ink-soft">صورة مرفقة — اضغط للتكبير</p>}
          {line.plateImageUrl && <p className="mt-0.5 text-xs text-ink-soft">يوجد خط مولّد لهذا السطر</p>}
          {editing && (
            <textarea
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              maxLength={500}
              className="mt-1.5 min-h-20 w-full resize-y rounded-xl border border-line bg-beige px-3 py-2 text-sm text-ink outline-none focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
            />
          )}
        </div>
      </div>
      {editable && (
        <div className="mt-2.5 flex flex-wrap gap-2 border-t border-line/70 pt-2.5">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
          {editing ? (
            <>
              <Button size="sm" onClick={save} loading={busy} disabled={busy}>
                حفظ النص
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDraft(line.text ?? "");
                  setEditing(false);
                }}
              >
                إلغاء
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(true)}>
                {line.text ? "تعديل النص" : "إضافة نص"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
                {line.imageUrl ? "تبديل الصورة" : "إضافة صورة"}
              </Button>
              {line.imageUrl && line.text && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onRemoveImage()}>
                  حذف الصورة
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function JobDetail({
  job,
  viewerId,
  canManage,
  busy,
  onClose,
  onClaim,
  onReady,
  onApprove,
  onReject,
  onUpload,
  onEditLine,
  onLineImage,
}: {
  job: DesignTeamJob;
  viewerId: string;
  canManage: boolean;
  busy: string | null;
  onClose: () => void;
  onClaim: () => Promise<void>;
  onReady: (note: string) => Promise<void>;
  onApprove: () => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  onUpload: (file: File) => Promise<void>;
  onEditLine: (itemId: string, change: { text?: string; removeImage?: boolean }) => Promise<boolean>;
  onLineImage: (itemId: string, file: File) => Promise<boolean>;
}) {
  const [note, setNote] = useState(job.task.note ?? "");
  const [rejectMode, setRejectMode] = useState(false);
  // Same two-step shape as rejectMode, and for the same reason: the footer swaps to
  // «رجوع» + «تأكيد الإنهاء» instead of a window.confirm — a native browser dialog
  // freezes the Chrome extension the project verifies with.
  const [finishMode, setFinishMode] = useState(false);
  const [reason, setReason] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const isMine = job.task.assignedTo === viewerId;
  const isTaken = Boolean(job.task.assignedTo && !isMine);
  const isReady = job.task.status === "ready";
  const canWork = !canManage && (isMine || !job.task.assignedTo);
  const actionBusy = busy !== null;
  const finalSrc = resolveImageUrl(job.finalDesignUrl);

  async function markReady() {
    await onReady(note.trim());
    onClose();
  }

  async function reject() {
    if (!reason.trim()) {
      toast.error("اكتب سبب الإعادة أولاً");
      return;
    }
    await onReject(reason.trim());
    onClose();
  }

  function pickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void onUpload(file);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${job.studentName} — ${job.productName}`}
      footer={
        <div className="flex w-full flex-wrap gap-2">
          <Button variant="ghost" onClick={onClose} disabled={actionBusy}>
            إغلاق
          </Button>
          {canManage && !rejectMode && (
            <>
              <Button variant="danger" onClick={() => setRejectMode(true)} disabled={actionBusy}>
                إعادته للعضو
              </Button>
              <Button onClick={onApprove} loading={busy === "approve"} disabled={actionBusy && busy !== "approve"}>
                اعتماد وإرسال للتطريز
              </Button>
            </>
          )}
          {canManage && rejectMode && (
            <>
              <Button variant="ghost" onClick={() => setRejectMode(false)} disabled={actionBusy}>
                رجوع
              </Button>
              <Button variant="danger" onClick={reject} loading={busy === "reject"} disabled={actionBusy && busy !== "reject"}>
                تأكيد الإعادة
              </Button>
            </>
          )}
          {!canManage && !isReady && !isTaken && !isMine && !finishMode && (
            <Button onClick={onClaim} loading={busy === "claim"} disabled={actionBusy && busy !== "claim"}>
              استلام للتصميم
            </Button>
          )}
          {/* «جاهز لمراجعة محمد» is KEPT — a member who wants محمد to look first still can.
              It steps down to `ghost` because finishing is now the primary move. */}
          {canWork && !isReady && !finishMode && (
            <Button variant="ghost" onClick={markReady} loading={busy === "ready"} disabled={actionBusy && busy !== "ready"}>
              جاهز لمراجعة محمد
            </Button>
          )}
          {canWork && !finishMode && (
            <Button onClick={() => setFinishMode(true)} disabled={actionBusy}>
              إنهاء التصميم وإرساله للتطريز
            </Button>
          )}
          {canWork && finishMode && (
            <>
              <Button variant="ghost" onClick={() => setFinishMode(false)} disabled={actionBusy}>
                رجوع
              </Button>
              <Button onClick={onApprove} loading={busy === "approve"} disabled={actionBusy && busy !== "approve"}>
                تأكيد الإنهاء
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-5" dir="rtl">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={`rounded-full border px-2.5 py-1 font-semibold ${taskPresentation(job).className}`}>
            {taskPresentation(job).label}
          </span>
          <span className="rounded-full border border-line bg-surface-sink px-2.5 py-1 text-ink-soft">
            {job.universityName || "—"}
            {job.department ? ` · ${job.department}` : ""}
          </span>
          {job.source === "wholesaler" && (
            <span className="rounded-full border border-line bg-surface-sink px-2.5 py-1 text-ink-soft">
              ممثل: {job.repName ?? "—"}
              {job.batchName ? ` · ${job.batchName}` : ""}
            </span>
          )}
        </div>

        <StudentInfo student={job.student} />

        <section className="rounded-2xl border border-line bg-surface-sink p-4">
          <h3 className="text-sm font-semibold text-ink">تفاصيل التصميم المطلوب</h3>
          {job.specLines.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">لا توجد تفاصيل مكتوبة لهذا الطلب.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {job.specLines.map((line, index) => (
                <SpecLineRow
                  key={line.itemId ?? index}
                  line={line}
                  canEdit={canWork || canManage}
                  busy={busy === `line:${line.itemId}`}
                  onSaveText={(text) => onEditLine(line.itemId!, { text })}
                  onRemoveImage={() => onEditLine(line.itemId!, { removeImage: true })}
                  onReplaceImage={(file) => onLineImage(line.itemId!, file)}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink">التصميم النهائي</h3>
            <Link
              href="/design-support/calligraphy"
              className="inline-flex min-h-9 items-center rounded-full border border-orange-ink/30 bg-orange-ink/10 px-3 text-xs font-semibold text-orange-ink"
            >
              الخط العربي ←
            </Link>
          </div>
          {finalSrc ? (
            <a href={finalSrc} target="_blank" rel="noreferrer" className="mt-3 block">
              <Image
                src={finalSrc}
                alt="التصميم النهائي"
                width={480}
                height={320}
                className="max-h-64 w-full rounded-xl border border-line object-contain"
              />
            </a>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">لم يُرفع تصميم نهائي بعد.</p>
          )}
          {(canWork || canManage) && (
            <>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickFile} />
              <Button
                variant="ghost"
                className="mt-3"
                onClick={() => fileRef.current?.click()}
                loading={busy === "upload"}
                disabled={actionBusy && busy !== "upload"}
              >
                {finalSrc ? "استبدال التصميم النهائي" : "رفع التصميم النهائي"}
              </Button>
            </>
          )}
          {/* Owner 2026-10-26: finishing needs no upload and no اعتماد from محمد — the
              server never required artwork on this edge, and the UI gate was the only wall. */}
        </section>

        {job.task.note && !rejectMode && (
          <section className="rounded-2xl border border-orange-ink/20 bg-orange-ink/5 p-4">
            <h3 className="text-sm font-semibold text-orange-ink">ملاحظة محمد للعضو</h3>
            <p className="mt-1.5 text-sm leading-6 text-ink-soft">{job.task.note}</p>
          </section>
        )}

        {isTaken && !canManage && (
          <p className="rounded-xl border border-line bg-surface-sink px-4 py-3 text-sm text-ink-soft">
            هذا الطلب يعمل عليه الآن {job.task.assignedName}.
          </p>
        )}

        {canWork && finishMode && (
          <section className="rounded-2xl border border-orange-ink/30 bg-orange-ink/5 p-4">
            <h3 className="text-sm font-semibold text-orange-ink">تأكيد الإنهاء</h3>
            <p className="mt-1.5 text-sm leading-6 text-ink-soft">
              سيخرج الطلب من أيادي التصميم وينتقل إلى التطريز، ولن تتمكن من تعديله من هنا بعدها.
            </p>
          </section>
        )}

        {canWork && !isReady && !finishMode && (
          <label className="block text-sm font-medium text-ink">
            <span className="mb-1.5 block">ملاحظة لمحمد (اختيارية)</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder="أي ملاحظة يحتاجها في المراجعة النهائية"
              className="min-h-24 w-full resize-y rounded-xl border border-line bg-beige px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink/55 focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
            />
          </label>
        )}

        {canManage && rejectMode && (
          <label className="block text-sm font-medium text-ink">
            <span className="mb-1.5 block">سبب الإعادة للعضو</span>
            <textarea
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              placeholder="اكتب الملاحظة التي ستصل للعضو الذي صمّم الطلب"
              className="min-h-28 w-full resize-y rounded-xl border border-line bg-beige px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink/55 focus:border-danger focus:ring-2 focus:ring-danger/20"
            />
          </label>
        )}
      </div>
    </Modal>
  );
}

function AddMemberModal({
  onClose,
  onCreate,
  loading,
}: {
  onClose: () => void;
  onCreate: (name: string, password: string) => Promise<boolean>;
  loading: boolean;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  async function save() {
    if (!name.trim() || password.length < PASSWORD_MIN_PRIVILEGED) {
      toast.error(`أدخل الاسم وكلمة مرور من ${PASSWORD_MIN_PRIVILEGED} أحرف على الأقل`);
      return;
    }
    if (await onCreate(name.trim(), password)) onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="إضافة عضو إلى أيادي التصميم"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>إلغاء</Button>
          <Button onClick={save} loading={loading}>إضافة</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input label="الاسم" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
        <Input
          label="كلمة المرور"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
        />
        <p className="text-xs leading-5 text-ink-soft">
          هذا الحساب يعمل فقط داخل أيادي التصميم، عبر الرابط الخاص.
        </p>
      </div>
    </Modal>
  );
}

function LeadSetup({
  onCreate,
  loading,
}: {
  onCreate: (name: string, password: string) => Promise<void>;
  loading: boolean;
}) {
  const [name, setName] = useState("محمد هيثم");
  const [password, setPassword] = useState("");
  return (
    <section className="rounded-2xl border border-orange-ink/25 bg-orange-ink/5 p-5">
      <h2 className="font-display-ar text-xl font-bold text-ink">إعداد حساب محمد هيثم</h2>
      <p className="mt-1 text-sm leading-6 text-ink-soft">
        هذا الحساب هو مسؤول أيادي التصميم. يراجع التصاميم ويضيف أو يزيل أعضاء الفريق.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Input label="الاسم" value={name} onChange={(event) => setName(event.target.value)} />
        <Input
          label="كلمة المرور"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
        />
      </div>
      <Button
        className="mt-4"
        loading={loading}
        onClick={() => {
          if (!name.trim() || password.length < PASSWORD_MIN_PRIVILEGED) {
            toast.error(`أدخل الاسم وكلمة مرور من ${PASSWORD_MIN_PRIVILEGED} أحرف على الأقل`);
            return;
          }
          onCreate(name.trim(), password);
        }}
      >
        إنشاء الحساب
      </Button>
    </section>
  );
}

function TeamTab({
  session,
  isAdmin,
  onReload,
}: {
  session: DesignTeamSession;
  isAdmin: boolean;
  onReload: () => Promise<void>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const lead = session.members.find((member) => member.memberRole === "lead" && member.active);
  const helpers = session.members.filter((member) => member.memberRole === "helper");
  const portalLink = useMemo(() => {
    if (!session.team?.portalPath || typeof window === "undefined") return null;
    return `${window.location.origin}${session.team.portalPath}`;
  }, [session.team?.portalPath]);

  async function createLead(name: string, password: string) {
    setBusy("lead");
    try {
      await createDesignTeamLead({ name, password });
      toast.success("تم إعداد حساب محمد هيثم");
      await onReload();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "تعذر إنشاء الحساب"));
    } finally {
      setBusy(null);
    }
  }

  async function createMember(name: string, password: string): Promise<boolean> {
    setBusy("add");
    try {
      await createDesignTeamMember({ name, password });
      toast.success("تمت الإضافة إلى أيادي التصميم");
      await onReload();
      return true;
    } catch (error) {
      toast.error(getApiErrorMessage(error, "تعذرت الإضافة"));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function toggleMember(member: DesignTeamMember) {
    setBusy(member.userId);
    try {
      await updateDesignTeamMember(member.userId, { active: !member.active });
      toast.success(member.active ? "تم إيقاف الوصول" : "تم تفعيل الوصول");
      await onReload();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "تعذر التحديث"));
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(member: DesignTeamMember) {
    if (!window.confirm(`إزالة ${member.name} من أيادي التصميم؟`)) return;
    setBusy(member.userId);
    try {
      await removeDesignTeamMember(member.userId);
      toast.success("تمت الإزالة من الفريق");
      await onReload();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "تعذرت الإزالة"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {!lead && isAdmin ? <LeadSetup onCreate={createLead} loading={busy === "lead"} /> : null}

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-display-ar text-xl font-bold text-ink">الرابط الخاص</h2>
            <p className="mt-1 text-sm leading-6 text-ink-soft">
              يفتح هذا الرابط مساحة أيادي التصميم فقط. شاركه مع أعضاء الفريق فقط.
            </p>
          </div>
          {portalLink ? <CopyButton text={portalLink} label="نسخ الرابط" /> : null}
        </div>
        {portalLink ? (
          <p className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface-sink px-3 py-2 text-xs text-ink-soft" dir="ltr">
            {portalLink}
          </p>
        ) : (
          <p className="mt-4 rounded-xl border border-orange-ink/25 bg-orange-ink/5 px-3 py-2 text-sm text-orange-ink">
            أضف DESIGN_TEAM_PORTAL_KEY في إعدادات الخادم لتفعيل الرابط الخاص.
          </p>
        )}
      </section>

      {lead && (
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-soft)]">
          <p className="text-xs text-ink-soft">مسؤول أيادي التصميم</p>
          <p className="mt-1 font-display-ar text-2xl font-bold text-ink">{lead.name}</p>
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display-ar text-xl font-bold text-ink">أعضاء أيادي التصميم</h2>
            <p className="mt-1 text-sm text-ink-soft">
              {session.team?.activeHelperCount ?? 0} من {session.team?.helperLimit ?? 2} أماكن مفعّلة
            </p>
          </div>
          <Button
            onClick={() => setAddOpen(true)}
            disabled={(session.team?.activeHelperCount ?? 0) >= (session.team?.helperLimit ?? 2)}
          >
            إضافة عضو
          </Button>
        </div>

        {helpers.length === 0 ? (
          <EmptyState title="لا يوجد أعضاء بعد" message="أضف من يعمل مع محمد في مرحلة التصميم." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {helpers.map((member) => (
              <article key={member.userId} className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{member.name}</p>
                    <p className={`mt-1 text-xs font-medium ${member.active ? "text-orange-ink" : "text-ink-soft"}`}>
                      {member.active ? "الوصول مفعّل" : "الوصول متوقف"}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => toggleMember(member)} loading={busy === member.userId}>
                      {member.active ? "إيقاف" : "تفعيل"}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => removeMember(member)} disabled={busy !== null}>
                      إزالة
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {addOpen && <AddMemberModal onClose={() => setAddOpen(false)} onCreate={createMember} loading={busy === "add"} />}
    </div>
  );
}

export default function DesignSupportPage() {
  const router = useRouter();
  // staff allowed too: محمد هيثم leads the desk from his normal staff (manager) account
  // (2026-07-15). Non-member staff get a clean error — the backend 403s them.
  const { user, loading: authLoading } = useRequireAuth(["design_helper", "admin", "staff"]);
  const [session, setSession] = useState<DesignTeamSession | null>(null);
  const [jobs, setJobs] = useState<DesignTeamJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>("jobs");
  const [selected, setSelected] = useState<DesignTeamJob | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Source → ممثل → دفعة drill-down (owner 2026-10-13: the desk now works دفعات الممثلين).
  const [source, setSource] = useState<"all" | "retail" | "wholesaler">("all");
  const [rep, setRep] = useState<string | null>(null);
  const [batch, setBatch] = useState<string | null>(null);

  const reps = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const job of jobs) {
      if (job.source !== "wholesaler") continue;
      const name = job.repName ?? "—";
      const batches = map.get(name) ?? new Map<string, number>();
      if (job.batchName) batches.set(job.batchName, (batches.get(job.batchName) ?? 0) + 1);
      map.set(name, batches);
    }
    return [...map.entries()]
      .map(([name, batches]) => ({
        name,
        count: jobs.filter((j) => j.source === "wholesaler" && (j.repName ?? "—") === name).length,
        batches: [...batches.entries()].map(([b, n]) => ({ name: b, count: n })),
      }))
      .sort((a, b) => b.count - a.count);
  }, [jobs]);

  const retailCount = useMemo(() => jobs.filter((j) => j.source === "retail").length, [jobs]);
  const activeRep = rep ? reps.find((r) => r.name === rep) ?? null : null;

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const scoped = jobs.filter((job) => {
      if (source !== "all" && job.source !== source) return false;
      if (source === "wholesaler" && rep && (job.repName ?? "—") !== rep) return false;
      if (source === "wholesaler" && rep && batch && job.batchName !== batch) return false;
      return true;
    });
    if (!q) return scoped;
    return scoped.filter((job) =>
      [
        job.studentName,
        job.student.fullName,
        job.universityName,
        job.department,
        job.student.instagram,
        job.student.phone,
        job.productName,
        job.repName,
        job.batchName,
      ]
        .filter(Boolean)
        // Spelling-insensitive Arabic match — see lib/arabic.ts.
        .some((field) => matchesAr(String(field), q))
    );
  }, [jobs, search, source, rep, batch]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const nextSession = await getDesignTeamSession();
      const nextJobs = await getDesignTeamJobs();
      const members = nextSession.viewer.canManage ? await getDesignTeamMembers() : [];
      setSession({ ...nextSession, members });
      setJobs(nextJobs);
    } catch (loadError) {
      setError(true);
      toast.error(getApiErrorMessage(loadError, "تعذر تحميل أيادي التصميم"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user) void load();
  }, [authLoading, load, user]);

  async function runAction(kind: "claim" | "ready" | "approve" | "reject", work: () => Promise<void>) {
    setAction(kind);
    try {
      await work();
      const success = {
        claim: "تم استلام الطلب للتصميم",
        ready: "تم إرساله لمراجعة محمد",
        // Same endpoint, two different acts: محمد يعتمد عمل غيره، والعضو ينهي عمله بنفسه.
        approve: session?.viewer.canManage
          ? "تم اعتماد التصميم وإرساله للتطريز"
          : "تم إنهاء التصميم وإرساله للتطريز",
        reject: "تمت إعادته للعضو",
      }[kind];
      toast.success(success);
      setSelected(null);
      await load();
    } catch (actionError) {
      toast.error(getApiErrorMessage(actionError, "تعذر تنفيذ الإجراء"));
    } finally {
      setAction(null);
    }
  }

  // Upload the final artwork onto the order, then refresh so the modal shows it
  // without closing (the member usually uploads, eyeballs it, then marks ready).
  async function handleUpload(file: File) {
    if (!selected) return;
    setAction("upload");
    try {
      await uploadDesignTeamFinal(selected.orderId, file);
      toast.success("تم رفع التصميم النهائي");
      const fresh = await getDesignTeamJobs();
      setJobs(fresh);
      const updated = fresh.find((job) => job.id === selected.id);
      if (updated) setSelected(updated);
    } catch (uploadError) {
      toast.error(getApiErrorMessage(uploadError, "تعذر رفع الملف"));
    } finally {
      setAction(null);
    }
  }

  // Line edits keep the modal open and swap in the fresh job the server returns.
  async function runLineEdit(itemId: string, work: () => Promise<DesignTeamJob>, done: string) {
    setAction(`line:${itemId}`);
    try {
      const updated = await work();
      setSelected(updated);
      setJobs((prev) => prev.map((job) => (job.id === updated.id ? updated : job)));
      toast.success(done);
      return true;
    } catch (editError) {
      toast.error(getApiErrorMessage(editError, "تعذر حفظ التعديل"));
      return false;
    } finally {
      setAction(null);
    }
  }

  if (authLoading || !user || loading) return <PageLoader />;

  const canManage = Boolean(session?.viewer.canManage);
  const isAdmin = user.role === "admin";
  const title = session?.team?.name ?? "أيادي التصميم";

  return (
    <div className="min-h-dvh bg-cream" dir="rtl" lang="ar">
      <header className="sticky top-0 z-20 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <div>
            <p className="text-xs font-medium text-orange-ink">لولو شوب</p>
            <p className="font-display-ar text-xl font-bold text-ink">{title}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/design-support/calligraphy"
              className="inline-flex min-h-11 items-center rounded-full border border-orange-ink/30 bg-orange-ink/10 px-4 text-sm font-semibold text-orange-ink transition-colors hover:bg-orange-ink/15"
            >
              الخط العربي
            </Link>
            <Link
              href="/design-support/studio"
              className="inline-flex min-h-11 items-center rounded-full border border-orange-ink/30 bg-orange-ink/10 px-4 text-sm font-semibold text-orange-ink transition-colors hover:bg-orange-ink/15"
            >
              ChatGPT
            </Link>
            {isAdmin ? (
              <Link href="/admin" className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface-sink px-4 text-sm font-semibold text-ink transition-colors hover:border-orange-ink/40 hover:text-orange-ink">
                لوحة التحكم
              </Link>
            ) : (
              <Button
                variant="ghost"
                onClick={() => {
                  logout();
                  router.replace("/");
                }}
              >
                خروج
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
        <PageHeader
          title={title}
          subtitle="تصميم طلبات التجزئة ودفعات الممثلين ومراجعتها"
          action={
            <Button variant="ghost" onClick={() => void load()} loading={loading}>
              تحديث
            </Button>
          }
        />

        {canManage && (
          <div className="mb-6 inline-flex rounded-full border border-line bg-surface-sink p-1">
            <button
              type="button"
              onClick={() => setTab("jobs")}
              className={`min-h-10 rounded-full px-4 text-sm font-semibold transition-colors ${tab === "jobs" ? "bg-orange-ink text-white" : "text-ink-soft hover:text-ink"}`}
            >
              مهام التصميم
            </button>
            <button
              type="button"
              onClick={() => setTab("team")}
              className={`min-h-10 rounded-full px-4 text-sm font-semibold transition-colors ${tab === "team" ? "bg-orange-ink text-white" : "text-ink-soft hover:text-ink"}`}
            >
              الفريق
            </button>
          </div>
        )}

        {error ? (
          <div className="rounded-2xl border border-danger/25 bg-surface px-6 py-10 text-center">
            <p className="font-semibold text-ink">تعذر تحميل مساحة التصميم</p>
            <p className="mt-1 text-sm text-ink-soft">تحقق من الاتصال ثم أعد المحاولة.</p>
            <Button className="mt-4" onClick={() => void load()}>إعادة المحاولة</Button>
          </div>
        ) : tab === "team" && canManage && session ? (
          <TeamTab session={session} isAdmin={isAdmin} onReload={load} />
        ) : jobs.length === 0 ? (
          <EmptyState title="لا توجد طلبات تحتاج تصميماً الآن" message="ستظهر هنا طلبات التجزئة ودفعات الممثلين التي تحتاج تصميماً." />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {([
                ["all", `الكل · ${jobs.length}`],
                ["retail", `تجزئة · ${retailCount}`],
                ["wholesaler", `دفعات الممثلين · ${jobs.length - retailCount}`],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSource(key);
                    setRep(null);
                    setBatch(null);
                  }}
                  className={chipClass(source === key)}
                >
                  {label}
                </button>
              ))}
            </div>
            {source === "wholesaler" && reps.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => { setRep(null); setBatch(null); }} className={chipClass(rep === null)}>
                  كل الممثلين
                </button>
                {reps.map((r) => (
                  <button
                    key={r.name}
                    type="button"
                    onClick={() => { setRep(r.name); setBatch(null); }}
                    className={chipClass(rep === r.name)}
                  >
                    {r.name} · {r.count}
                  </button>
                ))}
              </div>
            )}
            {source === "wholesaler" && activeRep && activeRep.batches.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setBatch(null)} className={chipClass(batch === null)}>
                  كل الدفعات
                </button>
                {activeRep.batches.map((b) => (
                  <button key={b.name} type="button" onClick={() => setBatch(b.name)} className={chipClass(batch === b.name)}>
                    {b.name} · {b.count}
                  </button>
                ))}
              </div>
            )}
            <div className="relative">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ابحث باسم الطالب أو الجامعة أو الممثل أو الانستغرام…"
                className="min-h-11 w-full rounded-xl border border-line bg-surface ps-4 pe-10 text-sm text-ink outline-none transition-colors placeholder:text-ink/50 focus:border-orange-ink focus:ring-2 focus:ring-orange-ink/20"
              />
              <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-ink-soft">🔍</span>
            </div>
            <p className="text-xs text-ink-soft">
              {/* PIECES. A design job is one `orders` row (designTeamController JOB_SELECT,
                  `FROM orders o`), so a student's sash and cap are two jobs here — calling
                  them «طلب» made this screen disagree with /admin about the same cohort. */}
              {search.trim() || source !== "all"
                ? `${filteredJobs.length} من ${jobs.length} قطعة`
                : `${jobs.length} قطعة بانتظار التصميم`}
            </p>
            {filteredJobs.length === 0 ? (
              <EmptyState title="لا نتائج" message="لا توجد قطعة تطابق البحث أو الفلتر." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredJobs.map((job) => (
                  <TaskCard key={job.id} job={job} onOpen={() => setSelected(job)} />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {selected && session && (
        <JobDetail
          job={selected}
          viewerId={session.viewer.id}
          canManage={canManage}
          busy={action}
          onClose={() => setSelected(null)}
          onClaim={() => runAction("claim", () => claimDesignTeamJob(selected.orderId))}
          onReady={(note) => runAction("ready", () => readyDesignTeamJob(selected.orderId, note))}
          onApprove={() => runAction("approve", () => approveDesignTeamJob(selected.orderId))}
          onReject={(reason) => runAction("reject", () => rejectDesignTeamJob(selected.orderId, reason))}
          onUpload={handleUpload}
          onEditLine={(itemId, change) =>
            runLineEdit(itemId, () => editDesignTeamLine(selected.orderId, itemId, change),
              change.removeImage ? "تم حذف الصورة" : "تم حفظ النص")
          }
          onLineImage={(itemId, file) =>
            runLineEdit(itemId, () => uploadDesignTeamLineImage(selected.orderId, itemId, file), "تم تبديل الصورة")
          }
        />
      )}
    </div>
  );
}
