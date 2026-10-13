/**
 * Chancellor's Gala report (DST-3095). Pure shaping for the page: the payload
 * is the giving admin feed (schemaVersion 1) published by the GalaReportData
 * publisher, plus `publishedAt`. History is gala/snapshots/index.json.
 */

export type GalaCategoryKey =
  | "sponsorship"
  | "underwriting"
  | "tickets"
  | "match"
  | "paddleRaise"
  | "otherGifts";

export type GalaCategory = {
  actual: number;
  commitment: number;
  actualPlusCommitment: number;
  giftCount: number;
  askCount: number;
};

export type GalaExpenseCategory = {
  category?: string;
  name?: string;
  budgeted?: number;
  budget?: number;
  committed?: number;
  paid?: number;
};

export type GalaQualityItem = {
  code: string;
  message: string;
  count?: number;
  amount?: number;
};

export type GalaPayload = {
  schemaVersion: 1;
  asOf: string;
  publishedAt?: string;
  event: { key: string; segmentCode: string; eventDate: string };
  categories: Record<GalaCategoryKey, GalaCategory>;
  gross: { actual: number; actualPlusCommitment: number };
  expenses: {
    committed: number;
    paid: number;
    lineCount: number;
    byCategory: GalaExpenseCategory[];
  };
  netAfterExpenses: { actual: number; actualPlusCommitment: number };
  seats: { sold: number; comp: number; reserved: number };
  dataQuality: GalaQualityItem[];
};

/** One row per Eastern day, written by the publisher (last snapshot of the day). */
export type GalaHistoryRow = {
  date: string;
  gross: { actual: number; actualPlusCommitment: number };
  expenses: { committed: number };
  netAfterExpenses: { actual: number; actualPlusCommitment: number };
};

export type GalaResponse = { latest: GalaPayload; history: GalaHistoryRow[] };

export type TableRowKind = "category" | "gross" | "expenses" | "net";

export type TableRow = {
  key: string;
  label: string;
  kind: TableRowKind;
  amount: number;
  /** Change since the previous history day. Only the three total rows have one. */
  delta: number | null;
};

export type GalaTable = { title: string; rows: TableRow[] };

export const CATEGORY_ROWS: { key: GalaCategoryKey; label: string }[] = [
  { key: "sponsorship", label: "Total Sponsorship" },
  { key: "underwriting", label: "Total Underwriting" },
  { key: "tickets", label: "Total Tickets" },
  { key: "match", label: "Match" },
  { key: "paddleRaise", label: "Paddle Raise" },
  { key: "otherGifts", label: "Other Gala Gifts" },
];

export const SEATS_NOTE = "Comp and reserved seats are not counted as revenue";

export const METHODOLOGY =
  "Actual is money received (paid gifts and online payments, refunds excluded; ACH still processing is included and flagged). Commitment is accepted or pending gift asks recorded in the donor system, minus gifts already received against them. Net subtracts committed expenses entered in the giving admin.";

const EASTERN = "America/New_York";

/** Eastern calendar day (YYYY-MM-DD) of an ISO timestamp, or "" when unparseable. */
export function easternDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: EASTERN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "Oct 13, 2026, 8:00 AM" in Eastern time. */
export function formatEasternStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/** Whole dollars without cents; cents only when the amount has them. Negatives use a leading minus. */
export function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  const rounded = Math.round(n * 100) / 100;
  const whole = Number.isInteger(rounded);
  const text = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(Math.abs(rounded));
  return `${rounded < 0 ? "-" : ""}$${text}`;
}

/** "+$1,200", "-$300", or "No change". Empty string for null. */
export function formatDelta(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "";
  const rounded = Math.round(n * 100) / 100;
  if (rounded === 0) return "No change";
  return `${rounded > 0 ? "+" : "-"}${formatMoney(Math.abs(rounded))}`;
}

/**
 * The history row to compare against: the latest row dated before the payload's
 * Eastern day. Null when there is none.
 */
export function previousDay(history: GalaHistoryRow[], asOf: string): GalaHistoryRow | null {
  const today = easternDate(asOf);
  if (!today) return null;
  let best: GalaHistoryRow | null = null;
  for (const row of history) {
    if (row.date < today && (!best || row.date > best.date)) best = row;
  }
  return best;
}

function diff(now: number, then: number | undefined): number | null {
  if (then === undefined || !Number.isFinite(then)) return null;
  return Math.round((now - then) * 100) / 100;
}

type Basis = "actualPlusCommitment" | "actual";

