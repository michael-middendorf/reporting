"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  usd,
  type FallAppealSnapshot,
  type PacePoint,
  type SegmentRow,
  type TimelineWeek,
} from "@/lib/reports/fall-appeal/shape";
import "@/styles/annunciation.css";
import "@/styles/fall-appeal.css";

type Payload = FallAppealSnapshot & { error?: string };

const usd2 = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number) => n.toLocaleString("en-US");
const pct = (n: number) => `${n}%`;

const DEFS = {
  totalRevenue:
    "Sum of all gift amounts (net of reversals) attributed to the appeal campaign in Virtuous.",
  totalGifts: "Count of gifts attributed to the appeal campaign.",
  avgGift: "Total revenue ÷ total gifts.",
  medianGift: "The middle gift amount — half of gifts are larger, half smaller.",
  donors: "Distinct contacts who gave to the appeal.",
  yoy: "Point-in-time comparison: the current appeal's cumulative total vs where the prior appeal stood at the same number of days into its run. It grows as the current appeal progresses.",
  breakdown:
    "Gifts grouped by amount band, with each band's share of total revenue. Reversals/refunds fall in the lowest band so bands reconcile to total.",
  segments:
    "Appeal revenue and gifts attributed to donors carrying each Virtuous tag. Constituency segments are non-exclusive (a donor may count in several); Friends = donors with none of Alumni/Parents/Faculty-Staff.",
  geography: "Appeal revenue by the donor's state of record (top states shown).",
  timeline: "Cumulative appeal revenue by week, with campaign touch dates overlaid.",
  mail: "Appeal revenue by the acquisition segment recorded on each gift (the appeal's individual asks/lists).",
} as const;

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

