"use client";

// رف التجهيز — three zones, NO mode switch.
//   1. جاهز للتغليف  — the hero. Whose set is complete right now.
//   2. وصلت توّا     — un-shelved arrivals needing a خانة (caps/شال never pass الكوي).
//   3. الرف          — the map, for lookup.
// The prototype made the worker toggle تسكين ⇄ جمع and know which mode they were in.
// Here placing and collecting are just different taps.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getShelfBoard,
  placePiece,
  collectPiece,
  closeSet,
  type ShelfBoard,
  type ShelfInboxItem,
  type ShelfSlot,
} from "@/lib/shelf";
import { getApiErrorMessage } from "@/lib/api";
// Undo + send-back both go through the ORDINARY revert endpoint. The shelf never decides
// where a piece may move — the backend state machine owns that, and mirroring it here
// would produce buttons that 409.
import { revertOrder } from "@/lib/staff";
import { ORDER_STATUS_LABELS } from "@/lib/constants";
import type { OrderStatus } from "@/lib/types";
import { usePolling } from "@/lib/hooks/usePolling";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { PlaceSheet } from "./PlaceSheet";
import { ShelfMap } from "./ShelfMap";
import { SearchField } from "@/components/ui/SearchField";

const STORAGE_KEY = "loloshop-shelf-console";

interface Persisted {
  search?: string;
  showAllInbox?: boolean;
}

/** Short Arabic relative time — a collected list is scanned, not read. */
function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `قبل ${mins} د`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `قبل ${hrs} س`;
  const days = Math.round(hrs / 24);
  return `قبل ${days} ي`;
}

function readPersisted(): Persisted {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}") as Persisted;
  } catch {
    return {};
  }
}

