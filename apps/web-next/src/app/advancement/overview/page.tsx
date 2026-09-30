"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  barFill,
  count,
  formatEastern,
  isOverviewReady,
  pct,
  usd,
  type AdvancementOverviewSnapshot,
  type PipelineRow,
  type YtdRow,
} from "@/lib/reports/advancement-overview/shape";
import "@/styles/annunciation.css";
import "@/styles/advancement-overview.css";

function plusUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "--";
  return n > 0 ? `+${usd(n)}` : usd(n);
}

function plusCount(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "--";
  const shown = count(n);
  return n > 0 ? `+${shown}` : shown;
}

function scale(part: number | null | undefined, max: number): number {
  if (part == null || max <= 0) return 0;
  return barFill((part / max) * 100);
}

function statusLabel(status: string): string {
  return status.replace(/\s*\(MGO\)\s*/g, "").replace(/\s+/g, " ").trim();
}

function RankRow({
  label,
  amount,
  max,
  extra,
}: {
  label: string;
  amount: number | null | undefined;
  max: number;
  extra?: string;
}) {
  return (
    <div className="ao-rank">
      <div className="ao-rank-line">
        <span className="ao-rank-name">{label}</span>
        <span className="ao-rank-amt">
          {usd(amount)}
          {extra ? <small>{extra}</small> : null}
        </span>
      </div>
      <div className="ao-rank-track" aria-hidden="true">
        <i style={{ width: `${scale(amount, max)}%` }} />
      </div>
    </div>
  );
}

function YtdCard({
  label,
  row,
  kind,
}: {
  label: string;
  row?: YtdRow;
  kind: "money" | "count";
}) {
  const current = kind === "count" ? count(row?.current) : usd(row?.current);
  const prior = kind === "count" ? count(row?.prior) : usd(row?.prior);
  const delta = kind === "count" ? plusCount(row?.difference) : plusUsd(row?.difference);
  const up = (row?.pct ?? 0) > 0;
  const down = (row?.pct ?? 0) < 0;
  return (
    <article className="ao-ytd-card">
      <div className="ao-ytd-label">{label}</div>
      <div className="ao-ytd-value">{current}</div>
      <div className="ao-ytd-delta">
        <span className={up ? "ao-pill ao-pill-up" : down ? "ao-pill ao-pill-dn" : "ao-pill"}>
          {pct(row?.pct)}
        </span>
        <span className={up ? "ao-pos" : down ? "ao-neg" : ""}>{delta}</span>
      </div>
      <div className="ao-ytd-prior">FY26 YTD {prior}</div>
    </article>
  );
}

