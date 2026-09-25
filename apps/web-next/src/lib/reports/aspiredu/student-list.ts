/** Query-string validation for GET /aspiredu/api/students. */

const SORTS = new Set(["risk", "name"]);

/** Parse ?minRisk= and ?sort=. Returns an error string for bad input. */
export function parseListFilters(url: URL):
  | { ok: true; minRisk: number | undefined; sort: "risk" | "name" | undefined }
  | { ok: false; error: string } {
  const rawRisk = url.searchParams.get("minRisk");
  let minRisk: number | undefined;
  if (rawRisk !== null && rawRisk.trim() !== "") {
    const value = Number(rawRisk.trim());
    if (!Number.isFinite(value) || value < 0 || value > 1000) {
      return { ok: false, error: "minRisk must be a number" };
    }
    minRisk = value;
  }
  const rawSort = url.searchParams.get("sort");
  let sort: "risk" | "name" | undefined;
  if (rawSort !== null && rawSort.trim() !== "") {
    if (!SORTS.has(rawSort.trim())) return { ok: false, error: "sort must be risk or name" };
    sort = rawSort.trim() as "risk" | "name";
  }
  return { ok: true, minRisk, sort };
}
