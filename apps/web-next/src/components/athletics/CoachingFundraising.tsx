"use client";

import { useSportFetch } from "./useSportFetch";
import type { FundraisingGift, SportFundraising } from "@/lib/reports/athletics-coaching/fundraising";
import { formatAsOf, formatCount, formatMoney } from "./CoachingHub";

function byNewest(left: FundraisingGift, right: FundraisingGift) {
  return right.giftDate.localeCompare(left.giftDate);
}

function GiftTable({ gifts }: { gifts: FundraisingGift[] }) {
  return (
    <div className="ath-table-scroll ath-coach-academics">
      <table className="ath-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Donor</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {gifts.map((gift, index) => (
            <tr key={`${gift.giftDate}-${gift.donorName}-${gift.amount}-${index}`}>
              <td>{gift.giftDate}</td>
              <td>{gift.donorName}</td>
              <td>{formatMoney(gift.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FundraisingBand({ sportKey }: { sportKey: string }) {
  const { data, error, loading } = useSportFetch<SportFundraising>(
    `/api/athletics-coaching/fundraising?sport=${encodeURIComponent(sportKey)}`,
    { fallbackError: "Unable to load fundraising" },
  );

  const unmapped = Boolean(data && !data.mapped);
  const unavailable = Boolean(data && data.reason === "unavailable");
  const gifts = data?.gifts ?? [];
  const fytdGifts = gifts.filter((gift) => gift.fytd).sort(byNewest);
  const allGifts = [...gifts].sort(byNewest);
  const hasTotals = Boolean(
    data &&
      ((data.fytdAmount ?? 0) > 0 ||
        (data.allTimeAmount ?? 0) > 0 ||
        (data.fytdGiftCount ?? 0) > 0 ||
        (data.allTimeGiftCount ?? 0) > 0),
  );

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
            {data.fiscalYearLabel ? ` (${data.fiscalYearLabel})` : ""}.
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
          {allGifts.length ? (
            <>
              <h3>This fiscal year</h3>
              {fytdGifts.length ? (
                <GiftTable gifts={fytdGifts} />
              ) : (
                <p>No gifts this fiscal year yet.</p>
              )}
              <h3>All-time</h3>
              <GiftTable gifts={allGifts} />
            </>
          ) : (
            <p>
              {hasTotals
                ? "Gift list is not in this snapshot yet."
                : "No gifts on this sport fund yet."}
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
