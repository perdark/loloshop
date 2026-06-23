"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, getApiErrorMessage } from "@/lib/api";
import {
  submitRepFullSetOrder,
  type RepFullSetContext,
  type CreateFullSetPayload,
} from "@/lib/wholesaler";
import { uploadDesignImage } from "@/lib/designer";
import { FullSetOrderForm } from "@/components/wholesaler/FullSetOrderForm";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

/** Approval states returned by the backend (orthogonal to the production state machine). */
type WholesalerApproval = "pending" | "approved" | "rejected" | null;

/** Raw shape of GET /orders/rep-full-set — includes approval fields the backend now returns. */
interface RawRepFullSetData {
  is_rep_student: boolean;
  approved: boolean;
  packages: RepFullSetContext["packages"];
  existing: RepFullSetContext["existing"];
  pricing: RepFullSetContext["pricing"];
  /** Only present for wholesaler-linked students; NULL for retail. */
  wholesaler_approval?: WholesalerApproval;
  wholesaler_reject_reason?: string | null;
}

// ── Approval banner — defined at module level (not inside render) ──────────────

interface ApprovalBannerProps {
  approval: WholesalerApproval;
  rejectReason: string | null;
}

function ApprovalBanner({ approval, rejectReason }: ApprovalBannerProps) {
  if (approval === "approved") {
    return (
      <div
        role="status"
        className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800"
        style={{ borderInlineStart: "4px solid #16a34a" }}
      >
        <p className="font-semibold">تمت الموافقة — طلبك قيد الإنتاج</p>
      </div>
    );
  }
  if (approval === "pending") {
    return (
      <div
        role="status"
        className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800"
        style={{ borderInlineStart: "4px solid #d97706" }}
      >
        <p className="font-semibold">بانتظار موافقة الممثل</p>
        <p className="mt-0.5 text-xs text-amber-700">
          سيُراجع الممثل طلبك ويوافق عليه قريباً.
        </p>
      </div>
    );
  }
  if (approval === "rejected" && rejectReason) {
    return (
      <div
        role="alert"
        className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800"
        style={{ borderInlineStart: "4px solid #dc2626" }}
      >
        <p className="font-semibold">أعاد الممثل طلبك</p>
        <p className="mt-1 text-red-700">{rejectReason}</p>
        <p className="mt-1 text-xs text-red-600">
          يرجى تعديل الطلب وإعادة الإرسال.
        </p>
      </div>
    );
  }
  return null;
}

// ── Page component ─────────────────────────────────────────────────────────────

