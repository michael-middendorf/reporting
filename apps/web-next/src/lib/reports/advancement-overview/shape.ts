/** Snapshot from the advancement-overview publisher. */

export type MoneyKpi = {
  label: string;
  amount: number;
  goal: number;
  pctOfGoal: number | null;
};

export type CountKpi = {
  label: string;
  count: number;
  goal: number;
  realizedBequests?: number;
  bequestIntentions?: number;
};

export type YtdRow = {
  current: number;
  prior: number;
  difference: number;
  pct: number | null;
};

export type OfficerRow = {
  name: string;
  solicitor: string;
  goal: number;
  received: number;
  pctToGoal: number | null;
};

export type PipelineRow = {
  status: string;
  amount: number;
  count: number;
};

export type AdvancementYearSnapshot = {
  fiscalYear: number;
  fiscalYearLabel: string;
  gaugeLabel?: string;
  fyStart?: string;
  fyEnd?: string;
  asOf: string;
  kpis: {
    totalFundraising: MoneyKpi;
    unrestricted: MoneyKpi;
    multiYearPledges: CountKpi;
    estateGifts: CountKpi;
  };
  ytd: {
    overall: YtdRow;
    mgoTeam: YtdRow;
    currentYear?: number;
    priorYear?: number;
  };
  officers: OfficerRow[];
  pipeline: {
    rows: PipelineRow[];
    totalAmount: number;
    totalCount: number;
  };
};

export type AdvancementOverviewSnapshot = {
  generated_at: string;
  source: string;
  currentFiscalYear?: number;
  fiscalYearLabel: string;
  gaugeLabel?: string;
  asOf: string;
  kpis: AdvancementYearSnapshot["kpis"];
  ytd: AdvancementYearSnapshot["ytd"];
  officers: OfficerRow[];
  pipeline: AdvancementYearSnapshot["pipeline"];
  fiscalYears?: AdvancementYearSnapshot[];
  cache?: string;
  error?: string;
};

export function hasFiscalYears(
  data: AdvancementOverviewSnapshot | null | undefined,
): data is AdvancementOverviewSnapshot & { fiscalYears: AdvancementYearSnapshot[] } {
  return Array.isArray(data?.fiscalYears) && (data?.fiscalYears.length ?? 0) >= 2;
}

export function gaugeCopy(year: {
  fiscalYearLabel: string;
  gaugeLabel?: string;
}): string {
  if (year.gaugeLabel) return year.gaugeLabel;
  const match = year.fiscalYearLabel.match(/FY\s+(\d{2})(\d{2})-(\d{2})/i);
  if (match) return `of ${match[2]}/${match[3]} FY`;
  return "of FY";
}

export function pickYear(
  data: AdvancementOverviewSnapshot | null,
  requestedFy: number | null,
): AdvancementYearSnapshot | null {
  if (!data?.kpis) return null;
  const years = data.fiscalYears ?? [];
  const fallback: AdvancementYearSnapshot = {
    fiscalYear: data.currentFiscalYear ?? years[0]?.fiscalYear ?? 0,
    fiscalYearLabel: data.fiscalYearLabel,
    gaugeLabel: data.gaugeLabel,
    asOf: data.asOf,
    kpis: data.kpis,
    ytd: data.ytd,
    officers: data.officers,
    pipeline: data.pipeline,
  };
  if (years.length === 0) return fallback;
  const currentFy = data.currentFiscalYear ?? years[0].fiscalYear;
  const fy =
    requestedFy != null && years.some((year) => year.fiscalYear === requestedFy)
      ? requestedFy
      : currentFy;
  return years.find((year) => year.fiscalYear === fy) ?? fallback;
}

export function usd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

/** Width of a 0–100 bar; values over 100 still fill the bar. */
export function barFill(n: number | null | undefined): number {
  if (n == null || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
