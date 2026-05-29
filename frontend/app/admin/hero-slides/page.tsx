"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { getApiErrorMessage } from "@/lib/api";
import { uploadCatalogImage } from "@/lib/catalog";
import {
  createHeroSlide,
  deleteHeroSlide,
  listHeroSlidesAdmin,
  updateHeroSlide,
  type HeroSlidePayload,
} from "@/lib/admin";
import type { HeroSlide } from "@/lib/types";

const EMPTY = {
  imageUrl: "",
  kicker: "",
  title: "",
  caption: "",
  accent: "#f4a45f",
  ctaLabel: "",
  ctaHref: "",
  sort: 0,
};

export default function AdminHeroSlidesPage() {
  const [rows, setRows] = useState<HeroSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HeroSlide | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HeroSlide | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      setRows(await listHeroSlidesAdmin());
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر تحميل الشرائح"));
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY, sort: rows.length });
    setOpen(true);
  }

  function openEdit(s: HeroSlide) {
    setEditing(s);
    setForm({
      imageUrl: s.imageUrl,
      kicker: s.kicker ?? "",
      title: s.title,
      caption: s.caption ?? "",
      accent: s.accent || "#f4a45f",
      ctaLabel: s.ctaLabel ?? "",
      ctaHref: s.ctaHref ?? "",
      sort: s.sort,
    });
    setOpen(true);
  }

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const url = await uploadCatalogImage(file);
      setForm((f) => ({ ...f, imageUrl: url }));
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر رفع الصورة"));
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!form.imageUrl || !form.title.trim()) {
      toast.error("الصورة والعنوان مطلوبان");
      return;
    }
    const payload: HeroSlidePayload = {
      image_url: form.imageUrl,
      kicker_ar: form.kicker.trim() || null,
      title_ar: form.title.trim(),
      caption_ar: form.caption.trim() || null,
      accent: form.accent || null,
      cta_label_ar: form.ctaLabel.trim() || null,
      cta_href: form.ctaHref.trim() || null,
      sort: Number(form.sort) || 0,
    };
    setSubmitting(true);
    try {
      if (editing) {
        await updateHeroSlide(editing.id, payload);
        toast.success("تم تحديث الشريحة");
      } else {
        await createHeroSlide(payload);
        toast.success("تمت إضافة الشريحة");
      }
      setOpen(false);
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر الحفظ"));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(s: HeroSlide) {
    try {
      await updateHeroSlide(s.id, { active: !s.active });
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر التحديث"));
    }
  }

  function remove(s: HeroSlide) {
    setDeleteTarget(s);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteHeroSlide(target.id);
      toast.success("تم حذف الشريحة");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر الحذف"));
    }
  }

  if (loading) return (
    <div dir="rtl" lang="ar" className="space-y-6 animate-fade-page-in">
      <div className="skeleton h-9 w-40" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton h-24 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );

  if (fetchError) return (
    <div dir="rtl" lang="ar" className="space-y-4">
      <PageHeader
        title="شريط الواجهة"
        subtitle="الصور والشرائح المتحركة في صفحة الطلاب الرئيسية"
      />
      <div className="rounded-2xl border border-danger/25 bg-[var(--shop-sink)] px-6 py-10 text-center">
        <p className="text-base font-semibold text-ink">تعذر تحميل الشرائح</p>
        <p className="mt-1 text-sm text-ink-soft">تحقق من اتصالك ثم أعد المحاولة.</p>
        <Button className="mt-4" onClick={load}>إعادة المحاولة</Button>
      </div>
    </div>
  );

  return (
    <div dir="rtl" lang="ar">
      <PageHeader
        title="شريط الواجهة"
        subtitle="الصور والشرائح المتحركة في صفحة الطلاب الرئيسية"
        action={<Button onClick={openCreate}>إضافة شريحة</Button>}
      />

      {rows.length === 0 ? (
        <EmptyState message="لا توجد شرائح — يظهر للطلاب الشريط الافتراضي حتى تضيف صورك." />
      ) : (
        <div className="space-y-3">
          {rows.map((s) => (
            <article
              key={s.id}
              className={`surface-card flex items-center gap-4 rounded-2xl p-3 ${
                s.active ? "" : "opacity-55"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.imageUrl}
                alt=""
                className="h-20 w-16 shrink-0 rounded-lg object-cover ring-1 ring-ink/10"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display font-bold text-ink">{s.title}</p>
                {s.kicker && <p className="truncate text-xs text-ink-soft">{s.kicker}</p>}
                <p className="mt-1 flex items-center gap-2 text-xs text-[var(--shop-muted)]">
                  <span>ترتيب {s.sort}</span>
                  {s.ctaLabel && <span>· زر: {s.ctaLabel}</span>}
                  {!s.active && <span className="font-semibold text-orange-ink">مخفية</span>}
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-1.5">
                <Button variant="ghost" onClick={() => openEdit(s)}>تعديل</Button>
                <Button variant="ghost" onClick={() => toggleActive(s)}>
                  {s.active ? "إخفاء" : "إظهار"}
                </Button>
                <Button variant="danger" onClick={() => remove(s)}>حذف</Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "تعديل الشريحة" : "إضافة شريحة"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={handleSave} loading={submitting}>حفظ</Button>
          </>
        }
      >
        <div className="space-y-3">
          {/* Image */}
          <div>
            <p className="mb-1.5 text-sm font-semibold text-ink">الصورة</p>
            <div className="flex items-center gap-3">
              {form.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.imageUrl}
                  alt=""
                  className="h-24 w-20 rounded-lg object-cover ring-1 ring-ink/10"
                />
              ) : (
                <div className="grid h-24 w-20 place-items-center rounded-lg bg-beige text-xs text-[var(--shop-muted)] ring-1 ring-ink/10">
                  لا صورة
                </div>
              )}
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                  }}
                />
                <Button
                  variant="ghost"
                  loading={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {form.imageUrl ? "تغيير الصورة" : "رفع صورة"}
                </Button>
                <p className="mt-1 text-xs text-[var(--shop-muted)]">يفضّل صورة عمودية عالية الجودة.</p>
              </div>
            </div>
          </div>

          <Input
            label="سطر علوي صغير (اختياري)"
            value={form.kicker}
            onChange={(e) => setForm({ ...form, kicker: e.target.value })}
          />
          <Input
            label="العنوان"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <Input
            label="الوصف (اختياري)"
            value={form.caption}
            onChange={(e) => setForm({ ...form, caption: e.target.value })}
          />

          <div className="flex items-center gap-3">
            <label className="text-sm font-semibold text-ink">لون التمييز</label>
            <input
              type="color"
              value={form.accent}
              onChange={(e) => setForm({ ...form, accent: e.target.value })}
              className="h-9 w-12 rounded border border-ink/15 bg-transparent"
            />
            <span className="text-xs text-[var(--shop-muted)]" dir="ltr">{form.accent}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="نص الزر (اختياري)"
              value={form.ctaLabel}
              onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })}
            />
            <Input
              label="رابط الزر"
              dir="ltr"
              placeholder="/design أو ‎#shop"
              value={form.ctaHref}
              onChange={(e) => setForm({ ...form, ctaHref: e.target.value })}
            />
          </div>

          <Input
            label="الترتيب"
            type="number"
            dir="ltr"
            value={String(form.sort)}
            onChange={(e) => setForm({ ...form, sort: Number(e.target.value) })}
          />
        </div>
      </Modal>

      {/* ── Confirm: delete hero slide ── */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="تأكيد حذف الشريحة"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button variant="danger" onClick={confirmDelete}>
              حذف «{deleteTarget?.title}»
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">
          ستُحذف الشريحة «{deleteTarget?.title}» نهائياً من شريط الواجهة. لا يمكن التراجع.
        </p>
      </Modal>
    </div>
  );
}