export default function StudentMyOrderPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<RepFullSetContext | null>(null);
  /** Orthogonal approval state — independent of the production state machine. */
  const [approval, setApproval] = useState<WholesalerApproval>(null);
  const [rejectReason, setRejectReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [formKey, setFormKey] = useState(0);

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      // Fetch the raw response so we can read wholesaler_approval inline without
      // modifying lib/wholesaler.ts (owned by a parallel agent task, T8).
      const { data } = await api.get<{ data: RawRepFullSetData }>(
        "/orders/rep-full-set"
      );
      const raw = data.data;

      setCtx({
        isRepStudent: raw.is_rep_student,
        approved: raw.approved,
        packages: raw.packages || [],
        existing: raw.existing,
        pricing: raw.pricing ?? null,
      });
      setApproval(raw.wholesaler_approval ?? null);
      setRejectReason(raw.wholesaler_reject_reason ?? null);
      setFormKey((k) => k + 1);

      // Non-rep students don't belong here — send them to the shop.
      if (!raw.is_rep_student) router.replace("/");
    } catch (err) {
      setLoadError(true);
      toast.error(getApiErrorMessage(err, "تعذر تحميل النموذج"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(payload: CreateFullSetPayload) {
    setSubmitting(true);
    try {
      await submitRepFullSetOrder(payload);
      // After a successful save the order re-enters 'pending' approval.
      toast.success("تم الإرسال — بانتظار موافقة الممثل");
      setApproval("pending");
      setRejectReason(null);
      setDone(true);
      // Refresh so a later edit pre-fills with the saved values.
      api
        .get<{ data: RawRepFullSetData }>("/orders/rep-full-set")
        .then(({ data: d }) => {
          const raw = d.data;
          setCtx({
            isRepStudent: raw.is_rep_student,
            approved: raw.approved,
            packages: raw.packages || [],
            existing: raw.existing,
            pricing: raw.pricing ?? null,
          });
          setApproval(raw.wholesaler_approval ?? null);
          setRejectReason(raw.wholesaler_reject_reason ?? null);
          setFormKey((k) => k + 1);
        })
        .catch(() => {});
    } catch (err) {
      // 403 ERR_LOCKED = the order was approved while the form was open — show a
      // friendly toast and refresh to reflect the locked state.
      const code = (err as { response?: { data?: { code?: string } } })?.response
        ?.data?.code;
      if (code === "ERR_LOCKED") {
        toast.error("الطلب تمت الموافقة عليه ولا يمكن تعديله");
        // Refresh to show the locked banner.
        load();
      } else {
        toast.error(getApiErrorMessage(err, "تعذر إرسال الطلب"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageLoader />;

  if (loadError || !ctx) {
    return (
      <EmptyState
        title="تعذر تحميل النموذج"
        message="تحقق من الاتصال ثم حاول مجدداً."
        action={
          <Button variant="ghost" onClick={load}>
            إعادة المحاولة
          </Button>
        }
      />
    );
  }

  if (!ctx.isRepStudent) return <PageLoader />; // redirecting to "/"

  // Stage 1 gate: student not yet approved by rep to JOIN the cohort.
  if (!ctx.approved) {
    return (
      <EmptyState
        title="بانتظار موافقة الممثل"
        message="سيتمكّن من إدخال طلبك بعد موافقة ممثل الجامعة على تسجيلك."
      />
    );
  }

  // Stage 2: approved orders are locked — show the banner + read-only form.
  if (approval === "approved") {
    return (
      <div className="space-y-5">
        <header>
          <h1 className="section-heading font-display-ar text-2xl font-bold text-ink">
            طلبك
          </h1>
        </header>
        <ApprovalBanner approval={approval} rejectReason={rejectReason} />
        {/* Read-only: pointer-events off so the student can view but not edit. */}
        <div className="pointer-events-none select-none opacity-60">
          <FullSetOrderForm
            key={formKey}
            pricing={ctx.pricing}
            initial={ctx.existing}
            submitting={false}
            submitLabel="تحديث الطلب"
            onUploadImage={uploadDesignImage}
            onSubmit={() => {}}
          />
        </div>
      </div>
    );
  }

  // Done screen — shown after a successful save (now pending approval).
  if (done) {
    return (
      <div className="space-y-5">
        <ApprovalBanner approval="pending" rejectReason={null} />
        <div className="space-y-5 py-6 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-orange-ink/10 text-3xl text-orange-ink">
            ✓
          </div>
          <div>
            <h1 className="font-display-ar text-2xl font-bold text-ink">
              تم الإرسال
            </h1>
            <p className="mt-2 text-sm text-ink-soft">
              طلبك بانتظار موافقة الممثل. يمكنك تعديله حتى تتم الموافقة.
            </p>
          </div>
          <Button onClick={() => setDone(false)}>تعديل الطلب</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="section-heading font-display-ar text-2xl font-bold text-ink">
          {ctx.existing ? "تعديل طلبك" : "طلب طقم التخرج"}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {ctx.existing
            ? "الحقول معبّأة بقيم طلبك الحالي — عدّلها ثم احفظ."
            : "املأ النموذج لطلب طقم تخرجك (روب + وشاح + قبعة)."}
        </p>
      </header>

      {/* Approval banner for pending/rejected states — shown above the editable form. */}
      <ApprovalBanner approval={approval} rejectReason={rejectReason} />

      <FullSetOrderForm
        key={formKey}
        pricing={ctx.pricing}
        initial={ctx.existing}
        submitting={submitting}
        submitLabel={ctx.existing ? "تحديث الطلب" : "تأكيد الطلب"}
        onUploadImage={uploadDesignImage}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
