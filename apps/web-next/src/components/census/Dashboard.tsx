"use client";

import { useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import type { CensusSnapshot, CountFte, LabeledCount } from "@/lib/reports/census/types";
import "@/styles/census.css";

function fmtN(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}
function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}
function fmtFte(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

type Tab = "summary" | "historical" | "ug" | "attrition";

export function CensusDashboard() {
  const [data, setData] = useState<CensusSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("summary");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch("/api/census-data");
        const json = (await res.json()) as CensusSnapshot & { error?: string };
        if (!alive) return;
        if (!res.ok) {
          setError(json.error || res.statusText || "Data unavailable");
          return;
        }
        setData(json);
      } catch (e) {
        if (alive) setError(String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <p style={{ padding: 24 }}>Error: {error}</p>;
  if (!data) return <p style={{ padding: 24 }}>Loading…</p>;

  const k = data.kpis;
  return (
    <div className="census-root">
      <div className="wrap">
        <div className="hero">
          <div>
            <div className="eyebrow">Institutional Research</div>
            <h1>{data.term} Census</h1>
            <p className="sub">
              Built the same way as FA25: registration spine, joined lists, then
              these tables. Snapshot {data.generated}.
            </p>
          </div>
          <span className="draft-pill">{data.status}</span>
        </div>

        {data.pending.length > 0 && (
          <div className="pending">
            <h2>Still to add</h2>
            <ul>
              {data.pending.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="kpis">
          <Kpi label="States" value={fmtN(k.states)} />
          <Kpi label="All students" value={fmtN(k.allStudents)} />
          <Kpi label="UG degree-seeking" value={fmtN(k.ugStudents)} />
          <Kpi label="Foreign countries" value={fmtN(k.foreignCountries)} />
          <Kpi label="UG on campus" value={fmtPct(k.ugOnCampusPct)} hint="Needs housing list" />
          <Kpi label="Incoming avg HS GPA" value={k.incomingHsGpa?.toFixed(2) ?? "—"} hint="Needs Slate scores" />
          <Kpi label="% Catholic" value={fmtPct(k.pctCatholic, 0)} />
          <Kpi
            label="Avg CLT / ACT / SAT"
            value={`${k.avgClt ?? "—"}  /  ${k.avgAct ?? "—"}  /  ${k.avgSat ?? "—"}`}
            hint="Needs Slate scores"
          />
        </div>

        <div className="tabs">
          {(
            [
              ["summary", "Summary"],
              ["historical", "Historical"],
              ["ug", "Undergraduate"],
              ["attrition", "Retention"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "summary" && <SummaryTab data={data} />}
        {tab === "historical" && <HistoricalTab data={data} />}
        {tab === "ug" && <UgTab data={data} />}
        {tab === "attrition" && <AttritionTab data={data} />}
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kpi">
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function HcFte({ c }: { c: CountFte }) {
  return (
    <>
      <td className="num">{fmtN(c.headcount)}</td>
      <td className="num">{fmtFte(c.fte)}</td>
    </>
  );
}

function SummaryTab({ data }: { data: CensusSnapshot }) {
  const s = data.summary;
  const rows: { label: string; c: CountFte; indent?: boolean }[] = [
    { label: "Undergraduate, new students admitted", c: s.newStudents },
    { label: "FTCA", c: s.ftca, indent: true },
    { label: "Transfer", c: s.tran, indent: true },
    { label: "Re-admit", c: s.read, indent: true },
    { label: "Second bachelor's", c: s.secb, indent: true },
    { label: "Lux Mundi (UG)", c: s.luxMundiUg, indent: true },
    { label: "Returning students", c: s.returning },
    { label: "Total degree-seeking", c: s.degreeSeeking },
    { label: "High school dual enrollment", c: s.dualEnrollment },
    { label: "Non-degree / personal enrichment", c: s.nonDegree },
    { label: "Total undergraduate enrollment", c: s.totalUndergraduate },
    { label: "Graduate MA", c: s.gradMa },
    { label: "Graduate PhD", c: s.gradPhd },
    { label: "Graduate MBA", c: s.gradMba },
    { label: "Graduate MEdCl", c: s.gradMedcl },
    { label: "Lux Mundi (graduate)", c: s.luxMundiGrad },
    { label: "Total graduate enrollment", c: s.totalGraduate },
    { label: "Graduate & undergraduate enrollment", c: s.totalEnrollment },
  ];
  return (
    <div className="card">
      <h3>Headcount / FTE</h3>
      <table>
        <thead>
          <tr>
            <th></th>
            <th className="num">Headcount</th>
            <th className="num">FTE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={r.label.startsWith("Total") ? "total" : r.indent ? "indent" : ""}>
              <td>{r.label}</td>
              <HcFte c={r.c} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoricalTab({ data }: { data: CensusSnapshot }) {
  const h = data.historical as {
    years: number[];
    [k: string]: { hc?: (number | null)[]; fte?: (number | null)[] } | number[] | undefined;
  };
  const years = h.years;
  const lines: { label: string; key: string }[] = [
    { label: "New students", key: "newStudents" },
    { label: "FTCA", key: "ftca" },
    { label: "Transfer", key: "tran" },
    { label: "Re-admit", key: "read" },
    { label: "Second bachelor's", key: "secb" },
    { label: "Returning", key: "returning" },
    { label: "Degree-seeking UG", key: "degreeSeeking" },
    { label: "Dual enrollment", key: "dualEnrollment" },
    { label: "Total undergraduate", key: "totalUndergraduate" },
    { label: "Graduate MA", key: "gradMa" },
    { label: "Graduate PhD", key: "gradPhd" },
    { label: "Graduate MBA", key: "gradMba" },
    { label: "Graduate MEdCl", key: "gradMedcl" },
    { label: "Total graduate", key: "totalGraduate" },
    { label: "All enrollment", key: "totalEnrollment" },
  ];
  return (
    <div className="card">
      <h3>Fall census history (FA26 is live / draft)</h3>
      <table>
        <thead>
          <tr>
            <th></th>
            {years.map((y) => (
              <th key={y} className="num">
                FA{String(y).slice(2)} HC
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const series = h[line.key] as { hc?: (number | null)[] } | undefined;
            const hc = series?.hc || [];
            return (
              <tr key={line.key} className={line.label.startsWith("Total") || line.label.startsWith("All") ? "total" : ""}>
                <td>{line.label}</td>
                {years.map((_, i) => (
                  <td key={i} className="num">
                    {hc[i] == null ? "—" : fmtN(hc[i])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CountTable({
  title,
  rows,
  extra,
}: {
  title: string;
  rows: LabeledCount[];
  extra?: (row: LabeledCount) => ReactNode;
}) {
  const total = rows.reduce((s, r) => s + r.n, 0);
  return (
    <div className="card">
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th></th>
            <th className="num">Students</th>
            <th className="num">%</th>
            {extra && <th className="num"></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="num">{fmtN(r.n)}</td>
              <td className="num">{fmtPct(r.pct ?? (total ? r.n / total : 0))}</td>
              {extra && extra(r)}
            </tr>
          ))}
          <tr className="total">
            <td>Total</td>
            <td className="num">{fmtN(total)}</td>
            <td className="num"></td>
            {extra && <td></td>}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function UgTab({ data }: { data: CensusSnapshot }) {
  const u = data.ug;
  return (
    <>
      <div className="grid-2 section">
        <CountTable title="States" rows={u.states} />
        <CountTable title="Countries (F1 / international)" rows={u.countries} />
      </div>
      <div className="grid-3 section">
        <CountTable title="Gender" rows={u.gender} />
        <CountTable title="Religion" rows={u.religion} />
        <CountTable title="Athlete / non-athlete" rows={u.athlete} />
      </div>
      <div className="grid-2 section">
        <div className="card">
          <h3>Class level</h3>
          <table>
            <thead>
              <tr>
                <th></th>
                <th className="num">Students</th>
                <th className="num">Full time</th>
              </tr>
            </thead>
            <tbody>
              {u.classLevel.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="num">{fmtN(r.n)}</td>
                  <td className="num">{fmtN(r.fullTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CountTable
          title="Sports"
          rows={u.sports}
          extra={(r) => (
            <td className="num">{fmtPct(r.pctOfAll)}</td>
          )}
        />
      </div>
      <div className="grid-3 section">
        <CountTable title="Incoming athlete mix" rows={u.incomingAthlete} />
        <CountTable title="Residency (housing pending)" rows={u.residency} />
        <CountTable title={`Honors (${fmtN(u.honorsN)})`} rows={u.honorsByClass} />
      </div>
      <div className="card section">
        <h3>Majors by class</h3>
        <table>
          <thead>
            <tr>
              <th>Major</th>
              <th className="num">Fr</th>
              <th className="num">So</th>
              <th className="num">Jr</th>
              <th className="num">Sr</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {u.majors.map((m) => (
              <tr key={m.label}>
                <td>{m.label}</td>
                <td className="num">{fmtN(m.freshman)}</td>
                <td className="num">{fmtN(m.sophomore)}</td>
                <td className="num">{fmtN(m.junior)}</td>
                <td className="num">{fmtN(m.senior)}</td>
                <td className="num">{fmtN(m.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AttritionTab({ data }: { data: CensusSnapshot }) {
  const a = data.ftcaAttrition;
  const u = data.allUgRetention;
  return (
    <>
      <div className="grid-2 section">
        <div className="card">
          <h3>FA25 FTCA cohort retention</h3>
          <table>
            <tbody>
              <tr>
                <td>Fall 2025 FTCA cohort</td>
                <td className="num">{fmtN(a.cohort)}</td>
              </tr>
              <tr>
                <td>Enrolled Fall 2026</td>
                <td className="num">{fmtN(a.enrolledThisFall)}</td>
              </tr>
              <tr>
                <td>Not retained</td>
                <td className="num">{fmtN(a.notRetained)}</td>
              </tr>
              <tr className="total">
                <td>Retention rate F25–F26</td>
                <td className="num">{fmtPct(a.retentionRate)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>All UG retention (minus graduates)</h3>
          <table>
            <tbody>
              <tr>
                <td>Fall 2025 degree-seeking UG</td>
                <td className="num">{fmtN(u.priorUg)}</td>
              </tr>
              <tr>
                <td>Fall / Spring / Summer graduates</td>
                <td className="num">{fmtN(u.graduates)}</td>
              </tr>
              <tr>
                <td>Retention pool</td>
                <td className="num">{fmtN(u.pool)}</td>
              </tr>
              <tr>
                <td>Enrolled Fall 2026</td>
                <td className="num">{fmtN(u.enrolledThisFall)}</td>
              </tr>
              <tr className="total">
                <td>All-UG retention F25–F26</td>
                <td className="num">{fmtPct(u.retentionRate)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid-2 section">
        <div className="card">
          <h3>Historical FTCA retention</h3>
          <table>
            <tbody>
              {data.historicalFtcaRetention.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="num">{fmtPct(r.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Historical all-UG retention</h3>
          <table>
            <tbody>
              {data.historicalAllUgRetention.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="num">{fmtPct(r.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid-2 section">
        <AttritionTable title="FTCA by state" rows={a.byState} />
        <AttritionTable title="FTCA by sport" rows={a.bySport} />
      </div>
      <div className="grid-2 section">
        <AttritionTable title="FTCA athlete / non-athlete" rows={a.byAthlete} />
        <AttritionTable title="FTCA by AMU GPA" rows={a.byGpa} />
      </div>
    </>
  );
}

function AttritionTable({
  title,
  rows,
}: {
  title: string;
  rows: CensusSnapshot["ftcaAttrition"]["byState"];
}) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th></th>
            <th className="num">Students</th>
            <th className="num">Not retained</th>
            <th className="num">% retained</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="num">{fmtN(r.students)}</td>
              <td className="num">{fmtN(r.notRetained)}</td>
              <td className="num">{fmtPct(r.retainedPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
