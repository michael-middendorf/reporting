"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { SimpleXlsx, triggerXlsxDownload } from "@/lib/aspiredu-xlsx";
import { SPORTS } from "@/lib/reports/athletics-coaching/sports";
import {
  DATE_PRESETS,
  datePresetLabel,
  filterGifts,
  formatGiftDate,
  fundsFromGifts,
  giftExportRows,
  isGivingReady,
  rangeForPreset,
  sportForGift,
  totalsFromGifts,
  usd,
  usdExact,
  type AthleticsGivingGift,
  type AthleticsGivingSnapshot,
  type DatePreset,
} from "@/lib/reports/athletics-giving/shape";

export function GivingClient() {
  const [data, setData] = useState<AthleticsGivingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<DatePreset>("fytd");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [sportKey, setSportKey] = useState("all");
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

  const asOf = data?.asOf?.slice(0, 10) || "";
  const range = useMemo(
    () => rangeForPreset(preset, asOf || "2026-09-14", data?.fyStart || "", customStart, customEnd),
    [preset, asOf, data?.fyStart, customStart, customEnd],
  );

  const dated = useMemo(
    () =>
      data
        ? filterGifts(data.gifts, {
            start: range.start,
            end: range.end,
            sportKey: "all",
            fund: "all",
            search: "",
          })
        : [],
    [data, range.start, range.end],
  );

  const sportOptions = useMemo(() => {
    const present = new Set(dated.map((gift) => sportForGift(gift).key));
    return SPORTS.filter((sport) => present.has(sport.key));
  }, [dated]);

  const visible = useMemo(
    () =>
      data
        ? filterGifts(data.gifts, {
            start: range.start,
            end: range.end,
            sportKey,
            fund,
            search,
          })
        : [],
    [data, range.start, range.end, sportKey, fund, search],
  );

  const fundSource = useMemo(
    () =>
      filterGifts(dated, {
        start: null,
        end: null,
        sportKey,
        fund: "all",
        search: "",
      }),
    [dated, sportKey],
  );

  const fundOptions = useMemo(() => fundsFromGifts(fundSource).filter((item) => !item.isFee), [fundSource]);
  const totals = useMemo(() => totalsFromGifts(visible), [visible]);
  const fyTotals = useMemo(
    () =>
      totalsFromGifts(
        filterGifts(data?.gifts || [], {
          start: data?.fyStart?.slice(0, 10) || null,
          end: asOf || null,
          sportKey,
          fund,
          search: "",
        }),
      ),
    [data, asOf, sportKey, fund],
  );
  const allTimeTotals = useMemo(
    () =>
      totalsFromGifts(
        filterGifts(data?.gifts || [], {
          start: null,
          end: null,
          sportKey,
          fund,
          search: "",
        }),
      ),
    [data, sportKey, fund],
  );
  const maxFund = Math.max(1, ...fundOptions.map((item) => item.amount));
  const sportLabel = sportKey === "all" ? "All sports" : sportForGiftLabel(sportKey);
  const periodLabel = datePresetLabel(preset, data?.fiscalYearLabel);
  const rangeLabel =
    range.start && range.end
      ? `${formatGiftDate(range.start)} to ${formatGiftDate(range.end)}`
      : range.start
        ? `from ${formatGiftDate(range.start)}`
        : range.end
          ? `through ${formatGiftDate(range.end)}`
          : "all time";
  const fyRangeLabel =
    data?.fyStart && asOf
      ? `${formatGiftDate(data.fyStart)} to ${formatGiftDate(asOf)}`
      : data?.fiscalYearLabel || "this fiscal year";

  function exportExcel() {
    const book = new SimpleXlsx();
    book.addSheet("Gifts", giftExportRows(visible));
    const stamp = asOf || new Date().toISOString().slice(0, 10);
    triggerXlsxDownload(`Athletics_Giving_${stamp}.xlsx`, book.write());
  }

  return (
    <main className="ath-page ath-giving">
      <div className="ath-page-heading">
        <div>
          <h1>Athletics Giving</h1>
          <p>
            Gifts posted to Athletics Fundraising, Athletics - Specific Sport, and the
            historical athletics segment in Virtuous. Defaults to this fiscal year
            {data?.fiscalYearLabel ? ` (${data.fiscalYearLabel})` : ""}
            {data?.generated_at ? ` · updated ${data.generated_at.slice(0, 10)}` : ""}.
          </p>
        </div>
        <div className="ath-giving-actions">
          <button type="button" className="ath-secondary" onClick={exportExcel} disabled={!visible.length}>
            Export Excel
          </button>
          <button type="button" className="ath-primary" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="ath-state">
          <p>{error}</p>
        </div>
      ) : null}

      {!error && data ? (
        <>
          <div className="ath-giving-filters">
            <label>
              Sport
              <select
                value={sportKey}
                onChange={(event) => {
                  setSportKey(event.target.value);
                  setFund("all");
                }}
              >
                <option value="all">All sports</option>
                {sportOptions.map((sport) => (
                  <option key={sport.key} value={sport.key}>
                    {sport.label}
                  </option>
                ))}
                {dated.some((gift) => sportForGift(gift).key === "other") ? (
                  <option value="other">General / other</option>
                ) : null}
              </select>
            </label>
            <div className="ath-giving-date-filter">
              <span>Gift date</span>
              <div className="ath-giving-date-presets" role="group" aria-label="Gift date">
                {DATE_PRESETS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={preset === item.id ? "is-active" : ""}
                    onClick={() => {
                      setPreset(item.id);
                      if (item.id === "custom" && !customStart && !customEnd) {
                        setCustomStart(range.start || "");
                        setCustomEnd(range.end || asOf);
                      }
                    }}
                  >
                    {item.id === "fytd" && data.fiscalYearLabel
                      ? `This fiscal year (${data.fiscalYearLabel})`
                      : item.label}
                  </button>
                ))}
              </div>
            </div>
            <label>
              From
              <input
                type="date"
                value={preset === "custom" ? customStart : range.start || ""}
                onChange={(event) => {
                  setPreset("custom");
                  setCustomStart(event.target.value);
                  setCustomEnd(preset === "custom" ? customEnd : range.end || asOf);
                }}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={preset === "custom" ? customEnd : range.end || ""}
                onChange={(event) => {
                  setPreset("custom");
                  setCustomStart(preset === "custom" ? customStart : range.start || "");
                  setCustomEnd(event.target.value);
                }}
              />
            </label>
          </div>

          <div className="ath-kpi-grid ath-giving-kpis">
            <div className="ath-kpi">
              <span>Total gifts received</span>
              <strong>{usd(totals.programAmount)}</strong>
              <small>
                {periodLabel} · {sportLabel} · {rangeLabel}
                {totals.giftCount || totals.feeAmount
                  ? ` · ${totals.giftCount} gift${totals.giftCount === 1 ? "" : "s"}`
                  : ""}
                {totals.designationCount !== totals.giftCount ? ` · ${totals.designationCount} fund splits` : ""}
                {totals.feeAmount ? ` · ${usdExact(totals.feeAmount)} fees` : ""}
              </small>
            </div>
            <div className="ath-kpi">
              <span>This fiscal year</span>
              <strong>{usd(fyTotals.programAmount)}</strong>
              <small>
                {data.fiscalYearLabel || "FY"} · {fyRangeLabel} · {fyTotals.giftCount} gift
                {fyTotals.giftCount === 1 ? "" : "s"}
              </small>
            </div>
            <div className="ath-kpi">
              <span>All time</span>
              <strong>{usd(allTimeTotals.programAmount)}</strong>
              <small>
                Every year on record · {allTimeTotals.giftCount} gift
                {allTimeTotals.giftCount === 1 ? "" : "s"}
              </small>
            </div>
          </div>

          <section className="ath-giving-funds">
            <h2>By fund</h2>
            <p>
              {periodLabel} amounts{sportKey === "all" ? "" : ` for ${sportLabel}`}. Click a fund to filter the
              total and table.
            </p>
            <div className="ath-giving-fund-list">
              {fundOptions.map((item) => (
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
              {!fundOptions.length ? <p className="ath-empty">No funds in this filter.</p> : null}
            </div>
          </section>

          <section className="ath-card ath-giving-table">
            <div className="ath-card-title">
              <h2>Athletics gifts · {periodLabel}</h2>
            </div>
            <div className="ath-table-tools">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search donor, fund, or sport"
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

function sportForGiftLabel(key: string): string {
  if (key === "other") return "General / other";
  return SPORTS.find((sport) => sport.key === key)?.label || key;
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
            <th>Sport</th>
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
              <td>{sportForGift(row).label}</td>
              <td>{row.segment || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
