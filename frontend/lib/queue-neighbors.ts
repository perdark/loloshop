/**
 * «السابق» / «التالي» between order pages (bug 8, part 3).
 *
 * A worker going through the queue opened a piece, dealt with it, went back to the list,
 * found their place again, and opened the next one — once per piece, on a queue that runs to
 * hundreds of rows. The order page has no idea a list exists, so the neighbours are handed
 * to it the same way the console already hands itself its filters: through sessionStorage.
 *
 * The stored list is the FILTERED order, not the visible page, so stepping past the bottom
 * of page 1 continues into page 2 instead of dead-ending.
 *
 * Deliberately best-effort. The list can be stale — a piece may have advanced out of the
 * filter, or the worker may have opened the order from a link with no list behind it at all.
 * Every function here answers "I don't know" rather than guessing, and the caller hides the
 * controls; a wrong «التالي» would send someone to a piece that is not theirs to work on.
 */

const KEY = "loloshop-console:queue-order";

/** Remember the ids the console is currently showing, in the order it shows them. */
export function rememberQueueOrder(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* private mode / quota — the feature degrades to "no neighbours", which is the old behaviour */
  }
}

export interface QueueNeighbors {
  prev: string | null;
  next: string | null;
  /** 1-based position, for «٣ من ١٢٠». */
  position: number;
  total: number;
}

/**
 * Where does this order sit in the list the console last showed?
 * Returns null when there is no list, or when this order is not in it.
 */
export function queueNeighbors(orderId: string): QueueNeighbors | null {
  if (typeof window === "undefined") return null;
  let ids: unknown;
  try {
    ids = JSON.parse(sessionStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
  if (!Array.isArray(ids)) return null;
  const list = ids.filter((v): v is string => typeof v === "string");
  const i = list.indexOf(orderId);
  if (i === -1) return null;
  return {
    prev: i > 0 ? list[i - 1] : null,
    next: i < list.length - 1 ? list[i + 1] : null,
    position: i + 1,
    total: list.length,
  };
}
