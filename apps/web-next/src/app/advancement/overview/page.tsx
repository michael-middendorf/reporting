"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import {
  barFill,
  gaugeCopy,
  hasFiscalYears,
  pct,
  pickYear,
  usd,
  type AdvancementOverviewSnapshot,
  type OfficerRow,
  type YtdRow,
} from "@/lib/reports/advancement-overview/shape";
import "@/styles/annunciation.css";
import "@/styles/advancement-overview.css";

function deltaClass(n: number): string {
  if (n > 0) return "ao-pos";
  if (n < 0) return "ao-neg";
  return "";
}

function goalBarColor(n: number | null | undefined): string {
  const v = n ?? 0;
  if (v >= 100) return "#2f7a48";
  if (v >= 70) return "#4fa56a";
  if (v >= 40) return "#8ecf96";
  return "#c5e6c8";
}

function parseFy(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 1990 && n < 2100 ? n : null;
}

function Gauge({ value, subtitle }: { value: number | null | undefined; subtitle: string }) {
  const shown = value ?? 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  const filled = (barFill(shown) / 100) * c;
  return (
    <svg viewBox="0 0 140 140" aria-hidden="true">
      <circle cx="70" cy="70" r={r} fill="none" stroke="#e6eee8" strokeWidth="12" />
      <circle
        cx="70"
        cy="70"
        r={r}
        fill="none"
        stroke="#4fa56a"
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${c}`}
        transform="rotate(-90 70 70)"
      />
      <text className="ao-gauge-pct" x="70" y="68" textAnchor="middle">
        {pct(value, 0)}
      </text>
      <text className="ao-gauge-sub" x="70" y="86" textAnchor="middle">
        {subtitle}
      </text>
    </svg>
  );
}

function VBar({
  value,
  goal,
  label,
}: {
  value: number | null | undefined;
  goal: number;
  label: string;
}) {
  const n = value ?? 0;
  return (
    <div className="ao-vbar">
      <div className="ao-vbar-max">{goal}</div>
      <div className="ao-vbar-track">
        <div className="ao-vbar-fill" style={{ height: `${barFill((n / goal) * 100)}%` }} />
      </div>
      <div className="ao-vbar-min">0</div>
      <div className="ao-vbar-value">{value ?? "—"}</div>
      <div className="ao-vbar-label">{label}</div>
    </div>
  );
}

function AdvancementOverviewPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedFy = parseFy(searchParams.get("fy"));
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

  const years = data?.fiscalYears ?? [];
  const view = pickYear(data, requestedFy);
  const selectedFy = view?.fiscalYear ?? requestedFy;
  const k = view?.kpis;
  const ytd = view?.ytd;
  const officers = view?.officers ?? [];
  const pipeline = view?.pipeline;
  const currentYear = ytd?.currentYear ?? 2025;
  const priorYear = ytd?.priorYear ?? 2024;

  function selectFy(fy: number) {
    const params = new URLSearchParams(searchParams.toString());
    const current = data?.currentFiscalYear ?? years[0]?.fiscalYear;
    if (current != null && fy === current) params.delete("fy");
    else params.set("fy", String(fy));
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <main className="ac-page ao-page">
      <div className="ac-head">
        <div>
          <h1>Advancement Overview</h1>
          <p className="ac-sub">
            {view?.fiscalYearLabel ?? "FY"} results from Virtuous
            {data?.generated_at ? ` · updated ${data.generated_at}` : ""}.
          </p>
        </div>
        <div className="ao-head-actions">
          {hasFiscalYears(data) && selectedFy != null && (
            <div className="ao-fy-switch" role="group" aria-label="Fiscal year">
              {years.map((year) => (
                <button
                  key={year.fiscalYear}
                  type="button"
                  aria-pressed={year.fiscalYear === selectedFy}
                  onClick={() => selectFy(year.fiscalYear)}
                >
                  {year.fiscalYearLabel}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="ac-refresh" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="ac-error">
          <p>{error}</p>
        </div>
      )}

      {!error && (
        <>
          <div className="ao-top">
            <section className="ao-card">
              <div className="ao-card-body ao-fund">
                <div>
                  <div className="ao-kpi-label">Total Fundraising</div>
                  <div className="ao-kpi-value">{usd(k?.totalFundraising.amount)}</div>
                </div>
                <div>
                  <div className="ao-kpi-label">Unrestricted Gifts</div>
                  <div className="ao-kpi-value">{usd(k?.unrestricted.amount)}</div>
                  <div className="ao-kpi-goal">Goal: {usd(k?.unrestricted.goal)}</div>
                </div>
                <div className="ao-gauge">
                  <Gauge
                    value={k?.totalFundraising.pctOfGoal}
                    subtitle={view ? gaugeCopy(view) : "of FY"}
                  />
                </div>
              </div>
            </section>

            <section className="ao-card">
              <div className="ao-vbars">
                <VBar
                  value={k?.multiYearPledges.count}
                  goal={k?.multiYearPledges.goal ?? 30}
                  label="New Multi-Year Pledges"
                />
                <VBar
                  value={k?.estateGifts.count}
                  goal={k?.estateGifts.goal ?? 25}
                  label="Estate Gifts"
                />
              </div>
            </section>
          </div>

          <section className="ao-card ao-ytd">
            <table className="ao-table ao-ytd-table">
              <thead>
                <tr>
                  <th>YTD Actuals</th>
                  <th className="ao-num">{currentYear}</th>
                  <th className="ao-num">{priorYear}</th>
                  <th className="ao-num">Difference</th>
                  <th className="ao-num">Percentage</th>
                </tr>
              </thead>
              <tbody>
                <YtdLine label="MGO Team" row={ytd?.mgoTeam} />
                <YtdLine label="Overall" row={ytd?.overall} />
              </tbody>
            </table>
          </section>

          <div className="ao-bottom">
            <section className="ao-card">
              <header className="ao-panel-head">
                <h2>Individual Goals</h2>
                <p>Major Gift Officers</p>
              </header>
              <table className="ao-table">
                <thead>
                  <tr>
                    <th>MGO</th>
                    <th className="ao-num">Goal</th>
                    <th className="ao-num">% to Goal</th>
                  </tr>
                </thead>
                <tbody>
                  {officers.length === 0 && (
                    <tr>
                      <td colSpan={3} className="ao-empty">
                        {loading ? "Loading…" : "No officer totals."}
                      </td>
                    </tr>
                  )}
                  {officers.map((o: OfficerRow) => (
                    <tr key={o.solicitor}>
                      <td>{o.name}</td>
                      <td className="ao-num">{usd(o.goal)}</td>
                      <td className="ao-num" style={{ padding: 0, width: "34%" }}>
                        <div className="ao-goal-bar">
                          <span
                            style={{
                              width: `${barFill(o.pctToGoal)}%`,
                              background: goalBarColor(o.pctToGoal),
                            }}
                          />
                          <em>{pct(o.pctToGoal, 0)}</em>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="ao-card">
              <header className="ao-panel-head">
                <h2>Virtuous Pipeline Status</h2>
              </header>
              <table className="ao-table ao-pipe-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th className="ao-num">Total Amount in Asks</th>
                    <th className="ao-num">Number of Gifts</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Totals</td>
                    <td className="ao-num">{usd(pipeline?.totalAmount)}</td>
                    <td className="ao-num">{pipeline?.totalCount ?? "—"}</td>
                  </tr>
                  {(pipeline?.rows ?? []).map((r) => (
                    <tr key={r.status}>
                      <td>{r.status}</td>
                      <td className="ao-num">{usd(r.amount)}</td>
                      <td className="ao-num">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}
    </main>
  );
}

function YtdLine({ label, row }: { label: string; row?: YtdRow }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="ao-num ao-now">{usd(row?.current)}</td>
      <td className="ao-num">{usd(row?.prior)}</td>
      <td className={`ao-num ${row ? deltaClass(row.difference) : ""}`}>
        {usd(row?.difference)}
      </td>
      <td className={`ao-num ${row?.pct != null ? deltaClass(row.pct) : ""}`}>
        {pct(row?.pct)}
      </td>
    </tr>
  );
}

export default function AdvancementOverviewRoute() {
  return (
    <Suspense
      fallback={
        <main className="ac-page ao-page">
          <p className="ac-sub">Loading…</p>
        </main>
      }
    >
      <AdvancementOverviewPage />
    </Suspense>
  );
}
