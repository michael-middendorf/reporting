"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  barFill,
  count,
  isOverviewReady,
  pct,
  usd,
  type AdvancementOverviewSnapshot,
  type OfficerRow,
  type YtdRow,
} from "@/lib/reports/advancement-overview/shape";
import "@/styles/annunciation.css";
import "@/styles/advancement-overview.css";

function deltaClass(n: number | null | undefined): string {
  if (n == null) return "";
  if (n > 0) return "ao-pos";
  if (n < 0) return "ao-neg";
  return "";
}

function VBar({
  value,
  goal,
  label,
}: {
  value: number | null | undefined;
  goal: number;
  label: string;
}) {
  const n = value ?? 0;
  return (
    <div className="ao-vbar">
      <div className="ao-vbar-max">{goal}</div>
      <div className="ao-vbar-track">
        <div className="ao-vbar-fill" style={{ height: `${barFill((n / goal) * 100)}%` }} />
      </div>
      <div className="ao-vbar-min">0</div>
      <div className="ao-vbar-value">{value == null ? "--" : count(value)}</div>
      <div className="ao-vbar-label">{label}</div>
    </div>
  );
}

function MoneyKpi({ label, amount }: { label: string; amount: number | null | undefined }) {
  return (
    <div>
      <div className="ao-kpi-label">{label}</div>
      <div className="ao-kpi-value">{usd(amount)}</div>
    </div>
  );
}

