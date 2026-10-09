"use client";

import { useCallback, useEffect, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { apiFetch } from "@/lib/api";
import { formatEastern } from "@/lib/reports/advancement-overview/shape";
import type {
  CurrentTable,
  IncomingTrend,
  MajorsPayload,
  MajorsReady,
  TrendTable,
} from "@/lib/reports/majors/shape";
import "@/styles/annunciation.css";
import "@/styles/mgo-analysis.css";
import "@/styles/majors.css";

type Tab = "incoming" | "current" | "trends";

const TABS: { key: Tab; label: string }[] = [
  { key: "incoming", label: "Incoming (Accepted by Major)" },
  { key: "current", label: "Current Students (Majors and Minors)" },
  { key: "trends", label: "Trends" },
];

type Params = { incomingYear: string; year: string; term: string };

function int(n: number | null | undefined): string {
  return n == null ? "" : n.toLocaleString("en-US");
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function signed(n: number | null): string {
  if (n == null) return "";
  return n > 0 ? `+${n.toLocaleString("en-US")}` : n.toLocaleString("en-US");
}

function query(p: Params): string {
  const q = new URLSearchParams();
  if (p.incomingYear) q.set("incomingYear", p.incomingYear);
  if (p.year && p.term) {
    q.set("year", p.year);
    q.set("term", p.term);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export default function MajorsPage() {
  return (
    <AccessGate report="majors">
      <ReportTopBar title="Majors and Minors" nav={[]} />
      <MajorsReport />
    </AccessGate>
  );
}

function MajorsReport() {
  const [tab, setTab] = useState<Tab>("incoming");
  const [params, setParams] = useState<Params>({ incomingYear: "", year: "", term: "" });
  const [data, setData] = useState<MajorsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const fetchData = useCallback((p: Params) => {
    return apiFetch(`/api/majors-data${query(p)}`)
      .then(async (r) => {
        const json = (await r.json()) as MajorsPayload & { error?: string };
        if (!r.ok) throw new Error(json.error || `Error ${r.status}`);
        setData(json);
        setError(null);
      })
      .catch((e: Error) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void fetchData({ incomingYear: "", year: "", term: "" });
  }, [fetchData]);

  function update(next: Partial<Params>) {
    const p = { ...params, ...next };
    setParams(p);
    setLoading(true);
    void fetchData(p);
  }

  async function exportXlsx() {
    if (!data || data.status !== "ready") return;
    setExporting(true);
    try {
      const res = await apiFetch(
        `/api/majors-export${query({
          incomingYear: data.incoming.year,
          year: data.current.year,
          term: data.current.term,
        })}`,
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || res.statusText || "Export failed");
      }
      const blob = await res.blob();
      const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] || "Majors_and_Minors.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const ready = data?.status === "ready" ? data : null;

  return (
    <main className="ac-page mga-page mj-page">
      <div className="ac-head">
        <div>
          <h1>Majors and Minors</h1>
          <p className="ac-sub">
            Undergraduate accepted applicants, majors, and minors from PowerCampus
            {data?.generatedAt ? ` · updated ${formatEastern(data.generatedAt)}` : ""}
          </p>
        </div>
        <div className="mj-actions">
          <button type="button" className="ac-refresh" onClick={exportXlsx} disabled={!ready || exporting}>
            {exporting ? "Preparing…" : "Download Excel"}
          </button>
          <button type="button" className="ac-refresh" onClick={() => update({})} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="ac-error">
          <p>{error}</p>
        </div>
      )}

      {data?.status === "waiting" && (
        <div className="ac-note mj-waiting" role="status">
          <strong>{data.message}.</strong> The report needs PowerCampus fields that are published starting with the
          next nightly refresh ({data.missing.join(", ")}). No counts are shown until then.
        </div>
      )}

      {!data && loading && <p className="rc-loading">Loading…</p>}

      {ready && (
        <>
          <div className="mga-controls">
            <div className="mga-seg" role="tablist" aria-label="Report view">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  className={tab === t.key ? "mga-seg-on" : undefined}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {tab === "incoming" && (
              <label className="mga-field">
                <span>Fall entry year</span>
                <select
                  value={ready.incoming.year}
                  onChange={(e) => update({ incomingYear: e.target.value })}
                  disabled={!ready.incoming.years.length}
                >
                  {ready.incoming.years.map((y) => (
                    <option key={y} value={y}>
                      Fall {y}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {tab === "current" && (
              <label className="mga-field">
                <span>Term</span>
                <select
                  value={`${ready.current.year}|${ready.current.term}`}
                  onChange={(e) => {
                    const [year, term] = e.target.value.split("|");
                    update({ year: year ?? "", term: term ?? "" });
                  }}
                  disabled={!ready.current.terms.length}
                >
                  {ready.current.terms.map((t) => (
                    <option key={`${t.year}|${t.term}`} value={`${t.year}|${t.term}`}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {tab === "incoming" && <IncomingView data={ready} />}
          {tab === "current" && <CurrentView data={ready} />}
          {tab === "trends" && <TrendsView data={ready} />}
        </>
      )}
    </main>
  );
}

function IncomingView({ data }: { data: MajorsReady }) {
  const inc = data.incoming;
  const t = inc.totals;
  return (
    <section>
      <h2 className="mj-h2">Accepted Applicants by Major, Fall {inc.year}</h2>
      <div className="ac-table-wrap">
        <table className="ac-table mj-table">
          <thead>
            <tr>
              <th rowSpan={2}>Major</th>
              <th rowSpan={2}>Degree</th>
              <th colSpan={2} className="mj-group">First-Time Freshmen</th>
              <th colSpan={2} className="mj-group">Transfers</th>
              <th colSpan={4} className="mj-group">Composite</th>
              <th colSpan={2} className="mj-group">Prior Year Final ({inc.priorYear})</th>
            </tr>
            <tr>
              <th className="ac-num">All Accepts</th>
              <th className="ac-num">Active Deposits</th>
              <th className="ac-num">All Accepts</th>
              <th className="ac-num">Active Deposits</th>
              <th className="ac-num">All Accepts QTY</th>
              <th className="ac-num">%</th>
              <th className="ac-num">Active Deposits QTY</th>
              <th className="ac-num">%</th>
              <th className="ac-num">Accepts</th>
              <th className="ac-num">Deposits</th>
            </tr>
          </thead>
          <tbody>
            {inc.rows.length === 0 && (
              <tr>
                <td colSpan={12} className="ac-empty">
                  No accepted applicants for this year yet.
                </td>
              </tr>
            )}
            {inc.rows.map((r) => (
              <tr key={`${r.curriculum}|${r.degree}`}>
                <td>{r.major}</td>
                <td>{r.degreeLabel}</td>
                <td className="ac-num">{int(r.ftcaAccepts)}</td>
                <td className="ac-num">{int(r.ftcaDeposits)}</td>
                <td className="ac-num">{int(r.tranAccepts)}</td>
                <td className="ac-num">{int(r.tranDeposits)}</td>
                <td className="ac-num">{int(r.totalAccepts)}</td>
                <td className="ac-num">{pct(r.acceptsPct)}</td>
                <td className="ac-num">{int(r.totalDeposits)}</td>
                <td className="ac-num">{pct(r.depositsPct)}</td>
                <td className="ac-num mj-prior">{int(r.priorAccepts)}</td>
                <td className="ac-num mj-prior">{int(r.priorDeposits)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="mj-total">
              <td colSpan={2}>Grand Total</td>
              <td className="ac-num">{int(t.ftcaAccepts)}</td>
              <td className="ac-num">{int(t.ftcaDeposits)}</td>
              <td className="ac-num">{int(t.tranAccepts)}</td>
              <td className="ac-num">{int(t.tranDeposits)}</td>
              <td className="ac-num">{int(t.totalAccepts)}</td>
              <td className="ac-num">{pct(t.acceptsPct)}</td>
              <td className="ac-num">{int(t.totalDeposits)}</td>
              <td className="ac-num">{pct(t.depositsPct)}</td>
              <td className="ac-num">{int(t.priorAccepts)}</td>
              <td className="ac-num">{int(t.priorDeposits)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <footer className="mga-foot">
        <h2>How this is counted</h2>
        <ul>
          <li>
            Undergraduate (UNDERG, NDEG) Fall session 01 applications from the undergraduate admissions office with an
            accept decision, or a withdrawn deposit (WDEP). Non-degree (NONDEG) is excluded.
          </li>
          <li>
            Major is the student&apos;s primary curriculum for that term when one is set, otherwise the applied curriculum.
            Rows are counted (as in the legacy report), so a student with two applications in the same major counts twice.
          </li>
          <li>
            First-time freshmen: {labelList(data.definitions.collegeAttend.slice(0, 1))}. Transfers:{" "}
            {labelList(data.definitions.collegeAttend.slice(1))}.
          </li>
          <li>
            Active deposits: application status DEP, not a withdrawn deposit. % is the share of the grand total.
          </li>
          <li>
            Prior Year Final is the same major and degree in the year before. Its total covers every major that year,
            including majors with no accepts this year.
          </li>
        </ul>
      </footer>
    </section>
  );
}

function labelList(items: { code: string; label: string }[]): string {
  return items.map((i) => (i.label && i.label !== i.code ? `${i.label} (${i.code})` : i.code)).join(", ");
}

function CurrentTableView({ title, table }: { title: string; table: CurrentTable }) {
  const t = table.totals;
  return (
    <section className="mj-section">
      <h2 className="mj-h2">{title}</h2>
      <div className="ac-table-wrap">
        <table className="ac-table mj-table">
          <thead>
            <tr>
              <th>Curriculum</th>
              <th className="ac-num">Freshman</th>
              <th className="ac-num">Sophomore</th>
              <th className="ac-num">Junior</th>
              <th className="ac-num">Senior</th>
              <th className="ac-num">Total</th>
              <th className="ac-num">% Overall</th>
              <th className="ac-num">Rank</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="ac-empty">
                  No students for this term.
                </td>
              </tr>
            )}
            {table.rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="ac-num">{int(r.fres)}</td>
                <td className="ac-num">{int(r.soph)}</td>
                <td className="ac-num">{int(r.jr)}</td>
                <td className="ac-num">{int(r.sr)}</td>
                <td className="ac-num">{int(r.total)}</td>
                <td className="ac-num">{pct(r.pct)}</td>
                <td className="ac-num">{r.rank}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="mj-total">
              <td>Total</td>
              <td className="ac-num">{int(t.fres)}</td>
              <td className="ac-num">{int(t.soph)}</td>
              <td className="ac-num">{int(t.jr)}</td>
              <td className="ac-num">{int(t.sr)}</td>
              <td className="ac-num">{int(t.total)}</td>
              <td className="ac-num">{pct(t.pct)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function CurrentView({ data }: { data: MajorsReady }) {
  const c = data.current;
  return (
    <>
      <p className="ac-note">
        {c.label}: active undergraduates who are registered (ENRL or GRAD) or accepted and deposited. Students with a
        separation status this term are excluded. Total counts students with a class level.
      </p>
      <CurrentTableView title="Majors (without Undeclared)" table={c.majors} />
      <CurrentTableView title="Majors (with Undeclared)" table={c.majorsWithUndeclared} />
      <CurrentTableView title="Minors" table={c.minors} />
    </>
  );
}

function TrendTableView({ title, table }: { title: string; table: TrendTable }) {
  const change5 = table.compareYear ? `vs Fall ${table.compareYear}` : "vs 5 years ago";
  return (
    <section className="mj-section">
      <h2 className="mj-h2">{title}</h2>
      <div className="ac-table-wrap">
        <table className="ac-table mj-table">
          <thead>
            <tr>
              <th>Curriculum</th>
              {table.years.map((y) => (
                <th key={y} className="ac-num">
                  Fall {y}
                </th>
              ))}
              <th className="ac-num">vs prior fall</th>
              <th className="ac-num">{change5}</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                {r.counts.map((n, i) => (
                  <td key={table.years[i]} className="ac-num">
                    {int(n)}
                  </td>
                ))}
                <td className="ac-num">{signed(r.changePrior)}</td>
                <td className="ac-num">{signed(r.change5)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="mj-total">
              <td>Total</td>
              {table.totals.counts.map((n, i) => (
                <td key={table.years[i]} className="ac-num">
                  {int(n)}
                </td>
              ))}
              <td className="ac-num">{signed(table.totals.changePrior)}</td>
              <td className="ac-num">{signed(table.totals.change5)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function IncomingTrendView({ trend }: { trend: IncomingTrend }) {
  const head = (y: string) => `Fall ${y}${trend.inProgress.includes(y) ? "*" : ""}`;
  return (
    <section className="mj-section">
      <h2 className="mj-h2">Incoming Accepts and Active Deposits by Major</h2>
      <div className="ac-table-wrap">
        <table className="ac-table mj-table">
          <thead>
            <tr>
              <th rowSpan={2}>Major</th>
              <th colSpan={trend.years.length + 1} className="mj-group">
                All Accepts
              </th>
              <th colSpan={trend.years.length + 1} className="mj-group">
                Active Deposits
              </th>
            </tr>
            <tr>
              {trend.years.map((y) => (
                <th key={`a${y}`} className="ac-num">
                  {head(y)}
                </th>
              ))}
              <th className="ac-num">vs prior</th>
              {trend.years.map((y) => (
                <th key={`d${y}`} className="ac-num">
                  {head(y)}
                </th>
              ))}
              <th className="ac-num">vs prior</th>
            </tr>
          </thead>
          <tbody>
            {[...trend.rows, trend.totals].map((r) => (
              <tr key={r.label} className={r === trend.totals ? "mj-total" : undefined}>
                <td>{r.label}</td>
                {r.accepts.map((n, i) => (
                  <td key={`a${trend.years[i]}`} className="ac-num">
                    {int(n)}
                  </td>
                ))}
                <td className="ac-num">{signed(r.acceptsChangePrior)}</td>
                {r.deposits.map((n, i) => (
                  <td key={`d${trend.years[i]}`} className="ac-num">
                    {int(n)}
                  </td>
                ))}
                <td className="ac-num">{signed(r.depositsChangePrior)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {trend.inProgress.length > 0 && (
        <p className="mj-footnote">* Term has not started yet; counts are still changing.</p>
      )}
    </section>
  );
}

function TrendsView({ data }: { data: MajorsReady }) {
  return (
    <>
      <p className="ac-note">
        Fall census-style counts from the same definitions as the Current Students tab, for the last five fall terms that
        have started.
      </p>
      <TrendTableView title="Majors (with Undeclared)" table={data.trends.majorsWithUndeclared} />
      <TrendTableView title="Minors" table={data.trends.minors} />
      <IncomingTrendView trend={data.trends.incoming} />
    </>
  );
}