export function ShelfConsole() {
  // Lazy-init from sessionStorage is safe: this console only mounts client-side behind
  // the auth gate, so there is no SSR hydration mismatch.
  const [board, setBoard] = useState<ShelfBoard | null>(null);
  const [search, setSearch] = useState(() => readPersisted().search ?? "");
  const [showAllInbox, setShowAllInbox] = useState(() => readPersisted().showAllInbox ?? false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<ShelfInboxItem | null>(null);
  const [openSlot, setOpenSlot] = useState<ShelfSlot | null>(null);
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await getShelfBoard();
      setBoard(data);
      setError(null);
      loadedOnce.current = true;
    } catch (e) {
      setError(getApiErrorMessage(e, "تعذّر تحميل الرف"));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  usePolling(load, 15000);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ search, showAllInbox }));
  }, [search, showAllInbox]);

  // Land the preparer back where they were after opening a piece — the shelf map is long
  // and «رجوع» used to return them to the top of it every time.
  useScrollRestore("shelf", !!board);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  const readySets = useMemo(
    () => (board?.sets ?? []).filter((s) => s.state === "ready"),
    [board],
  );
  const waitingCount = (board?.sets ?? []).length - readySets.length;

  // Collected pieces grouped per student (bundle), newest group first. Grouping matters:
  // a student's robe/cap/شال were collected seconds apart, and three separate rows would
  // read as three separate events instead of one packed طرد.
  const collectedGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        set_key: string;
        student_name: string;
        pieces: NonNullable<typeof board>["collected"];
        allDelivered: boolean;
        latest: number;
      }
    >();
    for (const c of board?.collected ?? []) {
      let g = groups.get(c.set_key);
      if (!g) {
        g = {
          set_key: c.set_key,
          student_name: c.student_name,
          pieces: [],
          allDelivered: true,
          latest: 0,
        };
        groups.set(c.set_key, g);
      }
      g.pieces.push(c);
      if (c.status !== "delivered") g.allDelivered = false;
      g.latest = Math.max(g.latest, new Date(c.collected_at).getTime());
    }
    return [...groups.values()].sort((a, b) => b.latest - a.latest);
  }, [board]);

  const inbox = board?.inbox ?? [];
  const shownInbox = showAllInbox ? inbox : inbox.slice(0, 12);
  const unplaceable = inbox.filter((i) => !i.suggestion).length;

  async function doPlace(item: ShelfInboxItem, target?: { shelf_code: string; slot_index: number }) {
    setBusyId(item.order_id);
    try {
      const res = await placePiece(item.order_id, target);
      flash(
        res.over
          ? `${item.piece_label} في ${res.slot_code} — الخانة فوق حدها`
          : `${item.piece_label} → ${res.slot_code}`,
      );
      setSheet(null);
      await load();
    } catch (e) {
      flash(getApiErrorMessage(e, "تعذّر التسكين"));
    } finally {
      setBusyId(null);
    }
  }

  async function doCollect(orderId: string, label: string) {
    setBusyId(orderId);
    try {
      const res = await collectPiece(orderId);
      flash(res.set_closed ? `تم إغلاق الطرد كاملاً ✓` : `${label} — تم الجمع`);
      await load();
    } catch (e) {
      flash(getApiErrorMessage(e, "تعذّر الجمع"));
    } finally {
      setBusyId(null);
    }
  }

  // One step back through the ordinary revert endpoint. Used for both «تراجع» (undo a
  // mis-tapped جمعها: ready → التجهيز) and «إرجاع» (send a piece on the shelf back to
  // الكوي/التطريز). The backend picks the target and refuses when there is nowhere to go —
  // e.g. a plain robe already at الكوي, whose first stage that is.
  async function doRevert(orderId: string, label: string) {
    setBusyId(orderId);
    try {
      const res = await revertOrder(orderId);
      const where = ORDER_STATUS_LABELS[res.status as OrderStatus] ?? res.status;
      flash(`${label} — رجعت إلى «${where}»`);
      await load();
    } catch (e) {
      flash(getApiErrorMessage(e, "تعذّر الإرجاع"));
    } finally {
      setBusyId(null);
    }
  }

  async function doCloseSet(setKey: string, name: string) {
    setBusyId(setKey);
    try {
      const res = await closeSet(setKey);
      flash(`طرد ${name} — ${res.advanced_ids.length} قطعة جاهزة للاستلام ✓`);
      await load();
    } catch (e) {
      flash(getApiErrorMessage(e, "تعذّر إغلاق الطرد"));
    } finally {
      setBusyId(null);
    }
  }

  if (!board && !error) {
    return <div className="p-8 text-center text-[#6b6356]">جاري تحميل الرف…</div>;
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] px-3 py-4 sm:px-5" dir="rtl">
      {error ? (
        <div className="mb-4 rounded-xl bg-[#9f382d] px-4 py-3 text-sm font-bold text-white">
          {error}
        </div>
      ) : null}

      {/* ── Zone 1: جاهز للتغليف (hero) ─────────────────────────── */}
      <section className="mb-6">
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-2xl font-black text-[#1A1A1A]">
            جاهز للتغليف{" "}
            <span className="text-[#F47B42]">{readySets.length}</span>
          </h2>
          <p className="text-xs text-[#6b6356]">
            {waitingCount} طقم ما زال ينتظر قطعة
          </p>
        </header>

        {readySets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#ded6c8] bg-[#FFF8F0] px-5 py-8 text-center">
            <p className="font-bold text-[#1A1A1A]">ما في طقم مكتمل هسه</p>
            <p className="mt-1 text-sm text-[#6b6356]">
              كل الأطقم تنتظر قطعة بعدها بالتطريز أو الكوي.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {readySets.map((s) => (
              <article
                key={s.set_key}
                className="rounded-2xl border-2 border-[#639a7b] bg-[#FFF8F0] p-4"
              >
                <div className="mb-3">
                  <h3 className="text-lg font-extrabold text-[#1A1A1A]">{s.student_name}</h3>
                  {s.university_name ? (
                    <p className="text-xs text-[#6b6356]">
                      {s.university_name}
                      {s.department ? ` · ${s.department}` : ""}
                    </p>
                  ) : null}
                </div>

                <div className="mb-3 flex flex-wrap gap-2">
                  {s.pieces.map((p) => {
                    const done = p.status === "ready";
                    return (
                      <button
                        key={p.order_id}
                        type="button"
                        disabled={done || busyId === p.order_id}
                        onClick={() => doCollect(p.order_id, p.piece_label)}
                        className={[
                          "flex min-h-14 flex-col items-center justify-center rounded-xl border-2 px-3 py-1.5 transition active:scale-95",
                          done
                            ? "border-[#639a7b] bg-[#e5f0e9] text-[#256347]"
                            : "border-[#F47B42] bg-white text-[#1A1A1A] hover:bg-[#FFDAB9]",
                        ].join(" ")}
                      >
                        <span className="text-[10px] font-bold">{p.piece_label}</span>
                        <span className="font-mono text-base font-black" dir="ltr">
                          {done ? "✓" : (p.slot_code ?? "بلا خانة")}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  disabled={busyId === s.set_key}
                  onClick={() => doCloseSet(s.set_key, s.student_name)}
                  className="min-h-11 w-full rounded-full bg-[#1A1A1A] font-extrabold text-white transition active:scale-[.98] disabled:opacity-40"
                >
                  {busyId === s.set_key ? "..." : "إغلاق الطرد"}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ── Zone 2: وصلت توّا ────────────────────────────────────── */}
      <section className="mb-6">
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-black text-[#1A1A1A]">
            وصلت توّا — سكّنها{" "}
            <span className="text-[#F47B42]">{inbox.length}</span>
          </h2>
          {unplaceable > 0 ? (
            <p className="rounded-full bg-[#FFE4E1] px-3 py-1 text-xs font-bold text-[#9f382d]">
              {unplaceable} قطعة بلا خانة — الرف ممتلئ
            </p>
          ) : null}
        </header>

        {inbox.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[#ded6c8] bg-[#FFF8F0] px-5 py-6 text-center text-sm text-[#6b6356]">
            ما وصلت قطع جديدة.
          </p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {shownInbox.map((i) => (
                <div
                  key={i.order_id}
                  className="flex items-center gap-2 rounded-xl border border-[#ded6c8] bg-[#FFF8F0] p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-[#1A1A1A]">
                      {i.student_name}
                    </p>
                    <p className="text-xs text-[#6b6356]">{i.piece_label}</p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === i.order_id}
                    onClick={() => (i.suggestion ? doPlace(i) : setSheet(i))}
                    className={[
                      "min-h-11 flex-none rounded-xl px-3 font-mono text-sm font-black transition active:scale-95",
                      i.suggestion
                        ? "bg-[#F47B42] text-white"
                        : "border border-[#bdb3a3] bg-white text-[#6b6356]",
                    ].join(" ")}
                    dir="ltr"
                  >
                    {busyId === i.order_id ? "…" : (i.suggestion?.slot_code ?? "بلا خانة")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSheet(i)}
                    className="min-h-11 flex-none rounded-xl border border-[#ded6c8] bg-white px-2 text-xs font-bold text-[#6b6356]"
                    aria-label="تغيير الخانة"
                  >
                    تغيير
                  </button>
                </div>
              ))}
            </div>
            {inbox.length > 12 ? (
              <button
                type="button"
                onClick={() => setShowAllInbox((v) => !v)}
                className="mt-3 min-h-11 w-full rounded-full border border-[#ded6c8] bg-white text-sm font-bold text-[#6b6356]"
              >
                {showAllInbox ? "عرض أقل" : `عرض الكل (${inbox.length})`}
              </button>
            ) : null}
          </>
        )}
      </section>

      {/* ── Zone 3: الرف ─────────────────────────────────────────── */}
      <section>
        <div className="mb-3">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="دوّر على طالب داخل الرف…"
            variant="pill"
            className="w-full"
            inputClassName="min-h-12 border-[#ded6c8] bg-white px-5 text-[#1A1A1A] focus:border-[#F47B42]"
          />
        </div>
        <ShelfMap shelves={board!.shelves} search={search} onSlotClick={setOpenSlot} />
      </section>

      {/* ── جُمعت — everything taken off the shelf, grouped per student ──────── */}
      {collectedGroups.length > 0 ? (
        <section className="mt-8 border-t border-[#ded6c8] pt-6">
          <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-black text-[#1A1A1A]">
              جُمعت <span className="text-[#256347]">{board!.collected.length}</span>
            </h2>
            <p className="text-xs text-[#6b6356]">
              {collectedGroups.length} طالب · الأحدث أولاً
            </p>
          </header>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {collectedGroups.map((g) => (
              <article
                key={g.set_key}
                className="rounded-2xl border border-[#ded6c8] bg-[#FFF8F0] p-3"
              >
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h3 className="truncate text-sm font-extrabold text-[#1A1A1A]">
                    {g.student_name}
                  </h3>
                  <span
                    className={[
                      "flex-none rounded-full px-2 py-0.5 text-[10px] font-bold",
                      g.allDelivered
                        ? "bg-[#e5f0e9] text-[#256347]"
                        : "bg-[#FFDAB9] text-[#632d17]",
                    ].join(" ")}
                  >
                    {g.allDelivered ? "تم التسليم" : "جاهز للاستلام"}
                  </span>
                </div>

                <ul className="space-y-1.5">
                  {g.pieces.map((p) => (
                    <li
                      key={p.order_id}
                      className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5"
                    >
                      <span className="flex-none rounded bg-[#f2ede4] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#6b6356]" dir="ltr">
                        {p.slot_code ?? "—"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-bold text-[#1A1A1A]">
                        {p.piece_label}
                      </span>
                      <span className="flex-none text-[10px] text-[#bdb3a3]">
                        {timeAgo(p.collected_at)}
                      </span>
                      {p.can_undo ? (
                        <button
                          type="button"
                          disabled={busyId === p.order_id}
                          onClick={() => doRevert(p.order_id, p.piece_label)}
                          className="min-h-9 flex-none rounded-full border border-[#bdb3a3] bg-white px-2.5 text-[11px] font-bold text-[#6b6356] transition hover:border-[#1A1A1A] hover:text-[#1A1A1A] disabled:opacity-40"
                        >
                          {busyId === p.order_id ? "…" : "تراجع"}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {/* Slot detail */}
      {openSlot ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => setOpenSlot(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-t-3xl bg-[#FFF8F0] p-5 sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="font-mono text-3xl font-black text-[#F47B42]" dir="ltr">
                {openSlot.slot_code}
              </h3>
              <span className="text-sm text-[#6b6356]">
                {openSlot.piece_label} · {openSlot.count}
                {openSlot.max ? ` / ${openSlot.max}` : ""}
              </span>
            </div>

            {openSlot.waiting_for.length > 0 ? (
              <div className="mb-3 rounded-xl bg-[#FFDAB9] p-3 text-xs text-[#632d17]">
                <b className="block">ينتظر</b>
                {openSlot.waiting_for.join(" · ")}
              </div>
            ) : null}

            {openSlot.pieces.length === 0 ? (
              <p className="py-6 text-center text-sm text-[#6b6356]">الخانة فارغة</p>
            ) : (
              <ul className="space-y-2">
                {openSlot.pieces.map((p) => (
                  <li
                    key={p.order_id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[#ded6c8] bg-white p-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-[#1A1A1A]">
                        {p.student_name}
                      </p>
                      <p className="text-xs text-[#6b6356]">{p.piece_label}</p>
                    </div>
                    <div className="flex flex-none gap-2">
                      <button
                        type="button"
                        disabled={busyId === p.order_id}
                        onClick={async () => {
                          await doCollect(p.order_id, p.piece_label);
                          setOpenSlot(null);
                        }}
                        className="min-h-11 rounded-full bg-[#F47B42] px-4 text-sm font-bold text-white disabled:opacity-40"
                      >
                        جمعها
                      </button>
                      {/* Send back up the line — الكوي or التطريز, whichever the backend
                          says is one step back for this piece. Frees the خانة. */}
                      <button
                        type="button"
                        disabled={busyId === p.order_id}
                        onClick={async () => {
                          await doRevert(p.order_id, p.piece_label);
                          setOpenSlot(null);
                        }}
                        className="min-h-11 rounded-full border border-[#bdb3a3] bg-white px-3 text-xs font-bold text-[#6b6356] disabled:opacity-40"
                      >
                        إرجاع
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              onClick={() => setOpenSlot(null)}
              className="mt-4 min-h-11 w-full rounded-full border border-[#ded6c8] bg-white font-bold text-[#6b6356]"
            >
              إغلاق
            </button>
          </div>
        </div>
      ) : null}

      <PlaceSheet
        open={!!sheet}
        pieceLabel={sheet?.piece_label ?? ""}
        studentName={sheet?.student_name ?? ""}
        studentId={sheet?.student_id ?? null}
        pieceType={sheet?.piece_type ?? ""}
        suggestion={sheet?.suggestion ?? null}
        board={board}
        busy={busyId === sheet?.order_id}
        onConfirm={(t) => sheet && doPlace(sheet, t)}
        onSkip={() => setSheet(null)}
        onClose={() => setSheet(null)}
      />

      {toast ? (
        <div className="fixed inset-x-0 bottom-6 z-50 mx-auto w-fit rounded-full bg-[#1A1A1A] px-5 py-3 text-sm font-bold text-white shadow-xl">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
