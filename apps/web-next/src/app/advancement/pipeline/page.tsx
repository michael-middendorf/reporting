"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { count, formatEastern, usd } from "@/lib/reports/advancement-overview/shape";
import {
  ALL_OFFICERS,
  filterByOfficer,
  isPastDue,
  isPipelineReady,
  isStale,
  officerName,
  officerOptions,
  shortDate,
  sortByAmount,
  statusLabel,
  sumAmount,
  type AdvancementPipelineSnapshot,
  type PipelineBucketKey,
  type SortDir,
} from "@/lib/reports/advancement-pipeline/shape";
import "@/styles/annunciation.css";
import "@/styles/advancement-overview.css";
import "@/styles/advancement-pipeline.css";

const COLUMNS = 11;

function AdvancementPipelinePage() {
  const [data, setData] = useState<AdvancementPipelineSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<PipelineBucketKey>("to_be_asked");
  const [officer, setOfficer] = useState<string>(ALL_OFFICERS);
  const [dir, setDir] = useState<SortDir>("desc");
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  function readSnapshot() {
    return apiFetch("/api/advancement-pipeline-data").then(async (r) => {
      const json = (await r.json()) as AdvancementPipelineSnapshot;
      if (!r.ok) throw new Error(json.error || `Error ${r.status}`);
      return json;
    });
  }

  function load() {
    setLoading(true);
    readSnapshot()
      .then((json) => {
        setData(json);
        setLoadedAt(Date.now());
        setError(null);
      })
      .catch((e: Error) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    readSnapshot()
      .then((json) => {
        if (cancelled) return;
        setData(json);
        setLoadedAt(Date.now());
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = isPipelineReady(data);
  const buckets = useMemo(() => (ready ? data.buckets : []), [ready, data]);
  const officers = useMemo(() => officerOptions(buckets), [buckets]);
  const active = buckets.find((b) => b.key === tab) ?? buckets[0];
  const rows = useMemo(
    () => sortByAmount(filterByOfficer(active?.rows ?? [], officer), dir),
    [active, officer, dir],
  );
  const filtered = officer !== ALL_OFFICERS;
  const stale = ready && loadedAt !== null && isStale(data.generated_at, loadedAt);

  return (
    <main className="ac-page ao-page">
      <div className="ac-head">
        <div>
          <h1>{data?.fiscalYearLabel ?? "FY"} Gift Pipeline</h1>
          <p className="ac-sub">
            Gift asks from Virtuous expected to close this fiscal year
            {data?.window ? ` (${shortDate(data.window.start)} to ${shortDate(data.window.end)})` : ""}
            {data?.generated_at ? ` · as of ${formatEastern(data.generated_at)}` : ""}
          </p>
        </div>
        <button type="button" className="ac-refresh" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="ac-error">
          <p>{error}</p>
        </div>
      )}

      {!error && stale && (
        <div className="ap-stale" role="status">
          <p>
            This data last refreshed {formatEastern(data.generated_at)}. The scheduled refresh may be
            failing, so these figures may be out of date. Let IT know if this message stays up.
          </p>
        </div>
      )}

      {!error && !ready && loading && <p className="ac-empty">Loading…</p>}

      {!error && ready && active && (
        <>
          <div className="ap-tabs" role="tablist" aria-label="Pipeline stage">
            {buckets.map((b) => (
              <button
                key={b.key}
                type="button"
                role="tab"
                id={`ap-tab-${b.key}`}
                aria-selected={b.key === active.key}
                aria-controls="ap-panel"
                className="ap-tab"
                onClick={() => setTab(b.key)}
              >
                <div className="ap-tab-label">{b.label}</div>
                <div className="ap-tab-value">{usd(b.totalAmount)}</div>
                <div className="ap-tab-count">
                  {count(b.count)} ask{b.count === 1 ? "" : "s"}
                </div>
              </button>
            ))}
          </div>

          <div className="ac-toolbar">
            <label className="ap-officer">
              Gift officer
              <select value={officer} onChange={(e) => setOfficer(e.target.value)}>
                <option value={ALL_OFFICERS}>All officers</option>
                {officers.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <span className="ac-count">
              {count(rows.length)} ask{rows.length === 1 ? "" : "s"} · {usd(sumAmount(rows))}
              {filtered ? ` for ${officer}` : ""}
            </span>
          </div>

          <div
            className="ac-table-wrap"
            role="tabpanel"
            id="ap-panel"
            aria-labelledby={`ap-tab-${active.key}`}
          >
            <table className="ac-table ap-table">
              <thead>
                <tr>
                  <th>Ask Date</th>
                  <th>Donor</th>
                  <th>Status</th>
                  <th className="ac-num" aria-sort={dir === "desc" ? "descending" : "ascending"}>
                    <button
                      type="button"
                      className="ap-sort"
                      onClick={() => setDir(dir === "desc" ? "asc" : "desc")}
                      title="Sort by ask amount"
                    >
                      Ask Amount {dir === "desc" ? "▼" : "▲"}
                    </button>
                  </th>
                  <th>Expected Fulfillment</th>
                  <th>Assigned Gift Officer</th>
                  <th>Reason</th>
                  <th>City</th>
                  <th>State</th>
                  <th>Fund</th>
                  <th>Class</th>
                </tr>
              </thead>
              <tbody>
                {rows.length > 0 && (
                  <tr className="ap-total-row">
                    <td colSpan={3}>Total</td>
                    <td className="ac-num">{usd(sumAmount(rows))}</td>
                    <td colSpan={COLUMNS - 4} />
                  </tr>
                )}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS} className="ac-empty">
                      {filtered
                        ? `No ${active.label} asks for ${officer}.`
                        : `No ${active.label} asks expected this fiscal year.`}
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.askId}>
                    <td>{shortDate(r.askDate)}</td>
                    <td className="ap-wrap">{r.donor}</td>
                    <td className="ap-wrap">{statusLabel(r.status)}</td>
                    <td className="ac-num">{usd(r.askAmount)}</td>
                    <td>
                      {shortDate(r.expectedFulfillmentDate)}
                      {isPastDue(r, data.asOf) ? <span className="ap-due">Past due</span> : null}
                    </td>
                    <td>{officerName(r)}</td>
                    <td className="ap-reason">{r.reason ?? ""}</td>
                    <td>{r.city ?? ""}</td>
                    <td>{r.state ?? ""}</td>
                    <td className="ap-wrap">{r.fund ?? ""}</td>
                    <td>{r.fundClass ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="ap-note">
            {active.label} covers {active.statuses.map(statusLabel).join(" and ")}. Declined and
            received asks are left out. Class comes from the fund classification table and is blank
            when the ask has no fund or the fund is not classified.
          </p>
        </>
      )}

      {!error && !ready && !loading && (
        <div className="ac-error">
          <p>Gift pipeline detail is not published yet. Wait for the next refresh.</p>
        </div>
      )}
    </main>
  );
}

export default function AdvancementPipelineRoute() {
  return <AdvancementPipelinePage />;
}
