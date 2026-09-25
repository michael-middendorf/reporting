/** Input validation for /aspiredu/api/students (GET query string or POST JSON body). */

const SORTS = new Set(["risk", "name"]);

export type ListInput = {
  query: string | undefined;
  minRisk: number | undefined;
  sort: "risk" | "name" | undefined;
  cursor: string | undefined;
};

function text(value: unknown, max: number): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const trimmed = String(value).trim().slice(0, max);
  return trimmed || undefined;
}

/** Validate list filters. Returns an error string for bad input. */
export function parseListInput(raw: {
  query?: unknown;
  minRisk?: unknown;
  sort?: unknown;
  cursor?: unknown;
}): ({ ok: true } & ListInput) | { ok: false; error: string } {
  let minRisk: number | undefined;
  if (raw.minRisk !== null && raw.minRisk !== undefined && String(raw.minRisk).trim() !== "") {
    const value = typeof raw.minRisk === "number" ? raw.minRisk : Number(String(raw.minRisk).trim());
    if (typeof raw.minRisk === "boolean" || !Number.isFinite(value) || value < 0 || value > 1000) {
      return { ok: false, error: "minRisk must be a number" };
    }
    minRisk = value;
  }
  let sort: "risk" | "name" | undefined;
  const rawSort = text(raw.sort, 16);
  if (rawSort !== undefined) {
    if (!SORTS.has(rawSort)) return { ok: false, error: "sort must be risk or name" };
    sort = rawSort as "risk" | "name";
  }
  return { ok: true, query: text(raw.query, 200), minRisk, sort, cursor: text(raw.cursor, 2048) };
}

/** GET form, kept for backward compatibility. */
export function parseListFilters(url: URL) {
  return parseListInput({
    query: url.searchParams.get("query"),
    minRisk: url.searchParams.get("minRisk"),
    sort: url.searchParams.get("sort"),
    cursor: url.searchParams.get("cursor"),
  });
}
