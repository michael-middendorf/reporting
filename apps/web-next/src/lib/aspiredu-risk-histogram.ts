export type RiskHistogramBucket = {
  score: number;
  count: number;
};

/**
 * Integer Dropout Detective overall-risk axis from 0 through the highest
 * present score. Missing integers are filled with count 0 so gaps stay visible.
 */
export function riskHistogramBuckets(
  scores: Record<string, number> | null | undefined,
): RiskHistogramBucket[] {
  if (!scores) return [];

  const counts = new Map<number, number>();
  for (const [key, value] of Object.entries(scores)) {
    const score = Number(key);
    if (!Number.isInteger(score) || score < 0) continue;
    const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
    counts.set(score, (counts.get(score) ?? 0) + (Number.isFinite(n) ? n : 0));
  }

  if (counts.size === 0) return [];

  const max = Math.max(...counts.keys());
  const buckets: RiskHistogramBucket[] = [];
  for (let score = 0; score <= max; score += 1) {
    buckets.push({ score, count: counts.get(score) ?? 0 });
  }
  return buckets;
}

/** Compact non-zero totals for Academic Affairs, e.g. `0: 4,264 · 1: 373`. */
export function riskHistogramNonZeroSummary(buckets: RiskHistogramBucket[]): string {
  return buckets
    .filter((bucket) => bucket.count > 0)
    .map((bucket) => `${bucket.score}: ${bucket.count.toLocaleString()}`)
    .join(" · ");
}
