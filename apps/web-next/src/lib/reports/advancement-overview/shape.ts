/** Snapshot from the Qlik FY Advancement Overview Results sheet. */

export type YtdRow = {
  current: number | null;
  prior: number | null;
  difference: number | null;
  pct: number | null;
};

export type OfficerRow = {
  name: string;
  amount: number | null;
  isTotal?: boolean;
};

export type PipelineRow = {
  status: string;
  amount: number | null;
  count: number | null;
};

export type AdvancementOverviewSnapshot = {
  generated_at: string;
  source: string;
  qlikAppId?: string;
  qlikSheetId?: string;
  currentFiscalYear?: number;
  fiscalYearLabel: string;
  asOf?: string;
  received: {
    endowed: number | null;
    temporaryRestricted: number | null;
    unrestricted: number | null;
    total: number | null;
  };
  released: {
    fy26: number | null;
    other: number | null;
    total: number | null;
    note?: string;
  };
  pledges: {
    multiYear: number | null;
    multiYearGoal: number;
    realizedEstate: number | null;
    realizedEstateGoal: number;
    plannedEstate: number | null;
  };
  ytd: {
    currentLabel: string;
    priorLabel: string;
    overall: YtdRow;
    mgoTeam: YtdRow;
    activeDonors: YtdRow;
  };
  officers: OfficerRow[];
  pipeline: {
    rows: PipelineRow[];
    totalAmount: number | null;
    totalCount: number | null;
  };
  cache?: string;
  error?: string;
};

export function isOverviewReady(
  data: AdvancementOverviewSnapshot | null | undefined,
): data is AdvancementOverviewSnapshot {
  return Boolean(data?.source === "qlik" && data.received && data.ytd && data.pledges);
}

export function usd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "--";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

export function count(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "--";
  return Math.round(n).toLocaleString("en-US");
}

export function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "--";
  const digits = Math.abs(n - Math.round(n)) < 0.05 ? 0 : 1;
  return `${n.toFixed(digits)}%`;
}

/** Width of a 0-100 bar; values over 100 still fill the bar. */
export function barFill(n: number | null | undefined): number {
  if (n == null || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
