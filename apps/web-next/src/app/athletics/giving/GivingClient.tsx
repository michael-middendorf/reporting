"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { SimpleXlsx, triggerXlsxDownload } from "@/lib/aspiredu-xlsx";
import gyreneShield from "@/assets/athletics/gyrene-shield.png";
import {
  DATE_PRESETS,
  datePresetLabel,
  filterGifts,
  formatGiftDate,
  fundsFromGifts,
  fundsThisYearVsLastYear,
  giftExportRows,
  giftsFromLastTwoFiscalYears,
  intersectDateRange,
  isGivingReady,
  previousFiscalYearWindow,
  shortFiscalYearLabel,
  shortPreviousFiscalYearLabel,
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
  const thisFyStart = data?.fyStart?.slice(0, 10) || "";
  const lastFy = useMemo(() => previousFiscalYearWindow(thisFyStart), [thisFyStart]);
  const thisFyShort = shortFiscalYearLabel(data?.fiscalYearLabel);
  const lastFyShort = shortPreviousFiscalYearLabel(data?.fiscalYearLabel);
  const gifts = useMemo(
    () => (data ? giftsFromLastTwoFiscalYears(data.gifts, data.fyStart) : []),
    [data],
  );
  const range = useMemo(
    () => rangeForPreset(preset, asOf || "2026-09-14", data?.fyStart || "", customStart, customEnd),
    [preset, asOf, data?.fyStart, customStart, customEnd],
  );

  const visible = useMemo(
    () =>
      filterGifts(gifts, {
        start: range.start,
        end: range.end,
        sportKey: "all",
        fund,
        search,
      }),
    [gifts, range.start, range.end, fund, search],
  );

  const fundGifts = useMemo(
    () =>
      filterGifts(gifts, {
        start: range.start,
        end: range.end,
        sportKey: "all",
        fund: "all",
        search: "",
      }),
    [gifts, range.start, range.end],
  );
  const yearWindows = useMemo(() => {
    const thisWindow = intersectDateRange(range.start, range.end, thisFyStart, asOf);
    const lastWindow = intersectDateRange(range.start, range.end, lastFy.start, lastFy.end);
    return { thisWindow, lastWindow, compareYears: Boolean(thisWindow && lastWindow) };
  }, [range.start, range.end, thisFyStart, asOf, lastFy.start, lastFy.end]);
  const fundCompare = useMemo(
    () =>
      yearWindows.compareYears && yearWindows.thisWindow && yearWindows.lastWindow
        ? fundsThisYearVsLastYear(
            fundGifts,
            yearWindows.thisWindow.start,
            yearWindows.thisWindow.end,
            yearWindows.lastWindow.start,
            yearWindows.lastWindow.end,
          ).filter((row) => row.thisYear || row.lastYear)
        : [],
    [fundGifts, yearWindows],
  );
  const fundSingle = useMemo(
    () => fundsFromGifts(fundGifts).filter((item) => !item.isFee && item.amount > 0),
    [fundGifts],
  );
  const compareYears = yearWindows.compareYears;
  const fundRows = compareYears ? fundCompare : fundSingle;
  const totals = useMemo(() => totalsFromGifts(visible), [visible]);
  const fyTotals = useMemo(
    () =>
      totalsFromGifts(
        filterGifts(gifts, {
          start: thisFyStart || null,
          end: asOf || null,
          sportKey: "all",
          fund,
          search: "",
        }),
      ),
    [gifts, thisFyStart, asOf, fund],
  );
  const lastFyTotals = useMemo(
    () =>
      totalsFromGifts(
        filterGifts(gifts, {
          start: lastFy.start || null,
          end: lastFy.end || null,
          sportKey: "all",
          fund,
          search: "",
        }),
      ),
    [gifts, lastFy.start, lastFy.end, fund],
  );
  const maxFund = Math.max(
    1,
    ...fundCompare.map((item) => item.thisYear),
    ...fundSingle.map((item) => item.amount),
  );
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
    thisFyStart && asOf
      ? `${formatGiftDate(thisFyStart)} to ${formatGiftDate(asOf)}`
      : data?.fiscalYearLabel || "this fiscal year";
  const lastFyRangeLabel =
    lastFy.start && lastFy.end
      ? `${formatGiftDate(lastFy.start)} to ${formatGiftDate(lastFy.end)}`
      : lastFyShort;

  const filtersActive =
    fund !== "all" || search.trim() !== "" || preset !== "fytd" || Boolean(customStart || customEnd);

  function clearFilters() {
    setPreset("fytd");
    setCustomStart("");
    setCustomEnd("");
    setFund("all");
    setSearch("");
  }

  function exportExcel() {
    const book = new SimpleXlsx();
    book.addSheet("Gifts", giftExportRows(visible));
    const stamp = asOf || new Date().toISOString().slice(0, 10);
    triggerXlsxDownload(`Athletics_Giving_${stamp}.xlsx`, book.write());
  }

  return (
    <main className="ath-page ath-giving">
      <div className="ath-page-heading ath-giving-banner">
        <div className="ath-brand-lockup">
          <img
            className="ath-brand-shield"
            src={gyreneShield.src}
            alt="Ave Maria University Gyrenes"
            width={64}
            height={68}
          />
          <div>
            <p className="ath-kicker">Athletics</p>
            <h1>Giving</h1>
          </div>
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
                    {datePresetLabel(item.id, data.fiscalYearLabel)}
                  </button>
                ))}
              </div>
            </div>
            <label>
              From
              <input
                type="date"
                min={lastFy.start || undefined}
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
                min={lastFy.start || undefined}
                value={preset === "custom" ? customEnd : range.end || ""}
                onChange={(event) => {
                  setPreset("custom");
                  setCustomStart(preset === "custom" ? customStart : range.start || "");
                  setCustomEnd(event.target.value);
                }}
              />
            </label>
            <button
              type="button"
              className="ath-secondary ath-giving-clear"
              onClick={clearFilters}
              disabled={!filtersActive}
            >
              Clear filters
            </button>
          </div>

          <div className="ath-kpi-grid ath-giving-kpis">
            <div className="ath-kpi">
              <span>Total gifts received</span>
              <strong>{usd(totals.programAmount)}</strong>
              <small>
                {periodLabel} · {rangeLabel}
                {totals.giftCount || totals.feeAmount
                  ? ` · ${totals.giftCount} gift${totals.giftCount === 1 ? "" : "s"}`
                  : ""}
                {totals.designationCount !== totals.giftCount ? ` · ${totals.designationCount} fund splits` : ""}
                {totals.feeAmount ? ` · ${usdExact(totals.feeAmount)} fees` : ""}
              </small>
            </div>
            <div className="ath-kpi">
              <span>{thisFyShort}</span>
              <strong>{usd(fyTotals.programAmount)}</strong>
              <small>
                {fyRangeLabel} · {fyTotals.giftCount} gift{fyTotals.giftCount === 1 ? "" : "s"}
              </small>
            </div>
            <div className="ath-kpi">
              <span>{lastFyShort}</span>
              <strong>{usd(lastFyTotals.programAmount)}</strong>
              <small>
                {lastFyRangeLabel} · {lastFyTotals.giftCount} gift{lastFyTotals.giftCount === 1 ? "" : "s"}
              </small>
            </div>
          </div>

          <section className="ath-giving-funds">
            <h2>By fund</h2>
            <p>
              {compareYears ? `${thisFyShort} vs ${lastFyShort}` : periodLabel}. Click a fund to
              filter the table.
            </p>
            <div className="ath-giving-fund-list">
              {compareYears
                ? fundCompare.map((item) => (
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
                      <span className="ath-giving-fund-name">{item.project || item.projectCode || "Unnamed fund"}</span>
                      <span className="ath-giving-fund-amt">
                        <b>{usd(item.thisYear)}</b>
                        <small>{usd(item.lastYear)}</small>
                      </span>
                      <i style={{ width: `${Math.round((item.thisYear / maxFund) * 100)}%` }} />
                    </button>
                  ))
                : fundSingle.map((item) => (
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
                      <span className="ath-giving-fund-name">{item.project || item.projectCode || "Unnamed fund"}</span>
                      <b>{usd(item.amount)}</b>
                      <i style={{ width: `${Math.round((item.amount / maxFund) * 100)}%` }} />
                    </button>
                  ))}
              {!fundRows.length ? <p className="ath-empty">No funds in this date range.</p> : null}
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
