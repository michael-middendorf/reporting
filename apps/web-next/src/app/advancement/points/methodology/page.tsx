"use client";

import { Suspense } from "react";
import { PointsSubnav } from "@/components/PointsSubnav";
import { CONFLICTS, DAY_TARGETS, DEFINITIONS, POINTS_MAP, TIERS, TRACKING_CHART } from "@/lib/reports/points/scoring";
import "@/styles/points.css";

export default function PointsMethodologyPage() {
  const rules = Object.entries(POINTS_MAP as Record<string, { points: number; label: string; source?: string; bucket?: string }>);

  return (
    <div className="points-root">
        <main className="wrap dash points-method">
          <div className="points-toolbar">
            <Suspense fallback={null}>
              <PointsSubnav />
            </Suspense>
          </div>
          <h1>Methodology</h1>
          <p style={{ maxWidth: "70ch" }}>
            Points and gifts are scored from Virtuous notes and posted gifts. Large-event hours on this
            dashboard are 25 points per hour and are not written to Virtuous. A one-on-one Event note on
            a contact still counts at 25 points. The MA must log the correct note type on the donor’s
            contact, as themselves. A note on the wrong person, the wrong type, or after the gift will
            not count. A posted gift with no MA note on that contact is not attributed.
          </p>

          <section style={{ marginTop: 28 }} id="tracking-chart">
            <h2>Tracking chart</h2>
            <p className="track-lead" style={{ maxWidth: "72ch" }}>
              Virtuous note type on the donor’s contact, logged as yourself. Gifts are linked by the same
              contact when the note is on or before the gift, within 45 days. {TRACKING_CHART.refresh}
            </p>
            <ul style={{ maxWidth: "72ch" }}>
              {TRACKING_CHART.gifts.map((g) => (
                <li key={g.label} style={{ marginBottom: 8 }}>
                  <strong>{g.label}.</strong> {g.detail}
                </li>
              ))}
            </ul>
            <table style={{ width: "100%", background: "#fff", borderCollapse: "collapse", marginTop: 16 }}>
              <thead>
                <tr>
                  <th align="left">Counts as</th>
                  <th align="left">Virtuous note type</th>
                  <th align="right">Pts</th>
                </tr>
              </thead>
              <tbody>
                {TRACKING_CHART.rows.map((r) => (
                  <tr key={`${r.tracker}-${r.type}`}>
                    <td>{r.tracker}</td>
                    <td>{r.type}</td>
                    <td align="right">{r.pts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="footnote">Wrong person, wrong type, or no note = not counted.</p>
          </section>

          <section style={{ marginTop: 28 }}>
            <h2>Point values</h2>
            <table style={{ width: "100%", background: "#fff", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">Activity</th>
                  <th align="right">Points</th>
                  <th align="left">Source</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(([key, rule]) => (
                  <tr key={key}>
                    <td>{rule.label || key}</td>
                    <td align="right">{rule.points}</td>
                    <td>{rule.source || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={{ marginTop: 28 }}>
            <h2>Tiers</h2>
            <ul>
              {TIERS.map((t) => (
                <li key={t.id}>
                  <strong>{t.label}</strong> — avg ≥ {t.min}/weekday · payout $
                  {(t.payout ?? 0).toLocaleString()}
                  {DAY_TARGETS[t.id] && (
                    <div style={{ opacity: 0.75, fontSize: 13 }}>
                      Example day: {DAY_TARGETS[t.id].blurb}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section style={{ marginTop: 28 }} id="definitions">
            <h2>Definitions</h2>
            {DEFINITIONS.map((d) => (
              <article key={d.term} style={{ background: "#fff", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                <h3 style={{ marginTop: 0 }}>{d.term}</h3>
                <p style={{ margin: 0, maxWidth: "72ch" }}>{d.text}</p>
              </article>
            ))}
          </section>

          <section style={{ marginTop: 28 }} id="events">
            <h2>Documented conflicts</h2>
            {Object.entries(CONFLICTS).map(([id, c]) => (
              <article key={id} style={{ background: "#fff", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                <h3 style={{ marginTop: 0 }}>{(c as { title: string }).title}</h3>
                <p>
                  <strong>PDF:</strong> {(c as { pdf: string }).pdf}
                </p>
                <p>
                  <strong>Spreadsheet:</strong> {(c as { spreadsheet: string }).spreadsheet}
                </p>
                <p>
                  <strong>Resolved:</strong> {(c as { resolved: string }).resolved}
                </p>
                <p style={{ opacity: 0.75 }}>{(c as { note: string }).note}</p>
              </article>
            ))}
          </section>
        </main>
    </div>
  );
}
