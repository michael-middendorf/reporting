export type RiskHistogramBin = {
  label: string;
  min: number;
  max: number;
  count: number;
};

export type RiskHistogram = {
  bins: RiskHistogramBin[];
  atZero: number;
  aboveZero: number;
  total: number;
};

const RISK_BIN_DEFS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  { label: "0", min: 0, max: 0 },
  { label: "1–9", min: 1, max: 9 },
  { label: "10–19", min: 10, max: 19 },
  { label: "20–29", min: 20, max: 29 },
  { label: "30–39", min: 30, max: 39 },
  { label: "40–49", min: 40, max: 49 },
  { label: "50–59", min: 50, max: 59 },
  { label: "60–69", min: 60, max: 69 },
  { label: "70–79", min: 70, max: 79 },
  { label: "80–89", min: 80, max: 89 },
  { label: "90–99", min: 90, max: 99 },
  { label: "100", min: 100, max: 100 },
];

function emptyHistogram(): RiskHistogram {
  return {
    bins: RISK_BIN_DEFS.map((bin) => ({ ...bin, count: 0 })),
    atZero: 0,
    aboveZero: 0,
    total: 0,
  };
}

/**
 * Bin Dropout Detective overall risk into a stable 0 / 1–9 / decade / 100 scale.
 * Scores outside 0–100 are ignored (the parser may emit up to 1000).
 */
export function riskHistogramBuckets(
  scores: Record<string, number> | null | undefined,
): RiskHistogram {
  const histogram = emptyHistogram();
  if (!scores) return histogram;

  for (const [key, value] of Object.entries(scores)) {
    const score = Number(key);
    if (!Number.isInteger(score) || score < 0 || score > 100) continue;
    const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) continue;
    const bin = histogram.bins.find((item) => score >= item.min && score <= item.max);
    if (bin) bin.count += n;
  }

  histogram.atZero = histogram.bins[0]?.count ?? 0;
  histogram.total = histogram.bins.reduce((sum, bin) => sum + bin.count, 0);
  histogram.aboveZero = histogram.total - histogram.atZero;
  return histogram;
}

/** Rounded percent of `total`. Returns 0 when total is not a positive finite number. */
export function riskHistogramPercent(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((part / total) * 100);
}
