/**
 * ONE definition of what the production console's search box matches (bug 8, part 2).
 *
 * Two screens ask this question — `/staff/queue` and المجهز's PrepConsole — and before this
 * they answered it differently: the queue matched student/university/department/rep, the prep
 * console matched the student name alone, and NEITHER matched the التطريز text. A preparer
 * holding a sash searches for what is written ON it. Both now call this.
 *
 * Pure, data-only, no React — so it stays testable and cannot pull a component into the
 * dependency graph of the other.
 */
import type { ProductionQueueItem } from "./staff-types";

/**
 * Fold the Arabic spelling variants that a workshop keyboard produces into one form.
 *
 * This is not cosmetic. Iraqi student names are entered by three different people (the
 * student, the rep, the shop) and «أحمد» / «احمد» / «اَحمد» are the same name to everyone
 * except `String.includes`. A search box that misses the row the worker is holding is worse
 * than no search box, because it reads as "this piece is not in the system".
 *
 * Folds: tashkeel + tatweel are dropped · آأإٱ → ا · ى → ي · ة → ه · runs of whitespace
 * collapse. Latin text is lowercased and otherwise untouched.
 */
export function normalizeArabic(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

/** The fields a worker could reasonably be searching by, as one normalised haystack. */
function haystack(item: ProductionQueueItem): string {
  return normalizeArabic(
    [
      item.student_name,
      item.university_name,
      item.department,
      item.wholesaler_name,
      // What the student typed on the piece — above all the التطريز text. The half that was
      // missing, and the one a worker holding the garment reaches for first.
      item.search_text,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

/**
 * Does this queue row match the typed query?
 *
 * EVERY whitespace-separated token must appear somewhere in the row, in any order and in any
 * field: «احمد طب» finds Ahmed in the medicine faculty. Order-sensitive matching would fail
 * the most natural way to narrow a 480-row queue — name plus one distinguishing word.
 *
 * An empty query matches everything, so callers can pass the raw input straight through.
 */
export function matchesQueueSearch(item: ProductionQueueItem, query: string): boolean {
  const tokens = normalizeArabic(query).split(" ").filter(Boolean);
  if (!tokens.length) return true;
  const hay = haystack(item);
  return tokens.every((t) => hay.includes(t));
}
