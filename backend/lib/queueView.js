'use strict';
// «خط الإنتاج» (/staff/queue) as ONE PAGE + the numbers around it, computed here.
//
// WHY THIS EXISTS (measured 2026-10-16 on a restore of prod): GET /production/queue sends the
// whole line — 8,536 rows, 8.4 MB raw / ~900 KB gzip — and /staff/queue re-downloaded it every
// 15 s per open tab, only to show 30 rows. Every filter, count and page was computed in the
// browser, which is the only reason the browser needed every row. The SQL is ~120 ms; the rest
// of a 1.4 s prod response was Node serialising 8 MB, and while it did that every other staff
// request waited behind it (single process — `/auth/me` went 2 ms → 400–700 ms under six
// concurrent loads).
//
// This module answers the page's questions from the rows the existing query already returns:
// the 30 visible rows, plus every count the page shows (stage rail, KPI strip, source tabs,
// rep cards, garment chips). Same rows, same rules — moved, not reinvented — so the numbers
// cannot change meaning. The page then refreshes on SSE events instead of a timer.
//
// ⚠️ `normalizeArabic` / `matchesQueueSearch` MIRROR frontend/lib/queue-search.ts on purpose:
// the prep console still searches client-side with that file, and the two screens must keep
// agreeing on what "search" means (bug 8 part 2). Change one, change the other.

const PER_PAGE = 30;
/** How many pages either side of the current one carry their ids for «السابق»/«التالي». */
const ID_WINDOW_PAGES = 2;

const POST_DESIGN_STAGES = new Set(['embroidery', 'assembly', 'pressing', 'preparing', 'ready']);

function normalizeArabic(value) {
  return String(value)
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchTokens(query) {
  return normalizeArabic(query || '').split(' ').filter(Boolean);
}

function matchesQueueSearch(row, tokens) {
  if (!tokens.length) return true;
  const hay = normalizeArabic(
    [row.student_name, row.product_name, row.university_name, row.department, row.wholesaler_name, row.search_text]
      .filter(Boolean)
      .join(' ')
  );
  return tokens.every((t) => hay.includes(t));
}

function isOverdue(row, now) {
  if (!row.deadline || row.status === 'delivered') return false;
  return new Date(row.deadline).getTime() < now;
}

function isMissingDesign(row) {
  if (!POST_DESIGN_STAGES.has(row.status)) return false;
  if (!row.has_embroidery && !row.design_id) return false;
  return !row.final_design_url && !row.has_design_images;
}

function repKey(row) {
  return row.wholesaler_name ?? '—';
}

/**
 * @param {object[]} rows   every row getQueue would have sent (already role-stripped)
 * @param {object}   f      { stage, source, rep, batch, garment, q, page }
 */
function buildQueueView(rows, f = {}) {
  const now = Date.now();
  const stage = f.stage || null;
  const source = f.source === 'retail' || f.source === 'wholesaler' ? f.source : null;
  const rep = source === 'wholesaler' && f.rep != null && f.rep !== '' ? String(f.rep) : null;
  const batch = rep && f.batch ? String(f.batch) : null;
  const garment = f.garment || null;
  const tokens = searchTokens(f.q);

  // ── Whole-line numbers (what the stage rail + KPI strip show) ─────────────────────
  const stageStats = {};
  const kpi = { in_production: 0, ready: 0, delivered: 0, overdue: 0, missing: 0 };
  for (const r of rows) {
    const s = (stageStats[r.status] ||= { count: 0, overdue: 0, missing: 0 });
    const od = isOverdue(r, now);
    const md = isMissingDesign(r);
    s.count++;
    if (od) { s.overdue++; kpi.overdue++; }
    if (md) { s.missing++; kpi.missing++; }
    if (r.status === 'ready') kpi.ready++;
    else if (r.status === 'delivered') kpi.delivered++;
    else kpi.in_production++;
  }

  // ── Source tabs count the chosen stage only ───────────────────────────────────────
  const sourceCounts = { all: 0, retail: 0, wholesaler: 0 };
  for (const r of rows) {
    if (stage && r.status !== stage) continue;
    sourceCounts.all++;
    if (r.source === 'retail') sourceCounts.retail++;
    else if (r.source === 'wholesaler') sourceCounts.wholesaler++;
  }

  // ── Rep cards: every wholesaler row on the line, all stages ──────────────────────
  const repMap = new Map();
  for (const r of rows) {
    if (r.source !== 'wholesaler') continue;
    const k = repKey(r);
    let c = repMap.get(k);
    if (!c) repMap.set(k, (c = { name: k, batches: new Set(), orderCount: 0, readyCount: 0 }));
    if (r.batch_name) c.batches.add(r.batch_name);
    c.orderCount++;
    if (r.status === 'ready') c.readyCount++;
  }
  const reps = [...repMap.values()].map((c) => ({ ...c, batches: [...c.batches] }));
  const repCard = rep ? repMap.get(rep) : null;

  // ── The list: everything except the garment chip, then the chip ───────────────────
  const beforeGarment = rows.filter((r) => {
    if (stage && r.status !== stage) return false;
    if (!stage && r.status === 'delivered') return false; // «الكل» = still in production
    if (source && r.source !== source) return false;
    if (rep) {
      if (repKey(r) !== rep) return false;
      if (batch && r.batch_name !== batch) return false;
    }
    return matchesQueueSearch(r, tokens);
  });
  const garments = {};
  for (const r of beforeGarment) if (r.product_type) garments[r.product_type] = (garments[r.product_type] || 0) + 1;
  const filtered = garment ? beforeGarment.filter((r) => r.product_type === garment) : beforeGarment;

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  let page = parseInt(f.page, 10);
  if (!Number.isFinite(page) || page < 1 || page > totalPages) page = 1;
  const start = (page - 1) * PER_PAGE;
  const winStart = Math.max(0, start - ID_WINDOW_PAGES * PER_PAGE);
  const winEnd = Math.min(total, start + (ID_WINDOW_PAGES + 1) * PER_PAGE);

  return {
    data: filtered.slice(start, start + PER_PAGE),
    total,
    page,
    per_page: PER_PAGE,
    stage_stats: stageStats,
    kpi,
    source_counts: sourceCounts,
    reps,
    rep_exists: rep ? !!repCard : null,
    rep_batches: repCard ? [...repCard.batches] : [],
    garments,
    // The filtered list's ids around this page, for the order page's «السابق»/«التالي».
    // A window, not the whole list: 8k ids is ~300 KB, which is the payload we just removed.
    ids_window: filtered.slice(winStart, winEnd).map((r) => r.id),
    ids_offset: winStart,
  };
}

module.exports = { buildQueueView, normalizeArabic, matchesQueueSearch, searchTokens, PER_PAGE };