function AdvancementOverviewPage() {
  const [data, setData] = useState<AdvancementOverviewSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function readSnapshot() {
    return apiFetch("/api/advancement-overview-data").then(async (r) => {
      const json = (await r.json()) as AdvancementOverviewSnapshot;
      if (!r.ok) throw new Error(json.error || `Error ${r.status}`);
      return json;
    });
  }

  function load() {
    setLoading(true);
    readSnapshot()
      .then((json) => {
        setData(json);
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

  const ready = isOverviewReady(data);
  const received = data?.received;
  const released = data?.released;
  const pledges = data?.pledges;
  const ytd = data?.ytd;
  const officers = (data?.officers ?? []).filter((row) => !row.isTotal);
  const officerTotal = data?.officers?.find((row) => row.isTotal)?.amount ?? 0;
  const officerMax = Math.max(0, ...officers.map((row) => row.amount ?? 0));
  const pipeline = data?.pipeline;
  const pipeRows: PipelineRow[] = pipeline?.rows ?? [];
  const pipeMax = Math.max(0, ...pipeRows.map((row) => row.amount ?? 0));
  const total = received?.total ?? 0;
  const unassigned = received?.unassigned ?? 0;
  const fyShort =
    data?.currentFiscalYear != null ? `FY${String(data.currentFiscalYear % 100).padStart(2, "0")}` : "FY";

  return (
    <main className="ac-page ao-page">
      <div className="ac-head">
        <div>
          <h1>Advancement Overview</h1>
          <p className="ac-sub">
            {data?.fiscalYearLabel ?? "FY"} results from Virtuous
            {data?.generated_at ? ` · updated ${formatEastern(data.generated_at)}` : ""}
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

      {!error && ready && (
        <>
          <section className="ao-hero">
            <div>
              <div className="ao-kicker">{fyShort} total received</div>
              <div className="ao-hero-value">{usd(received?.total)}</div>
              <p className="ao-hero-note">Gifts booked this fiscal year</p>
            </div>
            <div className="ao-split">
              <Split label="Endowed" amount={received?.endowed} total={total} />
              <Split label="Temporary restricted" amount={received?.temporaryRestricted} total={total} />
              <Split label="Unrestricted" amount={received?.unrestricted} total={total} />
              {unassigned > 0 ? (
                <Split label="Fund not yet classified" amount={unassigned} total={total} />
              ) : null}
            </div>
          </section>

          <p className="ao-footnote">
            Released restricted · FY27 {usd(released?.total)} · FY26 {usd(released?.fy26)} · Other{" "}
            {usd(released?.other)}
            <span>{released?.note ?? "Actuals Updated 7/1/2026"}</span>
          </p>

          <section className="ao-ytd-grid" aria-label="Year to date versus last year">
            <YtdCard label="Overall" row={ytd?.overall} kind="money" />
            <YtdCard label="MGO team" row={ytd?.mgoTeam} kind="money" />
            <YtdCard label="Active donors" row={ytd?.activeDonors} kind="count" />
          </section>

          <div className="ao-two">
            <section className="ao-panel">
              <header className="ao-panel-top">
                <div>
                  <h2>Gift officers</h2>
                  <p>FY27 totals</p>
                </div>
                <div className="ao-panel-total">{usd(officerTotal)}</div>
              </header>
              <div className="ao-ranks">
                {officers.map((row) => (
                  <RankRow key={row.name} label={row.name} amount={row.amount} max={officerMax} />
                ))}
              </div>
            </section>

            <section className="ao-panel">
              <header className="ao-panel-top">
                <div>
                  <h2>Open pipeline</h2>
                  <p>{pipeline?.totalCount ?? 0} asks</p>
                </div>
                <div className="ao-panel-total">{usd(pipeline?.totalAmount)}</div>
              </header>
              <div className="ao-ranks">
                {pipeRows.map((row) => (
                  <RankRow
                    key={row.status}
                    label={statusLabel(row.status)}
                    amount={row.amount}
                    max={pipeMax}
                    extra={row.count != null ? `${row.count}` : undefined}
                  />
                ))}
              </div>
            </section>

            <section className="ao-panel">
              <header className="ao-panel-top">
                <div>
                  <h2>Pledges and planned giving</h2>
                </div>
              </header>
              <div className="ao-pledges">
                <Meter
                  label="New multi-year pledges"
                  value={pledges?.multiYear}
                  goal={pledges?.multiYearGoal ?? 30}
                />
                <Meter
                  label="Realized estate gifts"
                  value={pledges?.realizedEstate}
                  goal={pledges?.realizedEstateGoal ?? 25}
                />
                <div className="ao-meter">
                  <div className="ao-meter-label">Planned estate gifts</div>
                  <div className="ao-meter-value">{count(pledges?.plannedEstate)}</div>
                </div>
              </div>
            </section>
          </div>
        </>
      )}

      {!error && !ready && !loading && (
        <div className="ac-error">
          <p>Advancement overview cache is not a Virtuous snapshot yet. Wait for the next refresh.</p>
        </div>
      )}
    </main>
  );
}

function Split({
  label,
  amount,
  total,
}: {
  label: string;
  amount: number | null | undefined;
  total: number;
}) {
  return (
    <div className="ao-split-row">
      <div className="ao-split-head">
        <span>{label}</span>
        <strong>{usd(amount)}</strong>
      </div>
      <div className="ao-split-track" aria-hidden="true">
        <i style={{ width: `${scale(amount, total)}%` }} />
      </div>
    </div>
  );
}

function Meter({
  label,
  value,
  goal,
}: {
  label: string;
  value: number | null | undefined;
  goal: number;
}) {
  const n = value ?? 0;
  return (
    <div className="ao-meter">
      <div className="ao-meter-label">{label}</div>
      <div className="ao-meter-value">
        {value == null ? "--" : count(value)}
        <small>of {goal}</small>
      </div>
      <div className="ao-meter-track" aria-hidden="true">
        <i style={{ width: `${barFill((n / goal) * 100)}%` }} />
      </div>
    </div>
  );
}

export default function AdvancementOverviewRoute() {
  return <AdvancementOverviewPage />;
}
