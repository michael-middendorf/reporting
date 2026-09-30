/** Snapshot built from Virtuous by services/publishers/advancement-overview. */

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

export type UnassignedFund = {
  fundId: string | null;
  description: string;
  amount: number;
};

export type ConflictingFund = {
  fundId: string;
  description: string;
  statuses: string[];
  used: string;
};

export type AdvancementOverviewSnapshot = {
  generated_at: string;
  source: string;
  currentFiscalYear?: number;
  fiscalYearLabel: string;
  asOf?: string;
  received: {
    endowed: number | null;
    temporaryRestricted: number | null;
    unrestricted: number | null;
    /** Gifts to funds missing from the fund classification table (or no designation). */
    unassigned?: number | null;
    total: number | null;
    unassignedFunds?: UnassignedFund[];
    method?: string;
    giftCount?: number;
    splitGiftCount?: number;
    undesignatedGiftCount?: number;
  };
  conflictingFunds?: ConflictingFund[];
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
  // "qlik" is accepted only for the rollout window: deploy.yml ships the web
  // (cdk deploy AmuReportingEcs) before the Lambda (sst deploy), so the first
  // requests still see the cached Qlik snapshot. Remove the "qlik" branch
  // after the first Virtuous publish lands in advancement-overview/latest.json.
  const source = data?.source;
  return Boolean(
    (source === "virtuous" || source === "qlik") && data?.received && data.ytd && data.pledges,
  );
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

/** Snapshot timestamps are UTC. Show them in Naples / Eastern time. */
export function formatEastern(iso: string | null | undefined): string {
  if (!iso) return "";
  const day = new Date(iso);
  if (Number.isNaN(day.getTime())) return iso;
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(day);
  return `${text} ET`;
}
