"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { AcademicsSummary } from "@/lib/reports/athletics-coaching/academics";
import type { EnrollmentSummary } from "@/lib/reports/athletics-coaching/enrollment";
import type { SportFundraising } from "@/lib/reports/athletics-coaching/fundraising";
import type { SportDef } from "@/lib/reports/athletics-coaching/sports";

export function CoachingDenied({ message }: { message?: string }) {
  return (
    <div className="ath-state">
      <p>{message || "You do not have access to this report."}</p>
      <Link href="/athletics">Back to Athletics</Link>
    </div>
  );
}

export function TeamPicker({ sports, title, description }: { sports: SportDef[]; title: string; description: string }) {
  const ordered = [...sports].sort((a, b) => a.label.localeCompare(b.label));
  return (
    <main className="ath-hub">
      <header className="ath-hub-header">
        <span>Athletics</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {ordered.length ? (
        <div className="ath-hub-grid">
          {ordered.map((sport) => (
            <Link key={sport.key} href={`/athletics/coaching/${sport.key}`} className="ath-hub-card">
              <h2>{sport.label}</h2>
              <p>Team dashboard for fundraising, enrollment, and academics.</p>
              <strong>Open →</strong>
            </Link>
          ))}
        </div>
      ) : (
        <p className="ath-empty">No teams are assigned to this account yet.</p>
      )}
    </main>
  );
}

function formatCount(count: number | null): string {
  if (count === null) return "n/a";
  return String(count);
}

function formatMoney(amount: number | null): string {
  if (amount === null) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatAsOf(asOf: string | null): string {
  if (!asOf) return "";
  return `As of ${asOf.slice(0, 10)}`;
}

function FundraisingBand({ sportKey }: { sportKey: string }) {
  const [data, setData] = useState<SportFundraising | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/api/athletics-coaching/fundraising?sport=${encodeURIComponent(sportKey)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load fundraising");
        if (!cancelled) setData(body as SportFundraising);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sportKey]);

  const unmapped = Boolean(data && !data.mapped);
  const unavailable = Boolean(data && data.reason === "unavailable");

  return (
    <section className="ath-coach-band">
      <h2>Fundraising</h2>
      {loading ? <p>Loading gift totals…</p> : null}
      {error ? <p>{error}</p> : null}
      {!loading && !error && data && unmapped ? <p>No sport fund mapped</p> : null}
      {!loading && !error && data && unavailable ? (
        <p>Fundraising totals are unavailable.</p>
      ) : null}
      {!loading && !error && data && data.mapped && !unavailable ? (
        <>
          <p>
            Gift totals for this team&apos;s sport fund
            {data.fiscalYearLabel ? ` (${data.fiscalYearLabel})` : ""}. Donor names are not shown.
          </p>
          <div className="ath-coach-kpis">
            <div className="ath-kpi">
              <span>FYTD</span>
              <strong>{formatMoney(data.fytdAmount)}</strong>
              <small>{data.fiscalYearLabel || "This fiscal year"}</small>
            </div>
            <div className="ath-kpi">
              <span>All-time</span>
              <strong>{formatMoney(data.allTimeAmount)}</strong>
              <small>Life-to-date on the sport fund</small>
            </div>
            <div className="ath-kpi">
              <span>FYTD gifts</span>
              <strong>{formatCount(data.fytdGiftCount)}</strong>
              <small>Gifts this fiscal year</small>
            </div>
            <div className="ath-kpi">
              <span>All-time gifts</span>
              <strong>{formatCount(data.allTimeGiftCount)}</strong>
              <small>Gifts on the sport fund</small>
            </div>
          </div>
          {data.asOf ? <p>{formatAsOf(data.asOf)}</p> : null}
        </>
      ) : null}
    </section>
  );
}

