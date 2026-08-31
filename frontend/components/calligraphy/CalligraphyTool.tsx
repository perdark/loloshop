"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { RetailReviewBoard } from "@/components/calligraphy/RetailReviewBoard";
import { getApiErrorMessage } from "@/lib/api";
import { isAuthenticated, getUser } from "@/lib/auth";
import { safeFileName, saveFile, saveFromUrl } from "@/lib/download";
import { matchesAr } from "@/lib/arabic";
import {
  absUrl,
  CAL_REROLL_LIMIT,
  calJobZipBlob,
  createCalJob,
  generateFromQueue,
  getCalJob,
  getCalNames,
  getCalQueue,
  getCalStyles,
  getCalWholesalers,
  getOrdersZones,
  getRecentPlates,
  isRealName,
  MIN_BATCH,
  platesZipBlob,
  processCalJob,
  rerollPlate,
  sendCalOrder,
  suggestCalText,
  VARIANT_LABEL,
  type CalJob,
  type CalOrderZones,
  type CalQueue,
  type CalQueueHeldItem,
  type CalQueueZone,
  type CalGrabRow,
  type CalStyle,
  type CalSuggestion,
  type CalPlate,
  type CalVariant,
  type CalWholesaler,
  type CreateJobBody,
} from "@/lib/calligraphy";
import { PlateCompositor } from "@/components/calligraphy/PlateCompositor";

// ─── Types ──────────────────────────────────────────────────────────────────

type InputMode = "queue" | "retail" | "typed" | "wholesaler";
type ModelMode = "standard" | "premium";
// «مُرسلة» (archive — nothing left to do) and «بدون طلب» (orphan plates from the old
// copy-paste flow) were dropped 2026-07-21: neither led to an action. «بانتظار الإرسال»
// stays — it IS the designer's to-do list (plates generated, order not yet pushed to التطريز).
type GridFilter = "all" | "awaiting";

// ─── Status pill colours ─────────────────────────────────────────────────────

function StatusPill({ status }: { status: CalPlate["status"] | string }) {
  const map: Record<string, string> = {
    done: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-700",
    pending: "bg-amber-100 text-amber-800",
  };
  const label: Record<string, string> = {
    done: "تم",
    failed: "فشل",
    pending: "قيد الانتظار",
  };
  const cls = map[status] ?? "bg-gray-100 text-gray-700";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      {label[status] ?? status}
    </span>
  );
}

/**
 * What the saved file is called. `plate_path` is a 32-char content hash, so a designer
 * who downloaded ten plates got ten files they had to open one by one to tell apart.
 * The zone rides along because a student usually has more than one.
 */
function plateFileName(plate: Pick<CalPlate, "student_name" | "render_text" | "variant">): string {
  const who = plate.student_name || plate.render_text || "لوحة";
  const zone = VARIANT_LABEL[plate.variant] ?? plate.variant;
  return safeFileName(`${who} ${zone}`, "png", "لوحة");
}

// ─── Plate card ──────────────────────────────────────────────────────────────

