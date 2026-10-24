"use client";

/**
 * «التجميع» — برزان's board (owner 2026-09-02, narrowed to sashes 2026-09-06).
 *
 * A ممثل sash comes out of التطريز as two halves (من الخلف · من الأمام). This board shows, per
 * student, which halves have physically arrived on the sewing table and which sashes are
 * complete and waiting to be sewn into one garment and sent to الكوي.
 *
 *   «جاهزة للتجميع» — status = assembly. Every zone ticked. One button: the row's own
 *                     `advance_label` (الكوي, or التجهيز when the piece needs no pressing).
 *                     Owner 2026-10-25 («ضيف لبرزان تحديد الكل»): each piece also has a
 *                     checkbox, «تحديد الكل» picks every movable piece, and a sticky bar
 *                     sends the selection through the same `advance-bulk` every station uses.
 *   «قطع واصلة»     — status = embroidery with ≥1 ticked zone. Chips show which half is here
 *                     and which is still under the needle. No button — nothing to sew yet.
 *
 * The board never decides status. Status is the backend's (a sash becomes `assembly` when its
 * LAST zone is ticked — D1); this screen only reads it and calls the same `advance` every
 * station calls. Live through the production SSE stream — the embroiderer's every tick emits,
 * so a half appears here the moment it is ticked, without a refresh.
 *
 * Phone-first (برزان works on an iPad and a phone): one column, 44px targets, safe-area bottom.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/EmptyState";
import { getApiErrorMessage } from "@/lib/api";
import { advanceBulk, advanceOrder, getAssemblyBoard } from "@/lib/staff";
import { Button } from "@/components/ui/Button";
import { formatDateShort } from "@/lib/format";
import { usePolling } from "@/lib/hooks/usePolling";
import { useProductionEvents } from "@/hooks/useProductionEvents";
import { useCoalesced } from "@/hooks/useCoalesced";
import { advancedLabelFor } from "@/components/staff/station/types";
import type { AssemblyRow } from "@/lib/staff-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface StudentGroup {
  key: string;
  student_name: string;
  wholesaler_name: string | null;
  batch_name: string | null;
  deadline: string | null;
  rows: AssemblyRow[];
}

/** Group rows by student, keeping the server's deadline-first order. */
function groupByStudent(rows: AssemblyRow[]): StudentGroup[] {
  const map = new Map<string, StudentGroup>();
  for (const r of rows) {
    let g = map.get(r.student_id);
    if (!g) {
      g = {
        key: r.student_id,
        student_name: r.student_name,
        wholesaler_name: r.wholesaler_name,
        batch_name: r.batch_name,
        deadline: r.deadline,
        rows: [],
      };
      map.set(r.student_id, g);
    }
    g.rows.push(r);
  }
  return [...map.values()];
}

