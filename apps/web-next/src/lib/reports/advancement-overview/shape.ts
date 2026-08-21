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

export type AdvancementOverviewSnapshot = {
  generated_at: string;
  source: string;
  fiscalYearLabel: string;
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
  cache?: string;
  error?: string;
};

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