function AdvancementOverviewPage() {
  const [data, setData] = useState<AdvancementOverviewSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function readSnapshot() {
    return apiFetch("/api/advancement-overview-data").then(async (r) => {
      const json = (await r.json()) as AdvancementOverviewSnapshot;
      if (!r.ok) throw new Error(json.error || `Error ${r.status}`);
      return json;
    });
  }

  function load() {
    setLoading(true);
    readSnapshot()
      .then((json) => {
        setData(json);
        setError(null);
      })
      .catch((e: Error) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    readSnapshot()
      .then((json) => {
        if (cancelled) return;
        setData(json);
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = isOverviewReady(data);
  const received = data?.received;
  const released = data?.released;
  const pledges = data?.pledges;
  const ytd = data?.ytd;
  const officers = data?.officers ?? [];
  const pipeline = data?.pipeline;

  return (
    <main className="ac-page ao-page">
      <div className="ac-head">
        <div>
          <h1>Advancement Overview</h1>
          <p className="ac-sub">
            {data?.fiscalYearLabel ?? "FY"} Results from Qlik
            {data?.generated_at ? ` · updated ${data.generated_at}` : ""}.
          </p>
        </div>
        <div className="ao-head-actions">
          <button type="button" className="ac-refresh" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="ac-error">
          <p>{error}</p>
        </div>
      )}

      {!error && ready && (
        <>
          <div className="ao-top">
            <section className="ao-card">
              <header className="ao-panel-head">
                <h2>FY27 Received Gifts</h2>
                <p>Business Fund Designation</p>
              </header>
              <div className="ao-card-body ao-received">
                <MoneyKpi label="FY27 Endowed" amount={received?.endowed} />
                <MoneyKpi label="FY27 Temporary Restricted" amount={received?.temporaryRestricted} />
                <MoneyKpi label="FY27 Unrestricted" amount={received?.unrestricted} />
                <MoneyKpi label="FY27 Total Received Gifts" amount={received?.total} />
              </div>
            </section>

            <section className="ao-card">
              <header className="ao-panel-head">
                <h2>FY27 Released Restricted Funds</h2>
                <p>{released?.note ?? "Actuals Updated 7/1/2026"}</p>
              </header>
              <div className="ao-card-body ao-released">
                <MoneyKpi label="FY26 Released Restricted" amount={released?.fy26} />
                <MoneyKpi label="Other Released Restricted" amount={released?.other} />
                <MoneyKpi label="FY27 Total Released Restricted" amount={released?.total} />
              </div>
            </section>

            <section className="ao-card">
              <header className="ao-panel-head">
                <h2>FY27 Pledges & Planned Giving</h2>
              </header>
              <div className="ao-vbars ao-vbars-3">
                <VBar
                  value={pledges?.multiYear}
                  goal={pledges?.multiYearGoal ?? 30}
                  label="New Multi-Year Pledges"
                />
                <VBar
                  value={pledges?.realizedEstate}
                  goal={pledges?.realizedEstateGoal ?? 25}
                  label="FY27 Realized Estate Gifts"
                />
                <div className="ao-planned">
                  <div className="ao-kpi-label">FY27 Planned Estate Gifts</div>
                  <div className="ao-kpi-value">{count(pledges?.plannedEstate)}</div>
                </div>
              </div>
            </section>
          </div>

          <section className="ao-card ao-ytd">
            <table className="ao-table ao-ytd-table">
              <thead>
                <tr>
                  <th>FY27 vs. FY26 YTD Actuals</th>
                  <th className="ao-num">{ytd?.currentLabel ?? "FY2027"}</th>
                  <th className="ao-num">{ytd?.priorLabel ?? "FY2026"}</th>
                  <th className="ao-num">Difference</th>
                  <th className="ao-num">Percentage</th>
                </tr>
              </thead>
              <tbody>
                <YtdLine label="Overall" row={ytd?.overall} kind="money" />
                <YtdLine label="MGO Team" row={ytd?.mgoTeam} kind="money" />
                <YtdLine label="Active Donors" row={ytd?.activeDonors} kind="count" />
              </tbody>
            </table>
          </section>

          <div className="ao-bottom">
            <section className="ao-card">
              <header className="ao-panel-head">
                <h2>Individual Fundraising Results</h2>
                <p>Gift Officers | FY27 Overview</p>
              </header>
              <table className="ao-table">
                <thead>
                  <tr>
                    <th>Gift Officer</th>
                    <th className="ao-num">FY27 Total Gifts</th>
                  </tr>
                </thead>
                <tbody>
                  {officers.length === 0 && (
                    <tr>
                      <td colSpan={2} className="ao-empty">
                        {loading ? "Loading…" : "No officer totals."}
                      </td>
                    </tr>
                  )}
                  {officers.map((o: OfficerRow) => (
                    <tr key={o.name} className={o.isTotal ? "ao-total-row" : undefined}>
                      <td>{o.name}</td>
                      <td className="ao-num">{usd(o.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="ao-card">
              <header className="ao-panel-head">
                <h2>Virtuous Pipeline Status</h2>
              </header>
              <table className="ao-table ao-pipe-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th className="ao-num">Total Amount in Asks</th>
                    <th className="ao-num">Number of Gifts</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="ao-total-row">
                    <td>Totals</td>
                    <td className="ao-num">{usd(pipeline?.totalAmount)}</td>
                    <td className="ao-num">{pipeline?.totalCount ?? "--"}</td>
                  </tr>
                  {(pipeline?.rows ?? []).map((r) => (
                    <tr key={r.status}>
                      <td>{r.status}</td>
                      <td className="ao-num">{usd(r.amount)}</td>
                      <td className="ao-num">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}

      {!error && !ready && !loading && (
        <div className="ac-error">
          <p>Advancement overview cache is not a Qlik snapshot yet. Wait for the next refresh.</p>
        </div>
      )}
    </main>
  );
}

function YtdLine({
  label,
  row,
  kind,
}: {
  label: string;
  row?: YtdRow;
  kind: "money" | "count";
}) {
  const fmt = kind === "count" ? count : usd;
  return (
    <tr>
      <td>{label}</td>
      <td className="ao-num ao-now">{fmt(row?.current)}</td>
      <td className="ao-num">{fmt(row?.prior)}</td>
      <td className={`ao-num ${deltaClass(row?.difference)}`}>{fmt(row?.difference)}</td>
      <td className={`ao-num ${row?.pct != null ? deltaClass(row.pct) : ""}`}>{pct(row?.pct)}</td>
    </tr>
  );
}

export default function AdvancementOverviewRoute() {
  return <AdvancementOverviewPage />;
}
