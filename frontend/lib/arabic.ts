// ─────────────────────────────────────────────────────────────────────────────
// Arabic text folding for SEARCH and comparison — never for display, and never
// for what gets embroidered.
//
// Why it exists: «سجى» and «سجي» are the same name and look identical on screen, but
// they are different code points (ى U+0649 · ي U+064A). A raw `includes()` search
// therefore answers differently depending on which key the designer happened to press,
// and one of the two answers is «no results» for a student who is right there.
//
// Measured on the dev snapshot of production (2026-08-21): **318 of 1,147 student
// names (28%)** and **226 of 458 plates** carry at least one variant character
// (أ إ آ ى ة ؤ ئ or a diacritic). Every one of them was unfindable by anybody typing
// the plain spelling — «سرى رحمن» · «اية علي احمد» · «طيبة فراس» · «زبيدة أكبر».
//
// This is the exact twin of `normalizeAr` in `backend/lib/calligraphyText.js`. Keep the
// two identical: the server uses it to decide whether a line is an instruction, this
// side uses it to decide whether a line matches what the designer typed, and a designer
// searching by one rule while the server judges by another is its own bug.
// ─────────────────────────────────────────────────────────────────────────────

/** Diacritics + tatweel carry no lexical meaning in a name. */
const DIACRITICS = /[ً-ْٰـ]/g;

/** Fold the orthographic variants people actually type (أ/إ/آ→ا, ى→ي, ة→ه). */
export function normalizeAr(value: string | null | undefined): string {
  return String(value || "")
    .replace(DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ؤئ]/g, "ء");
}

/** Search key: folded, lowercased (for the Latin fields — instagram, department codes),
 *  and whitespace-collapsed so a double space between two names never hides a row. */
function key(value: string | null | undefined): string {
  return normalizeAr(value).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * «Does this haystack contain what the user typed?», spelling-insensitively.
 * The one search predicate for Arabic names — use it instead of `.includes()`.
 */
export function matchesAr(haystack: string | null | undefined, query: string): boolean {
  const q = key(query);
  if (!q) return true;
  return key(haystack).includes(q);
}