function PlateCard({
  plate,
  onReroll,
  onPreview,
  onEdit,
  rerolling,
}: {
  plate: CalPlate;
  onReroll: (id: string, overrides?: { render_text?: string }) => Promise<void>;
  onPreview: (plate: CalPlate) => void;
  onEdit: (plate: CalPlate) => void;
  rerolling: boolean;
}) {
  const imgUrl = absUrl(plate.plate_path);
  // A plate whose text is an instruction cannot be fixed by rerolling — the model would just
  // render the same sentence again. The only useful action is retyping the real name, so the
  // card asks for it instead of offering a button that spends money to change nothing.
  const needsText = plate.text_is_instruction === true;
  const [fixText, setFixText] = useState("");
  const [saving, setSaving] = useState(false);
  const rerollsUsed = plate.reroll_count ?? 0;
  const atRerollLimit = rerollsUsed >= CAL_REROLL_LIMIT;

  return (
    <article className="flex min-w-0 flex-col gap-2 overflow-hidden rounded-2xl border border-line bg-white p-3 shadow-sm">
      {/* image — click to preview full size */}
      {plate.status === "done" && imgUrl ? (
        <button
          type="button"
          onClick={() => onPreview(plate)}
          className="group relative overflow-hidden rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-orange-ink/40"
          aria-label={`معاينة ${plate.render_text}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgUrl}
            alt={plate.render_text}
            className="w-full object-contain transition-transform duration-200 group-hover:scale-[1.03]"
            loading="lazy"
          />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink/0 text-xs font-semibold text-white opacity-0 transition-all duration-200 group-hover:bg-ink/30 group-hover:opacity-100">
            معاينة
          </span>
        </button>
      ) : plate.status === "failed" ? (
        <div className="flex min-h-[80px] items-center justify-center rounded-xl bg-red-50 p-3">
          <p className="text-center text-xs text-red-600">
            {plate.error ?? "فشل التوليد"}
          </p>
        </div>
      ) : plate.status === "done" ? (
        // done but no usable image — never show a spinner here, it can never resolve
        <div className="flex min-h-[80px] items-center justify-center rounded-xl bg-gray-50 p-3">
          <p className="text-center text-xs text-ink-soft">
            لا توجد صورة — أعد التوليد
          </p>
        </div>
      ) : (
        <div className="flex min-h-[80px] items-center justify-center rounded-xl bg-amber-50">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
        </div>
      )}

      {/* name + status */}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 break-words font-display text-sm font-semibold leading-snug text-ink">
          {plate.render_text}
        </p>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          <span className="rounded-full bg-beige px-2 py-0.5 text-[11px] text-ink-soft border border-line">
            {VARIANT_LABEL[plate.variant] ?? plate.variant}
          </span>
          {/* Why two plates of the same zone can look different. */}
          {plate.style && (
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] text-sky-800">
              {plate.style === "extend"
                ? "مد الحروف"
                : plate.style === "bold"
                  ? "خط أعرض"
                  : plate.style === "plain"
                    ? "بدون زخرفة"
                    : plate.style}
            </span>
          )}
          {plate.element_text && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 border border-amber-200">
              + {plate.element_text}
            </span>
          )}
          <StatusPill status={plate.status} />
        </div>
      </div>

      {/* The student wrote us a message, not a name. Say so before any money is spent. */}
      {needsText && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-2.5">
          <p className="text-[11px] font-semibold leading-5 text-amber-800">
            هذا النص تعليمات للمحل وليس اسماً — اكتب الاسم الصحيح قبل إعادة التوليد
          </p>
          <input
            value={fixText}
            onChange={(e) => setFixText(e.target.value)}
            placeholder="الاسم الصحيح"
            dir="rtl"
            className="mt-2 w-full min-h-11 rounded-full border border-amber-300 bg-white px-3 text-sm text-ink outline-none focus:border-orange-ink"
          />
        </div>
      )}

      {/* actions */}
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          disabled={rerolling || atRerollLimit || (needsText && fixText.trim() === "")}
          loading={rerolling}
          onClick={() =>
            onReroll(plate.id, fixText.trim() ? { render_text: fixText.trim() } : undefined)
          }
        >
          {atRerollLimit ? `بلغ الحد (${CAL_REROLL_LIMIT})` : "إعادة التوليد"}
        </Button>
        {rerollsUsed > 0 && !atRerollLimit && (
          <span className="self-center rounded-full bg-beige px-2 py-0.5 text-[11px] text-ink-soft border border-line">
            أُعيد {rerollsUsed}/{CAL_REROLL_LIMIT}
          </span>
        )}

        {plate.status === "done" && imgUrl && (
          <>
            <Button
              size="sm"
              variant="ghost"
              loading={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  const out = await saveFromUrl(imgUrl, plateFileName(plate));
                  if (out !== "cancelled") toast.success("تم تنزيل الصورة");
                } catch {
                  toast.error("تعذّر تنزيل الصورة");
                } finally {
                  setSaving(false);
                }
              }}
            >
              تنزيل
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onEdit(plate)}
            >
              تحرير / صورة
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

// ─── Order group (plates grouped by student/order) ───────────────────────────
// «ربط بالطلب» is gone: plates auto-attach on generation. The group header carries
// the student (clickable → the order), zone ✓/✗ chips and the one send button.

interface PlateGroup {
  key: string;
  orderId: string | null;
  studentName: string | null;
  productName: string | null;
  wholesalerId: string | null;
  wholesalerName: string | null;
  plates: CalPlate[];
}

const ORDER_STATUS_AR: Record<string, string> = {
  design_complete: "بانتظار التصميم",
  converting: "قيد التحويل",
  embroidery: "قيد التطريز",
  pressing: "قيد الكوي",
  preparing: "قيد التجهيز",
  ready: "جاهز للاستلام",
  delivered: "تم التسليم",
  cancelled: "ملغي",
};

// ─── Name-count hint (valid / junk / under-minimum) ──────────────────────────

function NameCountHint({ lines }: { lines: string[] }) {
  const valid = lines.filter(isRealName).length;
  const junk = lines.length - valid;
  return (
    <p className="mt-1 text-xs text-ink-soft">
      <span className="font-semibold text-ink">{valid}</span> اسم صالح
      {junk > 0 && (
        <span className="text-red-600"> · {junk} غير صالح (سيُستبعد)</span>
      )}
      {valid > 0 && valid < MIN_BATCH && (
        <span className="text-amber-600"> · أقل من {MIN_BATCH} — التكلفة لكل ورقة ثابتة</span>
      )}
    </p>
  );
}

// ─── Queue zone card ─────────────────────────────────────────────────────────

/**
 * One held line, with the only two things a designer can honestly do about it: retype the real
 * name, or say «this text IS the embroidery, generate it». The text box starts filled with the
 * student's words so accepting-as-is costs one tap, and correcting costs an edit — either way
 * the `order_item_id` rides along, so the plate still lands on the right order line instead of
 * becoming another orphan from «لصق أسماء».
 */
function HeldRow({
  item,
  onGenerate,
}: {
  item: CalQueueHeldItem;
  onGenerate: (item: CalQueueHeldItem, text: string) => Promise<void>;
}) {
  const [text, setText] = useState(item.render_text);
  const [busy, setBusy] = useState(false);
  const edited = text.trim() !== item.render_text.trim();

  return (
    <li className="rounded-lg border border-amber-200 bg-amber-50/60 p-2">
      <p className="break-words text-ink-soft">
        <span className="font-semibold text-ink">{item.student_name}</span>
        <span className="text-amber-700"> · {item.hint}</span>
      </p>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        dir="rtl"
        aria-label={`النص المطلوب توليده لـ ${item.student_name}`}
        className="mt-1.5 w-full min-h-11 rounded-lg border border-amber-300 bg-white px-2.5 text-xs text-ink outline-none focus:border-orange-ink"
      />
      <Button
        size="sm"
        variant="ghost"
        className="mt-1.5"
        disabled={busy || text.trim() === ""}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onGenerate(item, text.trim());
          } finally {
            setBusy(false);
          }
        }}
      >
        {edited ? "ولّد بالاسم المصحح" : "ولّد كما هو"}
      </Button>
    </li>
  );
}

function QueueZoneCard({
  variant,
  zone,
  running,
  onGenerate,
  onGenerateHeld,
}: {
  variant: CalVariant;
  zone: CalQueueZone;
  running: boolean;
  onGenerate: (variant: CalVariant, mode: "full" | "all") => void;
  onGenerateHeld: (item: CalQueueHeldItem, text: string) => Promise<void>;
}) {
  const [confirmAll, setConfirmAll] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const full = Math.floor(zone.pending / 10);
  const leftover = zone.pending % 10;
  // Two populations this card used to hide completely, which is why «بانتظار» could read 0
  // while a designer's «يخصّني الآن» was full of the same reps' orders.
  const heldCount = zone.held?.count ?? 0;
  const platedCount = zone.plated?.count ?? 0;

  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display font-bold text-ink text-base">
            {VARIANT_LABEL[variant]}
          </h3>
          <p className="text-sm text-ink-soft mt-0.5">
            <span className="font-semibold text-ink">{zone.pending}</span> بانتظار
          </p>
        </div>
        <span className="rounded-full bg-beige border border-line px-2.5 py-1 text-xs font-semibold text-ink-soft shrink-0">
          {variant}
        </span>
      </div>

      {/* sheet breakdown */}
      <div className="rounded-xl bg-beige border border-line px-3 py-2.5 text-xs text-ink-soft space-y-0.5">
        <p>
          <span className="font-semibold text-ink">{full}</span> ورقة كاملة جاهزة (×10)
        </p>
        {leftover > 0 && (
          <p className="text-amber-700">
            + <span className="font-semibold">{leftover}</span> بانتظار اكتمال الورقة
          </p>
        )}
        <p className="text-ink/50 pt-0.5">التكلفة الأقل: ١٠ أسماء بالورقة</p>
      </div>

      {/* Everything in this zone that is NOT waiting to be generated. Without it «بانتظار 0»
          reads as «لا يوجد عمل», which is exactly how 55 orders ended up visible only in a
          designer's «يخصّني الآن» and nowhere in this tool. */}
      {(heldCount > 0 || platedCount > 0) && (
        <div className="rounded-xl border border-line bg-surface-sink px-3 py-2.5 text-xs">
          <button
            type="button"
            onClick={() => setShowOther((v) => !v)}
            className="flex w-full min-h-11 items-center justify-between gap-2 text-start font-semibold text-ink"
          >
            <span>
              {heldCount > 0 && <>{heldCount} نص موقوف</>}
              {heldCount > 0 && platedCount > 0 && " · "}
              {platedCount > 0 && <>{platedCount} مُولَّد سابقاً</>}
            </span>
            <span className="text-ink-soft">{showOther ? "▾" : "◂"}</span>
          </button>

          {showOther && (
            <div className="mt-2 space-y-2">
              {heldCount > 0 && (
                <div>
                  <p className="font-semibold text-amber-700">
                    موقوف — لن يُصرف عليه حتى تراجعه:
                  </p>
                  <ul className="mt-1 space-y-2">
                    {zone.held.items.slice(0, 15).map((it) => (
                      <HeldRow key={it.order_item_id} item={it} onGenerate={onGenerateHeld} />
                    ))}
                  </ul>
                  {heldCount > 15 && <p className="mt-1 text-ink/50">…و{heldCount - 15} غيرها</p>}
                </div>
              )}
              {platedCount > 0 && (
                <div>
                  <p className="font-semibold text-ink-soft">
                    لديها صورة جاهزة — تظهر في «يخصّني الآن» ولا تظهر في الانتظار:
                  </p>
                  <ul className="mt-1 space-y-1">
                    {zone.plated.items.slice(0, 15).map((it) => (
                      <li key={it.order_item_id} className="break-words text-ink-soft">
                        <span className="text-ink">{it.student_name}</span> — «{it.render_text}»
                      </li>
                    ))}
                  </ul>
                  {platedCount > 15 && <p className="mt-1 text-ink/50">…و{platedCount - 15} غيرها</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* action buttons */}
      <div className="flex flex-col gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={full < 1 || running}
          loading={running && full >= 1}
          onClick={() => onGenerate(variant, "full")}
          fullWidth
        >
          ولّد الأوراق الكاملة ({full}×10)
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={zone.pending < 1 || running}
          onClick={() => {
            if (leftover > 0) {
              setConfirmAll(true);
            } else {
              onGenerate(variant, "all");
            }
          }}
          fullWidth
        >
          ولّد الكل ({zone.pending})
        </Button>
      </div>

      {/* confirm "all" when leftover > 0 */}
      <Modal
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title="تأكيد توليد الكل"
        footer={
          <>
            <Button variant="ghost" fullWidth onClick={() => setConfirmAll(false)}>
              إلغاء
            </Button>
            <Button
              variant="primary"
              fullWidth
              onClick={() => {
                setConfirmAll(false);
                onGenerate(variant, "all");
              }}
            >
              متابعة
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          المتبقّي <span className="font-bold">{leftover}</span> سيُولَّد كورقة كاملة بتكلفة أعلى (~$0.10).
          هل تريد المتابعة؟
        </div>
      </Modal>
    </div>
  );
}

// ─── Session persistence — «getting back perfectly» (mirrors StationConsole) ────
// The worker sets the plates filter chip / ممثل selects / name search / sticky-bar
// collapse, then taps a student's name (→ /staff/orders/[id]?from=<path>); on back
// this component remounts and must land exactly where they left off. Only display/
// filter state is mirrored — fetched data (jobs/plates/queue), in-flight generation,
// modals, and the download-folder handle are deliberately excluded. Safe to lazy-init:
// all three mounts (admin layout, /staff/calligraphy, /design-support/calligraphy) gate
// behind a client-side auth loading check, so this component never renders during
// SSR/prerender.
//
// The «لصق أسماء» draft IS mirrored (mode + variant + textarea). Designers build that
// list one name at a time — review a retail order on مراجعة التصاميم, copy the name,
// come back, paste, repeat — and dropping the draft on every remount silently threw
// away everything they had accumulated (the tab reset to «تلقائي» too).
interface StoredCalligraphyState {
  gridFilter?: GridFilter;
  gridWid?: string;
  queueWid?: string;
  searchText?: string;
  controlsOpen?: boolean;
  mode?: InputMode;
  typedVariant?: CalVariant;
  typedText?: string;
  /** Window scroll offset. The plates grid is a long, page-scrolled list with no
   *  overlay to restore (unlike StationConsole's student sheet), so landing back
   *  at the top is the most disorienting part of returning from an order page —
   *  both hops are `<Link>` pushes, which Next always scrolls to top. */
  scrollY?: number;
  /** Designer-corrected embroidery text for a ممثل's lines, keyed by order_item_id. */
  grabDrafts?: Record<string, string>;
}
const STORAGE_KEY = "loloshop-calligraphy";

function readStoredCalligraphy(): StoredCalligraphyState {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}") as StoredCalligraphyState;
  } catch {
    return {};
  }
}

function validGridFilter(v: GridFilter | undefined): GridFilter {
  return v === "awaiting" ? v : "all";
}

function validMode(v: InputMode | undefined): InputMode {
  return v === "typed" || v === "wholesaler" || v === "retail" ? v : "queue";
}

function validVariant(v: CalVariant | undefined): CalVariant {
  return v === "back" || v === "cap" || v === "cap_side" ? v : "front";
}

/** Bound the mirrored draft so a pathological paste can never blow the sessionStorage
 *  quota and take the (more important) filter/scroll snapshot down with it. ~40k chars
 *  is far past any real batch — a 500-name list is ~10k. */
const MAX_DRAFT_CHARS = 40000;

/** Same bound, applied to the per-line drafts: a ممثل can carry hundreds of rows and the
 *  snapshot must never grow big enough to cost us the filter/scroll state beside it. */
function boundDrafts(drafts: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  let budget = MAX_DRAFT_CHARS;
  for (const [id, text] of Object.entries(drafts)) {
    if (budget <= 0) break;
    const t = text.slice(0, 200);
    out[id] = t;
    budget -= t.length + id.length;
  }
  return out;
}

// ─── Main tool ─────────────────────────────────────────────────────────────────
// Shared by the admin page (`/admin/calligraphy`) and the designer/staff page
// (`/staff/calligraphy`). Both are thin wrappers around this component. It talks to
// /calligraphy/* via the JWT axios instance in lib/calligraphy.ts, so it works for
// any allowed role (admin + manager/designer staff — see routes/calligraphy.js).

export function CalligraphyTool({ backHref }: { backHref?: string } = {}) {
  // ── portal mount guard (createPortal needs document.body, client-only) ────────
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Current path — appended as ?from= so the order page's back button returns HERE.
  const pathname = usePathname();

  // Role gating (send + order links). The tool is shared by admin, staff
  // designer/manager AND design_helper — helpers generate plates but never push
  // orders (their desk flow goes through محمد هيثم) and can't open /staff routes.
  const me = getUser();
  const myStaffTypes: string[] =
    (me as unknown as { staff_types?: string[] })?.staff_types ??
    ((me as unknown as { staff_type?: string })?.staff_type
      ? [(me as unknown as { staff_type?: string }).staff_type as string]
      : []);
  const canSendOrders =
    me?.role === "admin" ||
    (me?.role === "staff" && myStaffTypes.some((t) => t === "designer" || t === "manager"));
  const canOpenOrders = me?.role === "admin" || me?.role === "staff";

  // Restore the last UI state for this session (see StoredCalligraphyState above).
  const [stored] = useState<StoredCalligraphyState>(() => readStoredCalligraphy());

  // ── mode + model ────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<InputMode>(validMode(stored.mode));
  const model: ModelMode = "standard";

  // ── variant (typed mode) ────────────────────────────────────────────────────
  const [typedVariant, setTypedVariant] = useState<CalVariant>(validVariant(stored.typedVariant));

  // ── typed input ─────────────────────────────────────────────────────────────
  const [typedText, setTypedText] = useState(stored.typedText ?? "");

  // ── wholesaler grab ─────────────────────────────────────────────────────────
  const [wholesalers, setWholesalers] = useState<CalWholesaler[]>([]);
  const [wLoading, setWLoading] = useState(false);
  const [wholesalersLoaded, setWholesalersLoaded] = useState(false);
  const [selectedWid, setSelectedWid] = useState("");
  const [grabRows, setGrabRows] = useState<CalGrabRow[]>([]);
  const [grabLoading, setGrabLoading] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  // زون filter for the wholesaler grab list — امامي / خلف / قبعة (cap+cap_side grouped)
  const [zoneFilter, setZoneFilter] = useState<Set<"front" | "back" | "cap">>(
    new Set(["front", "back", "cap"]),
  );
  // element_text per order_item_id — only used for cap rows in wholesaler mode
  const [capElements, setCapElements] = useState<Record<string, string>>({});
  // ── the designer's corrected embroidery text, per order_item_id ──────────────
  // The owner rule this relaxes (2026-07-21): «ممثل = generate in bulk then review ·
  // تجزئة = review first». It rested on rep students producing clean names — مضر
  // reported 2026-08-21 that they do not: they type instructions into the same field
  // («خلي التطريز محمد مع حرف N») and the generator embroidered the sentence. The
  // designer can now fix the line BEFORE it is paid for, exactly like the retail board.
  //
  // Same two rules as RetailReviewBoard: the draft is a RENDER draft — it rides with
  // the plate and is never written back to the student's own words — and a line the
  // designer retyped counts as read, so it may be generated even if the instruction
  // guard flagged the original.
  const [textDrafts, setTextDrafts] = useState<Record<string, string>>(stored.grabDrafts ?? {});
  // Style id per order_item_id, from the closed list the API serves. Null/absent = the shop
  // default. Plates batch by (zone, style), so picking one does NOT buy a private image.
  const [styleChoice, setStyleChoice] = useState<Record<string, string>>({});
  const [styles, setStyles] = useState<CalStyle[]>([]);
  // ── the AI reading layer ────────────────────────────────────────────────────
  // It PROPOSES; it never generates and never spends image money. A proposal sits beside the
  // student's own words until the designer presses «استخدم» — which is also what marks the
  // line reviewed, so an unread suggestion can never let a held line through the guard.
  const [suggestions, setSuggestions] = useState<Record<string, CalSuggestion>>({});
  const [suggesting, setSuggesting] = useState(false);

  // ── queue ────────────────────────────────────────────────────────────────────
  const [queue, setQueue] = useState<CalQueue | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState(false);
  // ممثل filter for the automatic queue (counts + generation scope). "" = الكل.
  const [queueWid, setQueueWid] = useState(stored.queueWid ?? "");

  // ── job state ───────────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [plates, setPlates] = useState<CalPlate[]>([]);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);

  // ── per-plate action states ─────────────────────────────────────────────────
  const [rerollingId, setRerollingId] = useState<string | null>(null);

  // ── order zones + send («تحويل للتطريز») ─────────────────────────────────────
  const [orderZones, setOrderZones] = useState<Record<string, CalOrderZones>>({});
  const [sendingOrderId, setSendingOrderId] = useState<string | null>(null);
  // Confirm dialog when sending an order whose zones still miss images.
  const [sendConfirm, setSendConfirm] = useState<{ orderId: string; missing: string[] } | null>(null);

  // ── grid filters (sticky bar) ────────────────────────────────────────────────
  const [gridFilter, setGridFilter] = useState<GridFilter>(validGridFilter(stored.gridFilter));
  const [gridWid, setGridWid] = useState(stored.gridWid ?? "");
  const [searchText, setSearchText] = useState(stored.searchText ?? "");
  // Generation controls collapse behind the sticky bar once results exist.
  const [controlsOpen, setControlsOpen] = useState(stored.controlsOpen ?? true);
  const [folderSaving, setFolderSaving] = useState(false);

  // ── confirm gate (junk names / small batch / under-filled zone) ───────────────
  const [confirm, setConfirm] = useState<{
    body: CreateJobBody;
    junk: string[];
    validCount: number;
    underfilled?: { variant: CalVariant; count: number }[];
  } | null>(null);

  // ── full-size plate preview (click a result) ─────────────────────────────────
  const [preview, setPreview] = useState<CalPlate | null>(null);
  const [previewSaving, setPreviewSaving] = useState(false);
  // The student's reference photo, opened full-size from a grab row.
  const [photoPreview, setPhotoPreview] = useState<{ url: string; name: string } | null>(null);
  const [zipSaving, setZipSaving] = useState<"plates" | "sheets" | null>(null);

  // ── plate compositor (overlay editor) ────────────────────────────────────────
  const [compositorPlate, setCompositorPlate] = useState<CalPlate | null>(null);
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPreview(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [preview]);

  // ── in-flight elapsed timer (so the spinner is never a blank "is it stuck?") ──
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);

  // ── load wholesalers once ────────────────────────────────────────────────────
  useEffect(() => {
    setWLoading(true);
    getCalWholesalers()
      .then((rows) => {
        setWholesalers(rows);
        // Only a SUCCESSFUL fetch may unlock the prune effect below. Marking this
        // in .finally() meant a 403/network blip left `wholesalers` empty while
        // claiming it had loaded — so the prune saw an empty id set and silently
        // reset the restored ممثل filters to «الكل».
        setWholesalersLoaded(true);
      })
      .catch(() => toast.error("تعذر تحميل الممثلين"))
      .finally(() => setWLoading(false));
  }, []);

  // A restored ممثل filter (plates grid or auto-generation queue) may reference a
  // wholesaler that no longer exists — degrade gracefully to "كل الممثلين" once the
  // real list has loaded. Gated on wholesalersLoaded so a VALID restored id is never
  // wiped against the empty pre-fetch array.
  useEffect(() => {
    if (!wholesalersLoaded) return;
    const validIds = new Set(wholesalers.map((w) => w.id));
    setGridWid((prev) => (prev && !validIds.has(prev) ? "" : prev));
    setQueueWid((prev) => (prev && !validIds.has(prev) ? "" : prev));
  }, [wholesalers, wholesalersLoaded]);

  // Mirror the UI state so back-navigation restores it exactly (sessionStorage key
  // above). Fetched data/progress/modals/drafts are deliberately excluded — see the
  // StoredCalligraphyState comment.
  // Held in a ref so the scroll listener can persist the FULL snapshot without
  // re-subscribing every time a filter or search keystroke changes.
  const snapshotRef = useRef<StoredCalligraphyState>(stored);
  const persistSnapshot = useCallback(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshotRef.current));
    } catch {
      /* storage full/unavailable — persistence is best-effort */
    }
  }, []);

  useEffect(() => {
    snapshotRef.current = {
      ...snapshotRef.current, // keep the live scrollY written by the listener below
      gridFilter,
      gridWid,
      queueWid,
      searchText,
      controlsOpen,
      mode,
      typedVariant,
      typedText: typedText.slice(0, MAX_DRAFT_CHARS),
      grabDrafts: boundDrafts(textDrafts),
    };
    persistSnapshot();
  }, [
    gridFilter,
    gridWid,
    queueWid,
    searchText,
    controlsOpen,
    mode,
    typedVariant,
    typedText,
    textDrafts,
    persistSnapshot,
  ]);

  // Mirror the scroll offset too. rAF-throttled + passive so a long plates grid
  // never turns scrolling into a sessionStorage write per frame.
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        snapshotRef.current.scrollY = window.scrollY;
        persistSnapshot();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [persistSnapshot]);

  // ── fetch names when wholesaler selected ─────────────────────────────────────
  const loadGrab = useCallback(async (wid: string) => {
    if (!wid) return;
    setGrabLoading(true);
    setGrabRows([]);
    setCheckedIds(new Set());
    setZoneFilter(new Set(["front", "back", "cap"]));
    try {
      const rows = await getCalNames(wid);
      setGrabRows(rows);
      // pre-select rows without a done plate
      const pending = new Set(
        rows
          .filter((r) => r.plate_status !== "done")
          .map((r) => r.order_item_id)
      );
      setCheckedIds(pending);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحميل الأسماء"));
    } finally {
      setGrabLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedWid) loadGrab(selectedWid);
  }, [selectedWid, loadGrab]);

  // ── load queue (scoped to the selected ممثل when set) ────────────────────────
  const refreshQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(false);
    try {
      const q = await getCalQueue(queueWid || null);
      setQueue(q);
    } catch (e) {
      setQueueError(true);
      toast.error(getApiErrorMessage(e, "تعذر تحميل الطابور"));
    } finally {
      setQueueLoading(false);
    }
  }, [queueWid]);

  useEffect(() => {
    if (mode === "queue") {
      refreshQueue();
    }
  }, [mode, refreshQueue]);

  // ── order zone/send status for every order that has plates on screen ─────────
  const orderIdsKey = useMemo(() => {
    const ids = [...new Set(plates.map((p) => p.order_id).filter(Boolean))] as string[];
    ids.sort();
    return ids.join(",");
  }, [plates]);

  const refreshZones = useCallback(async () => {
    const ids = orderIdsKey ? orderIdsKey.split(",") : [];
    if (!ids.length) return;
    try {
      const rows = await getOrdersZones(ids);
      setOrderZones((prev) => {
        const next = { ...prev };
        for (const r of rows) next[r.order_id] = r;
        return next;
      });
    } catch {
      // zone chips are best-effort — the send button still validates server-side
    }
  }, [orderIdsKey]);

  useEffect(() => {
    refreshZones();
  }, [refreshZones]);

  // ── persistence: mount effect (restore last job + recent plates) ─────────────
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (!isAuthenticated()) return;

    async function restore() {
      const savedJobId = localStorage.getItem("cal_last_job");

      if (savedJobId) {
        try {
          const job = await getCalJob(savedJobId);
          setJobId(job.job_id);
          setPlates(job.plates);
          setDone(job.done);
          setTotal(job.total);

          // THE BUG: restoring a job painted its plates but never started the
          // poller, so any plate still 'pending' span an amber spinner forever —
          // reloading the page reproduced it identically. runCreatedJob is the
          // ONLY poller and the only ~2-min worker-stall fallback, so resume it
          // when the restored job still has unfinished work. A finished job is
          // dropped from localStorage so it stops being resurrected.
          if (job.plates.some((p) => p.status === "pending")) {
            setRunning(true);
            void runCreatedJob(job).finally(() => setRunning(false));
          } else {
            localStorage.removeItem("cal_last_job");
          }
        } catch {
          // job not found or expired — clear the key
          localStorage.removeItem("cal_last_job");
        }
      }

      // ALWAYS load the recent finished plates, even when a job was restored.
      // Gating this behind `!jobRestored` meant a single stuck job in localStorage
      // hid every successfully-generated design: the grid showed only that job's
      // pending spinners and nothing else. Merge by id so the restored job's own
      // rows (which carry live status) win over the recent snapshot.
      try {
        const recent = await getRecentPlates(60);
        if (recent.length > 0) {
          setPlates((prev) => {
            if (prev.length === 0) return recent;
            const seen = new Set(prev.map((p) => p.id));
            return [...prev, ...recent.filter((r) => !seen.has(r.id))];
          });
        }
      } catch {
        // silent — recent plates are best-effort
      }
      // Results restored → tuck the generation controls behind the sticky bar, unless
      // the worker already had a controlsOpen preference restored this session (their
      // own toggle wins over this first-load default — see StoredCalligraphyState).
      if (stored.controlsOpen === undefined) setControlsOpen(false);
    }

    restore();
  }, [stored.controlsOpen]);

  // Restore the scroll offset — but only ONCE the grid has plates to scroll over.
  // `restore()` above fetches asynchronously, so scrolling on mount would target a
  // still-empty page and land at 0. Re-applied across a few frames because plate
  // images size in progressively and keep growing the document under us.
  const scrollRestoredRef = useRef(false);
  useEffect(() => {
    if (scrollRestoredRef.current) return;
    const target = stored.scrollY ?? 0;
    if (!target) {
      scrollRestoredRef.current = true; // nothing to restore — don't fight the user
      return;
    }
    if (!plates.length) return; // wait for the grid
    scrollRestoredRef.current = true;

    let frames = 0;
    let raf = 0;
    const settle = () => {
      window.scrollTo(0, target);
      // Stop early once we're there; cap the retries so a shorter page (fewer
      // plates than last time) can never spin.
      if (++frames < 12 && Math.abs(window.scrollY - target) > 2) {
        raf = requestAnimationFrame(settle);
      }
    };
    raf = requestAnimationFrame(settle);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [plates.length, stored.scrollY]);

  // ── core processing loop (shared by runJob and runQueue) ─────────────────────
  // The backend enqueues generation on job creation (pg-boss worker) — the browser
  // only WATCHES progress now. Closing the tab no longer stops generation; reopening
  // + fetching the job (cal_last_job) shows the finished plates. If the worker is
  // down (no progress for ~2 min), we fall back to the old client-driven /process
  // loop so generation never hard-blocks on the worker.
  async function runCreatedJob(job: CalJob) {
    setJobId(job.job_id);
    setPlates(job.plates);
    setTotal(job.total);
    setDone(0);

    let stalledPolls = 0;
    let lastDone = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 4000));
      const snap = await getCalJob(job.job_id);
      setPlates(snap.plates);
      setDone(snap.done);
      const finished = snap.plates.every((p) => p.status !== "pending");
      if (finished) break;
      stalledPolls = snap.done === lastDone ? stalledPolls + 1 : 0;
      lastDone = snap.done;
      if (stalledPolls >= 30) {
        toast.message("المولّد الخلفي متوقف — نكمل التوليد من المتصفح");
        let remaining = snap.total - snap.done;
        while (remaining > 0) {
          const r = await processCalJob(job.job_id);
          setDone(r.done);
          setPlates((prev) =>
            prev.map((p) => r.plates.find((u) => u.id === p.id) ?? p)
          );
          if (r.review) {
            toast.error("تعذّر تقطيع إحدى الأوراق — راجِعها يدويًا");
          }
          if (r.processed === 0 && r.remaining > 0) break; // batch failed; stop
          remaining = r.remaining;
        }
        break;
      }
    }
    // refresh to capture all final states
    const full = await getCalJob(job.job_id);
    setPlates(full.plates);
    setDone(full.done);
    // Generation finished → collapse the controls so results lead the page.
    setControlsOpen(false);
  }

  // ── generate loop ────────────────────────────────────────────────────────────
  async function runJob(body: CreateJobBody) {
    setRunning(true);
    try {
      const job = await createCalJob(body);
      if (job.dropped && job.dropped.length) {
        toast.message(`تم استبعاد ${job.dropped.length} نص — غير صالح أو تعليمات للمحل`);
      }
      localStorage.setItem("cal_last_job", job.job_id);
      await runCreatedJob(job);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "فشل التوليد"));
    } finally {
      setRunning(false);
    }
  }

  // ── queue generate (scoped to the selected ممثل when set) ────────────────────
  async function runQueue(variant: CalVariant, mode: "full" | "all") {
    setRunning(true);
    try {
      const job = await generateFromQueue(variant, mode, queueWid || null);
      localStorage.setItem("cal_last_job", job.job_id);
      await runCreatedJob(job);
      await refreshQueue();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّر التوليد من الطابور"));
    } finally {
      setRunning(false);
    }
  }

  // ── generate ONE held line, after the designer has read it ───────────────────
  // `reviewed: true` is what makes this legal — the instruction guard exists to stop
  // UNREVIEWED spending, and a person reading this exact string and pressing the button is
  // the review. The order_item_id rides along so the plate lands on the order line rather
  // than becoming another orphan.
  async function runHeldItem(item: CalQueueHeldItem, text: string) {
    try {
      const job = await createCalJob({
        source: "wholesaler",
        model,
        wholesaler_id: queueWid || null,
        reviewed: true,
        items: [{
          render_text: text,
          student_id: item.student_id,
          order_item_id: item.order_item_id,
          variant: item.variant,
        }],
      });
      localStorage.setItem("cal_last_job", job.job_id);
      await runCreatedJob(job);
      await refreshQueue();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّر التوليد"));
    }
  }

  // ── the designer's draft for one ممثل line ───────────────────────────────────
  // `renderTextOf` is what actually gets embroidered; `r.render_text` (the student's own
  // words) stays untouched on screen and in the database as the reference of record.
  const renderTextOf = useCallback(
    (r: CalGrabRow) => (textDrafts[r.order_item_id] ?? r.render_text).trim(),
    [textDrafts]
  );
  const isDraftEdited = useCallback(
    (r: CalGrabRow) => renderTextOf(r) !== r.render_text.trim(),
    [renderTextOf]
  );

  // The closed style list, fetched once. A failure is silent: the picker simply does not
  // appear and everything generates in the shop default, which is the old behaviour.
  useEffect(() => {
    let alive = true;
    getCalStyles()
      .then((list) => { if (alive) setStyles(list); })
      .catch(() => { /* default-only is a fine degradation */ });
    return () => { alive = false; };
  }, []);

  // ── «اقرأ النصوص» — the AI reading layer over the SELECTED lines ─────────────
  // Sends ids only; the server reads the text off the order line. Costs ~$0.00006 per line
  // (text, not an image) and is ledgered under the same daily ceiling as the generator.
  async function runSuggest() {
    const untouched = grabRows.filter(
      (r) => checkedIds.has(r.order_item_id) && !textDrafts[r.order_item_id]
    );
    // Read the lines the shop actually has a doubt about, not every selected name. Two
    // reasons, and the cheaper one is not the important one: reading is billed per line, but
    // more than that, a clean «غفران» comes back as «غفران» — a row of noise the designer has
    // to read and dismiss. When nothing is flagged, fall back to the whole selection, because
    // the instruction word list is deliberately narrow and misses some real requests.
    const held = untouched.filter((r) => r.text_is_instruction);
    const target = held.length ? held : untouched;
    if (!target.length) {
      toast.error("اختر سطوراً لم تصححها بعد");
      return;
    }
    setSuggesting(true);
    try {
      const out = await suggestCalText(target.slice(0, 60).map((r) => r.order_item_id));
      if (!out.items.length) {
        // Everything read back identical to what the student wrote — that IS the answer.
        toast.success(
          out.unchanged
            ? `النصوص سليمة كما هي (${out.unchanged})`
            : "ما رجع أي اقتراح — جرّب مرة ثانية"
        );
        return;
      }
      setSuggestions((prev) => {
        const next = { ...prev };
        for (const it of out.items) next[it.order_item_id] = it;
        return next;
      });
      const usable = out.items.filter((i) => i.text).length;
      const noName = out.items.length - usable;
      toast.success(
        [
          `${usable} اقتراح جاهز`,
          noName ? `${noName} بلا اسم` : "",
          out.unchanged ? `${out.unchanged} سليم أصلاً` : "",
        ].filter(Boolean).join(" · ")
      );
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّرت قراءة النصوص"));
    } finally {
      setSuggesting(false);
    }
  }

  /** Accept one suggestion: it becomes the designer's draft (and therefore reviewed). */
  function applySuggestion(s: CalSuggestion) {
    if (!s.text) return;
    setTextDrafts((prev) => ({ ...prev, [s.order_item_id]: s.text as string }));
    if (s.style) setStyleChoice((prev) => ({ ...prev, [s.order_item_id]: s.style as string }));
    if (s.element) {
      setCapElements((prev) => ({ ...prev, [s.order_item_id]: s.element as string }));
    }
  }

  // Returns the job body (valid names only) plus the junk names that were excluded,
  // so junk never reaches the paid generator. null = nothing usable (with a toast).
  function buildItems(): { body: CreateJobBody; junk: string[] } | null {
    let allItems: CreateJobBody["items"] = [];
    let base: Omit<CreateJobBody, "items">;
    let instructionRows: string[] = [];

    const isCapLike = (v: CalVariant) => v === "cap" || v === "cap_side";

    if (mode === "typed") {
      const lines = typedText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!lines.length) {
        toast.error("أدخل أسماء في المربع");
        return null;
      }
      base = { source: "typed", model, variant: typedVariant };
      if (isCapLike(typedVariant)) {
        allItems = lines.map((line) => {
          const [namePart, ...rest] = line.split("|");
          const text = namePart.trim();
          const element = rest.join("|").trim();
          return { render_text: text, variant: typedVariant, ...(element ? { element_text: element } : {}) };
        });
      } else {
        allItems = lines.map((t) => ({ render_text: t, variant: typedVariant }));
      }
    } else {
      // wholesaler mode
      if (!selectedWid) {
        toast.error("اختر ممثلاً");
        return null;
      }
      const selected = grabRows.filter((r) => checkedIds.has(r.order_item_id));
      if (!selected.length) {
        toast.error("اختر أسماء من القائمة");
        return null;
      }
      base = { source: "wholesaler", model, wholesaler_id: selectedWid };
      // Rows the server already classified as messages to the shop. Excluded here so the
      // confirm dialog's count matches what will actually be generated — the server refuses
      // them either way, this just stops the preview from lying about how many.
      // A row the designer RETYPED is no longer one of them: a person read that exact
      // string and typed the replacement, which is the review the guard is asking for.
      instructionRows = selected
        .filter((r) => r.text_is_instruction && !isDraftEdited(r))
        .map((r) => r.render_text);
      allItems = selected
        .filter((r) => !r.text_is_instruction || isDraftEdited(r))
        .map((r) => {
          const isCap = isCapLike(r.variant);
          const element = isCap ? (capElements[r.order_item_id] ?? "").trim() : "";
          const edited = isDraftEdited(r);
          return {
            render_text: renderTextOf(r),
            student_id: r.student_id,
            order_item_id: r.order_item_id,
            variant: r.variant,
            ...(isCap && element ? { element_text: element } : {}),
            ...(styleChoice[r.order_item_id] ? { style: styleChoice[r.order_item_id] } : {}),
            // Per-LINE review flag — never the job-level one, which would also wave
            // through the lines in this same batch that nobody looked at.
            ...(edited ? { reviewed: true } : {}),
          };
        });
    }

    const valid = allItems.filter((it) => isRealName(it.render_text));
    const junk = [
      ...allItems.filter((it) => !isRealName(it.render_text)).map((it) => it.render_text),
      ...instructionRows,
    ];
    if (!valid.length) {
      toast.error("لا توجد أسماء صالحة — تحقق من النص: قد يكون تعليمات للمحل وليس اسماً");
      return null;
    }
    return { body: { ...base, items: valid }, junk };
  }

  function handleGenerate() {
    const built = buildItems();
    if (!built) return;
    const { body, junk } = built;

    // Per-zone under-filled check: group valid items by variant and find any zone < MIN_BATCH
    const byVariant: Record<string, number> = {};
    for (const item of body.items) {
      const v = item.variant ?? "front";
      byVariant[v] = (byVariant[v] ?? 0) + 1;
    }
    const underfilled = (Object.entries(byVariant) as [CalVariant, number][])
      .filter(([, count]) => count < MIN_BATCH)
      .map(([variant, count]) => ({ variant, count }));

    // Show confirm if: junk excluded, total < MIN_BATCH, OR any per-zone underfilling
    if (junk.length > 0 || body.items.length < MIN_BATCH || underfilled.length > 0) {
      setConfirm({ body, junk, validCount: body.items.length, underfilled: underfilled.length > 0 ? underfilled : undefined });
      return;
    }
    runJob(body);
  }

  // ── reroll ───────────────────────────────────────────────────────────────────
  // `overrides` carries the corrected name when the stored render_text turned out to be an
  // instruction. The server saves it onto the plate, so the fix sticks and the next reroll
  // starts from the right words.
  async function handleReroll(id: string, overrides?: { render_text?: string }) {
    setRerollingId(id);
    try {
      const updated = await rerollPlate(id, overrides);
      setPlates((prev) => prev.map((p) => (p.id === id ? updated : p)));
      toast.success("تم إعادة توليد الصورة");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "فشل إعادة التوليد"));
    } finally {
      setRerollingId(null);
    }
  }

  // ── «تحويل للتطريز» — push the order out of بانتظار التصميم ───────────────────
  async function doSendOrder(orderId: string) {
    setSendingOrderId(orderId);
    try {
      const r = await sendCalOrder(orderId);
      toast.success("تم تحويل الطلب للتطريز");
      // Flip the group's status locally + re-pull the authoritative zone state.
      setPlates((prev) =>
        prev.map((p) => (p.order_id === orderId ? { ...p, order_status: r.status } : p))
      );
      setOrderZones((prev) => {
        const cur = prev[orderId];
        return cur
          ? { ...prev, [orderId]: { ...cur, order_status: r.status, can_send: false, send_label: null } }
          : prev;
      });
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذر تحويل الطلب"));
    } finally {
      setSendingOrderId(null);
    }
  }

  function handleSendClick(orderId: string) {
    const z = orderZones[orderId];
    const missing = (z?.zones ?? []).filter((x) => !x.has_image).map((x) => x.label);
    if (missing.length > 0) {
      setSendConfirm({ orderId, missing });
      return;
    }
    doSendOrder(orderId);
  }

  // ── grouping (by order) + sticky-bar filters ─────────────────────────────────
  const groups = useMemo<PlateGroup[]>(() => {
    const map = new Map<string, PlateGroup>();
    for (const p of plates) {
      const key = p.order_id ?? "__none__";
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          orderId: p.order_id ?? null,
          studentName: p.student_name ?? null,
          productName: p.product_name ?? null,
          wholesalerId: p.wholesaler_id ?? null,
          wholesalerName: p.wholesaler_name ?? null,
          plates: [],
        };
        map.set(key, g);
      }
      g.plates.push(p);
    }
    const list = [...map.values()];
    // «بدون طلب» group always last; the rest keep the plates' (newest-first) order.
    list.sort((a, b) => (a.orderId === null ? 1 : 0) - (b.orderId === null ? 1 : 0));
    return list;
  }, [plates]);

  const visibleGroups = useMemo(() => {
    const q = searchText.trim();
    return groups
      .filter((g) => {
        const z = g.orderId ? orderZones[g.orderId] : null;
        if (gridFilter === "awaiting" && !(z?.can_send)) return false;
        if (gridWid && g.wholesalerId !== gridWid) return false;
        if (q) {
          // Spelling-insensitive: «سجى» and «سجي» are the same name and look identical,
          // so a raw includes() answered differently depending on which key was pressed —
          // and 28% of student names carry a variant character. See lib/arabic.ts.
          const hay = `${g.studentName ?? ""} ${g.plates.map((p) => p.render_text).join(" ")}`;
          if (!matchesAr(hay, q)) return false;
        }
        return true;
      })
      // A matching ORDER shows all its zones — they belong together. «لوحات بدون طلب»
      // is not an order though, it is a bucket of every orphan there is, so one hit
      // used to drag all 58 of them onto the screen (measured on the dev snapshot).
      .map((g) =>
        q && !g.orderId
          ? { ...g, plates: g.plates.filter((p) => matchesAr(p.render_text, q)) }
          : g
      )
      .filter((g) => g.plates.length > 0);
  }, [groups, gridFilter, gridWid, searchText, orderZones]);

  const visiblePlates = useMemo(
    () => visibleGroups.flatMap((g) => g.plates),
    [visibleGroups]
  );

  // ── «تنزيل الكل» — the whole job as one ZIP ──────────────────────────────────
  // Fetched with the Bearer token and saved as a blob. It used to be
  // `window.location.href = <API url>`, which sent no Authorization header at all and
  // replaced the workbench with `401 غير مصرح` — the empty page the designer reported.
  async function downloadJobZip(sheets: boolean) {
    if (!jobId) return;
    setZipSaving(sheets ? "sheets" : "plates");
    try {
      const blob = await calJobZipBlob(jobId, sheets);
      const out = await saveFile(blob, `calligraphy-${jobId.slice(0, 8)}${sheets ? "-sheets" : ""}.zip`);
      if (out !== "cancelled") toast.success("تم تنزيل ملف ZIP");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "تعذّر تنزيل الملف"));
    } finally {
      setZipSaving(null);
    }
  }

  // ── «تنزيل إلى مجلد…» — write every visible done plate into a user-picked folder
  //    (File System Access API, Chrome/Edge desktop). Fallback: ZIP of the same set.
  async function downloadToFolder() {
    const target = visiblePlates.filter((p) => p.status === "done" && p.plate_path);
    if (!target.length) {
      toast.error("لا توجد صور جاهزة ضمن الفلترة الحالية");
      return;
    }
    setFolderSaving(true);
    try {
      const w = window as unknown as {
        showDirectoryPicker?: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
      };
      if (w.showDirectoryPicker) {
        const dir = await w.showDirectoryPicker({ mode: "readwrite" });
        const used = new Set<string>();
        let ok = 0;
        for (const p of target) {
          const res = await fetch(absUrl(p.plate_path));
          if (!res.ok) continue;
          const blob = await res.blob();
          const first = plateFileName(p);
          let name = first;
          let n = 2;
          while (used.has(name)) name = first.replace(/\.png$/, ` ${n++}.png`);
          used.add(name);
          const fh = await dir.getFileHandle(name, { create: true });
          const ws = await fh.createWritable();
          await ws.write(blob);
          await ws.close();
          ok++;
        }
        toast.success(`تم حفظ ${ok} صورة في المجلد`);
      } else {
        // ZIP fallback (phones / Safari / Firefox). Goes through saveFile: the old inline
        // anchor revoked its blob URL on the next line, which Safari reads as "cancel".
        const blob = await platesZipBlob(target.map((p) => p.id));
        const out = await saveFile(blob, `calligraphy-${target.length}.zip`);
        if (out !== "cancelled") toast.success("تم تنزيل ملف ZIP بالصور");
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        toast.error(getApiErrorMessage(e, "تعذر حفظ الصور"));
      }
    } finally {
      setFolderSaving(false);
    }
  }

  // ── remaining ungenerated in wholesaler list ─────────────────────────────────
  const pendingGrabCount = grabRows.filter(
    (r) => checkedIds.has(r.order_item_id) && r.plate_status !== "done"
  ).length;
  // Counted over the SELECTED rows, because that is what «توليد» will act on: how many
  // lines the designer corrected, and how many are still the student's own instructions
  // and will therefore be skipped.
  const selectedGrabRows = grabRows.filter((r) => checkedIds.has(r.order_item_id));
  const editedGrabCount = selectedGrabRows.filter((r) => isDraftEdited(r)).length;
  const heldGrabCount = selectedGrabRows.filter(
    (r) => r.text_is_instruction === true && !isDraftEdited(r)
  ).length;

  // ── زون filter for the grab list — cap + cap_side both map to «قبعة» ──────────
  const zoneGroupOf = (v: CalVariant): "front" | "back" | "cap" =>
    v === "front" ? "front" : v === "back" ? "back" : "cap";
  const visibleGrabRows = grabRows.filter((r) => zoneFilter.has(zoneGroupOf(r.variant)));
  const toggleZone = (z: "front" | "back" | "cap") => {
    const turningOff = zoneFilter.has(z) && zoneFilter.size > 1;
    setZoneFilter((prev) => {
      const next = new Set(prev);
      if (next.has(z)) next.delete(z);
      else next.add(z);
      // never leave the list fully hidden — re-select the one just removed
      if (next.size === 0) next.add(z);
      return next;
    });
    // keep the selection in sync with the visible zones so «توليد المتبقي» matches
    setCheckedIds((prev) => {
      const next = new Set(prev);
      grabRows.forEach((r) => {
        if (zoneGroupOf(r.variant) !== z) return;
        if (turningOff) next.delete(r.order_item_id);
        else if (r.plate_status !== "done") next.add(r.order_item_id);
      });
      return next;
    });
  };

  // ── progress ─────────────────────────────────────────────────────────────────
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  // Manual inputs stay available, but the automatic queue is the daily primary flow.
  // «تجزئة» sits first among them: it is a real daily queue (retail students are invisible
  // to the automatic one — their order labels don't match the rep form's), not a fallback.
  const manualModes = [
    { id: "retail" as InputMode, label: "تجزئة" },
    { id: "typed" as InputMode, label: "لصق أسماء" },
    { id: "wholesaler" as InputMode, label: "طلبات ممثل" },
  ] as const;
  const queuePendingTotal = queue
    ? (["front", "back", "cap"] as CalVariant[]).reduce(
        (sum, variant) => sum + queue[variant].pending,
        0
      )
    : null;

  return (
    <div dir="rtl" lang="ar">
      {backHref && (
        <div className="mb-4">
          <Link
            href={backHref}
            className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-orange-ink hover:underline"
          >
            <span aria-hidden>→</span> رجوع
          </Link>
        </div>
      )}
      <PageHeader
        title="الخط العربي"
        subtitle="ابدأ بالطابور التلقائي، واستخدم الإدخال اليدوي للحالات الاستثنائية"
      />

      {/* ── Sticky workbench bar — filters + bulk download + controls toggle ── */}
      {plates.length > 0 && (
        <div className="sticky top-0 z-30 -mx-1 mb-4 rounded-2xl border border-line bg-[var(--shop-paper,#FAEBD7)]/95 px-3 py-2.5 shadow-[var(--shadow-soft)] backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={controlsOpen ? "secondary" : "primary"}
              onClick={() => setControlsOpen((v) => !v)}
            >
              {controlsOpen ? "إخفاء التوليد ▴" : "توليد المزيد ▾"}
            </Button>

            {/* status filter chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: "all" as const, label: "الكل" },
                  { id: "awaiting" as const, label: "بانتظار الإرسال" },
                ]
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setGridFilter(f.id)}
                  className={`min-h-9 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    gridFilter === f.id
                      ? "bg-orange-ink text-white"
                      : "border border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* wholesaler filter */}
            <select
              value={gridWid}
              onChange={(e) => setGridWid(e.target.value)}
              className="min-h-9 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink-soft focus:border-orange-ink focus:outline-none"
              aria-label="فلترة حسب الممثل"
            >
              <option value="">كل الممثلين</option>
              {wholesalers.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>

            {/* name search */}
            <input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              dir="rtl"
              placeholder="ابحث باسم الطالب…"
              className="min-h-9 w-40 grow rounded-full border border-line bg-surface px-3.5 py-1 text-xs text-ink placeholder:text-ink/40 focus:border-orange-ink focus:outline-none sm:w-48 sm:grow-0"
            />

            <Button
              size="sm"
              variant="secondary"
              loading={folderSaving}
              disabled={folderSaving}
              onClick={downloadToFolder}
            >
              تنزيل إلى مجلد…
            </Button>
          </div>
        </div>
      )}

      {/* ── Controls card ─────────────────────────────────────────────────── */}
      <section className={`surface-card rounded-2xl p-4 lg:p-6 mb-6 ${controlsOpen ? "" : "hidden"}`}>
        {/* The daily path is deliberately dominant; manual methods are secondary. */}
        <div className="mb-5 space-y-3" aria-label="طريقة الإدخال">
          <button
            type="button"
            aria-pressed={mode === "queue"}
            onClick={() => setMode("queue")}
            className={`flex min-h-16 w-full items-center justify-between gap-4 rounded-xl px-4 py-3 text-start transition-colors ${
              mode === "queue"
                ? "bg-orange-ink text-white"
                : "border border-orange-ink/30 bg-surface text-ink hover:border-orange-ink"
            }`}
          >
            <span className="min-w-0">
              <span className="block text-base font-bold">الطابور التلقائي</span>
              <span className={`mt-0.5 block text-xs ${mode === "queue" ? "text-white/85" : "text-ink-soft"}`}>
                الطلبات الجاهزة مرتبة حسب مكان التطريز
              </span>
            </span>
            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${mode === "queue" ? "bg-white/20 text-white" : "bg-orange-ink/10 text-orange-ink"}`}>
              {queuePendingTotal == null ? "الأساسي" : `${queuePendingTotal} بانتظار`}
            </span>
          </button>

          <div className="border-t border-line pt-3">
            <p className="mb-2 text-xs font-semibold text-ink-soft">إدخال يدوي للحالات الخاصة</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {manualModes.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={mode === tab.id}
              onClick={() => setMode(tab.id)}
              className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                mode === tab.id
                  ? "border-orange-ink bg-orange-ink/10 text-orange-ink"
                  : "border-line bg-surface text-ink-soft hover:border-orange-ink/40 hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
            ))}
            </div>
          </div>
        </div>

        {/* ── Queue panel ──────────────────────────────────────────────────── */}
        {mode === "queue" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink-soft">
                الطلبات المعلّقة مرتّبة حسب النوع — يمكنك توليدها دفعةً واحدة
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {/* ممثل filter — scopes the counts AND what «ولّد» generates */}
                <select
                  value={queueWid}
                  onChange={(e) => setQueueWid(e.target.value)}
                  disabled={running}
                  className="min-h-11 rounded-full border border-line bg-beige px-3.5 py-2 text-xs font-semibold text-ink-soft focus:border-orange-ink focus:outline-none disabled:opacity-50"
                  aria-label="فلترة الطابور حسب الممثل"
                >
                  <option value="">كل الممثلين</option>
                  {wholesalers.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={refreshQueue}
                  disabled={queueLoading || running}
                  className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-line bg-beige px-4 py-2 text-xs font-semibold text-ink-soft transition-colors hover:border-orange/40 hover:text-orange-ink disabled:opacity-50"
                >
                  {queueLoading ? (
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <span>↻</span>
                  )}
                  تحديث
                </button>
              </div>
            </div>

            {queueLoading && !queue ? (
              <div className="flex items-center gap-2 text-sm text-ink-soft py-4">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-orange border-t-transparent" />
                جارٍ التحميل…
              </div>
            ) : queueError ? (
              <div className="rounded-xl border border-danger/25 bg-surface px-5 py-8 text-center" role="alert">
                <p className="font-bold text-ink">تعذر تحميل الطابور</p>
                <p className="mt-1 text-sm text-ink-soft">تحقق من الاتصال ثم أعد المحاولة.</p>
                <Button className="mt-4" variant="ghost" onClick={refreshQueue}>إعادة المحاولة</Button>
              </div>
            ) : queue ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {(["front", "back", "cap", "cap_side"] as CalVariant[]).map((v) => (
                  <QueueZoneCard
                    key={v}
                    variant={v}
                    zone={queue[v] as CalQueueZone}
                    running={running}
                    onGenerate={runQueue}
                    onGenerateHeld={runHeldItem}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )}

        {/* variant segmented control — typed mode only */}
        {mode === "typed" && (
          <div className="mb-5">
            <p className="mb-2 text-xs font-semibold text-ink-soft">نوع التطريز</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: "front" as CalVariant, label: "الوجه الأمامي (زخرفة كاملة)" },
                  { id: "back" as CalVariant, label: "الوجه الخلفي (زخرفة أقل)" },
                  { id: "cap" as CalVariant, label: "القبعة — أعلى (اسم + عنصر)" },
                  { id: "cap_side" as CalVariant, label: "القبعة — جانب (اسم + عنصر)" },
                ]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={running}
                  onClick={() => setTypedVariant(opt.id)}
                  className={`min-h-11 rounded-full px-5 py-2 text-sm font-semibold transition-all duration-200 ${
                    typedVariant === opt.id
                      ? "bg-orange-ink text-white shadow-sm"
                      : "border border-line bg-beige text-ink hover:border-orange/40 hover:text-orange-ink"
                  } disabled:opacity-60`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* typed textarea */}
        {mode === "typed" && (
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-semibold text-ink-soft">
              أسماء الطلاب (اسم واحد في كل سطر)
            </label>
            <textarea
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              disabled={running}
              rows={8}
              dir="rtl"
              placeholder={
                typedVariant === "cap" || typedVariant === "cap_side"
                  ? "لمار | فراشة\nيوسف | شجرة\nعبدالله"
                  : "محمد علي\nفاطمة حسن\nأحمد كريم"
              }
              className="w-full rounded-xl border border-line bg-beige px-3 py-2.5 text-sm text-ink placeholder:text-ink/30 focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15 disabled:opacity-60"
            />
            {(typedVariant === "cap" || typedVariant === "cap_side") && (
              <p className="mt-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                للقبعة: اكتب الاسم ثم | ثم العنصر، مثال: <span className="font-semibold">لمار | فراشة</span> (العنصر اختياري)
              </p>
            )}
            <NameCountHint
              lines={typedText
                .split(/\r?\n/)
                .map((l) => ((typedVariant === "cap" || typedVariant === "cap_side") ? l.split("|")[0] : l).trim())
                .filter(Boolean)}
            />
          </div>
        )}

        {/* wholesaler grab */}
        {mode === "wholesaler" && (
          <div className="mb-4 space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink-soft">
                الممثل
              </label>
              <select
                value={selectedWid}
                onChange={(e) => setSelectedWid(e.target.value)}
                disabled={running || wLoading}
                className="min-h-11 w-full rounded-xl border border-line bg-beige px-3 py-2 text-sm text-ink focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15 disabled:opacity-60"
              >
                <option value="">— اختر ممثلاً —</option>
                {wholesalers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.student_count} طالب)
                  </option>
                ))}
              </select>
            </div>

            {grabLoading && (
              <div className="flex items-center gap-2 text-sm text-ink-soft">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-orange border-t-transparent" />
                جارٍ التحميل…
              </div>
            )}

            {!grabLoading && grabRows.length > 0 && (
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {([
                    { z: "front" as const, label: "امامي" },
                    { z: "back" as const, label: "خلف" },
                    { z: "cap" as const, label: "قبعة" },
                  ]).map(({ z, label }) => {
                    const on = zoneFilter.has(z);
                    return (
                      <button
                        key={z}
                        type="button"
                        onClick={() => toggleZone(z)}
                        className={`inline-flex min-h-11 items-center rounded-full border px-3 text-xs font-semibold transition ${
                          on
                            ? "border-orange-ink bg-orange-ink text-white"
                            : "border-line bg-beige text-ink-soft hover:border-orange-ink/40"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-ink-soft">
                    أسماء التطريز (اختر المطلوب توليده)
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-orange-ink underline-offset-2 hover:underline"
                      onClick={() =>
                        setCheckedIds((prev) => {
                          const next = new Set(prev);
                          visibleGrabRows.forEach((r) => next.add(r.order_item_id));
                          return next;
                        })
                      }
                    >
                      تحديد الكل
                    </button>
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-ink-soft underline-offset-2 hover:underline"
                      onClick={() =>
                        setCheckedIds((prev) => {
                          const next = new Set(prev);
                          visibleGrabRows.forEach((r) => next.delete(r.order_item_id));
                          return next;
                        })
                      }
                    >
                      إلغاء الكل
                    </button>
                    {/* Reads the selected lines and proposes what to embroider. Generates
                        nothing: ~$0.00006 a line of TEXT, against ~$0.01 for a name on a
                        sheet. The designer presses «استخدم» on each proposal. */}
                    <button
                      type="button"
                      disabled={suggesting}
                      onClick={runSuggest}
                      className="inline-flex min-h-11 items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-3 text-xs font-semibold text-sky-800 transition hover:border-sky-500 disabled:opacity-60"
                    >
                      {suggesting
                        ? "جارٍ القراءة…"
                        : heldGrabCount > 0
                          ? `اقرأ التعليمات (${heldGrabCount})`
                          : "اقرأ النصوص"}
                    </button>
                  </div>
                </div>
                <ul className="max-h-96 divide-y divide-line overflow-x-hidden overflow-y-auto rounded-xl border border-line bg-beige">
                  {visibleGrabRows.map((r) => {
                    const draft = textDrafts[r.order_item_id] ?? r.render_text;
                    const edited = isDraftEdited(r);
                    // Held only while it is still the student's own sentence — the moment
                    // the designer retypes it, it is a reviewed name and will generate.
                    const held = r.text_is_instruction === true && !edited;
                    const photo = absUrl(r.customer_image_url ?? null);
                    const sug = suggestions[r.order_item_id];
                    return (
                    <li key={r.order_item_id} className="flex min-w-0 flex-wrap items-start gap-2 px-3 py-2.5 sm:gap-3">
                      <input
                        type="checkbox"
                        id={`grab-${r.order_item_id}`}
                        checked={checkedIds.has(r.order_item_id)}
                        onChange={(e) => {
                          // Functional update, like «تحديد الكل» beside it: building the next
                          // Set from the render's closure loses a tick's other clicks.
                          const on = e.target.checked;
                          setCheckedIds((prev) => {
                            const next = new Set(prev);
                            if (on) next.add(r.order_item_id);
                            else next.delete(r.order_item_id);
                            return next;
                          });
                        }}
                        className="mt-3 h-5 w-5 shrink-0 accent-orange-ink"
                      />
                      {/* The student's own reference photo. 85% of the lines that read as a
                          message are talking about THIS image, and until now the designer had
                          to open the order to see it. */}
                      {photo && (
                        <button
                          type="button"
                          onClick={() => setPhotoPreview({ url: photo, name: r.student_name })}
                          className="mt-1 h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-line bg-white focus:outline-none focus:ring-2 focus:ring-orange-ink/40"
                          aria-label={`صورة ${r.student_name}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={photo} alt="" className="h-full w-full object-cover" loading="lazy" />
                        </button>
                      )}
                      <div className="min-w-0 flex-1">
                        <label
                          htmlFor={`grab-${r.order_item_id}`}
                          className="flex min-h-8 min-w-0 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1"
                        >
                          <span className="min-w-0 break-words text-xs font-semibold text-ink-soft">
                            {r.student_name}
                          </span>
                          <span className="rounded-full bg-beige px-2 py-0.5 text-[11px] text-ink-soft border border-line shrink-0">
                            {VARIANT_LABEL[r.variant] ?? r.variant}
                          </span>
                          <StatusPill status={r.plate_status ?? "pending"} />
                          {held && (
                            <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                              تعليمات — اكتب الاسم الصحيح
                            </span>
                          )}
                        </label>
                        {/* The text that will be embroidered. Editable BEFORE the paid
                            generation — rep students type instructions into this field just
                            like retail students do. */}
                        <input
                          type="text"
                          dir="rtl"
                          aria-label={`نص التطريز لـ ${r.student_name}`}
                          value={draft}
                          onChange={(e) =>
                            setTextDrafts((prev) => ({
                              ...prev,
                              [r.order_item_id]: e.target.value,
                            }))
                          }
                          className={`min-h-11 w-full min-w-0 rounded-lg border bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15 ${
                            held
                              ? "border-amber-300"
                              : edited
                                ? "border-orange-ink"
                                : "border-line focus:border-orange-ink"
                          }`}
                        />
                        {edited && (
                          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-ink-soft">
                            <span className="min-w-0 break-words">
                              كلام الطالب: {r.render_text}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setTextDrafts((prev) => {
                                  const next = { ...prev };
                                  delete next[r.order_item_id];
                                  return next;
                                })
                              }
                              className="shrink-0 font-semibold text-orange-ink underline-offset-2 hover:underline"
                            >
                              استرجاع
                            </button>
                          </p>
                        )}

                        {/* What the reader proposed. It sits BESIDE the field, never inside it:
                            «استخدم» is the designer's press, and that press is what marks the
                            line reviewed. An unread suggestion changes nothing. */}
                        {sug && !edited && (
                          <div className="mt-1.5 rounded-lg border border-sky-200 bg-sky-50/70 px-2.5 py-2 text-[11px]">
                            {sug.text ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-sky-900">اقتراح:</span>
                                <span className="min-w-0 break-words text-ink">{sug.text}</span>
                                {sug.style && (
                                  <span className="rounded-full border border-sky-300 bg-white px-2 py-0.5 text-sky-800">
                                    {styles.find((x) => x.id === sug.style)?.label ?? sug.style}
                                  </span>
                                )}
                                {sug.element && (
                                  <span className="rounded-full border border-sky-300 bg-white px-2 py-0.5 text-sky-800">
                                    رمز: {sug.element}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => applySuggestion(sug)}
                                  className="ms-auto min-h-8 shrink-0 rounded-full bg-sky-700 px-3 py-1 font-semibold text-white hover:opacity-90"
                                >
                                  استخدم
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="shrink-0 rounded-full border border-sky-300 bg-white px-2 py-0.5 font-semibold text-sky-800">
                                  {sug.kind === "letter"
                                    ? "حرف أو شكل — لا يُكتب"
                                    : sug.kind === "photo"
                                      ? "التصميم = صورة الطالب"
                                      : "بحاجة سؤال الطالب"}
                                </span>
                                <span className="min-w-0 break-words text-sky-900">
                                  {sug.note || "راجع الصورة المرفقة"}
                                </span>
                                {photo && (
                                  <button
                                    type="button"
                                    onClick={() => setPhotoPreview({ url: photo, name: r.student_name })}
                                    className="ms-auto min-h-8 shrink-0 rounded-full border border-sky-300 bg-white px-3 py-1 font-semibold text-sky-800 hover:border-sky-500"
                                  >
                                    افتح الصورة
                                  </button>
                                )}
                              </div>
                            )}
                            {sug.text && sug.note && (
                              <p className="mt-1 text-ink-soft">{sug.note}</p>
                            )}
                          </div>
                        )}

                        {/* Style picker — only when the designer has actually taken this line
                            in hand. Ten styled names still ride ONE sheet (batched by zone +
                            style), so this costs nothing extra unless styles are scattered. */}
                        {styles.length > 0 && edited && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] text-ink-soft">الشكل:</span>
                            <button
                              type="button"
                              onClick={() =>
                                setStyleChoice((prev) => {
                                  const next = { ...prev };
                                  delete next[r.order_item_id];
                                  return next;
                                })
                              }
                              className={`min-h-8 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
                                !styleChoice[r.order_item_id]
                                  ? "border-orange-ink bg-orange-ink text-white"
                                  : "border-line bg-white text-ink-soft hover:border-orange-ink/40"
                              }`}
                            >
                              افتراضي
                            </button>
                            {styles.map((st) => (
                              <button
                                key={st.id}
                                type="button"
                                title={st.hint}
                                onClick={() =>
                                  setStyleChoice((prev) => ({ ...prev, [r.order_item_id]: st.id }))
                                }
                                className={`min-h-8 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
                                  styleChoice[r.order_item_id] === st.id
                                    ? "border-orange-ink bg-orange-ink text-white"
                                    : "border-line bg-white text-ink-soft hover:border-orange-ink/40"
                                }`}
                              >
                                {st.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {(r.variant === "cap" || r.variant === "cap_side") && (
                        <input
                          type="text"
                          dir="rtl"
                          placeholder="عنصر (اختياري)"
                          value={capElements[r.order_item_id] ?? ""}
                          onChange={(e) =>
                            setCapElements((prev) => ({
                              ...prev,
                              [r.order_item_id]: e.target.value,
                            }))
                          }
                          className="mt-8 min-h-11 w-full min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-xs text-ink placeholder:text-ink/50 focus:border-orange-ink focus:outline-none focus:ring-2 focus:ring-orange-ink/15 sm:w-32"
                        />
                      )}
                    </li>
                    );
                  })}
                </ul>
                <p className="mt-1.5 text-xs text-ink-soft">
                  {checkedIds.size} محدد · {pendingGrabCount} لم يُولَّد بعد
                  {editedGrabCount > 0 ? ` · ${editedGrabCount} نص مُصحَّح` : ""}
                  {heldGrabCount > 0 ? ` · ${heldGrabCount} تعليمات بحاجة تصحيح` : ""}
                </p>
              </div>
            )}

            {!grabLoading && selectedWid && grabRows.length === 0 && (
              <p className="text-sm text-ink-soft">
                لا توجد أسماء تطريز مسجّلة لهذا الممثل
              </p>
            )}
          </div>
        )}

        {/* «تجزئة» — review-before-generate board. Generation is per student/zone inside
            the board (each needs its own cleaned text + variant), so the shared footer
            button below is deliberately not shown for this mode. */}
        {mode === "retail" && (
          <RetailReviewBoard
            canOpenOrders={canOpenOrders}
            fromPath={pathname}
            running={running}
            onGenerate={runJob}
          />
        )}

        {/* generate button — manual modes only */}
        {mode !== "queue" && mode !== "retail" && (
          <Button
            onClick={handleGenerate}
            loading={running}
            disabled={running}
            size="lg"
          >
            {mode === "wholesaler" && pendingGrabCount > 0
              ? `توليد المتبقي (${pendingGrabCount})`
              : "توليد"}
          </Button>
        )}
      </section>

      {/* ── Progress ──────────────────────────────────────────────────────── */}
      {(running || (jobId && total > 0)) && (
        <section className="surface-card rounded-2xl p-4 mb-6">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-ink">
              التقدم: {done} / {total}
            </p>
            {running && (
              <p className="text-xs text-ink-soft">
                جارٍ توليد ورقة… قد تستغرق حتى دقيقة لكل ورقة ({elapsed} ثانية)
              </p>
            )}
          </div>
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className={`h-2.5 overflow-hidden rounded-full bg-orange/15 ${
              running ? "animate-pulse" : ""
            }`}
          >
            <div
              className="h-full rounded-full bg-orange-ink transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </section>
      )}

      {/* ── Download all ──────────────────────────────────────────────────── */}
      {jobId && done > 0 && (
        <section className="mb-6 flex flex-wrap gap-3">
          <Button
            variant="secondary"
            loading={zipSaving === "plates"}
            disabled={!!zipSaving}
            onClick={() => downloadJobZip(false)}
          >
            تنزيل الكل (ZIP)
          </Button>
          <Button
            variant="ghost"
            loading={zipSaving === "sheets"}
            disabled={!!zipSaving}
            onClick={() => downloadJobZip(true)}
          >
            تنزيل الكل مع الأوراق
          </Button>
        </section>
      )}

      {/* ── Workbench — plates grouped by student/order ───────────────────── */}
      {plates.length > 0 && (
        <section>
          <h2 className="mb-4 font-display text-lg font-bold text-ink">
            اللوحات ({visiblePlates.length}
            {visiblePlates.length !== plates.length ? ` من ${plates.length}` : ""})
          </h2>

          {visibleGroups.length === 0 && (
            <div className="rounded-2xl border border-dashed border-line bg-surface-sink p-8 text-center text-sm text-ink-soft">
              لا توجد نتائج ضمن الفلترة الحالية.
            </div>
          )}

          <div className="space-y-4">
            {visibleGroups.map((g) => {
              const z = g.orderId ? orderZones[g.orderId] : null;
              const statusKey = z?.order_status ?? g.plates[0]?.order_status ?? null;
              const sent = !!(g.orderId && statusKey && statusKey !== "design_complete");
              return (
                <article
                  key={g.key}
                  className="rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-soft)] sm:p-4"
                >
                  {/* group header: student → order · product · status · zones · send */}
                  <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                    {g.orderId ? (
                      <>
                        {canOpenOrders ? (
                          <Link
                            href={`/staff/orders/${g.orderId}?from=${encodeURIComponent(pathname)}`}
                            className="min-w-0 truncate font-display text-base font-bold text-orange-ink underline-offset-4 hover:underline"
                          >
                            {g.studentName ?? "طالب"}
                          </Link>
                        ) : (
                          <span className="min-w-0 truncate font-display text-base font-bold text-ink">
                            {g.studentName ?? "طالب"}
                          </span>
                        )}
                        {g.productName && (
                          <span className="text-xs font-semibold text-ink-soft">{g.productName}</span>
                        )}
                        {statusKey && (
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                              sent
                                ? "bg-green-100 text-green-800"
                                : "bg-peach/70 text-orange-ink"
                            }`}
                          >
                            {ORDER_STATUS_AR[statusKey] ?? statusKey}
                          </span>
                        )}
                        {g.wholesalerName && (
                          <span className="rounded-full border border-line bg-beige px-2 py-0.5 text-[11px] text-ink-soft">
                            ممثل: {g.wholesalerName}
                          </span>
                        )}

                        {/* zone ✓/✗ chips */}
                        {z && z.zones.length > 0 && (
                          <span className="flex flex-wrap items-center gap-1">
                            {z.zones.map((zone) => (
                              <span
                                key={zone.key}
                                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  zone.has_image
                                    ? "bg-green-50 text-green-700 border border-green-200"
                                    : "bg-amber-50 text-amber-700 border border-amber-200"
                                }`}
                                title={zone.has_image ? "الصورة جاهزة" : "بلا صورة بعد"}
                              >
                                {zone.label} {zone.has_image ? "✓" : "✗"}
                              </span>
                            ))}
                          </span>
                        )}

                        {/* the one action: تحويل للتطريز */}
                        {canSendOrders && z?.can_send && (
                          <Button
                            size="sm"
                            variant="primary"
                            className="ms-auto"
                            loading={sendingOrderId === g.orderId}
                            disabled={sendingOrderId !== null}
                            onClick={() => handleSendClick(g.orderId as string)}
                          >
                            {z.send_label ?? "تحويل للتطريز"}
                          </Button>
                        )}
                        {/* Refused by the server's own gate — say why instead of showing a
                            button that 409s, or (worse) letting the order vanish downstream. */}
                        {canSendOrders && !z?.can_send && z?.blocked_reason && (
                          <span className="ms-auto rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
                            ⏸ {z.blocked_reason}
                          </span>
                        )}
                        {sent && (
                          <span className="ms-auto rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700">
                            ✓ أُرسل
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="font-display text-base font-bold text-ink">
                        لوحات بدون طلب
                      </span>
                    )}
                  </div>

                  <div className="grid min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {g.plates.map((plate) => (
                      <PlateCard
                        key={plate.id}
                        plate={plate}
                        onReroll={handleReroll}
                        onPreview={setPreview}
                        onEdit={setCompositorPlate}
                        rerolling={rerollingId === plate.id}
                      />
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Send confirm — zones still missing artwork ─────────────────────── */}
      <Modal
        open={!!sendConfirm}
        onClose={() => setSendConfirm(null)}
        title="مواضع بلا صورة"
        footer={
          <>
            <Button variant="ghost" fullWidth onClick={() => setSendConfirm(null)}>
              إلغاء
            </Button>
            <Button
              variant="primary"
              fullWidth
              onClick={() => {
                if (sendConfirm) doSendOrder(sendConfirm.orderId);
                setSendConfirm(null);
              }}
            >
              تحويل على أي حال
            </Button>
          </>
        }
      >
        {sendConfirm && (
          <div className="space-y-2 text-sm text-ink">
            <p>هذا الطلب يحتوي مواضع تطريز بلا صورة حتى الآن:</p>
            <ul className="list-inside list-disc text-amber-700">
              {sendConfirm.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <p className="text-xs text-ink-soft">
              يمكنك توليد لوحاتها أولاً، أو تحويل الطلب كما هو وسيتولى المطرز الناقص.
            </p>
          </div>
        )}
      </Modal>

      {/* ── Full-size plate preview ───────────────────────────────────────────── */}
      {/* Portaled to <body> so the overlay escapes the admin layout's `.shop-paper`
          (`overflow-x: clip`) / staff layout stacking contexts — otherwise the
          fixed overlay is clipped/trapped and the ✕ / backdrop click can't be
          reached. Mirrors components/ui/Modal.tsx. `mounted` guards SSR (createPortal
          needs document.body). Backdrop click, ✕ (setPreview(null)) and the Escape
          handler above all still fire — React events bubble through the portal. */}
      {mounted && preview && absUrl(preview.plate_path) &&
        createPortal(
          <div
            className="animate-fade-page-in fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-ink/70 p-4 backdrop-blur-sm"
            onClick={() => setPreview(null)}
            role="dialog"
            aria-modal="true"
            aria-label={`معاينة ${preview.render_text}`}
          >
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="absolute end-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-xl text-ink shadow-lg transition hover:bg-white"
              aria-label="إغلاق"
            >
              ✕
            </button>
            <div
              className="flex max-h-[80dvh] w-full max-w-3xl flex-col items-center gap-3 overflow-auto rounded-2xl bg-white p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={absUrl(preview.plate_path)}
                alt={preview.render_text}
                className="max-h-[64dvh] w-auto max-w-full object-contain"
              />
              <p className="font-display text-lg font-bold text-ink">{preview.render_text}</p>
              <button
                type="button"
                disabled={previewSaving}
                onClick={async () => {
                  setPreviewSaving(true);
                  try {
                    const out = await saveFromUrl(
                      absUrl(preview.plate_path),
                      plateFileName(preview)
                    );
                    if (out !== "cancelled") toast.success("تم تنزيل الصورة");
                  } catch {
                    toast.error("تعذّر تنزيل الصورة");
                  } finally {
                    setPreviewSaving(false);
                  }
                }}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-orange-ink px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {previewSaving ? "جارٍ التنزيل…" : "تنزيل الصورة"}
              </button>
            </div>
          </div>,
          document.body
        )}

      {/* ── The student's reference photo, full size ───────────────────────── */}
      {mounted && photoPreview &&
        createPortal(
          <div
            className="fixed inset-0 z-[220] flex items-center justify-center bg-ink/80 p-4"
            role="dialog"
            aria-modal="true"
            aria-label={`صورة ${photoPreview.name}`}
            onClick={() => setPhotoPreview(null)}
          >
            <button
              type="button"
              onClick={() => setPhotoPreview(null)}
              aria-label="إغلاق"
              className="absolute end-4 top-[max(1rem,calc(env(safe-area-inset-top,0px)+0.5rem))] flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl leading-none text-white transition hover:bg-white/30"
            >
              ✕
            </button>
            <figure className="max-h-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoPreview.url}
                alt={`صورة ${photoPreview.name}`}
                className="max-h-[80dvh] w-auto max-w-full rounded-xl bg-white object-contain"
              />
              <figcaption className="mt-3 text-center text-sm font-semibold text-white">
                {photoPreview.name}
              </figcaption>
            </figure>
          </div>,
          document.body
        )}

      {/* ── Confirm gate (junk excluded / small batch / underfilled zone) ─────── */}
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="تأكيد التوليد"
        footer={
          <>
            <Button variant="ghost" fullWidth onClick={() => setConfirm(null)}>
              إلغاء
            </Button>
            <Button
              variant="primary"
              fullWidth
              onClick={() => {
                if (confirm) runJob(confirm.body);
                setConfirm(null);
              }}
            >
              متابعة ({confirm?.validCount} اسم)
            </Button>
          </>
        }
      >
        {confirm && (
          <div className="space-y-3 text-sm text-ink">
            {confirm.junk.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                <p className="font-semibold text-red-700">
                  {confirm.junk.length} نص سيُستبعد — غير صالح أو تعليمات للمحل (لن يُولَّد):
                </p>
                <p className="mt-1 break-words text-xs text-red-600">
                  {confirm.junk.slice(0, 12).join(" · ")}
                  {confirm.junk.length > 12 ? " …" : ""}
                </p>
              </div>
            )}
            {confirm.validCount < MIN_BATCH && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
                لديك <span className="font-bold">{confirm.validCount}</span> اسم فقط
                (أقل من {MIN_BATCH}). كل ورقة تكلّف نفس السعر سواء حملت اسمًا واحدًا أو
                {" "}{MIN_BATCH} — هل تريد المتابعة؟
              </div>
            )}
            {confirm.underfilled && confirm.underfilled.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
                <p className="font-semibold mb-1">بعض الأنواع بها أقل من {MIN_BATCH} أسماء:</p>
                <ul className="text-xs space-y-0.5">
                  {confirm.underfilled.map(({ variant, count }) => (
                    <li key={variant}>
                      {VARIANT_LABEL[variant]}: <span className="font-bold">{count}</span> فقط
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs">
                  كل نوع يُطبع بورقة منفصلة — الأقل من ١٠ يكلّف ورقة كاملة (~$0.10).
                </p>
              </div>
            )}
            <p className="text-xs text-ink-soft">
              سيتم توليد <span className="font-semibold text-ink">{confirm.validCount}</span> اسم صالح.
            </p>
          </div>
        )}
      </Modal>

      {/* ── Plate compositor (overlay editor) ───────────────────────────────── */}
      {compositorPlate && (
        <PlateCompositor
          plate={compositorPlate}
          onSaved={(p) => {
            setPlates((prev) => prev.map((x) => (x.id === p.id ? p : x)));
            setCompositorPlate(null);
          }}
          onClose={() => setCompositorPlate(null)}
        />
      )}
    </div>
  );
}
