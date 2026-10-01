/**
 * Gift pipeline detail built from Virtuous GiftAsk rows by
 * services/publishers/advancement-overview (advancement-overview/pipeline.json).
 * Replaces the Qlik "FY27 Pipeline" sheet.
 */

export type PipelineBucketKey = "to_be_asked" | "asked" | "accepted";

export type PipelineAsk = {
  askId: number;
  askDate: string | null;
  donor: string;
  contactId: number | null;
  status: string;
  askAmount: number;
  expectedFulfillmentDate: string | null;
  assignedUser: string | null;
  reason: string | null;
  city: string | null;
  state: string | null;
  fund: string | null;
  fundClass: string | null;
};

export type PipelineBucket = {
  key: PipelineBucketKey;
  label: string;
  statuses: string[];
  totalAmount: number;
  count: number;
  rows: PipelineAsk[];
};

export type AdvancementPipelineSnapshot = {
  generated_at: string;
  source: string;
  asOf: string;
  currentFiscalYear?: number;
  fiscalYearLabel: string;
  window: { start: string; end: string };
  buckets: PipelineBucket[];
  excludedStatuses?: Record<string, number>;
  missingContacts?: number;
  error?: string;
};

export const UNASSIGNED_OFFICER = "Unassigned";
export const ALL_OFFICERS = "";

export type SortDir = "asc" | "desc";

export function isPipelineReady(
  data: AdvancementPipelineSnapshot | null | undefined,
): data is AdvancementPipelineSnapshot {
  return Boolean(
    data &&
      data.source === "virtuous" &&
      Array.isArray(data.buckets) &&
      data.buckets.length > 0 &&
      data.buckets.every((b) => Array.isArray(b.rows)),
  );
}

export function officerName(row: Pick<PipelineAsk, "assignedUser">): string {
  const name = (row.assignedUser || "").trim();
  return name || UNASSIGNED_OFFICER;
}

/** Every officer across all buckets, sorted, with "Unassigned" last. */
export function officerOptions(buckets: PipelineBucket[]): string[] {
  const names = new Set<string>();
  for (const b of buckets) for (const r of b.rows) names.add(officerName(r));
  const sorted = [...names].filter((n) => n !== UNASSIGNED_OFFICER).sort((a, b) => a.localeCompare(b));
  if (names.has(UNASSIGNED_OFFICER)) sorted.push(UNASSIGNED_OFFICER);
  return sorted;
}

export function filterByOfficer(rows: PipelineAsk[], officer: string): PipelineAsk[] {
  if (officer === ALL_OFFICERS) return rows;
  return rows.filter((r) => officerName(r) === officer);
}

/** Ask Amount sort; ties break on ask id so the order is stable. */
export function sortByAmount(rows: PipelineAsk[], dir: SortDir): PipelineAsk[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * (a.askAmount - b.askAmount) || a.askId - b.askId);
}

export function sumAmount(rows: PipelineAsk[]): number {
  return rows.reduce((acc, r) => acc + (Number.isFinite(r.askAmount) ? r.askAmount : 0), 0);
}

/** "2026-09-01" -> "9/1/2026" without timezone drift. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}

/** True when the expected date is before the snapshot's as-of day. */
export function isPastDue(row: Pick<PipelineAsk, "expectedFulfillmentDate">, asOf: string | null | undefined): boolean {
  if (!row.expectedFulfillmentDate || !asOf) return false;
  return row.expectedFulfillmentDate.slice(0, 10) < asOf.slice(0, 10);
}

/** The publisher runs every 15 minutes, so 2 hours is about 8 missed runs. */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/** True when the snapshot's UTC generated_at is older than STALE_AFTER_MS at `now` (epoch ms). */
export function isStale(generatedAt: string | null | undefined, now: number): boolean {
  if (!generatedAt) return false;
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return false;
  return now - t > STALE_AFTER_MS;
}

export function statusLabel(status: string): string {
  return status.replace(/\s*\(MGO\)\s*/g, "").replace(/\s+/g, " ").trim();
}
