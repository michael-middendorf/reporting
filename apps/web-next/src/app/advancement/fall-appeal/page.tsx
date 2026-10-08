"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type MouseEvent } from "react";
import { apiFetch, fetchMe, getBearer } from "@/lib/api";
import {
  addDaysIso,
  formatMdDate,
  goalProgress,
  usd,
  type FallAppealSnapshot,
  type EmailPerformanceSegment,
  type PacePoint,
  type SegmentRow,
  type TimelineWeek,
} from "@/lib/reports/fall-appeal/shape";
import {
  APPEAL_CAMPAIGNS,
  DEFAULT_APPEAL_SLUG,
  appealCampaign,
  type AppealSlug,
} from "@/lib/reports/appeals/config";
import "@/styles/annunciation.css";
import "@/styles/fall-appeal.css";

type Payload = FallAppealSnapshot & { error?: string };

function campaignSlugFromUrl(): AppealSlug {
  const requested = new URLSearchParams(window.location.search).get("campaign");
  return appealCampaign(requested)?.slug ?? DEFAULT_APPEAL_SLUG;
}

function subscribeToUrl(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

const usd2 = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number) => n.toLocaleString("en-US");
const pct = (n: number) => `${n}%`;

const DEFS = {
  goal:
    "Gross gifts attributed to the appeal in Virtuous (full gift amounts, before any costs), with refunds and reversals subtracted. This is the same figure as Total Revenue. Goal set by Advancement.",
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
  givingPathways:
    "Landing pages are gifts whose batch name starts with Stripe-Giving or RaiseDonors. Email is gifts whose segment contains email and does not also say direct mail. Direct mail is every other gift, including a blank batch. A batch that only mentions an online form later in the name stays in direct mail. A segment that says both email and direct mail stays in direct mail.",
  email:
    "Unique opens and clicks from aggregate Virtuous Analytics email-version records. Segment rates are recipient-weighted across its published sends; they are engagement, not donation conversion rates.",
  directMail:
    "Response rate is distinct tagged-mail-audience responders divided by tagged audience. Revenue and gifts remain Virtuous campaign-attributed figures.",
  digital:
    "Digital performance is an administrator-imported aggregate. Conversion rate is conversions divided by visits.",
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

function ImportControl({
  label,
  columns,
  onFile,
  status,
}: {
  label: string;
  columns: string;
  onFile: (file: File | undefined) => void;
  status: string | null;
}) {
  return (
    <div className="fa-email-import">
      <label>
        {label}
        <input type="file" accept=".csv,text/csv" onChange={(event) => onFile(event.target.files?.[0])} />
      </label>
      <span>CSV columns: {columns}.</span>
      {status && <span>{status}</span>}
    </div>
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

export default function FallAppealPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canImport, setCanImport] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  // The ?campaign= URL param picks the initial report; the dropdown overrides it.
  // Reading the URL through useSyncExternalStore keeps hydration consistent
  // (server snapshot is the default) without setting state inside an effect.
  const urlSlug = useSyncExternalStore(subscribeToUrl, campaignSlugFromUrl, () => DEFAULT_APPEAL_SLUG);
  const [pickedSlug, setPickedSlug] = useState<AppealSlug | null>(null);
  const campaignSlug = pickedSlug ?? urlSlug;

  function load(slug = campaignSlug) {
    setLoading(true);
    fetchAppeal(slug);
  }

  // Fetch only: state is set in the promise callbacks, so the mount effect never
  // sets state synchronously. `loading` already starts true for the first fetch.
  function fetchAppeal(slug: AppealSlug) {
    apiFetch(`/api/appeals-data?campaign=${encodeURIComponent(slug)}`)
      .then(async (r) => {
        const json = (await r.json()) as Payload;
        if (json.summary) {
          setData(json);
          setError(r.ok ? null : json.error || null);
          return;
        }
        throw new Error(json.error || `Error ${r.status}`);
      })
      .catch((e: Error) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchAppeal(campaignSlugFromUrl());
  // Initial URL determines the report. Subsequent refreshes use selected state.
  }, []);
  useEffect(() => { void fetchMe().then((me) => setCanImport(Boolean(me.admin))); }, []);

  async function importCsv(dataset: "mail" | "email" | "digital", file: File | undefined) {
    if (!file) return;
    setImportStatus(`Importing ${file.name}…`);
    const headers: Record<string, string> = { "Content-Type": "text/csv" };
    const bearer = getBearer(); if (bearer) headers.Authorization = `Bearer ${bearer}`;
    try {
      const result = await fetch(`/api/appeals-import?campaign=${campaignSlug}&dataset=${dataset}`, { method: "POST", credentials: "include", headers, body: file }).then((response) => response.json());
      setImportStatus(result.ok ? "Saved. Metrics will appear after the next hourly appeal refresh." : `Import failed: ${result.error || "unknown error"}`);
    } catch { setImportStatus("Import failed."); }
  }

  const segments = useMemo(() => data?.segments ?? [], [data]);
  const constituency = segments.filter((s) => s.group === "constituency");
  const donorType = segments.filter((s) => s.group === "donorType");
  const selectedCampaign = appealCampaign(campaignSlug);
  const goal = data
    ? goalProgress(data.summary.totalRevenue, appealCampaign(data.campaignSlug ?? campaignSlug)?.goalGross)
    : null;
  const campaignStart = data?.campaignStart || data?.appealStart || selectedCampaign?.start || "2026-08-16";
  const campaignEnd = data?.campaignEnd || selectedCampaign?.end;

  function selectCampaign(nextSlug: AppealSlug) {
    setPickedSlug(nextSlug);
    window.history.replaceState(null, "", `/advancement/appeals?campaign=${nextSlug}`);
    load(nextSlug);
  }

  return (
    <main className="ac-page">
      <div className="ac-head">
        <div>
          <h1>{data?.campaign || "Fall Appeal"}</h1>
          <div className="ac-sub">
            Campaign {formatMdDate(campaignStart)}{campaignEnd ? ` – ${formatMdDate(campaignEnd)}` : ""}
            {data?.asOf ? ` · gift data as of ${formatMdDate(data.asOf)}` : ""}
            {data?.generated_at ? ` · updated ${data.generated_at}` : ""}
          </div>
        </div>
        <div className="appeals-controls">
          <label>
            <span className="sr-only">Campaign</span>
            <select value={campaignSlug} onChange={(event) => selectCampaign(event.target.value as AppealSlug)}>
              {APPEAL_CAMPAIGNS.map((campaign) => <option key={campaign.slug} value={campaign.slug}>{campaign.label}</option>)}
            </select>
          </label>
          <button type="button" className="ac-refresh" onClick={() => load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button type="button" className="ac-refresh" onClick={() => window.print()}>Print / PDF</button>
        </div>
      </div>

      {error && <div className="ac-error">{error}</div>}

      {data && data.empty && (
        <div className="ac-note">
          No gifts are attributed to <strong>{data.campaign}</strong> in Virtuous yet. This
          dashboard will populate automatically as appeal gifts are recorded against the campaign.
        </div>
      )}

      {data && (
        <>
          <section>
            <div className="ac-cards">
              <div className="ac-card" title={`${DEFS.totalRevenue} As of ${formatMdDate(data.asOf)}.`}>
                <span className="ac-card-num">{usd(data.summary.totalRevenue)}</span>
                <span className="ac-card-label">
                  Total Revenue <InfoDot text={DEFS.totalRevenue} />
                </span>
              </div>
              <div className="ac-card" title={`${DEFS.totalGifts} As of ${formatMdDate(data.asOf)}.`}>
                <span className="ac-card-num">{num(data.summary.totalGifts)}</span>
                <span className="ac-card-label">
                  Total Gifts <InfoDot text={DEFS.totalGifts} />
                </span>
              </div>
              <div className="ac-card" title={`${DEFS.avgGift} As of ${formatMdDate(data.asOf)}.`}>
                <span className="ac-card-num">{usd(data.summary.avgGift)}</span>
                <span className="ac-card-label">
                  Average Gift <InfoDot text={DEFS.avgGift} />
                </span>
              </div>
              <div className="ac-card" title={`${DEFS.medianGift} As of ${formatMdDate(data.asOf)}.`}>
                <span className="ac-card-num">{usd(data.summary.medianGift)}</span>
                <span className="ac-card-label">
                  Median Gift <InfoDot text={DEFS.medianGift} />
                </span>
              </div>
              <div className="ac-card" title={`${DEFS.donors} As of ${formatMdDate(data.asOf)}.`}>
                <span className="ac-card-num">{num(data.summary.donors)}</span>
                <span className="ac-card-label">
                  Donors <InfoDot text={DEFS.donors} />
                </span>
              </div>
            </div>
          </section>

          {goal && (
            <section className="ac-analytics">
              <h2>
                Progress to Goal <InfoDot text={DEFS.goal} />
              </h2>
              <div className="ac-cards">
                <div className="ac-card">
                  <span className="ac-card-num">{usd(goal.raised)}</span>
                  <span className="ac-card-label">Gross raised</span>
                  <span className="fa-card-sub">
                    {goal.pctOfGoal}% of {usd(goal.goal)} goal
                  </span>
                </div>
                <div className="ac-card">
                  <span className="ac-card-num">{usd(goal.goal)}</span>
                  <span className="ac-card-label">Gross goal</span>
                  <span className="fa-card-sub">
                    {goal.exceeded ? "Goal reached" : `${usd(goal.remaining)} to go`}
                  </span>
                </div>
              </div>
              <div
                className="fa-goal-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={goal.goal}
                aria-valuenow={Math.max(0, Math.min(goal.goal, goal.raised))}
                aria-label="Gross raised toward goal"
              >
                <div className="fa-goal-fill" style={{ width: `${Math.min(100, goal.pctOfGoal)}%` }} />
              </div>
            </section>
          )}

          {data.yoy && (
            <section className="ac-analytics">
              <h2>
                Year-over-Year Pace <InfoDot text={DEFS.yoy} />
              </h2>
              <div className="ac-cards">
                <div
                  className="ac-card"
                  title={`Day ${data.yoy.asOfOffset} (${formatMdDate(addDaysIso(campaignStart, data.yoy.asOfOffset))}) vs the same day of ${data.yoy.priorCampaign} (${formatMdDate(addDaysIso(data.yoy.priorStart, data.yoy.asOfOffset))}).`}
                >
                  <span className="ac-card-num">{usd(data.yoy.currentToDate.revenue)}</span>
                  <span className="ac-card-label">This appeal — revenue to date</span>
                  <span className="fa-card-sub">
                    vs {usd(data.yoy.priorToDate.revenue)} last year ·{" "}
                    <Delta value={data.yoy.revenueDeltaPct} />
                  </span>
                </div>
                <div
                  className="ac-card"
                  title={`Day ${data.yoy.asOfOffset}: ${num(data.yoy.currentToDate.gifts)} gifts vs ${num(data.yoy.priorToDate.gifts)} on the same day of ${data.yoy.priorCampaign}.`}
                >
                  <span className="ac-card-num">{num(data.yoy.currentToDate.gifts)}</span>
                  <span className="ac-card-label">This appeal — gifts to date</span>
                  <span className="fa-card-sub">
                    vs {num(data.yoy.priorToDate.gifts)} last year ·{" "}
                    <Delta value={data.yoy.giftsDeltaPct} />
                  </span>
                </div>
                <div
                  className="ac-card"
                  title={`${data.yoy.priorCampaign} full campaign total, not the same-day pace figure.`}
                >
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
                    <i className="fa-swatch fa-swatch-now" /> today (day {data.yoy.asOfOffset}
                    {campaignStart
                      ? `, ${formatMdDate(addDaysIso(campaignStart, data.yoy.asOfOffset))}`
                      : ""}
                    )
                  </span>
                </div>
                <p className="fa-deferred">Hover the chart to compare any day of the two campaigns.</p>
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
            <h2>Direct Mail Performance <InfoDot text={DEFS.directMail} /></h2>
            {!data.directMail || data.directMail.status === "unavailable" ? (
              <div className="ac-note">Direct-mail audience data is not available for this campaign yet.</div>
            ) : (
              <>
                <div className="ac-cards">
                  <div className="ac-card"><span className="ac-card-num">{num(data.directMail.totalMailed ?? data.directMail.audience)}</span><span className="ac-card-label">Total Mailed</span></div>
                  <div className="ac-card"><span className="ac-card-num">{data.directMail.responseRate == null ? "—" : pct(data.directMail.responseRate)}</span><span className="ac-card-label">Response Rate</span></div>
                  <div className="ac-card"><span className="ac-card-num">{num(data.directMail.responders)}</span><span className="ac-card-label">Responders</span></div>
                </div>
                {data.directMail.variants.length > 0 && (
                  <div className="ac-table-wrap"><table className="ac-table" style={{ minWidth: 700 }}><thead><tr><th>Audience / creative</th><th className="ac-num">Audience</th><th className="ac-num">Response rate</th><th className="ac-num">Revenue</th><th className="ac-num">Gifts</th><th className="ac-num">Avg gift</th></tr></thead><tbody>
                    {data.directMail.variants.map((variant) => <tr key={variant.label}><td>{variant.label}</td><td className="ac-num">{num(variant.audience)}</td><td className="ac-num">{variant.responseRate == null ? "—" : pct(variant.responseRate)}</td><td className="ac-num">{usd(variant.revenue)}</td><td className="ac-num">{num(variant.gifts)}</td><td className="ac-num">{usd(variant.avgGift)}</td></tr>)}
                  </tbody></table></div>
                )}
              </>
            )}
            {canImport && <ImportControl label="Update mail drop totals" columns="mailing_id, label, drop_date, creative, total_mailed" onFile={(file) => importCsv("mail", file)} status={importStatus} />}
          </section>

          <section className="ac-analytics">
            <h2>Email Performance</h2>
            {!data.emailImport || data.emailImport.status === "unavailable" ? <div className="ac-note">Standardized email delivery, conversion, unsubscribe, and attributed-revenue data is not available yet.</div> : (
              <div className="ac-table-wrap"><table className="ac-table" style={{ minWidth: 900 }}><thead><tr>
                {data.emailImport.rows.some((r) => r.segment) && <th>Segment</th>}
                {data.emailImport.rows.some((r) => r.emailNumber) && <th className="ac-num">Email #</th>}
                <th>Subject line</th><th className="ac-num">Sent</th><th className="ac-num">Delivered</th><th className="ac-num">Open rate</th><th className="ac-num">CTR</th><th className="ac-num">Conversion</th><th className="ac-num">Revenue</th></tr></thead><tbody>
                {data.emailImport.rows.map((row, index) => {
                  const hasSegment = data.emailImport?.rows.some((r) => r.segment);
                  const hasEmailNum = data.emailImport?.rows.some((r) => r.emailNumber);
                  return (
                    <tr key={`${row.emailId ?? "email"}-${index}`}>
                      {hasSegment && <td>{row.segment ? String(row.segment) : "-"}</td>}
                      {hasEmailNum && <td className="ac-num">{row.emailNumber ? `Email #${row.emailNumber}` : "-"}</td>}
                      <td>{String(row.subject || row.emailName || "Untitled")}</td>
                      <td className="ac-num">{num(Number(row.sent || 0))}</td>
                      <td className="ac-num">{num(Number(row.delivered || 0))}</td>
                      <td className="ac-num">{row.openRate == null ? "—" : pct(Number(row.openRate))}</td>
                      <td className="ac-num">{row.clickRate == null ? "—" : pct(Number(row.clickRate))}</td>
                      <td className="ac-num">{row.conversionRate == null ? "—" : pct(Number(row.conversionRate))}</td>
                      <td className="ac-num">{usd(Number(row.attributedRevenue || 0))}</td>
                    </tr>
                  );
                })}
              </tbody></table></div>
            )}
            {canImport && <ImportControl label="Update email performance" columns="email_id, email_name, subject, sent_at, sent, delivered, unique_opens, unique_clicks, conversions, unsubscribes, attributed_revenue, segment, email_number" onFile={(file) => importCsv("email", file)} status={importStatus} />}
          </section>

          <section className="ac-analytics">
            <h2>Digital and Landing Page <InfoDot text={DEFS.digital} /></h2>
            {!data.digitalPerformance || data.digitalPerformance.status === "unavailable" ? <div className="ac-note">Landing-page and traffic-source data is not available yet. Retargeting and ad performance remain a future reporting feature.</div> : (
              <div className="ac-table-wrap"><table className="ac-table" style={{ minWidth: 760 }}><thead><tr><th>Date</th><th>Landing page</th><th>Source</th><th className="ac-num">Visits</th><th className="ac-num">Conversion</th><th className="ac-num">Revenue</th></tr></thead><tbody>
                {data.digitalPerformance.rows.map((row, index) => <tr key={`${row.date}-${row.source}-${index}`}><td>{String(row.date)}</td><td>{String(row.landingPage)}</td><td>{String(row.source)}{row.medium ? ` / ${row.medium}` : ""}</td><td className="ac-num">{num(Number(row.visits || 0))}</td><td className="ac-num">{row.conversionRate == null ? "—" : pct(Number(row.conversionRate))}</td><td className="ac-num">{usd(Number(row.attributedRevenue || 0))}</td></tr>)}
              </tbody></table></div>
            )}
            {canImport && <ImportControl label="Update digital performance" columns="date, landing_page, source, medium, visits, conversions, attributed_revenue" onFile={(file) => importCsv("digital", file)} status={importStatus} />}
          </section>

          <section className="ac-analytics">
            <h2>
              Email Engagement <InfoDot text={DEFS.email} />
            </h2>
            {!data.emailPerformance || data.emailPerformance.status === "unavailable" ? (
              <div className="ac-note">
                Email engagement is not available yet. It will appear after the aggregate Virtuous Analytics
                refresh completes; this does not change gift reporting.
              </div>
            ) : data.emailPerformance.segments.length === 0 ? (
              <div className="ac-note">No approved Fall Appeal email sends have been published yet.</div>
            ) : (
              <>
                <div className="ac-table-wrap">
                  <table className="ac-table fa-email-table" style={{ minWidth: 960 }}>
                    <thead>
                      <tr>
                        <th>Segment / send</th>
                        <th className="ac-num">Email #</th>
                        <th className="ac-num">Sent</th>
                        <th className="ac-num">Revenue</th>
                        <th className="ac-num">Gifts</th>
                        <th className="ac-num">Avg gift</th>
                        <th className="ac-num">Recipients</th>
                        <th className="ac-num">Unique opens</th>
                        <th className="ac-num">Open rate</th>
                        <th className="ac-num">Unique clicks</th>
                        <th className="ac-num">Click rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.emailPerformance.segments.map((segment) => (
                        <EmailSegmentRows key={segment.key} segment={segment} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="fa-deferred">
                  Aggregate email data refreshed {data.emailPerformance.generatedAt || "recently"}
                  {data.emailPerformance.sourceSyncedAt
                    ? ` · warehouse synced ${data.emailPerformance.sourceSyncedAt}`
                    : ""}
                  .
                </p>
              </>
            )}
          </section>

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

          <section className="ac-analytics">
            <h2>
              Giving Pathways <InfoDot text={DEFS.givingPathways} />
            </h2>
            {!data.givingPathways ? (
              <div className="ac-note">Giving pathways will appear after the next data refresh.</div>
            ) : (
              <>
                <div className="ac-cards">
                  {data.givingPathways.map((pathway) => (
                    <div className="ac-card" key={pathway.key}>
                      <span className="ac-card-num">{usd(pathway.revenue)}</span>
                      <span className="ac-card-label">{pathway.label}</span>
                      <span className="fa-card-sub">{num(pathway.gifts)} gifts</span>
                    </div>
                  ))}
                </div>
                <div className="ac-table-wrap">
                  <table className="ac-table" style={{ minWidth: 640 }}>
                    <thead>
                      <tr>
                        <th>Pathway</th>
                        <th>Segment</th>
                        <th className="ac-num">Revenue</th>
                        <th className="ac-num">Gifts</th>
                        <th className="ac-num">Avg gift</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.givingPathways.map((pathway) =>
                        pathway.segments.length === 0 ? (
                          <tr key={pathway.key}>
                            <td>{pathway.label}</td>
                            <td>None in Virtuous yet</td>
                            <td className="ac-num">{usd(0)}</td>
                            <td className="ac-num">{num(0)}</td>
                            <td className="ac-num">{usd2(0)}</td>
                          </tr>
                        ) : (
                          pathway.segments.map((row) => (
                            <tr key={`${pathway.key}-${row.segment}`}>
                              <td>{pathway.label}</td>
                              <td>{row.segment}</td>
                              <td className="ac-num">{usd(row.revenue)}</td>
                              <td className="ac-num">{num(row.gifts)}</td>
                              <td className="ac-num">{usd2(row.avgGift)}</td>
                            </tr>
                          ))
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

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

function EmailSegmentRows({ segment }: { segment: EmailPerformanceSegment }) {
  return (
    <>
      <tr className="fa-email-group-row">
        <td>{segment.label}</td>
        <td className="ac-num">-</td>
        <td className="ac-num">-</td>
        <td className="ac-num">{segment.revenue != null ? usd(segment.revenue) : "-"}</td>
        <td className="ac-num">{segment.gifts != null ? num(segment.gifts) : "-"}</td>
        <td className="ac-num">{segment.avgGift != null ? usd2(segment.avgGift) : "-"}</td>
        <td className="ac-num">{num(segment.recipients)}</td>
        <td className="ac-num">{num(segment.uniqueOpens)}</td>
        <td className="ac-num">{segment.openRate == null ? "—" : pct(segment.openRate)}</td>
        <td className="ac-num">{num(segment.uniqueClicks)}</td>
        <td className="ac-num">{segment.clickRate == null ? "—" : pct(segment.clickRate)}</td>
      </tr>
      {segment.sends.map((send, index) => (
        <tr key={send.emailId} title={send.subject || send.name}>
          <td className="fa-email-send">
            <span>{send.name}</span>
            {send.subject && <small>{send.subject}</small>}
          </td>
          <td className="ac-num">Email #{send.emailNumber ?? (index + 1)}</td>
          <td className="ac-num">{formatMdDate(send.sentAt)}</td>
          <td className="ac-num">{send.revenue != null ? usd(send.revenue) : "-"}</td>
          <td className="ac-num">{send.gifts != null ? num(send.gifts) : "-"}</td>
          <td className="ac-num">{send.avgGift != null ? usd2(send.avgGift) : "-"}</td>
          <td className="ac-num">{num(send.recipients)}</td>
          <td className="ac-num">{num(send.uniqueOpens)}</td>
          <td className="ac-num">{send.openRate == null ? "—" : pct(send.openRate)}</td>
          <td className="ac-num">{num(send.uniqueClicks)}</td>
          <td className="ac-num">{send.clickRate == null ? "—" : pct(send.clickRate)}</td>
        </tr>
      ))}
    </>
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
        <tr
          key={s.key}
          title={`${s.label}: ${usd(s.revenue)} from ${num(s.gifts)} gifts and ${num(s.donors)} donors (avg ${usd(s.avgGift)}).`}
        >
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