function buildTable(title: string, basis: Basis, p: GalaPayload, prev: GalaHistoryRow | null): GalaTable {
  const rows: TableRow[] = CATEGORY_ROWS.map(({ key, label }) => ({
    key,
    label,
    kind: "category",
    amount: p.categories[key][basis],
    delta: null,
  }));
  rows.push(
    {
      key: "gross",
      label: "TOTAL GROSS",
      kind: "gross",
      amount: p.gross[basis],
      delta: diff(p.gross[basis], prev?.gross[basis]),
    },
    {
      key: "expenses",
      label: "EXPENSES",
      kind: "expenses",
      amount: p.expenses.committed,
      delta: diff(p.expenses.committed, prev?.expenses.committed),
    },
    {
      key: "net",
      label: "TOTAL NET",
      kind: "net",
      amount: p.netAfterExpenses[basis],
      delta: diff(p.netAfterExpenses[basis], prev?.netAfterExpenses[basis]),
    },
  );
  return { title, rows };
}

/** Table A (actual + commitment) and Table B (actual received), as in Advancement's email. */
export function buildTables(
  p: GalaPayload,
  history: GalaHistoryRow[] = [],
): { combined: GalaTable; actual: GalaTable; previousDate: string | null } {
  const prev = previousDay(history, p.asOf);
  return {
    combined: buildTable("Actual + Commitment", "actualPlusCommitment", p, prev),
    actual: buildTable("Actual (received)", "actual", p, prev),
    previousDate: prev?.date ?? null,
  };
}

export type Kpi = { label: string; value: number; delta: number | null };

export function buildKpis(p: GalaPayload, history: GalaHistoryRow[] = []): Kpi[] {
  const prev = previousDay(history, p.asOf);
  return [
    {
      label: "Gross (actual + commitment)",
      value: p.gross.actualPlusCommitment,
      delta: diff(p.gross.actualPlusCommitment, prev?.gross.actualPlusCommitment),
    },
    { label: "Gross (actual)", value: p.gross.actual, delta: diff(p.gross.actual, prev?.gross.actual) },
    {
      label: "Expenses (committed)",
      value: p.expenses.committed,
      delta: diff(p.expenses.committed, prev?.expenses.committed),
    },
    {
      label: "Net (actual + commitment)",
      value: p.netAfterExpenses.actualPlusCommitment,
      delta: diff(p.netAfterExpenses.actualPlusCommitment, prev?.netAfterExpenses.actualPlusCommitment),
    },
  ];
}

export type ExpenseLine = { category: string; budgeted: number | null; committed: number; paid: number };

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Expense lines by category; empty when none have been entered. Tolerates name/budget key variants. */
export function expenseLines(p: GalaPayload): ExpenseLine[] {
  if (!(p.expenses.byCategory ?? []).length) return [];
  return (p.expenses.byCategory ?? []).map((c) => ({
    category: String(c.category ?? c.name ?? "Uncategorized"),
    budgeted: numOrNull(c.budgeted ?? c.budget),
    committed: numOrNull(c.committed) ?? 0,
    paid: numOrNull(c.paid) ?? 0,
  }));
}

export const NO_EXPENSES_TEXT = "Expenses not yet entered in the giving admin";

export type TrendSeriesKey = "grossAC" | "grossActual" | "netAC";

export const TREND_SERIES: { key: TrendSeriesKey; label: string }[] = [
  { key: "grossAC", label: "Gross (actual + commitment)" },
  { key: "grossActual", label: "Gross (actual)" },
  { key: "netAC", label: "Net (actual + commitment)" },
];

export type TrendPoint = { date: string; grossAC: number; grossActual: number; netAC: number };

/** History sorted by date, one point per day. */
export function trendPoints(history: GalaHistoryRow[]): TrendPoint[] {
  const byDate = new Map<string, GalaHistoryRow>();
  for (const r of history) byDate.set(r.date, r);
  return [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((r) => ({
      date: r.date,
      grossAC: r.gross.actualPlusCommitment,
      grossActual: r.gross.actual,
      netAC: r.netAfterExpenses.actualPlusCommitment,
    }));
}

/** Round an axis maximum up to a tidy step (1, 2, 2.5, 5 times a power of ten). */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (value <= m * pow) return m * pow;
  }
  return 10 * pow;
}

/** "$1.2M", "$250K", "$900". Axis labels only. */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${trim(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}$${trim(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function trim(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/** "10/13" from YYYY-MM-DD. */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : date;
}
