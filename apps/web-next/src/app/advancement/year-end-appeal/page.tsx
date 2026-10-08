"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { apiFetch } from "@/lib/api";
import {
  addDaysIso,
  formatMdDate,
  lengthPair,
  lengthScopes,
  normalizeSnapshot,
  pctOrNa,
  usd,
  type BucketStats,
  type PacePoint,
  type TimelineWeek,
  type YearEndSnapshot,
} from "@/lib/reports/year-end-appeal/shape";
import "@/styles/annunciation.css";
import "@/styles/fall-appeal.css";

type Payload = YearEndSnapshot;

const num = (n: number) => n.toLocaleString("en-US");

const DEFS = {
  totalRevenue:
    "Sum of all gift amounts (net of reversals) attributed to the year-end campaign in Virtuous.",
  totalGifts: "Count of gifts attributed to the year-end campaign.",
  avgGift: "Total revenue divided by total gifts.",
  medianGift: "The middle gift amount. Half of gifts are larger, half smaller.",
  donors: "Distinct contacts who gave to the campaign.",
  yoy: "Point-in-time comparison: this campaign's cumulative total vs where the prior campaign stood at the same number of days into its run.",
  segment:
    "Gifts grouped by the donor segment encoded in each gift's source code (A, LP12, LP24). Codes with no segment, such as the stained glass code, are listed as No segment.",
  length:
    "2-page and 4-page packages compared for the same donor segment. Postcard, stained glass, and social codes have no package length and are not part of this comparison.",
  asset: "Gifts grouped by the asset encoded in each gift's source code.",
  code: "One row per registered source code. Response rate is distinct donors divided by pieces mailed, shown only when a mailed count has been loaded for the code.",
  timeline: "Cumulative campaign revenue by week, with campaign touch dates overlaid.",
} as const;

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="fa-delta-flat">n/a</span>;
  const cls = value > 0 ? "fa-delta-pos" : value < 0 ? "fa-delta-neg" : "fa-delta-flat";
  return (
    <span className={cls}>
      {value > 0 ? "+" : ""}
      {value}%
    </span>
  );
}

function InfoDot({ text }: { text: string }) {
  return (
    <span className="ac-info-wrap">
      <button
        type="button"
        className="ac-info"
        aria-label={`Definition: ${text}`}
        onClick={(e) => e.stopPropagation()}
      >
        i
      </button>
      <span className="ac-info-tip" role="tooltip">
        {text}
      </span>
    </span>
  );
}


function BarChart<T>({
  items,
  valueOf,
  labelOf,
  titleOf,
  accent,
}: {
  items: T[];
  valueOf: (it: T) => number;
  labelOf: (it: T) => string;
  titleOf: (it: T) => string;
  accent?: boolean;
}) {
  const max = Math.max(1, ...items.map(valueOf));
  return (
    <div className="ac-bars">
      {items.map((it, i) => (
        <div className="ac-bar-col" key={i}>
          <div
            className={accent ? "ac-bar ac-bar-accent" : "ac-bar"}
            style={{ height: `${(valueOf(it) / max) * 100}%` }}
          >
            <span className="ac-tip" role="tooltip">
              {titleOf(it)}
            </span>
          </div>
          <span className="ac-bar-x">{labelOf(it)}</span>
        </div>
      ))}
    </div>
  );
}

