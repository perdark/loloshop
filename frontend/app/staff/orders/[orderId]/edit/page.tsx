"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { getApiErrorMessage } from "@/lib/api";
import {
  getOrderEditContext,
  patchOrderDetails,
  saveStudentFullSetOrder,
  uploadProductionImage,
  type OrderEditContext,
} from "@/lib/staff";
import type { StudyType } from "@/lib/types";
import type { CreateFullSetPayload } from "@/lib/wholesaler";
import { FullSetOrderForm } from "@/components/wholesaler/FullSetOrderForm";
import { RetailOrderEditForm } from "@/components/admin/RetailOrderEditForm";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { PageLoader } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";

// «تعديل الطلب» — admin/مدير الإنتاج edit a student's full طقم (the same form the rep
// uses, pre-filled) + the student's info (الاسم، يوزر الانستا، الهواتف). The backend
// preserves the bundle's rep-approval state across the save.
export default function StaffOrderEditPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params.orderId;
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth(["staff", "admin"]);

  const [ctx, setCtx] = useState<OrderEditContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [instagram, setInstagram] = useState("");
  const [phonePrimary, setPhonePrimary] = useState("");
  const [phoneSecondary, setPhoneSecondary] = useState("");
  const [universityName, setUniversityName] = useState("");
  const [department, setDepartment] = useState("");
  const [studyType, setStudyType] = useState<StudyType | "">("");

  // Limited (quick) editor — retail orders, one text value per editable spec line.
  const [itemTexts, setItemTexts] = useState<Record<string, string>>({});
  const [quickSubmitting, setQuickSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    setLoading(true);
    getOrderEditContext(orderId)
      .then((data) => {
        if (!alive) return;
        setCtx(data);
        setName(data.student.name || "");
        setInstagram(data.group?.instagram_username || data.student.instagram_username || "");
        setPhonePrimary(data.group?.phone_primary || data.student.phone || "");
        setPhoneSecondary(data.group?.phone_secondary || "");
        setUniversityName(data.student.university_name || "");
        setDepartment(data.student.department || "");
        setStudyType(data.student.study_type || "");
        const seed: Record<string, string> = {};
        (data.editable_items || []).forEach((it) => {
          seed[it.id] = it.text || "";
        });
        setItemTexts(seed);
      })
      .catch((e) => {
        if (alive) setLoadError(getApiErrorMessage(e, "تعذر تحميل بيانات الطلب"));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, user?.id]);

  async function handleQuickSave() {
    if (!ctx) return;
    if (!name.trim()) {
      toast.error("اسم الطالب مطلوب");
      return;
    }
    setQuickSubmitting(true);
    try {
      // Only non-empty item texts are sent — the backend 400s an empty customer_text,
      // so a blanked field is simply skipped (not cleared) rather than failing the save.
      const items = Object.entries(itemTexts)
        .filter(([, value]) => value.trim())
        .map(([item_id, value]) => ({ item_id, customer_text: value.trim() }));
      await patchOrderDetails(orderId, {
        items,
        student: {
          name: name.trim(),
          instagram_username: instagram.trim(),
          university_name: universityName.trim(),
          department: department.trim(),
          study_type: studyType,
        },
        group: { phone_primary: phonePrimary.trim(), phone_secondary: phoneSecondary.trim() },
      });
      toast.success("تم حفظ التعديلات");
      router.push(`/staff/orders/${orderId}`);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حفظ التعديلات"));
    } finally {
      setQuickSubmitting(false);
    }
  }

  async function handleSubmit(payload: CreateFullSetPayload) {
    if (!ctx) return;
    if (!name.trim()) {
      toast.error("اسم الطالب مطلوب");
      return;
    }
    setSubmitting(true);
    try {
      await saveStudentFullSetOrder(ctx.student.id, {
        ...payload,
        student_info: {
          name: name.trim(),
          instagram_username: instagram.trim(),
          phone_primary: phonePrimary.trim(),
          phone_secondary: phoneSecondary.trim(),
          university_name: universityName.trim(),
          department: department.trim(),
          study_type: studyType,
        },
      });
      toast.success("تم حفظ التعديلات");
      router.push(`/staff/orders/${orderId}`);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر حفظ التعديلات"));
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || !user || loading) return <PageLoader />;

  if (loadError || !ctx) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16" dir="rtl">
        <EmptyState title="تعذر تحميل الطلب" message={loadError || "تحقق من الاتصال ثم حاول مجدداً."} />
      </div>
    );
  }

  const isRetail = ctx.edit_mode === "retail";
  const isLimited = ctx.edit_mode === "limited";

  return (
    <div dir="rtl" lang="ar" className="space-y-5 animate-fade-page-in">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="section-heading font-display-ar text-xl font-bold text-ink">تعديل الطلب</h1>
          <p className="mt-0.5 truncate text-sm text-ink-soft">
            {ctx.student.name}
            {ctx.student.rep_name
              ? ` — ممثل: ${ctx.student.rep_name}`
              : isRetail
                ? " — طلب تجزئة"
                : " — طلب مخصص"}
            {ctx.student.university_name ? ` · ${ctx.student.university_name}` : ""}
          </p>
        </div>
        <Link
          href={`/staff/orders/${orderId}`}
          className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-line bg-beige px-4 text-sm font-semibold text-ink-soft hover:border-orange-ink/40"
        >
          رجوع للطلب
        </Link>
      </div>

      <section className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)]">
        <h2 className="mb-3 text-sm font-bold text-ink">معلومات الطالب</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="اسم الطالب"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
          <Input
            label="يوزر الانستا (بدون @)"
            value={instagram}
            onChange={(e) => setInstagram(e.target.value)}
            maxLength={100}
            dir="ltr"
          />
          <Input
            label="رقم الهاتف الأول"
            value={phonePrimary}
            onChange={(e) => setPhonePrimary(e.target.value)}
            maxLength={20}
            dir="ltr"
          />
          <Input
            label="رقم الهاتف الثاني (اختياري)"
            value={phoneSecondary}
            onChange={(e) => setPhoneSecondary(e.target.value)}
            maxLength={20}
            dir="ltr"
          />
          <Input
            label="الجامعة"
            value={universityName}
            onChange={(e) => setUniversityName(e.target.value)}
            maxLength={160}
          />
          <Input
            label="القسم"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            maxLength={160}
          />
          <Select
            label="نوع الدراسة"
            value={studyType}
            onChange={(e) => setStudyType(e.target.value as StudyType | "")}
            options={[
              { value: "", label: "— غير محدد —" },
              { value: "morning", label: "صباحي" },
              { value: "evening", label: "مسائي" },
            ]}
          />
        </div>
      </section>

      {isRetail ? (
        <RetailOrderEditForm
          orderId={orderId}
          context={ctx}
          student={{
            name,
            instagram,
            phonePrimary,
            phoneSecondary,
            universityName,
            department,
            studyType,
          }}
          onSaved={(result) => {
            if (result.productChanged) {
              toast.info(`تم تبديل نوع القطعة إلى ${result.productName}`);
            }
            if (result.designRework) {
              toast.info("أُعيد الطلب إلى بانتظار التصميم بسبب التعديل");
            } else if (result.tailorReopened) {
              toast.info("أُعيد فتح مهمة الفصال بسبب تغيير القياسات");
            }
            router.push(`/staff/orders/${orderId}`);
          }}
        />
      ) : isLimited ? (
        <>
          <section className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-soft)]">
            <h2 className="mb-3 text-sm font-bold text-ink">القطع</h2>
            {ctx.editable_items.length === 0 ? (
              <p className="text-sm text-ink-soft">
                لا توجد بنود نصية قابلة للتعديل — يمكنك تعديل معلومات الطالب فقط.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {ctx.editable_items.map((it) => (
                  <Input
                    key={it.id}
                    label={it.label}
                    value={itemTexts[it.id] ?? ""}
                    onChange={(e) =>
                      setItemTexts((prev) => ({ ...prev, [it.id]: e.target.value }))
                    }
                    maxLength={200}
                  />
                ))}
              </div>
            )}
          </section>

          <Button fullWidth loading={quickSubmitting} onClick={handleQuickSave}>
            حفظ التعديلات
          </Button>
        </>
      ) : (
        <>
          {ctx.existing && (
            <p className="rounded-xl border border-line bg-[var(--shop-sink)] px-3.5 py-2.5 text-xs text-ink-soft">
              الحقول معبّأة بالطلب الحالي — الحفظ يُحدّثه، وتبقى حالة موافقة الممثل كما هي.
            </p>
          )}

          <FullSetOrderForm
            pricing={ctx.pricing}
            initial={ctx.existing}
            submitting={submitting}
            submitLabel="حفظ التعديلات"
            onUploadImage={uploadProductionImage}
            onSubmit={handleSubmit}
          />
        </>
      )}
    </div>
  );
}
