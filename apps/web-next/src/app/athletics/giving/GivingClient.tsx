"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  formatGiftDate,
  giftsInRange,
  isGivingReady,
  usd,
  usdExact,
  type AthleticsGivingGift,
  type AthleticsGivingSnapshot,
} from "@/lib/reports/athletics-giving/shape";

function weekStartIso(asOf: string | undefined): string {
  const day = asOf ? asOf.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
}

export function GivingClient() {
  const [data, setData] = useState<AthleticsGivingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"weekly" | "all">("weekly");
  const [fund, setFund] = useState("all");
  const [search, setSearch] = useState("");

  function load() {
    setLoading(true);
    apiFetch("/api/athletics-giving-data")
      .then(async (response) => {
        const json = (await response.json()) as AthleticsGivingSnapshot;
        if (!response.ok) throw new Error(json.error || `Error ${response.status}`);
        if (!isGivingReady(json)) throw new Error("Athletics giving snapshot is incomplete.");
        setData(json);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message || "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const asOfDay = data?.asOf?.slice(0, 10) || null;
  const weeklyStart = weekStartIso(data?.asOf);
  const visible = useMemo(() => {
    if (!data) return [];
    const ranged =
      tab === "weekly" ? giftsInRange(data.gifts, weeklyStart, asOfDay) : data.gifts;
    const needle = search.trim().toLowerCase();
    return ranged.filter((gift) => {
      if (fund !== "all" && (gift.projectCode || gift.project || "") !== fund) return false;
      if (!needle) return true;
      return [gift.contactName, gift.project, gift.segment, gift.projectCode]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [data, tab, fund, search, weeklyStart, asOfDay]);

  const fundOptions = data?.funds ?? [];
  const maxFund = Math.max(1, ...fundOptions.filter((item) => !item.isFee).map((item) => item.amount));

  return (
    <main className="ath-page ath-giving">
      <div className="ath-page-heading">
        <div>
          <h1>Athletics Giving</h1>
          <p>
            Gifts posted to Athletics Fundraising, Athletics - Specific Sport, and the
            historical athletics segment in Virtuous
            {data?.fiscalYearLabel ? ` · ${data.fiscalYearLabel}` : ""}
            {data?.generated_at ? ` · updated ${data.generated_at.slice(0, 10)}` : ""}.
          </p>
        </div>
        <button type="button" className="ath-primary" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="ath-state">
          <p>{error}</p>
        </div>
      ) : null}

      {!error && data ? (
        <>
          <div className="ath-kpi-grid">
            <div className="ath-kpi">
              <span>Last 7 days</span>
              <strong>{usd(data.weekly.programAmount)}</strong>
              <small>
                {data.weekly.giftCount} gifts
                {data.weekly.feeAmount ? ` · ${usdExact(data.weekly.feeAmount)} fees` : ""}
              </small>
            </div>
            <div className="ath-kpi">
              <span>{data.fiscalYearLabel} FYTD</span>
              <strong>{usd(data.fytd.programAmount)}</strong>
              <small>
                {data.fytd.giftCount} gifts
                {data.fytd.feeAmount ? ` · ${usdExact(data.fytd.feeAmount)} fees` : ""}
              </small>
            </div>
            <div className="ath-kpi">
              <span>All-time</span>
              <strong>{usd(data.allTime.programAmount)}</strong>
              <small>
                {data.allTime.giftCount} gifts on these segments
                {data.allTime.feeAmount ? ` · ${usdExact(data.allTime.feeAmount)} fees` : ""}
              </small>
            </div>
          </div>

          <section className="ath-giving-funds">
            <h2>By fund</h2>
            <p>Program designations only. Donor-paid card fees are listed separately in the gift table.</p>
            <div className="ath-giving-fund-list">
              {fundOptions
                .filter((item) => !item.isFee)
                .map((item) => (
                  <button
                    key={`${item.projectCode || ""}-${item.project || ""}`}
                    type="button"
                    className={fund === (item.projectCode || item.project || "") ? "is-active" : ""}
                    onClick={() =>
                      setFund((current) =>
                        current === (item.projectCode || item.project || "")
                          ? "all"
                          : item.projectCode || item.project || "all",
                      )
                    }
                  >
                    <span>{item.project || item.projectCode || "Unnamed fund"}</span>
                    <b>{usd(item.amount)}</b>
                    <i style={{ width: `${Math.round((item.amount / maxFund) * 100)}%` }} />
                  </button>
                ))}
            </div>
          </section>

          <section className="ath-card ath-giving-table">
            <div className="ath-card-title">
              <h2>{tab === "weekly" ? "Athletics gifts — previous 7 days" : "Athletics gifts — all"}</h2>
              <div className="ath-giving-tabs">
                <button type="button" className={tab === "weekly" ? "is-active" : ""} onClick={() => setTab("weekly")}>
                  Weekly
                </button>
                <button type="button" className={tab === "all" ? "is-active" : ""} onClick={() => setTab("all")}>
                  All gifts
                </button>
              </div>
            </div>
            <div className="ath-table-tools">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search donor, fund, or segment"
              />
              <span>
                {visible.length} row{visible.length === 1 ? "" : "s"}
                {fund !== "all" ? " · fund filter on" : ""}
              </span>
            </div>
            <GiftTable rows={visible} />
          </section>
        </>
      ) : null}
    </main>
  );
}

function GiftTable({ rows }: { rows: AthleticsGivingGift[] }) {
  if (!rows.length) {
    return <p className="ath-empty">No gifts in this view.</p>;
  }
  return (
    <div className="ath-table-scroll">
      <table className="ath-table">
        <thead>
          <tr>
            <th>Gift Date</th>
            <th>Donor</th>
            <th>Amount</th>
            <th>Fund</th>
            <th>Segment</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.giftId ?? "x"}-${row.projectCode ?? ""}-${index}`}>
              <td>{formatGiftDate(row.giftDate)}</td>
              <td>
                {row.contactUrl ? (
                  <a href={row.contactUrl} target="_blank" rel="noreferrer">
                    {row.contactName || "Unnamed donor"}
                  </a>
                ) : (
                  row.contactName || "Unnamed donor"
                )}
              </td>
              <td>{usdExact(row.amountDesignated)}</td>
              <td>
                {row.project || row.projectCode || "—"}
                {row.isFee ? " (fee)" : ""}
              </td>
              <td>{row.segment || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
