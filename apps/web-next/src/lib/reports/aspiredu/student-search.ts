/**
 * Pure search-state rules for the Academic Affairs student list page.
 * The Lambda cursor is an offset into ONE result set, so "Load more" must reuse
 * the params of the page that produced the cursor, never the live input box.
 */

export type SearchParams = { query: string; minRisk: number | null };

export const MIN_QUERY_CHARS = 2;

/** True when the box holds a query too short to auto-search (1 character). */
export function queryTooShort(query: string): boolean {
  const length = query.trim().length;
  return length > 0 && length < MIN_QUERY_CHARS;
}

/**
 * What the debounced auto-search should load for the current inputs, or null
 * to skip. A 1-character query never searches on its own, but a risk filter
 * change still reloads, keeping the last committed query.
 */
export function autoSearchParams(input: SearchParams, committed: SearchParams | null): SearchParams | null {
  const query = input.query.trim();
  if (!queryTooShort(query)) return { query, minRisk: input.minRisk };
  if (committed && committed.minRisk === input.minRisk) return null;
  return { query: committed?.query ?? "", minRisk: input.minRisk };
}

/** "Load more" params: the committed first-page params plus its cursor. */
export function loadMoreParams(
  committed: SearchParams | null,
  cursor: string | null,
): (SearchParams & { cursor: string }) | null {
  if (!committed || !cursor) return null;
  return { query: committed.query, minRisk: committed.minRisk, cursor };
}
