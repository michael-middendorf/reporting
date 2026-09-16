"use client";

import { CONFLICTS, DAY_TARGETS, DEFINITIONS, POINTS_MAP, TIERS } from "@/lib/reports/points/scoring";
import "@/styles/points.css";

export default function PointsMethodologyPage() {
  const rules = Object.entries(POINTS_MAP as Record<string, { points: number; label: string; source?: string; bucket?: string }>);

  return (
    <div className="points-root">
        <main style={{ padding: "24px 20px 48px", maxWidth: 900, margin: "0 auto" }}>
          <h1>Methodology &amp; Scoring</h1>
          <p style={{ maxWidth: "70ch" }}>
            Points and gifts are scored from Virtuous notes and posted gifts. Event points come only
            from hours added on the Points dashboard (25 points per hour, reporting-only — not written
            to Virtuous). A Virtuous Event note does not count. The MA must log the correct note type
            on the donor’s contact, as themselves. A note on the wrong person, the wrong type, or after
            the gift will not count. A posted gift with no MA note on that contact is not attributed.
          </p>

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
