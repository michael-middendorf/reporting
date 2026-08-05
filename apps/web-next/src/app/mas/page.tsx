"use client";

import { useEffect, useState } from "react";
import { MasShell, MetricCard } from "./MasShell";
import {
  drilldownHref,
  leaderboardFrom,
  loadMasJson,
  money,
  type Scorecards,
  type Trends,
} from "@/lib/reports/mas/load";

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
            href={drilldownHref({
              title: c.label,
              view: "engagements",
              predicates: [],
            })}
            label={c.label}
            value={c.value}
            context={c.context}
          />
        ))}
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2>MA leaderboard</h2>
        <div style={{ overflowX: "auto", background: "#fff", borderRadius: 12, border: "1px solid #e0d4c0" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">MA</th>
                <th align="right">Outreach</th>
                <th align="right">Two-way</th>
                <th align="right">Donors (30d)</th>
                <th align="right">$ (30d)</th>
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
                  <td align="right">{row.follow_on_donors_30 ?? "—"}</td>
                  <td align="right">{money(row.follow_on_dollars_30)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!board.length && !error && <p>No leaderboard rows yet.</p>}
      </section>

      <section>
        <h2>Engagement mix</h2>
        <ul>
          {typeMix.map(([label, count]) => (
            <li key={label}>
              <a
                href={drilldownHref({
                  title: label,
                  view: "engagements",
                  predicates: [{ kind: "eq", key: "engagement_type", value: label }],
                })}
              >
                {label}
              </a>
              : <strong>{count}</strong>
            </li>
          ))}
        </ul>
        {!typeMix.length && !error && <p>No type mix in trends.json.</p>}
      </section>
    </MasShell>
  );
}
