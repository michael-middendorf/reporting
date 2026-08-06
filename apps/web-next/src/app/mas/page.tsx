"use client";

import { useEffect, useMemo, useState } from "react";
import { MasShell, MetricCard } from "./MasShell";
import { ColumnChart, summaryCardHref } from "@/components/mas/charts";
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
  recent_follow_on_dollars?: number | string;
};

export default function MasOverviewPage() {
  const [scorecards, setScorecards] = useState<Scorecards | null>(null);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      loadMasJson<Record<string, unknown>>("metadata.json"),
      loadMasJson<Scorecards>("scorecards.json"),
      loadMasJson<Trends>("trends.json"),
    ])
      .then(([m, s, t]) => {
        setMeta(m);
        setScorecards(s);
        setTrends(t);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const board = leaderboardFrom(scorecards);
  const typeMix = Object.entries(trends?.type_mix || {}).sort((a, b) => b[1] - a[1]);
  const monthly = useMemo(
    () => ((trends?.monthly || []) as Monthly[]).slice(-18),
    [trends],
  );
  const monthLabels = monthly.map((r) => String(r.period_start || "").slice(0, 10));
  const outreach = monthly.map((r) => Number(r.outreach_notes || 0));
  const dollars = monthly.map((r) => Number(r.recent_follow_on_dollars || 0));

  return (
    <MasShell>
      <header style={{ marginBottom: 20 }}>
        <p className="eyebrow">Mission Advancement</p>
        <h1 style={{ fontFamily: "Iowan Old Style, Palatino, serif", fontSize: 34, margin: "4px 0" }}>
          MA Outreach and Follow-On Giving
        </h1>
        <p style={{ maxWidth: "62ch", opacity: 0.8 }}>
          Leadership report from Virtuous Mission Advancement outreach notes and follow-on gifts.
        </p>
        {meta && (
          <p style={{ fontSize: 13, opacity: 0.7 }}>
            Generated {String(meta.generated_at_display || meta.generated_at || "—")} · Mode{" "}
            {String(meta.mode || "—")}
            {meta.runtime_seconds != null ? ` · Runtime ${meta.runtime_seconds}s` : ""}
          </p>
        )}
      </header>
      {error && <p style={{ color: "#8f2d1f" }}>{error}</p>}

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
          gap: 12,
          marginBottom: 28,
        }}
      >
        {(scorecards?.summary_cards || []).map((c) => (
          <MetricCard
            key={c.id}
            href={summaryCardHref(c.id, c.label)}
            label={c.label}
            value={c.value}
            context={c.context}
          />
        ))}
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2>Monthly Outreach Notes</h2>
        <ColumnChart
          labels={monthLabels}
          values={outreach}
          hrefForIndex={(_i, label) =>
            drilldownHref({
              title: `Engagements in ${String(label).slice(0, 7)}`,
              view: "engagements",
              predicates: [{ kind: "prefix", key: "engagement_date", value: String(label).slice(0, 7) }],
            })
          }
        />
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2>Monthly Follow-On Dollars</h2>
        <ColumnChart
          labels={monthLabels}
          values={dollars}
          color="rgba(46, 95, 70, 0.88)"
          formatValue={(n) => money(n)}
        />
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2>MA leaderboard</h2>
        <div style={{ overflowX: "auto", background: "#fff", borderRadius: 12, border: "1px solid #e0d4c0" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Owner</th>
                <th align="right">Notes</th>
                <th align="right">Two-Way</th>
                <th align="right">One-Way</th>
                <th align="right">Donors 365</th>
                <th align="right">Dollars 365</th>
              </tr>
            </thead>
            <tbody>
              {board.map((row) => (
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
                  <td align="right">{row.follow_on_donors_365 ?? "—"}</td>
                  <td align="right">{money(row.follow_on_dollars_365)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2>Engagement mix</h2>
        <div style={{ overflowX: "auto", background: "#fff", borderRadius: 12, border: "1px solid #e0d4c0" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Type</th>
                <th align="right">Outreach Notes</th>
              </tr>
            </thead>
            <tbody>
              {typeMix.map(([label, count]) => (
                <tr key={label}>
                  <td>
                    <a
                      href={drilldownHref({
                        title: label,
                        view: "engagements",
                        predicates: [{ kind: "eq", key: "engagement_type", value: label }],
                      })}
                    >
                      {label}
                    </a>
                  </td>
                  <td align="right">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Downloads</h2>
        <ul>
          <li>
            <a href="/api/reports/mas/exports/engagement_ledger.csv">Engagement ledger CSV</a>
          </li>
          <li>
            <a href="/api/reports/mas/exports/recent_follow_on_gifts.csv">Recent follow-on gifts CSV</a>
          </li>
          <li>
            <a href="/api/reports/mas/exports/contact_rollup.csv">Contact rollup CSV</a>
          </li>
          <li>
            <a href="/api/reports/mas/exports/ma_scorecard_breakdown.csv">MA scorecard breakdown CSV</a>
          </li>
        </ul>
      </section>
    </MasShell>
  );
}