function EnrollmentBand({ sportKey }: { sportKey: string }) {
  const [data, setData] = useState<EnrollmentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/api/athletics-coaching/enrollment?sport=${encodeURIComponent(sportKey)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load enrollment");
        if (!cancelled) setData(body as EnrollmentSummary);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sportKey]);

  return (
    <section className="ath-coach-band">
      <h2>Enrollment</h2>
      {loading ? <p>Loading roster and recruiting counts…</p> : null}
      {error ? <p>{error}</p> : null}
      {!loading && !error && data ? (
        <>
          {data.roster.available ? (
            <p>
              Current roster headcount for this team. Class-year mix is shown only when Slate
              sends a class year.
            </p>
          ) : (
            <p>Awaiting roster secret. Current-athlete headcount is not shown until that feed lands.</p>
          )}
          <div className="ath-coach-kpis">
            <div className="ath-kpi">
              <span>Current roster</span>
              <strong>{formatCount(data.roster.available ? data.roster.count : null)}</strong>
              <small>{data.roster.available ? "From the Slate roster feed" : "Awaiting roster secret"}</small>
            </div>
            <div className="ath-kpi">
              <span>Signed / deposited</span>
              <strong>{formatCount(data.signed.available ? data.signed.count : null)}</strong>
              <small>
                {data.signed.available
                  ? "Varsity LOI signed or deposited"
                  : "Recruiting applications not published yet"}
              </small>
            </div>
            <div className="ath-kpi">
              <span>Applications</span>
              <strong>{formatCount(data.applications.available ? data.applications.count : null)}</strong>
              <small>
                {data.applications.available
                  ? "Applications for this sport"
                  : "Recruiting applications not published yet"}
              </small>
            </div>
          </div>
          {data.roster.classYearMix.length ? (
            <div className="ath-coach-mix">
              {data.roster.classYearMix.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function formatWhen(value: string | null): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleDateString();
}

function pulseLabel(band: "attending" | "watch" | "inactive"): string {
  if (band === "attending") return "Attending";
  if (band === "watch") return "Watch";
  return "Inactive";
}

function AcademicsBand({ sportKey }: { sportKey: string }) {
  const [data, setData] = useState<AcademicsSummary | null>(null);
  const [mfaUrl, setMfaUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMfaUrl(null);
    apiFetch(`/api/athletics-coaching/academics?sport=${encodeURIComponent(sportKey)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (response.status === 401 && body.mfaUrl) {
          if (!cancelled) setMfaUrl(String(body.mfaUrl));
          return;
        }
        if (!response.ok) throw new Error(body.error || "Unable to load academics");
        if (!cancelled) setData(body as AcademicsSummary);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sportKey]);

  return (
    <section className="ath-coach-band">
      <h2>Academics</h2>
      {loading ? <p>Loading academic snapshots…</p> : null}
      {mfaUrl ? (
        <p>
          Named athlete academics need an authenticator code.{" "}
          <Link href={mfaUrl}>Continue with authenticator</Link>
        </p>
      ) : null}
      {error ? <p>{error}</p> : null}
      {!loading && !error && !mfaUrl && data && !data.rosterAvailable ? (
        <p>The roster feed is not in yet. Named student academics cannot be shown until the roster lands.</p>
      ) : null}
      {!loading && !error && !mfaUrl && data?.rosterAvailable ? (
        <>
          <p>
            {data.matchedCount} of {data.rosterCount} rostered athletes have an academic snapshot
            {data.asOf ? ` as of ${formatWhen(data.asOf)}` : ""}.
          </p>
          {data.athletes.length ? (
            <div className="ath-table-scroll ath-coach-academics">
              <table className="ath-table">
                <thead>
                  <tr>
                    <th>Athlete</th>
                    <th>Risk</th>
                    <th>Attendance pulse</th>
                    <th>Last attended</th>
                  </tr>
                </thead>
                <tbody>
                  {data.athletes.map((athlete) => {
                    const key = athlete.email || athlete.pcid || athlete.name;
                    const expanded = open === key;
                    return (
                      <Fragment key={key}>
                        <tr>
                          <td>
                            <button
                              type="button"
                              className="ath-text-btn"
                              onClick={() => setOpen(expanded ? null : key)}
                              disabled={!athlete.matched}
                            >
                              {athlete.name}
                            </button>
                            {!athlete.matched ? (
                              <span className="ath-badge">no academic snapshot</span>
                            ) : null}
                          </td>
                          <td>{athlete.matched ? athlete.risk || "—" : "—"}</td>
                          <td>
                            {athlete.pulse ? pulseLabel(athlete.pulse.band) : "—"}
                          </td>
                          <td>{formatWhen(athlete.lastAttended)}</td>
                        </tr>
                        {expanded ? (
                          <tr className="ath-coach-courses">
                            <td colSpan={4}>
                              {athlete.courses.length ? (
                                <table className="ath-table">
                                  <thead>
                                    <tr>
                                      <th>Course</th>
                                      <th>Grade</th>
                                      <th>Missing</th>
                                      <th>Last access</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {athlete.courses.map((course, index) => (
                                      <tr key={`${key}-course-${index}`}>
                                        <td>{course.course}</td>
                                        <td>{course.grade ?? "—"}</td>
                                        <td>{course.missing ?? "—"}</td>
                                        <td>{formatWhen(course.lastAccess)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (
                                <p>No course rows in this snapshot.</p>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No rostered athletes for this team.</p>
          )}
        </>
      ) : null}
    </section>
  );
}

export function CoachingBands({ sportKey, sportLabel }: { sportKey: string; sportLabel: string }) {
  return (
    <main className="ath-page">
      <div className="ath-page-heading">
        <div>
          <h1>{sportLabel}</h1>
          <p>Team dashboard.</p>
        </div>
      </div>
      <div className="ath-coach-bands">
        <FundraisingBand sportKey={sportKey} />
        <EnrollmentBand sportKey={sportKey} />
        <AcademicsBand sportKey={sportKey} />
      </div>
    </main>
  );
}
