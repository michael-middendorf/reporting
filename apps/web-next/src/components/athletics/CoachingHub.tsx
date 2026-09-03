"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { EnrollmentSummary } from "@/lib/reports/athletics-coaching/enrollment";
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

export function CoachingBands({ sportKey, sportLabel }: { sportKey: string; sportLabel: string }) {
  return (
    <main className="ath-page">
      <div className="ath-page-heading">
        <div>
          <h1>{sportLabel}</h1>
          <p>Team dashboard. Fundraising and academics are not in the report yet.</p>
        </div>
      </div>
      <div className="ath-coach-bands">
        <section className="ath-coach-band">
          <h2>Fundraising</h2>
          <p>Gift totals for this team are coming. Nothing is shown here until the fundraising feed is live.</p>
        </section>
        <EnrollmentBand sportKey={sportKey} />
        <section className="ath-coach-band">
          <h2>Academics</h2>
          <p>Academic standing for this team is coming. Named student rows are not part of this report yet.</p>
        </section>
      </div>
    </main>
  );
}
