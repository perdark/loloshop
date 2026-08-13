"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { toast } from "sonner";
import {
  absUrl,
  getCalRetailQueue,
  isRealName,
  MIN_BATCH,
  type CalRetailOrder,
  type CalRetailZone,
  type CalVariant,
  type CreateJobBody,
} from "@/lib/calligraphy";
import { getApiErrorMessage } from "@/lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// «تجزئة» — review BEFORE generation.
//
// Owner rule (2026-07-21): a ممثل's students are generated in bulk and reviewed after,
// because the rep form produces clean names. A retail student's text is free-form
// instruction the student typed themselves — «تطريز من اليمين الدكتورة بان مع حرف ح» —
// so a designer has to read it, look at the attached photo, and decide what actually
// gets embroidered («الدكتورة بان ح») BEFORE a paid generation runs.
//
// Two hard rules baked into this screen:
//   1. The designer's cleaned text is a RENDER DRAFT. It is sent with the plate and is
//      never written back to order_items.customer_text — the student's own words stay
//      intact as the reference of record (shown above the field, read-only).
//   2. No default variant. The ornament style is a judgement call per zone, so
//      «توليد» stays disabled until the designer picks one.
//
// Drafts + variant picks + which card is open survive navigation (sessionStorage) —
// this screen exists precisely because designers bounce to the order page and back,
// and losing their work on every hop is the bug that started all this.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "loloshop-calligraphy-retail";

interface ZoneDraft {
  text?: string;
  variant?: CalVariant | null;
  checked?: boolean;
}
interface StoredRetailState {
  search?: string;
  openOrderId?: string | null;
  /** keyed by order_item_id */
  drafts?: Record<string, ZoneDraft>;
}

function readStored(): StoredRetailState {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}") as StoredRetailState;
  } catch {
    return {};
  }
}

const VARIANT_OPTIONS: { id: CalVariant; label: string; hint: string }[] = [
  { id: "front", label: "أمامي", hint: "زخرفة كاملة" },
  { id: "back", label: "خلفي", hint: "زخرفة أقل" },
  { id: "cap", label: "قبعة — أعلى", hint: "اسم + عنصر" },
  { id: "cap_side", label: "قبعة — جانب", hint: "اسم + عنصر" },
];

