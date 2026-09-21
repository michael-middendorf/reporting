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
            a contact still counts at 25 points. The MA must log the note on the donor’s contact, as
            themselves. The path below is the order the board uses for every posted gift.
          </p>

          <section className="gift-flow-section" id="gift-flow">
            <h2>How a gift is recorded</h2>
            <p className="flow-lead">
              Each check is decided before the next one. A gift stops at the first result.
            </p>

            <ol className="gift-flow">
              <li className="flow-node">
                <span className="flow-kicker">Start</span>
                <strong>A gift posts in Virtuous.</strong>
                <p>
                  The row keeps the contact ID. The household name is filled from the contacts file.
                  If that file does not include the household, the row says Unknown donor. The arrow
                  still opens the contact, because it uses the ID.
                </p>
              </li>

              <li className="flow-check">
                <span className="flow-kicker">Check 1</span>
                <strong>Is this the same Annunciation Circle amount as the last charge?</strong>
                <div className="flow-branches">
                  <div className="flow-branch stop">
                    <span>Yes</span>
                    <p>Not recorded again. A continuing monthly payment is not a new gift.</p>
                  </div>
                  <div className="flow-branch go">
                    <span>No</span>
                    <p>
                      Count a one-time gift as the posted amount. Count a new or restarted monthly
                      gift as the monthly amount × 12. Count an increase as (new − prior) × 12.
                    </p>
                  </div>
                </div>
              </li>

              <li className="flow-check">
                <span className="flow-kicker">Check 2</span>
                <strong>Is the segment or project a gala, and did an MA actually speak with the donor within 45 days?</strong>
                <p className="flow-note">
                  A conversation, a two-way email, or a meeting counts. It can be before or after the
                  gift posts. A voicemail, a letter, or an email that was only sent does not.
                </p>
                <div className="flow-branches">
                  <div className="flow-branch raised">
                    <span>Yes</span>
                    <p>
                      Raised. The ticket purchase is a new donation. Dollars and 100 points go to the
                      MA who spoke with the donor. A gala invitation does not claim a different gift
                      on the same contact.
                    </p>
                  </div>
                  <div className="flow-branch go">
                    <span>No</span>
                    <p>Continue. The gift is not a gala purchase, or nobody had that conversation.</p>
                  </div>
                </div>
              </li>

              <li className="flow-check">
                <span className="flow-kicker">Check 3</span>
                <strong>Is the gift coded Direct Solicitation (MGO), or is the solicitor someone who is not an MA?</strong>
                <div className="flow-branches">
                  <div className="flow-branch review">
                    <span>Yes</span>
                    <p>
                      It goes to the MGO-coded review list when an MA has a note in the 45-day window.
                      It is not Raised until someone clicks Assign. With no MA note, it is not listed.
                    </p>
                  </div>
                  <div className="flow-branch go">
                    <span>No</span>
                    <p>Continue to the donation-note check.</p>
                  </div>
                </div>
              </li>

              <li className="flow-check">
                <span className="flow-kicker">Check 4</span>
                <strong>Is there a donation note on this contact within 45 days before or after the gift?</strong>
                <p className="flow-note">
                  The note types are New Donation or New AC, Annunciation Circle updated, and Update
                  Recurring Gift. Credit goes to the MA who logged that note.
                </p>
                <div className="flow-branches">
                  <div className="flow-branch raised">
                    <span>Yes</span>
                    <p>Raised. The dollars and 100 points are recorded together, on the gift’s week.</p>
                  </div>
                  <div className="flow-branch go">
                    <span>No</span>
                    <p>Continue. A thank-you, a letter, or a voicemail is not this note.</p>
                  </div>
                </div>
              </li>

              <li className="flow-check">
                <span className="flow-kicker">Check 5</span>
                <strong>Did an MA speak with the donor on or before the gift, within 45 days?</strong>
                <p className="flow-note">
                  A conversation, a two-way email, an in-person visit, or a meeting. Every MA who
                  spoke is listed. A note after a non-gala gift does not put it here.
                </p>
                <div className="flow-branches">
                  <div className="flow-branch review">
                    <span>Yes</span>
                    <p>Incoming review. Zero points, and not Raised, until someone assigns it.</p>
                  </div>
                  <div className="flow-branch stop">
                    <span>No</span>
                    <p>Not attributed. The gift stays off the MA’s Raised total.</p>
                  </div>
                </div>
              </li>
            </ol>

            <div className="flow-review">
              <h3>Review</h3>
              <div className="flow-review-grid">
                <article>
                  <h4>Incoming</h4>
                  <p>The donor, the amount, and each MA who spoke are on the row.</p>
                  <p><strong>Assign</strong> gives that MA the dollars and 100 points. It does not write a note in Virtuous.</p>
                  <p><strong>Remove</strong> takes the gift off the list. It is not counted.</p>
                </article>
                <article>
                  <h4>MGO-coded</h4>
                  <p>These stay out of Raised while they are waiting.</p>
                  <p><strong>Assign</strong> gives the named MA the dollars.</p>
                  <p><strong>Remove</strong> takes the gift off the list.</p>
                </article>
              </div>
              <p className="flow-foot">
                A row on the MA gift tracker does not assign a gift. The Donations sheet was used
                only to finish gifts already listed there.
              </p>
            </div>
          </section>

          <section style={{ marginTop: 28 }} id="tracking-chart">
            <h2>Tracking chart</h2>
            <p className="track-lead" style={{ maxWidth: "72ch" }}>
              Virtuous note type on the donor’s contact, logged as yourself. Which gifts those notes
              record is the path in How a gift is recorded. {TRACKING_CHART.refresh}
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