function Delta({ value, unit }: { value: number | null; unit?: string }) {
  if (value === null) return <span className="fa-delta-flat">—</span>;
  const cls = value > 0 ? "fa-delta-pos" : value < 0 ? "fa-delta-neg" : "fa-delta-flat";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={cls}>
      {sign}
      {value}
      {unit ?? "%"}
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

function PaceChart({ points, asOfOffset }: { points: PacePoint[]; asOfOffset: number }) {
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

  const line = (sel: (p: PacePoint) => number | undefined) => {
    const pts = points
      .map((p) => ({ off: p.dayOffset, v: sel(p) }))
      .filter((p): p is { off: number; v: number } => typeof p.v === "number");
    if (!pts.length) return "";
    return pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.off).toFixed(1)},${y(p.v).toFixed(1)}`)
      .join(" ");
  };

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * maxRev));
  return (
    <svg
      className="fa-pace-svg"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Cumulative revenue pace: current vs prior appeal"
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
      <text x={pad.l} y={H - 6} fontSize="10" fill="var(--ac-dim)">
        Day 0
      </text>
      <text x={W - pad.r} y={H - 6} textAnchor="end" fontSize="10" fill="var(--ac-dim)">
        Day {maxOff}
      </text>
    </svg>
  );
}

export default function FallAppealPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    apiFetch("/api/fall-appeal-data")
      .then(async (r) => {
        const json = (await r.json()) as Payload;
        if (!r.ok) throw new Error(json.error || `Error ${r.status}`);
        setData(json);
        setError(null);
      })
      .catch((e: Error) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const segments = useMemo(() => data?.segments ?? [], [data]);
  const constituency = segments.filter((s) => s.group === "constituency");
  const donorType = segments.filter((s) => s.group === "donorType");

  return (
    <main className="ac-page">
      <div className="ac-head">
        <div>
          <h1>{data?.campaign || "Fall Appeal"}</h1>
          <div className="ac-sub">
            {data?.generated_at ? `Updated ${data.generated_at}` : "Fundraising performance from Virtuous"}
            {data?.asOf ? ` · as of ${data.asOf}` : ""}
          </div>
        </div>
        <button type="button" className="ac-refresh" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="ac-error">{error}</div>}

      {data && !error && data.empty && (
        <div className="ac-note">
          No gifts are attributed to <strong>{data.campaign}</strong> in Virtuous yet. This
          dashboard will populate automatically as appeal gifts are recorded against the campaign.
        </div>
      )}

      {data && !error && (
        <>
          <section>
            <div className="ac-cards">
              <div className="ac-card">
                <span className="ac-card-num">{usd(data.summary.totalRevenue)}</span>
                <span className="ac-card-label">
                  Total Revenue <InfoDot text={DEFS.totalRevenue} />
                </span>
              </div>
              <div className="ac-card">
                <span className="ac-card-num">{num(data.summary.totalGifts)}</span>
                <span className="ac-card-label">
                  Total Gifts <InfoDot text={DEFS.totalGifts} />
                </span>
              </div>
              <div className="ac-card">
                <span className="ac-card-num">{usd(data.summary.avgGift)}</span>
                <span className="ac-card-label">
                  Average Gift <InfoDot text={DEFS.avgGift} />
                </span>
              </div>
              <div className="ac-card">
                <span className="ac-card-num">{usd(data.summary.medianGift)}</span>
                <span className="ac-card-label">
                  Median Gift <InfoDot text={DEFS.medianGift} />
                </span>
              </div>
              <div className="ac-card">
                <span className="ac-card-num">{num(data.summary.donors)}</span>
                <span className="ac-card-label">
                  Donors <InfoDot text={DEFS.donors} />
                </span>
              </div>
            </div>
          </section>

          {data.yoy && (
            <section className="ac-analytics">
              <h2>
                Year-over-Year Pace <InfoDot text={DEFS.yoy} />
              </h2>
              <div className="ac-cards">
                <div className="ac-card">
                  <span className="ac-card-num">{usd(data.yoy.currentToDate.revenue)}</span>
                  <span className="ac-card-label">This appeal — revenue to date</span>
                  <span className="fa-card-sub">
                    vs {usd(data.yoy.priorToDate.revenue)} last year ·{" "}
                    <Delta value={data.yoy.revenueDeltaPct} />
                  </span>
                </div>
                <div className="ac-card">
                  <span className="ac-card-num">{num(data.yoy.currentToDate.gifts)}</span>
                  <span className="ac-card-label">This appeal — gifts to date</span>
                  <span className="fa-card-sub">
                    vs {num(data.yoy.priorToDate.gifts)} last year ·{" "}
                    <Delta value={data.yoy.giftsDeltaPct} />
                  </span>
                </div>
                <div className="ac-card">
                  <span className="ac-card-num">{usd(data.yoy.priorFinal.revenue)}</span>
                  <span className="ac-card-label">{data.yoy.priorCampaign} — final</span>
                  <span className="fa-card-sub">{num(data.yoy.priorFinal.gifts)} gifts</span>
                </div>
              </div>
              <div className="ac-chart-box fa-pace-box">
                <div className="fa-legend">
                  <span>
                    <i className="fa-swatch fa-swatch-cur" /> {data.campaign} (cumulative)
                  </span>
                  <span>
                    <i className="fa-swatch fa-swatch-prior" /> {data.yoy.priorCampaign} (cumulative)
                  </span>
                  <span>
                    <i className="fa-swatch fa-swatch-now" /> today (day {data.yoy.asOfOffset})
                  </span>
                </div>
                <PaceChart points={data.yoy.points} asOfOffset={data.yoy.asOfOffset} />
              </div>
            </section>
          )}

          <section className="ac-analytics">
            <h2>
              Donor Segmentation <InfoDot text={DEFS.segments} />
            </h2>
            <div className="ac-table-wrap">
              <table className="ac-table" style={{ minWidth: 620 }}>
                <thead>
                  <tr>
                    <th>Segment</th>
                    <th className="ac-num">Revenue</th>
                    <th className="ac-num">Gifts</th>
                    <th className="ac-num">Avg Gift</th>
                    <th className="ac-num">Donors</th>
                  </tr>
                </thead>
                <tbody>
                  <SegmentGroup label="Constituency" rows={constituency} />
                  <SegmentGroup label="Donor Type" rows={donorType} />
                </tbody>
              </table>
            </div>
            {data.deferredSegments?.length > 0 && (
              <p className="fa-deferred">
                Not yet computed (need multi-year giving history and are most meaningful against the
                solicited audience): {data.deferredSegments.join(", ")}.
              </p>
            )}
          </section>

          <section className="ac-analytics">
            <h2>
              Gift Breakdown by Amount <InfoDot text={DEFS.breakdown} />
            </h2>
            <div className="ac-charts">
              <div className="ac-chart-box">
                <h3>Revenue by band</h3>
                <BarChart
                  items={data.giftBreakdown}
                  valueOf={(b) => b.revenue}
                  labelOf={(b) => b.label.replaceAll("$", "").replace("Under ", "<")}
                  titleOf={(b) => `${b.label}: ${usd(b.revenue)} · ${b.gifts} gifts`}
                  accent
                />
              </div>
              <div className="ac-table-wrap">
                <table className="ac-table" style={{ minWidth: 380 }}>
                  <thead>
                    <tr>
                      <th>Band</th>
                      <th className="ac-num">Gifts</th>
                      <th className="ac-num">Revenue</th>
                      <th className="ac-num">% Rev</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.giftBreakdown.map((b) => (
                      <tr key={b.key}>
                        <td>{b.label}</td>
                        <td className="ac-num">{num(b.gifts)}</td>
                        <td className="ac-num">{usd(b.revenue)}</td>
                        <td className="ac-num">{pct(b.pctOfRevenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="ac-analytics">
            <h2>
              Top States <InfoDot text={DEFS.geography} />
            </h2>
            {data.geography.topStates.length === 0 ? (
              <div className="ac-note">No geographic data available yet.</div>
            ) : (
              <div className="ac-table-wrap">
                <table className="ac-table" style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th>State</th>
                      <th className="ac-num">Revenue</th>
                      <th className="ac-num">Gifts</th>
                      <th className="ac-num">Donors</th>
                      <th className="ac-num">Avg Gift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.geography.topStates.map((s) => (
                      <tr key={s.state}>
                        <td>{s.state}</td>
                        <td className="ac-num">{usd(s.revenue)}</td>
                        <td className="ac-num">{num(s.gifts)}</td>
                        <td className="ac-num">{num(s.donors)}</td>
                        <td className="ac-num">{usd(s.avgGift)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.geography.partial && (
              <p className="fa-deferred">
                Geography covers {num(data.geography.donorsGeocoded)} of{" "}
                {num(data.geography.donorsTotal)} donors with a state on file.
              </p>
            )}
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

          {data.mailSegments.length > 0 && (
            <section className="ac-analytics">
              <h2>
                By Acquisition Segment <InfoDot text={DEFS.mail} />
              </h2>
              <div className="ac-table-wrap">
                <table className="ac-table" style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th>Segment</th>
                      <th className="ac-num">Revenue</th>
                      <th className="ac-num">Gifts</th>
                      <th className="ac-num">Avg Gift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.mailSegments.map((m) => (
                      <tr key={m.segment}>
                        <td>{m.segment}</td>
                        <td className="ac-num">{usd(m.revenue)}</td>
                        <td className="ac-num">{num(m.gifts)}</td>
                        <td className="ac-num">{usd2(m.avgGift)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function SegmentGroup({ label, rows }: { label: string; rows: SegmentRow[] }) {
  if (!rows.length) return null;
  return (
    <>
      <tr className="fa-group-row">
        <td colSpan={5}>{label}</td>
      </tr>
      {rows.map((s) => (
        <tr key={s.key}>
          <td>{s.label}</td>
          <td className="ac-num">{usd(s.revenue)}</td>
          <td className="ac-num">{num(s.gifts)}</td>
          <td className="ac-num">{usd(s.avgGift)}</td>
          <td className="ac-num">{num(s.donors)}</td>
        </tr>
      ))}
    </>
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
