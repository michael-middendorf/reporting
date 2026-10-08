/**
 * Shapes for the Cybersecurity board space (reporting.avemaria.edu/cybersecurity).
 *
 * The publisher (PR 2+) writes DATA_BUCKET/cybersecurity/latest.json as a
 * CyberSnapshot. Counts and statuses only: no names, no emails, no host IPs,
 * no secret values. Manual KPIs (training, tabletop, GLBA items) live in the
 * DynamoDB register instead (see register.ts) and are merged on the page.
 *
 * Safe to import from client and server code.
 */

export const CYBER_SECTIONS = [
  "overview",
  "identity",
  "endpoints",
  "cloud",
  "resilience",
  "program",
] as const;

export type CyberSection = (typeof CYBER_SECTIONS)[number];

export const SECTION_LABELS: Record<CyberSection, string> = {
  overview: "Overview",
  identity: "Identity and access",
  endpoints: "Endpoint and email",
  cloud: "Cloud and applications",
  resilience: "Data protection and resilience",
  program: "Program and compliance",
};

export const RAGS = ["red", "amber", "green", "grey"] as const;
export type Rag = (typeof RAGS)[number];

/**
 * ok: measured. not_licensed: the tenant license does not expose this (shown
 * instead of a fake zero). stale: source older than its freshness window.
 * missing: source did not report this run.
 */
export type KpiStatus = "ok" | "not_licensed" | "stale" | "missing";

export type CyberKpi = {
  id: string;
  label: string;
  section: CyberSection;
  /** Shown on the Overview board scorecard (10 headline KPIs). */
  headline?: boolean;
  value: number | string | null;
  unit?: string;
  /** Human-readable target, e.g. "<= 5" or ">= 98%". Set with Keith. */
  target?: string | null;
  rag?: Rag | null;
  /** Change since last month, in the KPI's unit. */
  delta?: number | null;
  /** True when a lower number is better (drives the delta arrow colour). */
  lowerIsBetter?: boolean;
  /** Where the number comes from, e.g. "Security Hub FSBP", "AD LDAP", "Manual". */
  source: string;
  /** ISO timestamp of the source reading (freshness). */
  asOf?: string | null;
  status?: KpiStatus;
  note?: string | null;
};

export type CyberSnapshot = {
  generatedAt: string;
  kpis: CyberKpi[];
  /** Short "what changed since the last meeting" lines for the Overview. */
  changes?: string[];
};

/** What /api/cybersecurity-data returns on 200. */
export type CyberDataResponse = {
  snapshot: CyberSnapshot;
  /** Dates (YYYY-MM-DD) of cybersecurity/history/*.json snapshots, newest first. */
  history: string[];
};

export function kpisForSection(snapshot: CyberSnapshot | null, section: CyberSection): CyberKpi[] {
  if (!snapshot) return [];
  if (section === "overview") return snapshot.kpis.filter((k) => k.headline);
  return snapshot.kpis.filter((k) => k.section === section);
}

/** Minimal runtime check so a malformed object never renders as data. */
export function isCyberSnapshot(value: unknown): value is CyberSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.generatedAt === "string" && Array.isArray(v.kpis);
}

/**
 * Unit-aware KPI value and delta formatting, shared by every KPI tile.
 *
 * Known units ("percent", "count", "boolean", "days") each get a specific,
 * display-ready shape; anything else falls back to "value unit" so a typo'd
 * or free-text unit (manual KPIs let a person type anything) still reads
 * sensibly instead of disappearing.
 */
const CYBER_NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const CYBER_COUNT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function isTruthyBoolean(value: number | string | boolean | null | undefined): boolean | null {
  if (value === 1 || value === true || value === "1" || value === "true") return true;
  if (value === 0 || value === false || value === "0" || value === "false") return false;
  return null;
}

/** Formats a KPI's current value for display, e.g. "92.3%", "1,234", "Yes", "12 days". */
export function formatUnitValue(
  value: number | string | boolean | null | undefined,
  unit: string | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "n/a";
  if (unit === "boolean") {
    const b = isTruthyBoolean(value);
    if (b !== null) return b ? "Yes" : "No";
    return String(value);
  }
  if (typeof value !== "number") return String(value);
  switch (unit) {
    case "percent":
      return `${CYBER_NUMBER.format(value)}%`;
    case "count":
      return CYBER_COUNT.format(value);
    case "days":
      return `${CYBER_NUMBER.format(value)} day${Math.abs(value) === 1 ? "" : "s"}`;
    default:
      return unit ? `${CYBER_NUMBER.format(value)} ${unit}` : CYBER_NUMBER.format(value);
  }
}

/** Formats a delta's magnitude (always non-negative; the caller supplies the ▲/▼). */
export function formatDeltaMagnitude(delta: number, unit: string | null | undefined): string {
  const abs = Math.abs(delta);
  switch (unit) {
    case "percent":
      return `${CYBER_NUMBER.format(abs)} pts`;
    case "count":
    case "boolean":
      return CYBER_COUNT.format(abs);
    case "days":
      return `${CYBER_NUMBER.format(abs)} day${abs === 1 ? "" : "s"}`;
    default:
      return unit ? `${CYBER_NUMBER.format(abs)} ${unit}` : CYBER_NUMBER.format(abs);
  }
}

const HISTORY_KEY_RE = /^cybersecurity\/history\/(\d{4}-\d{2}-\d{2})\.json$/;

/** Dates from S3 keys under cybersecurity/history/, newest first. */
export function historyDatesFromKeys(keys: readonly string[]): string[] {
  const dates: string[] = [];
  for (const key of keys) {
    const m = HISTORY_KEY_RE.exec(key);
    if (m?.[1]) dates.push(m[1]);
  }
  return dates.sort().reverse();
}
