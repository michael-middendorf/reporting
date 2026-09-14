"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { EnrollmentSummary } from "@/lib/reports/athletics-coaching/enrollment";
import { formatAsOf, formatCount } from "./CoachingHub";

export function EnrollmentBand({ sportKey }: { sportKey: string }) {
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
          {data.generatedAt ? <p>{formatAsOf(data.generatedAt)}</p> : null}
        </>
      ) : null}
    </section>
  );
}
