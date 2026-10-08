"use client";

import Link from "next/link";
import { useSportFetch } from "@/components/athletics/useSportFetch";
import { formatMoney } from "@/components/athletics/CoachingHub";
import type {
  AthleticsBalancesResponse,
  FinanceSummary,
} from "@/lib/reports/business-office/athletics-finance";
import { FinanceFootnote, FinanceKpis, fyLabel } from "./SportFinance";

function SummaryCells({ summary }: { summary: FinanceSummary }) {
  return (
    <>
      <td>{formatMoney(summary.revenue)}</td>
      <td>{formatMoney(summary.expense)}</td>
      <td>
        <strong>{formatMoney(summary.net)}</strong>
      </td>
      <td>{formatMoney(summary.priorNet)}</td>
    </>
  );
}

function addSummaries(rows: FinanceSummary[]): FinanceSummary {
  const total = rows.reduce(
    (acc, row) => ({
      revenue: acc.revenue + row.revenue,
      expense: acc.expense + row.expense,
      net: acc.net + row.net,
      priorRevenue: acc.priorRevenue + row.priorRevenue,
      priorExpense: acc.priorExpense + row.priorExpense,
      priorNet: acc.priorNet + row.priorNet,
      budget: null,
    }),
    { revenue: 0, expense: 0, net: 0, priorRevenue: 0, priorExpense: 0, priorNet: 0, budget: null } as FinanceSummary,
  );
  return total;
}

/** All-teams table for Business Office and athletics leadership. */
export function AthleticsBalances() {
  const { data, error, loading } = useSportFetch<AthleticsBalancesResponse>(
    "/api/business-office/athletics-balances",
    { noStore: true, fallbackError: "Unable to load athletics finances" },
  );
  const teams = data ? [...data.teams].sort((a, b) => a.label.localeCompare(b.label)) : [];
  const department = data ? addSummaries([...teams, ...(data.departmentWide ? [data.departmentWide] : [])]) : null;

  return (
    <main className="ath-page">
      <div className="ath-page-heading">
        <div>
          <h1>Athletics</h1>
          <p className="ath-muted">
            Unrestricted revenue, expense, and net by team
            {data ? `, ${fyLabel(data.currentFy)} to date` : ""}.
          </p>
        </div>
      </div>
      {loading ? <p className="ath-loading">Loading athletics finances…</p> : null}
      {error ? <p className="ath-alert ath-alert-error">{error}</p> : null}
      {!loading && !error && data && department ? (
        <section className="ath-coach-band">
          <h2>Athletics department</h2>
          <FinanceKpis summary={department} priorFy={data.priorFy} />
          <h3>By team</h3>
          <div className="ath-table-scroll">
            <table className="ath-table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Revenue YTD</th>
                  <th>Expense YTD</th>
                  <th>Net YTD</th>
                  <th>{fyLabel(data.priorFy)} same period net</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => (
                  <tr key={team.sportKey}>
                    <td>
                      <Link href={`/business-office/athletics/${team.sportKey}`}>{team.label}</Link>
                    </td>
                    <SummaryCells summary={team} />
                  </tr>
                ))}
                {data.departmentWide ? (
                  <tr>
                    <td>Department-wide</td>
                    <SummaryCells summary={data.departmentWide} />
                  </tr>
                ) : null}
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  <SummaryCells summary={department} />
                </tr>
              </tbody>
            </table>
          </div>
          {data.unassigned ? (
            <>
              <h3>Unassigned departments</h3>
              <p>
                Athletics-related departments not yet assigned to a team. Visible to the Business Office
                only and not included in the department total above.
              </p>
              <div className="ath-table-scroll">
                <table className="ath-table">
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>Revenue YTD</th>
                      <th>Expense YTD</th>
                      <th>Net YTD</th>
                      <th>{fyLabel(data.priorFy)} same period net</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Unassigned</td>
                      <SummaryCells summary={data.unassigned} />
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          <FinanceFootnote data={data} />
        </section>
      ) : null}
    </main>
  );
}
