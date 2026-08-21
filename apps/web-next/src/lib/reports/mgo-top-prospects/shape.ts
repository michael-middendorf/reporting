/** Snapshot from the mgo-top-prospects publisher. */

export type ProspectAsk = {
  id: number | null;
  amount: number;
  status: string | null;
  askDate: string | null;
  expectedFulfillmentDate: string | null;
  assignedUser: string | null;
  project: string | null;
};

export type ProspectDonor = {
  contactId: number | null;
  donorName: string | null;
  contactUrl: string | null;
  askAmount: number;
  askCount: number;
  statuses: string[];
  asks: ProspectAsk[];
};

export type ProspectPortfolio = {
  name: string;
  groupId: number | null;
  groupName: string | null;
  askAmount: number;
  askCount: number;
  donorCount: number;
  donors: ProspectDonor[];
};

export type MgoTopProspectsSnapshot = {
  generated_at: string;
  source: string;
  fiscalYear: number;
  fiscalYearLabel: string;
  fyStart: string;
  fyEnd: string;
  asOf: string;
  definition: string;
  summary: {
    askAmount: number;
    askCount: number;
    donorCount: number;
    portfolioCount: number;
    portfoliosWithAsks: number;
  };
  portfolios: ProspectPortfolio[];
  skipped?: { status: number; outsideFy: number };
  cache?: string;
  error?: string;
};

export function usd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

export function shortStatus(status: string | null | undefined): string {
  if (!status) return "—";
  return status.replace(" (MGO)", "").replace(" (Adv Svcs)", "");
}
