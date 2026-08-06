"use client";

import { useEffect, useMemo, useState } from "react";
import { MasShell } from "../MasShell";
import { ColumnChart } from "@/components/mas/charts";
import {
  drilldownHref,
  leaderboardFrom,
  loadMasJson,
  money,
  type Scorecards,
  type Trends,
} from "@/lib/reports/mas/load";

type Monthly = {
  period_start?: string;
  outreach_notes?: number;
  two_way_engagements?: number;
};

export default function MasActivityPage() {
  const [scorecards, setScorecards] = useState<Scorecards | null>(null);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      loadMasJson<Scorecards>("scorecards.json"),
      loadMasJson<Trends>("trends.json"),
    ])
      .then(([s, t]) => {
        setScorecards(s);
        setTrends(t);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const owners = leaderboardFrom(scorecards);
  const typeMix = Object.entries(trends?.type_mix || {}).sort((a, b) => b[1] - a[1]);
  const monthly = useMemo(
    () => ((trends?.monthly || []) as Monthly[]).slice(-18),
    [trends],
  );
  const labels = monthly.map((r) => String(r.period_start || "").slice(0, 10));

  return (
    <MasShell>
      <h1>Activity</h1>
      {error && <p style={{ color: "#8f2d1f" }}>{error}</p>}

      <h2>Monthly Outreach Notes</h2>
      <ColumnChart
        labels={labels}
        values={monthly.map((r) => Number(r.outreach_notes || 0))}
        hrefForIndex={(_i, label) =>
          drilldownHref({
            title: `Engagements in ${String(label).slice(0, 7)}`,
            view: "engagements",
            predicates: [{ kind: "prefix", key: "engagement_date", value: String(label).slice(0, 7) }],
          })
        }
      />

      <h2 style={{ marginTop: 24 }}>Monthly Two-Way Engagements</h2>
      <ColumnChart
        labels={labels}
        values={monthly.map((r) => Number(r.two_way_engagements || 0))}
        color="rgba(46, 95, 70, 0.88)"
      />

      <h2 style={{ marginTop: 24 }}>By MA</h2>
      <div style={{ overflowX: "auto", background: "#fff", borderRadius: 12, marginBottom: 24 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th align="left">MA</th>
              <th align="right">Notes</th>
              <th align="right">Two-way</th>
              <th align="right">One-way</th>
              <th align="right">Failed</th>
              <th align="right">Donors 365</th>
              <th align="right">$ 365</th>
            </tr>
          </thead>
          <tbody>
            {owners.map((row) => (
              <tr key={row.ma_owner}>
                <td>
                  <a
                    href={drilldownHref({
                      title: row.ma_owner,
                      view: "engagements",
                      predicates: [{ kind: "eq", key: "ma_owner", value: row.ma_owner }],
                    })}
                  >
                    {row.ma_owner}
                  </a>
                </td>
                <td align="right">{row.outreach_notes ?? "—"}</td>
                <td align="right">{row.two_way_engagements ?? "—"}</td>
                <td align="right">{row.one_way_outreach ?? "—"}</td>
                <td align="right">{row.failed_contacts ?? "—"}</td>
                <td align="right">{row.follow_on_donors_365 ?? "—"}</td>
                <td align="right">{money(row.follow_on_dollars_365)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>By type</h2>
      <div style={{ overflowX: "auto", background: "#fff", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th align="left">Type</th>
              <th align="right">Count</th>
            </tr>
          </thead>
          <tbody>
            {typeMix.map(([type, count]) => (
              <tr key={type}>
                <td>
                  <a
                    href={drilldownHref({
                      title: type,
                      view: "engagements",
                      predicates: [{ kind: "eq", key: "engagement_type", value: type }],
                    })}
                  >
                    {type}
                  </a>
                </td>
                <td align="right">{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 12 }}>
        <a href="/api/reports/mas/exports/engagement_ledger.csv">Download ledger CSV</a>
      </p>
    </MasShell>
  );
}
