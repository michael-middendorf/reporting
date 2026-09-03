"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
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

export function CoachingBands({ sportKey, sportLabel }: { sportKey: string; sportLabel: string }) {
  return (
    <main className="ath-page">
      <div className="ath-page-heading">
        <div>
          <h1>{sportLabel}</h1>
          <p>Team dashboard. Academics are not in the report yet.</p>
        </div>
      </div>
      <div className="ath-coach-bands">
        <FundraisingBand sportKey={sportKey} />
        <EnrollmentBand sportKey={sportKey} />
        <section className="ath-coach-band">
          <h2>Academics</h2>
          <p>Academic standing for this team is coming. Named student rows are not part of this report yet.</p>
        </section>
      </div>
    </main>
  );
}
