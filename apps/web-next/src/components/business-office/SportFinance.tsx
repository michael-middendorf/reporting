"use client";

import Link from "next/link";
import { useSportFetch } from "@/components/athletics/useSportFetch";
import { formatMoney } from "@/components/athletics/CoachingHub";
import type {
  AccountLine,
  AthleticsBalancesResponse,
  FinanceSummary,
} from "@/lib/reports/business-office/athletics-finance";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fyLabel(fy: number): string {
  return `FY ${fy - 1}-${String(fy).slice(-2)}`;
}

function monthLabel(end: string, period: number): string {
  const month = Number(end.slice(5, 7));
  return month >= 1 && month <= 12 ? MONTHS[month - 1] : `P${period}`;
}

type PriorWindow = Pick<AthleticsBalancesResponse, "priorFy" | "priorThroughPeriod" | "priorThroughDate">;

/** "Sep 2025" from an ISO date, or null when the date is missing or malformed. */
function monthYearLabel(end: string | null): string | null {
  if (!end) return null;
  const year = end.slice(0, 4);
  const month = Number(end.slice(5, 7));
  return /^[0-9]{4}$/.test(year) && month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${year}` : null;
}

/**
 * The month the prior FY comparison runs through ("Sep 2025"), falling back
 * to "period N" when meta has no end date. Null when no month has closed.
 */
export function priorThroughLabel(data: PriorWindow): string | null {
  if (data.priorThroughPeriod < 1) return null;
  return monthYearLabel(data.priorThroughDate) ?? `period ${data.priorThroughPeriod}`;
}

/** Column heading for the prior FY net comparison. */
export function priorNetHeading(data: PriorWindow): string {
  const through = priorThroughLabel(data);
  return through ? `Prior FY net through ${through}` : "Prior FY net (no completed month yet)";
}

/** Prior FY amounts are null before the first month closes. */
export function formatPrior(value: number | null): string {
  return value === null ? "n/a" : formatMoney(value);
}

export function FinanceFootnote({ data }: { data: AthleticsBalancesResponse }) {
  const through = priorThroughLabel(data);
  return (
    <p className="ath-muted">
      Source: Great Plains general ledger, unrestricted funds, posted actuals. {fyLabel(data.currentFy)} to
      date through period {data.currentPeriod}
      {data.throughDate ? ` (ending ${data.throughDate})` : ""}, including the current month in progress.{" "}
      {through
        ? `Prior FY comparison: ${fyLabel(data.priorFy)} through period ${data.priorThroughPeriod}${
            data.priorThroughDate ? ` (ending ${data.priorThroughDate})` : ""
          }, the last completed month.`
        : `No prior FY comparison until the first month of ${fyLabel(data.currentFy)} closes.`}{" "}
      As of {data.asOfDate}.
    </p>
  );
}

export function FinanceKpis({ summary, data }: { summary: FinanceSummary; data: PriorWindow }) {
  const through = priorThroughLabel(data);
  const priorLine = (value: number | null) =>
    through
      ? `${fyLabel(data.priorFy)} through ${through}: ${formatPrior(value)}`
      : "Prior FY comparison starts after the first month closes";
  return (
    <div className="ath-coach-kpis">
      <div className="ath-kpi">
        <span>Revenue YTD</span>
        <strong>{formatMoney(summary.revenue)}</strong>
        <small>{priorLine(summary.priorRevenue)}</small>
      </div>
      <div className="ath-kpi">
        <span>Expense YTD</span>
        <strong>{formatMoney(summary.expense)}</strong>
        <small>{priorLine(summary.priorExpense)}</small>
      </div>
      <div className="ath-kpi">
        <span>Net YTD</span>
        <strong>{formatMoney(summary.net)}</strong>
        <small>Revenue less expense</small>
      </div>
      <div className="ath-kpi">
        <span>Prior FY net</span>
        <strong>{formatPrior(summary.priorNet)}</strong>
        <small>
          {through
            ? `${fyLabel(data.priorFy)} through ${through}`
            : "Available after the first month closes"}
        </small>
      </div>
    </div>
  );
}

function AccountTable({
  title,
  lines,
  totals,
  periods,
}: {
  title: string;
  lines: AccountLine[];
  totals: number[];
  periods: { period: number; end: string }[];
}) {
  const total = totals.reduce((sum, value) => sum + value, 0);
  return (
    <>
      <h3>{title}</h3>
      {lines.length ? (
        <div className="ath-table-scroll">
          <table className="ath-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Description</th>
                {periods.map((p) => (
                  <th key={p.period}>{monthLabel(p.end, p.period)}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.account}>
                  <td>{line.account}</td>
                  <td title={line.deptDesc}>{line.accountDesc}</td>
                  {line.byPeriod.map((value, i) => (
                    <td key={i}>{formatMoney(value)}</td>
                  ))}
                  <td>
                    <strong>{formatMoney(line.total)}</strong>
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={2}>
                  <strong>Total {title.toLowerCase()}</strong>
                </td>
                {totals.map((value, i) => (
                  <td key={i}>
                    <strong>{formatMoney(value)}</strong>
                  </td>
                ))}
                <td>
                  <strong>{formatMoney(total)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p>No {title.toLowerCase()} posted this fiscal year yet.</p>
      )}
    </>
  );
}

/**
 * One team's finances: KPIs plus revenue and expense accounts by month for
 * the current fiscal year. Used by the Business Office team page and the
 * coaching Budget tab. The API scopes rows to the signed-in user.
 */
export function SportFinance({ sportKey, backHref }: { sportKey: string; backHref?: string }) {
  const { data, error, loading } = useSportFetch<AthleticsBalancesResponse>(
    `/api/business-office/athletics-balances?sport=${encodeURIComponent(sportKey)}`,
    { noStore: true, fallbackError: "Unable to load team finances" },
  );
  const team = data?.teams.find((t) => t.sportKey === sportKey) ?? null;
  const detail = data?.sport ?? null;

  return (
    <section className="ath-coach-band">
      <h2>Budget</h2>
      {loading ? <p>Loading team finances…</p> : null}
      {error ? <p>{error}</p> : null}
      {!loading && !error && data && team && detail ? (
        <>
          <p>
            Unrestricted revenue and expense for this team, {fyLabel(data.currentFy)} to date. Budget
            comparison is coming in a later phase.
          </p>
          <FinanceKpis summary={team} data={data} />
          <AccountTable
            title="Revenue"
            lines={detail.revenue}
            totals={detail.revenueByPeriod}
            periods={detail.periods}
          />
          <AccountTable
            title="Expense"
            lines={detail.expense}
            totals={detail.expenseByPeriod}
            periods={detail.periods}
          />
          {detail.periods.length ? (
            <>
              <h3>Net by month</h3>
              <div className="ath-table-scroll">
                <table className="ath-table">
                  <thead>
                    <tr>
                      {detail.periods.map((p) => (
                        <th key={p.period}>{monthLabel(p.end, p.period)}</th>
                      ))}
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {detail.netByPeriod.map((value, i) => (
                        <td key={i}>{formatMoney(value)}</td>
                      ))}
                      <td>
                        <strong>{formatMoney(team.net)}</strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          <FinanceFootnote data={data} />
        </>
      ) : null}
      {!loading && !error && data && !team ? <p>No finances are mapped to this team.</p> : null}
      {backHref ? (
        <p>
          <Link href={backHref}>Back to all teams</Link>
        </p>
      ) : null}
    </section>
  );
}
