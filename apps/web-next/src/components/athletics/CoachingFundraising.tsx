"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { SportFundraising } from "@/lib/reports/athletics-coaching/fundraising";
import { formatAsOf, formatCount, formatMoney } from "./CoachingHub";

export function FundraisingBand({ sportKey }: { sportKey: string }) {
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
          {data.fyStart && data.fyEnd ? (
            <p>
              Fiscal year {data.fyStart} to {data.fyEnd}
              {data.fiscalYear ? ` (FY ${data.fiscalYear})` : ""}.
            </p>
          ) : null}
          {data.asOf ? <p>{formatAsOf(data.asOf)}</p> : null}
        </>
      ) : null}
    </section>
  );
}