export function RetailReviewBoard({
  canOpenOrders,
  fromPath,
  running,
  onGenerate,
}: {
  canOpenOrders: boolean;
  /** appended as ?from= so the order page's back button returns to the workbench */
  fromPath: string;
  running: boolean;
  onGenerate: (body: CreateJobBody) => Promise<void>;
}) {
  const [stored] = useState<StoredRetailState>(() => readStored());

  const [orders, setOrders] = useState<CalRetailOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState(false);
  const [pendingZones, setPendingZones] = useState(0);

  const [search, setSearch] = useState(stored.search ?? "");
  const [openOrderId, setOpenOrderId] = useState<string | null>(stored.openOrderId ?? null);
  const [drafts, setDrafts] = useState<Record<string, ZoneDraft>>(stored.drafts ?? {});
  const [showDone, setShowDone] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The confirm is portalled to <body>: the tool renders inside a card that establishes a
  // containing block (backdrop-filter), which traps `position: fixed` — the dialog rendered
  // as a floating rectangle mid-page instead of covering the screen. Same reason the plate
  // preview and StudentSheet use portals.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // ── persist (same «getting back perfectly» pattern as the rest of the tool) ──
  useEffect(() => {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ search, openOrderId, drafts } satisfies StoredRetailState),
      );
    } catch {
      /* best-effort */
    }
  }, [search, openOrderId, drafts]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = await getCalRetailQueue();
      setOrders(q.orders);
      setPendingZones(q.pending_zones);
      setError(false);
      setLoadedOnce(true);
    } catch (e) {
      setError(true);
      toast.error(getApiErrorMessage(e, "تعذّر تحميل طلبات التجزئة"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A restored open card may belong to an order that has since left «بانتظار التصميم».
  // Gated on loadedOnce so a valid restored id is never closed against the empty
  // pre-fetch list.
  useEffect(() => {
    if (!loadedOnce) return;
    setOpenOrderId((prev) => (prev && !orders.some((o) => o.order_id === prev) ? null : prev));
  }, [orders, loadedOnce]);

  // Client-side filter — the list is a few hundred rows, so typing stays instant
  // instead of round-tripping per keystroke.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = showDone ? orders : orders.filter((o) => o.zones.some((z) => !z.has_plate));
    if (!q) return rows;
    return rows.filter((o) =>
      [o.student_name, o.university_name, o.department, o.instagram_username]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q)),
    );
  }, [orders, search, showDone]);

  function draftFor(order: CalRetailOrder, itemId: string): Required<ZoneDraft> {
    const zone = order.zones.find((z) => z.order_item_id === itemId);
    const d = drafts[itemId] || {};
    return {
      // Pre-filled with the student's own words so a clean case is one click, and a
      // messy one is an edit rather than retyping from scratch.
      text: d.text ?? zone?.raw_text ?? "",
      variant: d.variant ?? null,
      checked: d.checked ?? false,
    };
  }

  function setDraft(itemId: string, patch: ZoneDraft) {
    setDrafts((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  }

  function selectedZones(order: CalRetailOrder) {
    return order.zones.filter((z) => !z.has_plate && draftFor(order, z.order_item_id).checked);
  }

  // Everything ticked across EVERY student — the selection is deliberately global.
  // One generated sheet holds up to MIN_BATCH names and costs the same whether it carries
  // 1 or 10, so generating a single student's 2-3 zones burns most of a sheet. The designer
  // reviews as many students as they like, ticks as they go, and fires ONE batch.
  const selection = useMemo(() => {
    const picked: { order: CalRetailOrder; zone: CalRetailZone; draft: Required<ZoneDraft> }[] = [];
    for (const o of orders) {
      for (const z of o.zones) {
        if (z.has_plate) continue;
        const d = drafts[z.order_item_id];
        if (!d?.checked) continue;
        picked.push({
          order: o,
          zone: z,
          draft: { text: d.text ?? z.raw_text, variant: d.variant ?? null, checked: true },
        });
      }
    }
    // Sheets are single-variant, so the per-variant counts — not the total — decide waste.
    const byVariant = new Map<string, number>();
    for (const p of picked) {
      if (p.draft.variant) byVariant.set(p.draft.variant, (byVariant.get(p.draft.variant) || 0) + 1);
    }
    return {
      picked,
      byVariant,
      missingVariant: picked.filter((p) => !p.draft.variant),
      junk: picked.filter((p) => !isRealName(p.draft.text)),
      underfilled: [...byVariant.entries()].filter(([, n]) => n < MIN_BATCH),
    };
  }, [orders, drafts]);

  async function runGeneration() {
    const { picked } = selection;
    const body: CreateJobBody = {
      source: "retail",
      model: "standard",
      items: picked.map((p) => ({
        render_text: p.draft.text.trim(),
        student_id: p.order.student_id,
        order_item_id: p.zone.order_item_id,
        variant: p.draft.variant as CalVariant,
      })),
    };
    setConfirmOpen(false);
    await onGenerate(body);
    // Clear the drafts we just spent, then re-read so those zones flip to «تم التوليد».
    setDrafts((prev) => {
      const next = { ...prev };
      for (const p of picked) delete next[p.zone.order_item_id];
      return next;
    });
    await load();
  }

  function handleGenerateClick() {
    const { picked, missingVariant, junk, underfilled } = selection;
    if (!picked.length) {
      toast.error("اختر منطقة واحدة على الأقل");
      return;
    }
    if (missingVariant.length) {
      toast.error(
        `اختر نوع الزخرفة لـ ${missingVariant.length} منطقة (${missingVariant[0].order.student_name}…)`,
      );
      return;
    }
    if (junk.length) {
      toast.error(
        `النص غير صالح للتوليد في ${junk.length} منطقة (${junk[0].order.student_name}…)`,
      );
      return;
    }
    // Under-filled sheets are allowed — sometimes the queue is genuinely small — but never
    // silently: the designer confirms they're spending a whole sheet on a few names.
    if (underfilled.length) {
      setConfirmOpen(true);
      return;
    }
    void runGeneration();
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="mb-4">
      {/* No explainer banner — the screen teaches itself: each zone shows the student's
          words above the field the designer types into, and the batch bar carries the
          sheet-economics warning at the moment it actually matters. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          dir="rtl"
          placeholder="ابحث باسم الطالب أو الجامعة أو انستغرام…"
          className="min-h-11 flex-1 rounded-xl border border-line bg-beige px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15"
        />
        <button
          type="button"
          onClick={() => setShowDone((v) => !v)}
          className={`min-h-11 rounded-full px-4 text-xs font-semibold transition-colors ${
            showDone
              ? "bg-orange-ink text-white"
              : "border border-line bg-beige text-ink-soft hover:text-orange-ink"
          }`}
        >
          {showDone ? "عرض الكل" : "إخفاء المكتملة"}
        </button>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="min-h-11 rounded-full border border-line bg-beige px-4 text-xs font-semibold text-ink-soft hover:text-orange-ink disabled:opacity-60"
        >
          تحديث
        </button>
      </div>

      {loading && !loadedOnce ? (
        <p className="py-8 text-center text-sm text-ink-soft">…جارٍ التحميل</p>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center">
          <p className="text-sm text-red-700">تعذّر تحميل القائمة</p>
          <button
            type="button"
            onClick={load}
            className="mt-2 min-h-11 rounded-full bg-orange-ink px-5 text-sm font-semibold text-white"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : !visible.length ? (
        <p className="rounded-xl border border-line bg-beige py-8 text-center text-sm text-ink-soft">
          {search.trim()
            ? "لا توجد نتائج مطابقة"
            : "لا توجد طلبات تجزئة بانتظار المراجعة"}
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-ink-soft">
            {visible.length} طالب · {pendingZones} منطقة بانتظار التوليد
          </p>
          <div className="space-y-2">
            {visible.map((o) => {
              const open = openOrderId === o.order_id;
              const pending = o.zones.filter((z) => !z.has_plate).length;
              const picked = selectedZones(o).length;
              return (
                <div key={o.order_id} className="overflow-hidden rounded-xl border border-line bg-surface">
                  <button
                    type="button"
                    onClick={() => setOpenOrderId(open ? null : o.order_id)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-beige"
                  >
                    <span className="text-xs text-ink-soft">{open ? "▾" : "▸"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-ink">{o.student_name}</span>
                      <span className="block truncate text-xs text-ink-soft">
                        {o.product_name}
                        {o.university_name ? ` · ${o.university_name}` : ""}
                      </span>
                    </span>
                    {picked > 0 && (
                      <span className="shrink-0 rounded-full bg-orange-ink px-2.5 py-1 text-xs font-bold text-white">
                        ✓ {picked}
                      </span>
                    )}
                    <span
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
                        pending ? "bg-orange-ink/10 text-orange-ink" : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {pending ? `${pending} منطقة` : "مكتمل ✓"}
                    </span>
                  </button>

                  {open && (
                    <div className="border-t border-line px-4 py-3">
                      {/* student context — the designer contacts them to confirm artwork */}
                      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
                        {o.department && <span>{o.department}</span>}
                        {o.instagram_username && (
                          <a
                            href={`https://instagram.com/${o.instagram_username.replace(/^@/, "")}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-orange-ink hover:underline"
                          >
                            @{o.instagram_username.replace(/^@/, "")}
                          </a>
                        )}
                        {canOpenOrders && (
                          <Link
                            href={`/staff/orders/${o.order_id}?from=${encodeURIComponent(fromPath)}`}
                            className="font-semibold text-orange-ink hover:underline"
                          >
                            فتح الطلب ←
                          </Link>
                        )}
                      </div>

                      {o.notes && (
                        <p className="mb-3 rounded-xl border border-line bg-beige px-3 py-2 text-xs text-ink">
                          <span className="font-semibold text-ink-soft">ملاحظة الطلب: </span>
                          {o.notes}
                        </p>
                      )}

                      <div className="space-y-3">
                        {o.zones.map((z) => {
                          const d = draftFor(o, z.order_item_id);
                          if (z.has_plate) {
                            return (
                              <div
                                key={z.order_item_id}
                                className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2"
                              >
                                <p className="text-xs font-semibold text-emerald-800">
                                  {z.zone_label} — تم التوليد ✓
                                </p>
                                <p className="mt-1 text-xs text-emerald-900/70">{z.raw_text}</p>
                              </div>
                            );
                          }
                          return (
                            <div
                              key={z.order_item_id}
                              className={`rounded-xl border px-3 py-3 transition-colors ${
                                d.checked ? "border-orange-ink/50 bg-orange-ink/[0.03]" : "border-line bg-beige"
                              }`}
                            >
                              <label className="flex cursor-pointer items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={d.checked}
                                  onChange={(e) => setDraft(z.order_item_id, { checked: e.target.checked })}
                                  className="h-4 w-4 accent-[color:var(--color-orange-ink,#F47B42)]"
                                />
                                <span className="text-sm font-bold text-ink">{z.zone_label}</span>
                              </label>

                              {/* the student's own words — reference of record, never edited here */}
                              <div className="mt-2 rounded-lg border border-line bg-surface px-3 py-2">
                                <p className="mb-1 text-[11px] font-semibold text-ink-soft">
                                  نص الطالب كما كتبه (لا يتغيّر)
                                </p>
                                <p className="whitespace-pre-wrap text-xs text-ink">{z.raw_text}</p>
                                {z.text_is_instruction && (
                                  <p className="mt-1.5 text-[11px] font-semibold leading-5 text-amber-700">
                                    ⚠ هذا كلام موجّه للمحل وليس اسماً — اكتب الاسم المطلوب في
                                    الحقل أدناه، ولا تولّد النص كما هو
                                  </p>
                                )}
                              </div>

                              {/* The student's OWN photo. Until migration 080 a generated plate
                                  overwrote this column, so a zone that had a reference showed the
                                  machine's output instead — and «تطريز هذه الصورة فقط» pointed at
                                  something nobody could open any more. */}
                              {z.customer_image_url && (
                                <a
                                  href={absUrl(z.customer_image_url)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-2 inline-block"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={absUrl(z.customer_image_url)}
                                    alt="صورة الطالب المرفقة"
                                    className="h-24 w-auto rounded-lg border border-line object-cover"
                                  />
                                </a>
                              )}

                              {z.plate_image_url && (
                                <div className="mt-2">
                                  <p className="mb-1 text-[11px] font-semibold text-ink-soft">
                                    الخط المولّد حالياً
                                  </p>
                                  <a href={absUrl(z.plate_image_url)} target="_blank" rel="noreferrer">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={absUrl(z.plate_image_url)}
                                      alt="الخط المولّد"
                                      className="h-24 w-auto rounded-lg border border-line bg-white object-contain"
                                    />
                                  </a>
                                </div>
                              )}

                              <label className="mt-3 block">
                                <span className="mb-1 block text-[11px] font-semibold text-ink-soft">
                                  النص المطلوب توليده
                                </span>
                                <textarea
                                  value={d.text}
                                  onChange={(e) => setDraft(z.order_item_id, { text: e.target.value })}
                                  disabled={running}
                                  rows={2}
                                  dir="rtl"
                                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15 disabled:opacity-60"
                                />
                              </label>
                              {d.text.trim() && !isRealName(d.text) && (
                                <p className="mt-1 text-xs font-semibold text-red-600">
                                  يجب أن يحتوي النص على حروف عربية
                                </p>
                              )}

                              <div className="mt-2">
                                <p className="mb-1 text-[11px] font-semibold text-ink-soft">
                                  نوع الزخرفة {!d.variant && <span className="text-red-600">— مطلوب</span>}
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {VARIANT_OPTIONS.map((v) => (
                                    <button
                                      key={v.id}
                                      type="button"
                                      disabled={running}
                                      onClick={() => setDraft(z.order_item_id, { variant: v.id, checked: true })}
                                      className={`min-h-11 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                                        d.variant === v.id
                                          ? "bg-orange-ink text-white"
                                          : "border border-line bg-surface text-ink hover:border-orange/40 hover:text-orange-ink"
                                      } disabled:opacity-60`}
                                    >
                                      {v.label}
                                      <span className="ms-1 opacity-70">({v.hint})</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* No per-student «توليد» here on purpose — a sheet holds up to
                          MIN_BATCH names and costs the same for 1 or 10, so generation is
                          one batch across all reviewed students (sticky bar below). */}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── batch bar — the only way to generate from this board ─────────────── */}
      {selection.picked.length > 0 && (
        <div className="sticky bottom-0 z-10 -mx-1 mt-3 rounded-2xl border border-orange-ink/30 bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink">
                {selection.picked.length} منطقة محدّدة
              </p>
              <p className="mt-0.5 text-xs text-ink-soft">
                {[...selection.byVariant.entries()]
                  .map(
                    ([v, n]) =>
                      `${VARIANT_OPTIONS.find((o) => o.id === v)?.label ?? v}: ${n}`,
                  )
                  .join(" · ") || "لم تُختر أنواع الزخرفة بعد"}
              </p>
            </div>
            <button
              type="button"
              disabled={running}
              onClick={handleGenerateClick}
              className="min-h-11 rounded-full bg-orange-ink px-6 text-sm font-bold text-white transition-opacity disabled:opacity-40"
            >
              {running ? "…جارٍ التوليد" : `توليد المحدّد (${selection.picked.length})`}
            </button>
          </div>
          {selection.underfilled.length > 0 && (
            <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              الورقة الواحدة تتسع لـ {MIN_BATCH} أسماء وتكلفتها واحدة سواء حملت اسماً أو
              عشرة، وكل نوع زخرفة يُطبع على ورقة منفصلة. أقل من {MIN_BATCH}:{" "}
              <span className="font-semibold">
                {selection.underfilled
                  .map(
                    ([v, n]) =>
                      `${VARIANT_OPTIONS.find((o) => o.id === v)?.label ?? v} (${n})`,
                  )
                  .join("، ")}
              </span>{" "}
              — راجِع طلاباً أكثر قبل التوليد لتوفير الأوراق.
            </p>
          )}
        </div>
      )}

      {/* under-filled confirm — allowed, but never silent */}
      {confirmOpen && mounted && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-xl">
            <p className="text-base font-bold text-ink">توليد بأوراق غير ممتلئة؟</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              الورقة الواحدة تتسع لـ {MIN_BATCH} أسماء وتكلفتها واحدة مهما كان العدد. هذه
              الأنواع أقل من {MIN_BATCH}:
            </p>
            <ul className="mt-2 space-y-1 text-sm text-ink">
              {selection.underfilled.map(([v, n]) => (
                <li key={v}>
                  • {VARIANT_OPTIONS.find((o) => o.id === v)?.label ?? v} —{" "}
                  <span className="font-semibold">{n}</span> من {MIN_BATCH}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="min-h-11 rounded-full border border-line bg-beige px-5 text-sm font-semibold text-ink"
              >
                أراجع طلاباً أكثر
              </button>
              <button
                type="button"
                onClick={() => void runGeneration()}
                className="min-h-11 rounded-full bg-orange-ink px-5 text-sm font-bold text-white"
              >
                توليد الآن
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