function isOverdue(deadline: string | null): boolean {
  return !!deadline && new Date(deadline).getTime() < Date.now();
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function ZoneChip({ label, done }: { label: string; done: boolean }) {
  return (
    <span
      className={`inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-xs font-bold ${
        done ? "bg-peach/70 text-orange-ink" : "bg-ink/[0.06] text-muted"
      }`}
    >
      <span aria-hidden>{done ? "✓" : "⏳"}</span>
      {label}
      {!done && <span className="font-normal">· بعده بالتطريز</span>}
    </span>
  );
}

function GroupHeader({ g }: { g: StudentGroup }) {
  const late = isOverdue(g.deadline);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 className="min-w-0 truncate text-base font-extrabold text-ink">{g.student_name}</h3>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted">
        {g.wholesaler_name && <span className="truncate">الممثل: {g.wholesaler_name}</span>}
        {g.batch_name && <span className="truncate">{g.batch_name}</span>}
        {g.deadline && (
          <span className={late ? "font-bold text-danger" : ""}>
            {late ? "متأخر · " : "الموعد: "}
            {formatDateShort(g.deadline)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Board ────────────────────────────────────────────────────────────────────

export function AssemblyBoard() {
  const [arriving, setArriving] = useState<AssemblyRow[]>([]);
  const [ready, setReady] = useState<AssemblyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    try {
      const data = await getAssemblyBoard();
      setArriving(data.arriving);
      setReady(data.ready);
      setError(null);
    } catch (err) {
      const msg = getApiErrorMessage(err, "تعذر تحميل لوحة التجميع");
      if (opts.silent) toast.error(msg);
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live: every zone tick and every status move emits an `order` event.
  usePolling(() => load({ silent: true }), 20000, true);
  // Coalesced: one bulk tick by the embroiderer emits an event per piece — see useCoalesced.
  const liveReload = useCoalesced(() => void load({ silent: true }));
  useProductionEvents((e) => {
    if (e.type !== "presence") liveReload();
  });

  const readyGroups = useMemo(() => groupByStudent(ready), [ready]);
  const arrivingGroups = useMemo(() => groupByStudent(arriving), [arriving]);

  // Only pieces this person may actually move are selectable — same rule as the row button.
  const selectableIds = useMemo(
    () => ready.filter((r) => r.can_advance && r.advance_label).map((r) => r.id),
    [ready]
  );
  // A live reload can take a selected piece off the board (someone else moved it); never
  // keep an id that is no longer here, or the bar's count lies.
  useEffect(() => {
    setSelected((prev) => {
      const live = new Set(selectableIds);
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [selectableIds]);
  const allChecked = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(selectableIds));

  // The bar names the stage the selection is going to when every selected piece agrees.
  const bulkLabel = (() => {
    const labels = new Set(ready.filter((r) => selected.has(r.id)).map((r) => r.advance_label));
    const one = labels.size === 1 ? [...labels][0] : null;
    return `${one ?? "نقل المحدد"} (${selected.size})`;
  })();

  const doBulk = async () => {
    if (!selected.size || bulkLoading) return;
    setBulkLoading(true);
    try {
      const res = await advanceBulk([...selected]);
      if (res.advanced > 0) {
        toast.success(
          res.skipped > 0
            ? `تم نقل ${res.advanced} قطعة · تخطّي ${res.skipped}`
            : `تم نقل ${res.advanced} قطعة`
        );
      } else {
        toast.error("ما انتقلت ولا قطعة من المحدد");
      }
      setSelected(new Set());
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر نقل القطع"));
    } finally {
      setBulkLoading(false);
      void load({ silent: true });
    }
  };

  const advance = async (row: AssemblyRow) => {
    if (busy.has(row.id)) return;
    setBusy((s) => new Set(s).add(row.id));
    // Optimistic: the piece leaves the board; a failure puts it back.
    setReady((rows) => rows.filter((r) => r.id !== row.id));
    setSelected((s) => {
      if (!s.has(row.id)) return s;
      const n = new Set(s);
      n.delete(row.id);
      return n;
    });
    try {
      const res = await advanceOrder(row.id);
      toast.success(`«${row.product_name}» — ${row.student_name}: ${advancedLabelFor(res.status)}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "تعذر نقل القطعة"));
      void load({ silent: true });
    } finally {
      setBusy((s) => {
        const n = new Set(s);
        n.delete(row.id);
        return n;
      });
    }
  };

  if (loading) {
    return (
      <div className="space-y-3" aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-24 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        title="ما كدرنا نحمّل اللوحة"
        message={error}
        action={
          <button
            type="button"
            onClick={() => void load()}
            className="btn-press min-h-11 rounded-full bg-orange-ink px-5 text-sm font-bold text-white"
          >
            حاول مرة ثانية
          </button>
        }
      />
    );
  }

  if (!ready.length && !arriving.length) {
    return (
      <EmptyState
        title="ما في قطع بالتجميع هسة."
        message="أول ما يطرّز محمد عماد نص وشاح لطالب ممثل، يبين هنا."
      />
    );
  }

  return (
    <div className={`space-y-6 ${selected.size > 0 ? "pb-28" : "pb-[env(safe-area-inset-bottom)]"}`}>
      {/* ── جاهزة للتجميع ─────────────────────────────────────────────── */}
      <section aria-labelledby="assembly-ready">
        <h2 id="assembly-ready" className="mb-2 flex items-center gap-2 text-sm font-extrabold text-ink">
          جاهزة للتجميع
          <span className="rounded-full bg-orange-ink px-2 py-0.5 text-xs font-bold text-white">{ready.length}</span>
        </h2>
        {readyGroups.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-5 text-center text-sm text-muted">
            ما في وشاح مكتمل التطريز بعد. القطع الواصلة تحت.
          </p>
        ) : (
          <div className="space-y-3">
            {selectableIds.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                aria-pressed={allChecked}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink-soft transition-colors hover:border-orange-ink/30"
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-md border-2 ${
                    allChecked ? "border-orange-ink bg-orange-ink text-white" : "border-ink/30"
                  }`}
                  aria-hidden
                >
                  {allChecked ? "✓" : ""}
                </span>
                تحديد الكل ({selectableIds.length})
              </button>
            )}
            {readyGroups.map((g) => (
              <article key={g.key} className="rounded-2xl border border-line bg-surface p-3.5 shadow-[var(--shadow-soft)]">
                <GroupHeader g={g} />
                <ul className="mt-3 space-y-3">
                  {g.rows.map((row) => (
                    <li key={row.id} className="rounded-xl bg-[var(--shop-sink)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {row.can_advance && row.advance_label ? (
                          <label className="-m-1.5 flex min-h-11 cursor-pointer items-center gap-2.5 p-1.5">
                            <input
                              type="checkbox"
                              checked={selected.has(row.id)}
                              onChange={() => toggleOne(row.id)}
                              className="h-5 w-5 shrink-0 accent-[var(--color-orange-ink)]"
                            />
                            <span className="text-sm font-bold text-ink">{row.product_name}</span>
                          </label>
                        ) : (
                          <span className="text-sm font-bold text-ink">{row.product_name}</span>
                        )}
                        <span className="text-xs text-muted">
                          {row.done_count}/{row.total_count} منطقة
                        </span>
                      </div>
                      {row.zones.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {row.zones.map((z) => (
                            <ZoneChip key={z.key} label={z.label} done={z.done} />
                          ))}
                        </div>
                      )}
                      {row.can_advance && row.advance_label ? (
                        <button
                          type="button"
                          disabled={busy.has(row.id)}
                          onClick={() => void advance(row)}
                          className="btn-press mt-3 flex min-h-11 w-full items-center justify-center rounded-full bg-orange-ink px-4 text-sm font-bold text-white disabled:opacity-60"
                        >
                          {row.advance_label}
                        </button>
                      ) : (
                        <p className="mt-2 text-xs text-muted">ما عندك صلاحية نقل هذه القطعة.</p>
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ── قطع واصلة ─────────────────────────────────────────────────── */}
      <section aria-labelledby="assembly-arriving">
        <h2 id="assembly-arriving" className="mb-2 flex items-center gap-2 text-sm font-extrabold text-ink">
          قطع واصلة
          <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs font-bold text-ink-soft">{arriving.length}</span>
        </h2>
        {arrivingGroups.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-5 text-center text-sm text-muted">
            ما في أنصاف واصلة من التطريز هسة.
          </p>
        ) : (
          <div className="space-y-3">
            {arrivingGroups.map((g) => (
              <article key={g.key} className="rounded-2xl border border-line bg-surface p-3.5">
                <GroupHeader g={g} />
                <ul className="mt-3 space-y-3">
                  {g.rows.map((row) => (
                    <li key={row.id} className="rounded-xl bg-[var(--shop-sink)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-bold text-ink">{row.product_name}</span>
                        <span className="text-xs text-muted">
                          {row.done_count}/{row.total_count} منطقة
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {row.zones.map((z) => (
                          <ZoneChip key={z.key} label={z.label} done={z.done} />
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        تكتمل لمّا يطرّز {row.total_count - row.done_count === 1 ? "النص الثاني" : `${row.total_count - row.done_count} مناطق`}.
                      </p>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur lg:ms-64">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="min-h-11 px-2 text-sm font-medium text-ink-soft hover:text-ink"
            >
              إلغاء التحديد ({selected.size})
            </button>
            <Button onClick={() => void doBulk()} loading={bulkLoading} className="min-w-[9rem]">
              {bulkLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