function PaceChart({
  points,
  asOfOffset,
  currentName,
  priorName,
  currentStart,
  priorStart,
}: {
  points: PacePoint[];
  asOfOffset: number;
  currentName: string;
  priorName: string;
  currentStart: string | null;
  priorStart: string | null;
}) {
  const [hoverOff, setHoverOff] = useState<number | null>(null);
  const W = 720;
  const H = 240;
  const pad = { l: 56, r: 16, t: 12, b: 26 };
  const maxOff = Math.max(1, ...points.map((p) => p.dayOffset));
  const maxRev = Math.max(
    1,
    ...points.map((p) => Math.max(p.currentCum?.revenue ?? 0, p.priorCum?.revenue ?? 0)),
  );
  const x = (off: number) => pad.l + (off / maxOff) * (W - pad.l - pad.r);
  const y = (rev: number) => H - pad.b - (rev / maxRev) * (H - pad.t - pad.b);
  const byOff = useMemo(() => {
    const m = new Map<number, PacePoint>();
    for (const p of points) m.set(p.dayOffset, p);
    return m;
  }, [points]);

  const line = (sel: (p: PacePoint) => number | undefined) => {
    const pts = points
      .map((p) => ({ off: p.dayOffset, v: sel(p) }))
      .filter((p): p is { off: number; v: number } => typeof p.v === "number");
    if (!pts.length) return "";
    return pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.off).toFixed(1)},${y(p.v).toFixed(1)}`)
      .join(" ");
  };

  function offsetFromEvent(e: MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const raw = Math.round(((px - pad.l) / Math.max(1, W - pad.l - pad.r)) * maxOff);
    return Math.max(0, Math.min(maxOff, raw));
  }

  const hover = hoverOff == null ? null : byOff.get(hoverOff);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * maxRev));
  return (
    <div className="fa-pace-plot">
      <svg
        className="fa-pace-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Cumulative revenue pace: current vs prior appeal. Hover a day for detail."
        onMouseMove={(e) => setHoverOff(offsetFromEvent(e))}
        onMouseLeave={() => setHoverOff(null)}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--ac-border)"
              strokeWidth="1"
            />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--ac-dim)">
              {usd(t)}
            </text>
          </g>
        ))}
        {asOfOffset > 0 && asOfOffset <= maxOff && (
          <line
            x1={x(asOfOffset)}
            x2={x(asOfOffset)}
            y1={pad.t}
            y2={H - pad.b}
            stroke="#B23A2E"
            strokeWidth="1"
            strokeDasharray="4 3"
          />
        )}
        <path d={line((p) => p.priorCum?.revenue)} fill="none" stroke="var(--ac-dim)" strokeWidth="2" />
        <path
          d={line((p) => p.currentCum?.revenue)}
          fill="none"
          stroke="var(--ac-gold)"
          strokeWidth="2.5"
        />
        {hoverOff != null && (
          <line
            x1={x(hoverOff)}
            x2={x(hoverOff)}
            y1={pad.t}
            y2={H - pad.b}
            stroke="var(--ac-text)"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        )}
        <text x={pad.l} y={H - 6} fontSize="10" fill="var(--ac-dim)">
          Day 0
        </text>
        <text x={W - pad.r} y={H - 6} textAnchor="end" fontSize="10" fill="var(--ac-dim)">
          Day {maxOff}
        </text>
      </svg>
      {hover && hoverOff != null && (
        <div className="fa-pace-tip" role="tooltip">
          <strong>
            Day {hoverOff}
            {currentStart ? ` · ${formatMdDate(addDaysIso(currentStart, hoverOff))}` : ""}
          </strong>
          <div>
            {currentName}: {usd(hover.currentCum?.revenue ?? 0)} · {num(hover.currentCum?.gifts ?? 0)}{" "}
            gifts
          </div>
          <div>
            {priorName}: {usd(hover.priorCum?.revenue ?? 0)} · {num(hover.priorCum?.gifts ?? 0)} gifts
            {priorStart ? ` (${formatMdDate(addDaysIso(priorStart, hoverOff))})` : ""}
          </div>
        </div>
      )}
    </div>
  );
}


const SEGMENT_NAMES: Record<string, string> = { total: "All segments", none: "No segment" };
const scopeName = (scope: string) => SEGMENT_NAMES[scope] ?? `Segment ${scope}`;

function StatCells({ r }: { r: BucketStats }) {
  return (
    <>
      <td className="ac-num">{usd(r.revenue)}</td>
      <td className="ac-num">{num(r.gifts)}</td>
      <td className="ac-num">{num(r.donors)}</td>
      <td className="ac-num">{usd(r.avgGift)}</td>
      <td className="ac-num">{r.mailed == null ? "n/a" : num(r.mailed)}</td>
      <td className="ac-num">{pctOrNa(r.responseRate)}</td>
    </>
  );
}

function StatHead({ first }: { first: string }) {
  return (
    <thead>
      <tr>
        <th>{first}</th>
        <th className="ac-num">Revenue</th>
        <th className="ac-num">Gifts</th>
        <th className="ac-num">Donors</th>
        <th className="ac-num">Avg gift</th>
        <th className="ac-num">Mailed</th>
        <th className="ac-num">Response rate</th>
      </tr>
    </thead>
  );
}

function TimelineOverlays({ weeks }: { weeks: TimelineWeek[] }) {
  const marks = weeks.filter((w) => w.overlays.length);
  if (!marks.length) return null;
  return (
    <ul
      className="fa-deferred"
      style={{ listStyle: "none", display: "flex", flexWrap: "wrap", gap: "4px 16px" }}
    >
      {marks.map((w) => (
        <li key={w.weekStart}>
          <strong>{w.label}:</strong> {w.overlays.join(", ")}
        </li>
      ))}
    </ul>
  );
}

export default function YearEndAppealPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function fetchReport() {
    apiFetch("/api/year-end-appeal-data")
      .then(async (r) => {
        const json = (await r.json()) as Partial<Payload> & { error?: string };
        if (json.summary) {
          setData(normalizeSnapshot(json));
          setError(r.ok ? null : json.error || null);
          return;
        }
        throw new Error(json.error || `Error ${r.status}`);
      })
      .catch((e: Error) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }

  function load() {
    setLoading(true);
    fetchReport();
  }

  useEffect(() => {
    fetchReport();
  }, []);

  const campaignStart = data?.campaignStart ?? null;
  const campaignEnd = data?.campaignEnd ?? null;
  const scopes = data ? lengthScopes(data.byLength) : [];

  return (
    <main className="ac-page">
      <div className="ac-head">
        <div>
          <h1>{data?.campaign || "Year-End Appeal"}</h1>
          <div className="ac-sub">
            Campaign {formatMdDate(campaignStart)}
            {campaignEnd ? ` to ${formatMdDate(campaignEnd)}` : ""}
            {data?.asOf ? ` · gift data as of ${formatMdDate(data.asOf)}` : ""}
            {data?.generated_at ? ` · updated ${data.generated_at}` : ""}
          </div>
        </div>
        <div className="appeals-controls">
          <button type="button" className="ac-refresh" onClick={load} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
          <button type="button" className="ac-refresh" onClick={() => window.print()}>
            Print / PDF
          </button>
        </div>
      </div>

      {error && <div className="ac-error">{error}</div>}

      {data && data.empty && (
        <div className="ac-note">
          No gifts are attributed to <strong>{data.campaign}</strong> in Virtuous yet. The campaign
          starts {formatMdDate(campaignStart)}. This report fills in automatically once gifts are
          recorded against the campaign.
        </div>
      )}

      {data && !data.empty && (
        <>
          <section>
            <div className="ac-cards">
              {(
                [
                  [usd(data.summary.totalRevenue), "Total Revenue", DEFS.totalRevenue],
                  [num(data.summary.totalGifts), "Total Gifts", DEFS.totalGifts],
                  [usd(data.summary.avgGift), "Average Gift", DEFS.avgGift],
                  [usd(data.summary.medianGift), "Median Gift", DEFS.medianGift],
                  [num(data.summary.donors), "Donors", DEFS.donors],
                ] as const
              ).map(([value, label, def]) => (
                <div className="ac-card" key={label} title={`${def} As of ${formatMdDate(data.asOf)}.`}>
                  <span className="ac-card-num">{value}</span>
                  <span className="ac-card-label">
                    {label} <InfoDot text={def} />
                  </span>
                </div>
              ))}
            </div>
          </section>

          {data.unmatched.gifts > 0 && (
            <section className="ac-analytics">
              <div className="ac-note" role="alert">
                <strong>
                  {num(data.unmatched.gifts)} gifts ({usd(data.unmatched.revenue)}) have a source code that
                  is not in the year-end code registry.
                </strong>{" "}
                They are counted in the totals above but not in the segment, length, asset, or code
                tables below. Codes seen: {data.unmatched.codes.length ? data.unmatched.codes.join(", ") : "none"}.
              </div>
            </section>
          )}

          {data.yoy && (
            <section className="ac-analytics">
              <h2>
                Year-over-Year Pace <InfoDot text={DEFS.yoy} />
              </h2>
              <div className="ac-cards">
                <div className="ac-card">
                  <span className="ac-card-num">{usd(data.yoy.currentToDate.revenue)}</span>
                  <span className="ac-card-label">This campaign, revenue to date</span>
                  <span className="fa-card-sub">
                    vs {usd(data.yoy.priorToDate.revenue)} last year · <Delta value={data.yoy.revenueDeltaPct} />
                  </span>
                </div>
                <div className="ac-card">
                  <span className="ac-card-num">{num(data.yoy.currentToDate.gifts)}</span>
                  <span className="ac-card-label">This campaign, gifts to date</span>
                  <span className="fa-card-sub">
                    vs {num(data.yoy.priorToDate.gifts)} last year · <Delta value={data.yoy.giftsDeltaPct} />
                  </span>
                </div>
                <div className="ac-card" title={`${data.yoy.priorCampaign} full campaign total, not the same-day pace figure.`}>
                  <span className="ac-card-num">{usd(data.yoy.priorFinal.revenue)}</span>
                  <span className="ac-card-label">{data.yoy.priorCampaign}, final</span>
                  <span className="fa-card-sub">{num(data.yoy.priorFinal.gifts)} gifts</span>
                </div>
              </div>
              <div className="ac-chart-box fa-pace-box">
                <div className="fa-legend">
                  <span><i className="fa-swatch fa-swatch-cur" /> {data.campaign} (cumulative)</span>
                  <span><i className="fa-swatch fa-swatch-prior" /> {data.yoy.priorCampaign} (cumulative)</span>
                  <span><i className="fa-swatch fa-swatch-now" /> today (day {data.yoy.asOfOffset})</span>
                </div>
                <PaceChart
                  points={data.yoy.points}
                  asOfOffset={data.yoy.asOfOffset}
                  currentName={data.campaign}
                  priorName={data.yoy.priorCampaign}
                  currentStart={campaignStart}
                  priorStart={data.yoy.priorStart}
                />
              </div>
            </section>
          )}

          <section className="ac-analytics">
            <h2>
              By Segment <InfoDot text={DEFS.segment} />
            </h2>
            <div className="ac-table-wrap">
              <table className="ac-table" style={{ minWidth: 700 }}>
                <StatHead first="Segment" />
                <tbody>
                  {data.bySegment.map((r) => (
                    <tr key={r.key}>
                      <td>{r.key === "none" ? "No segment" : r.label}</td>
                      <StatCells r={r} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ac-analytics">
            <h2>
              2-Page vs 4-Page <InfoDot text={DEFS.length} />
            </h2>
            <div className="ac-table-wrap">
              <table className="ac-table" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th>Segment</th>
                    <th>Package</th>
                    <th className="ac-num">Revenue</th>
                    <th className="ac-num">Gifts</th>
                    <th className="ac-num">Donors</th>
                    <th className="ac-num">Avg gift</th>
                    <th className="ac-num">Response rate</th>
                  </tr>
                </thead>
                <tbody>
                  {scopes.flatMap((scope) => {
                    const pair = lengthPair(data.byLength, scope);
                    return ([["2-page", pair.twoPage], ["4-page", pair.fourPage]] as const).map(([label, r]) =>
                      r ? (
                        <tr key={`${scope}-${label}`}>
                          <td>{scopeName(scope)}</td>
                          <td>{label}</td>
                          <td className="ac-num">{usd(r.revenue)}</td>
                          <td className="ac-num">{num(r.gifts)}</td>
                          <td className="ac-num">{num(r.donors)}</td>
                          <td className="ac-num">{usd(r.avgGift)}</td>
                          <td className="ac-num">{pctOrNa(r.responseRate)}</td>
                        </tr>
                      ) : null,
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="fa-deferred">
              Small samples are not conclusive. Treat early differences between the 2-page and 4-page
              packages as directional until gift counts grow.
              {data.mailedAvailable ? "" : " Response rate appears once mailed counts are loaded."}
            </p>
          </section>

          <section className="ac-analytics">
            <h2>
              By Asset <InfoDot text={DEFS.asset} />
            </h2>
            <div className="ac-table-wrap">
              <table className="ac-table" style={{ minWidth: 700 }}>
                <StatHead first="Asset" />
                <tbody>
                  {data.byAsset.map((r) => (
                    <tr key={r.asset}>
                      <td>{r.label}</td>
                      <StatCells r={r} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ac-analytics">
            <h2>
              By Code <InfoDot text={DEFS.code} />
            </h2>
            <div className="ac-table-wrap">
              <table className="ac-table" style={{ minWidth: 820 }}>
                <StatHead first="Code" />
                <tbody>
                  {data.byCode.map((r) => (
                    <tr key={r.code}>
                      <td>{r.code}</td>
                      <StatCells r={r} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {data.timeline.length > 0 && (
            <section className="ac-analytics">
              <h2>
                Campaign Timeline <InfoDot text={DEFS.timeline} />
              </h2>
              <div className="ac-chart-box">
                <h3>Cumulative revenue by week</h3>
                <BarChart
                  items={data.timeline}
                  valueOf={(w) => w.cumRevenue}
                  labelOf={(w) => w.label}
                  titleOf={(w) =>
                    `${w.label}: ${usd(w.cumRevenue)} cumulative · ${w.cumGifts} gifts` +
                    (w.overlays.length ? ` · ${w.overlays.join(", ")}` : "")
                  }
                  accent
                />
              </div>
              <TimelineOverlays weeks={data.timeline} />
            </section>
          )}
        </>
      )}
    </main>
  );
}
