"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  pct,
  usd,
  type AdvancementOverviewSnapshot,
  type OfficerRow,
  type YtdRow,
} from "@/lib/reports/advancement-overview/shape";
import "@/styles/annunciation.css";
import "@/styles/advancement-overview.css";

function meterWidth(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "0%";
  return `${Math.max(0, Math.min(100, n))}%`;
}

function deltaClass(n: number): string {
  if (n > 0) return "ao-pos";
  if (n < 0) return "ao-neg";
  return "";
}

export default function AdvancementOverviewPage() {
  const [data, setData] = useState<AdvancementOverviewSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    apiFetch("/api/advancement-overview-data")
      .then(async (r) => {
        const json = (await r.json()) as AdvancementOverviewSnapshot;
        if (!r.ok) throw new Error(json.error || `Error ${r.status}`);
        setData(json);
        setError(null);
      })
      .catch((e: Error) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const k = data?.kpis;
  const ytd = data?.ytd;
  const officers = data?.officers ?? [];
  const pipeline = data?.pipeline;

  return (
    <main className="ac-page">
      <div className="ac-head">
        <div>
          <h1>Advancement Overview</h1>
          <p className="ac-sub">
            {data?.fiscalYearLabel ?? "FY 2025-26"} results from Virtuous
            {data?.generated_at ? ` · updated ${data.generated_at}` : ""}.
          </p>
        </div>
        <button type="button" className="ac-refresh" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="ac-error">
          <p>{error}</p>
        </div>
      )}

      {!error && (
        <>
          <div className="ao-kpis">
            <div className="ao-kpi">
              <div className="ao-kpi-label">Total Fundraising</div>
              <div className="ao-kpi-value">{usd(k?.totalFundraising.amount)}</div>
              <div className="ao-meter">
                <span style={{ width: meterWidth(k?.totalFundraising.pctOfGoal) }} />
              </div>
              <div className="ao-kpi-sub">
                {pct(k?.totalFundraising.pctOfGoal, 0)} of {usd(k?.totalFundraising.goal)} FY goal
              </div>
            </div>
            <div className="ao-kpi">
              <div className="ao-kpi-label">Unrestricted Gifts</div>
              <div className="ao-kpi-value">{usd(k?.unrestricted.amount)}</div>
              <div className="ao-meter">
                <span style={{ width: meterWidth(k?.unrestricted.pctOfGoal) }} />
              </div>
              <div className="ao-kpi-sub">Goal: {usd(k?.unrestricted.goal)}</div>
            </div>
            <div className="ao-kpi">
              <div className="ao-kpi-label">New Multi-Year Pledges</div>
              <div className="ao-kpi-value">{k?.multiYearPledges.count ?? "—"}</div>
              <div className="ao-meter">
                <span
                  style={{
                    width: meterWidth(
                      k ? (100 * k.multiYearPledges.count) / k.multiYearPledges.goal : 0,
                    ),
                  }}
                />
              </div>
              <div className="ao-kpi-sub">Goal: {k?.multiYearPledges.goal ?? 30}</div>
            </div>
            <div className="ao-kpi">
              <div className="ao-kpi-label">Estate Gifts</div>
              <div className="ao-kpi-value">{k?.estateGifts.count ?? "—"}</div>
              <div className="ao-meter">
                <span
                  style={{
                    width: meterWidth(
                      k ? (100 * k.estateGifts.count) / k.estateGifts.goal : 0,
                    ),
                  }}
                />
              </div>
              <div className="ao-kpi-sub">Goal: {k?.estateGifts.goal ?? 25}</div>
            </div>
          </div>

          <p className="ac-note">
            Totals count Virtuous gifts dated on or after July 1, 2025 — the same window as the
            Qlik FY 25/26 Results sheet. Unrestricted gifts are those designated to a project
            whose location is Unrestricted. Last-year figures are gifts in the prior fiscal year
            through the same calendar day last year. MGO figures use the gift solicitor field.
          </p>

          <div className="ao-grid">
            <section className="ao-panel ao-wide">
              <h2>Year-to-date actuals</h2>
              <div className="ac-table-wrap">
                <table className="ac-table">
                  <thead>
                    <tr>
                      <th> </th>
                      <th className="ac-num">Last year to date</th>
                      <th className="ac-num">This year to date</th>
                      <th className="ac-num">Difference</th>
                      <th className="ac-num">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    <YtdLine label="Overall" row={ytd?.overall} />
                    <YtdLine label="MGO Team" row={ytd?.mgoTeam} />
                  </tbody>
                </table>
              </div>
            </section>

            <section className="ao-panel">
              <h2>Individual goals · Major Gift Officers</h2>
              <div className="ac-table-wrap">
                <table className="ac-table">
                  <thead>
                    <tr>
                      <th>MGO</th>
                      <th className="ac-num">Goal</th>
                      <th className="ac-num">Received</th>
                      <th className="ac-num">% to goal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {officers.length === 0 && (
                      <tr>
                        <td colSpan={4} className="ac-empty">
                          {loading ? "Loading…" : "No officer totals."}
                        </td>
                      </tr>
                    )}
                    {officers.map((o: OfficerRow) => (
                      <tr key={o.solicitor}>
                        <td>{o.name}</td>
                        <td className="ac-num">{usd(o.goal)}</td>
                        <td className="ac-num">{usd(o.received)}</td>
                        <td className="ac-num">{pct(o.pctToGoal, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="ao-panel">
              <h2>Virtuous pipeline status</h2>
              <div className="ac-table-wrap">
                <table className="ac-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th className="ac-num">Total in asks</th>
                      <th className="ac-num">Asks</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <strong>Totals</strong>
                      </td>
                      <td className="ac-num">
                        <strong>{usd(pipeline?.totalAmount)}</strong>
                      </td>
                      <td className="ac-num">
                        <strong>{pipeline?.totalCount ?? "—"}</strong>
                      </td>
                    </tr>
                    {(pipeline?.rows ?? []).map((r) => (
                      <tr key={r.status}>
                        <td>{r.status.replace(/ \(MGO\)$/, "")}</td>
                        <td className="ac-num">{usd(r.amount)}</td>
                        <td className="ac-num">{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
    </main>
  );
}

function YtdLine({ label, row }: { label: string; row?: YtdRow }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="ac-num">{usd(row?.prior)}</td>
      <td className="ac-num">{usd(row?.current)}</td>
      <td className={`ac-num ${row ? deltaClass(row.difference) : ""}`}>
        {usd(row?.difference)}
      </td>
      <td className={`ac-num ${row?.pct != null ? deltaClass(row.pct) : ""}`}>
        {pct(row?.pct)}
      </td>
    </tr>
  );
}
