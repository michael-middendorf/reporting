"use client";

import { NAIA_SPORTS } from "@/lib/reports/enrollment/fall-report-config";
import type {
  CountPct,
  FallReport,
  FunnelSlice,
  ScoreRow,
} from "@/lib/reports/enrollment/fall-report";

function yy(year: number) {
  return `'${String(year).slice(-2)}`;
}

function n(v: number | null | undefined) {
  if (v == null) return "—";
  return Number(v).toLocaleString();
}

function naOr(v: number | null | undefined, year: number, reportYear: number) {
  if (year === reportYear) return "N/A";
  if (v == null) return "—";
  return Number(v).toLocaleString();
}

function pct(v: number | null | undefined) {
  if (v == null) return "—";
  return `${v.toFixed(2)}%`;
}

function money(v: number | null | undefined) {
  if (v == null) return "—";
  return `$${Math.round(v).toLocaleString()}`;
}

function dr(v: number | null | undefined) {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

function avgN(cell: { avg: number | null; n: number }, kind: "act" | "sat" | "clt") {
  if (cell.avg == null) return { avg: "—", n: "—" };
  const avg =
    kind === "sat" ? String(Math.round(cell.avg)) : cell.avg.toFixed(2);
  return { avg, n: String(cell.n) };
}

function gpa(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toFixed(2);
}

function SliceTable({
  title,
  tone,
  rows,
}: {
  title: string;
  tone: "purple" | "blue";
  rows: { label: string; slice: FunnelSlice }[];
}) {
  return (
    <div className="fall-mini">
      <table className="fall-tbl">
        <thead>
          <tr>
            <th rowSpan={2} className={`fall-stub fall-${tone}`}>
              {title}
            </th>
            <th colSpan={2}>Applications</th>
            <th colSpan={2}>Accepted</th>
            <th colSpan={2}>Active Deposits</th>
          </tr>
          <tr>
            <th>#</th>
            <th>%</th>
            <th>#</th>
            <th>%</th>
            <th>#</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="r">{n(r.slice.apps.n)}</td>
              <td className="r">{pct(r.slice.apps.pct)}</td>
              <td className="r">{n(r.slice.accepted.n)}</td>
              <td className="r">{pct(r.slice.accepted.pct)}</td>
              <td className="r">{n(r.slice.deposits.n)}</td>
              <td className="r">{pct(r.slice.deposits.pct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScoreLine({
  label,
  row,
  honors,
}: {
  label: string;
  row: ScoreRow;
  honors: boolean;
}) {
  const act = avgN(row.act, "act");
  const sat = avgN(row.sat, "sat");
  const clt = avgN(row.clt, "clt");
  return (
    <tr>
      <td>{label}</td>
      <td className="r">{n(row.n)}</td>
      <td className="r">{act.avg}</td>
      <td className="r">{act.n}</td>
      <td className="r">{sat.avg}</td>
      <td className="r">{sat.n}</td>
      <td className="r">{clt.avg}</td>
      <td className="r">{clt.n}</td>
      <td className="r">{gpa(row.gpaAvg)}</td>
      {honors && (
        <>
          <td className="r">{row.honorsN == null ? "N/A" : n(row.honorsN)}</td>
          <td className="r">{row.honorsGpaAvg == null ? "N/A" : gpa(row.honorsGpaAvg)}</td>
        </>
      )}
    </tr>
  );
}

export function FallAdmissionsReport({ report }: { report: FallReport }) {
  const { years, reportYear } = report;
  const st = report.byStudentType;

  return (
    <div className="fall-rpt">
      <SectionDivider label={`Admissions Report for Fall ${reportYear}`} />
      <ol className="fall-notes">
        <li>
          The YEAR (FALL) FINAL row for Active Deposits is FTE census, not all
          active deposits.
        </li>
        <li>
          Conditional Accepted is for applicants pending official transcripts,
          then interview, who otherwise meet criteria.
        </li>
        <li>Resident vs Commuter is the completed-year total (active deposits).</li>
        <li>Unfunded aid averages exclude $0 awards.</li>
        <li>
          Varsity NAIA sports (FA26 recruitment onward; Pickleball, Band, Rugby,
          and Ultimate Frisbee removed): {NAIA_SPORTS.join(", ")}.
        </li>
        <li>Accepted decision codes also include ADM, COMM, and COND.</li>
      </ol>

      <div className="fall-scroll">
        <table className="fall-tbl fall-matrix">
          <thead>
            <tr>
              <th rowSpan={2} className="fall-stub fall-navy">
                Applications
                <br />
                By Student Type
              </th>
              <th colSpan={years.length}># Applications</th>
              <th colSpan={years.length}># Accepted</th>
              <th colSpan={years.length}># Active Deposits</th>
            </tr>
            <tr>
              {(["apps", "accepted", "deposits"] as const).flatMap((group) =>
                years.map((y) => (
                  <th key={`${group}-${y}`} className="r">
                    {yy(y)}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {st.rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                {years.map((y) => (
                  <td key={`a-${y}`} className="r">
                    {n(r.apps[y])}
                  </td>
                ))}
                {years.map((y) => (
                  <td key={`c-${y}`} className="r">
                    {n(r.accepted[y])}
                  </td>
                ))}
                {years.map((y) => (
                  <td key={`d-${y}`} className="r">
                    {n(r.deposits[y])}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="fall-composite">
              <td>Composite</td>
              {years.map((y) => (
                <td key={`ca-${y}`} className="r">
                  {n(st.composite.apps[y])}
                </td>
              ))}
              {years.map((y) => (
                <td key={`cc-${y}`} className="r">
                  {n(st.composite.accepted[y])}
                </td>
              ))}
              {years.map((y) => (
                <td key={`cd-${y}`} className="r">
                  {n(st.composite.deposits[y])}
                </td>
              ))}
            </tr>
            <tr>
              <td>YEAR (FALL) GOAL</td>
              {years.map((y) => (
                <td key={`ga-${y}`} className="r">
                  {n(st.goal.apps[y])}
                </td>
              ))}
              {years.map((y) => (
                <td key={`gc-${y}`} className="r">
                  {n(st.goal.accepted[y])}
                </td>
              ))}
              {years.map((y) => (
                <td key={`gd-${y}`} className="r">
                  {n(st.goal.deposits[y])}
                </td>
              ))}
            </tr>
            <tr className="fall-final">
              <td>YEAR (FALL) FINAL</td>
              {years.map((y) => (
                <td key={`fa-${y}`} className="r">
                  {naOr(st.final.apps[y], y, reportYear)}
                </td>
              ))}
              {years.map((y) => (
                <td key={`fc-${y}`} className="r">
                  {naOr(st.final.accepted[y], y, reportYear)}
                </td>
              ))}
              {years.map((y) => (
                <td key={`fd-${y}`} className="r">
                  {naOr(st.final.deposits[y], y, reportYear)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="fall-three">
        <div className="fall-mini">
          <table className="fall-tbl">
            <thead>
              <tr>
                <th colSpan={5} className="fall-stub fall-navy">
                  Applications Status
                </th>
              </tr>
              <tr>
                <th>Total</th>
                <th>Denied</th>
                <th>Withdrawn Deposit</th>
                <th>Conditional Accepted</th>
                <th>Interviewed</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="r">{n(report.status.total)}</td>
                <td className="r">{n(report.status.denied)}</td>
                <td className="r">{n(report.status.withdrawnDeposit)}</td>
                <td className="r">{n(report.status.conditionalAccepted)}</td>
                <td className="r">{n(report.status.interviewed)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="fall-mini">
          <table className="fall-tbl">
            <thead>
              <tr>
                <th colSpan={5} className="fall-stub fall-navy">
                  Deposited Varsity NAIA vs Others
                </th>
              </tr>
              <tr>
                <th>Total</th>
                <th colSpan={2}>Athletes</th>
                <th colSpan={2}>Non-Athletes</th>
              </tr>
              <tr>
                <th>#</th>
                <th>#</th>
                <th>%</th>
                <th>#</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="r">{n(report.naiaDeposits.total)}</td>
                <td className="r">{n(report.naiaDeposits.athletes)}</td>
                <td className="r">{pct(report.naiaDeposits.athletePct)}</td>
                <td className="r">{n(report.naiaDeposits.nonAthletes)}</td>
                <td className="r">{pct(report.naiaDeposits.nonAthletePct)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="fall-mini">
          <table className="fall-tbl">
            <thead>
              <tr>
                <th rowSpan={2} className="fall-stub fall-navy">
                  Resident vs
                  <br />
                  Commuter
                </th>
                {report.residentYears.map((y) => (
                  <th key={y} colSpan={2}>
                    {y}
                  </th>
                ))}
              </tr>
              <tr>
                {report.residentYears.flatMap((y) => [
                  <th key={`${y}-n`} className="r">
                    #
                  </th>,
                  <th key={`${y}-p`} className="r">
                    %
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {(["resident", "commuter"] as const).map((kind) => (
                <tr key={kind}>
                  <td>{kind === "resident" ? "Resident" : "Commuter"}</td>
                  {report.residentYears.map((y) => {
                    const cell = report.residentCommuter[y]?.[kind] as
                      | CountPct
                      | undefined;
                    return (
                      <FragmentYear key={`${kind}-${y}`} cell={cell} missing={!report.hasResidencyField} />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {!report.hasResidencyField && (
            <p className="fall-missing">
              Residency Preference is not on the current Slate feed yet — cells
              show —.
            </p>
          )}
        </div>
      </div>

      <div className="fall-two">
        <div className="fall-stack">
          <SliceTable
            title="Overall Religion"
            tone="purple"
            rows={[
              { label: "Catholic", slice: report.religion.overall.catholic },
              { label: "Other", slice: report.religion.overall.other },
            ]}
          />
          <SliceTable
            title="Varsity NAIA Religion"
            tone="purple"
            rows={[
              { label: "Catholic", slice: report.religion.naia.catholic },
              { label: "Other", slice: report.religion.naia.other },
            ]}
          />
          <SliceTable
            title="Others Religion"
            tone="purple"
            rows={[
              { label: "Catholic", slice: report.religion.others.catholic },
              { label: "Other", slice: report.religion.others.other },
            ]}
          />
        </div>
        <div className="fall-stack">
          <SliceTable
            title="Overall Gender"
            tone="blue"
            rows={[
              { label: "Male", slice: report.gender.overall.male },
              { label: "Female", slice: report.gender.overall.female },
            ]}
          />
          <SliceTable
            title="Varsity NAIA Gender"
            tone="blue"
            rows={[
              { label: "Male", slice: report.gender.naia.male },
              { label: "Female", slice: report.gender.naia.female },
            ]}
          />
          <SliceTable
            title="Others Gender"
            tone="blue"
            rows={[
              { label: "Male", slice: report.gender.others.male },
              { label: "Female", slice: report.gender.others.female },
            ]}
          />
        </div>
      </div>

      <div className="fall-two">
        <div className="fall-mini">
          <table className="fall-tbl">
            <thead>
              <tr>
                <th rowSpan={2} className="fall-stub fall-navy">
                  Unfunded Aid
                  <br />
                  &amp; Discount Rate
                </th>
                {report.aidYears.map((y) => (
                  <th key={y} colSpan={2}>
                    {y}
                  </th>
                ))}
              </tr>
              <tr>
                {report.aidYears.flatMap((y) => [
                  <th key={`${y}-aid`} className="r">
                    Aid
                  </th>,
                  <th key={`${y}-dr`} className="r">
                    D/R
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Avg. All Accepted</td>
                {report.aidYears.flatMap((y) => [
                  <td key={`${y}-aa`} className="r">
                    {money(report.aid.accepted[y]?.aid)}
                  </td>,
                  <td key={`${y}-ad`} className="r">
                    {dr(report.aid.accepted[y]?.dr)}
                  </td>,
                ])}
              </tr>
              <tr>
                <td>Avg. Active Deposited</td>
                {report.aidYears.flatMap((y) => [
                  <td key={`${y}-da`} className="r">
                    {money(report.aid.deposited[y]?.aid)}
                  </td>,
                  <td key={`${y}-dd`} className="r">
                    {dr(report.aid.deposited[y]?.dr)}
                  </td>,
                ])}
              </tr>
              <tr>
                <td>Goal</td>
                {report.aidYears.flatMap((y) => [
                  <td key={`${y}-ga`} className="r">
                    {money(report.aid.goal[y]?.aid)}
                  </td>,
                  <td key={`${y}-gd`} className="r">
                    {dr(report.aid.goal[y]?.dr)}
                  </td>,
                ])}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="fall-mini">
          <table className="fall-tbl">
            <thead>
              <tr>
                <th rowSpan={3} className="fall-stub fall-navy">
                  Test Scores &amp;
                  <br />
                  GPA Averages
                </th>
                <th rowSpan={3} className="r">
                  #
                </th>
                <th colSpan={7}>Freshmen</th>
                {report.hasHonorsField && <th colSpan={2}>Honors</th>}
              </tr>
              <tr>
                <th colSpan={2}>ACT</th>
                <th colSpan={2}>SAT</th>
                <th colSpan={2}>CLT</th>
                <th>HS GPA</th>
                {report.hasHonorsField && (
                  <>
                    <th rowSpan={2} className="r">
                      #
                    </th>
                    <th rowSpan={2}>HS GPA</th>
                  </>
                )}
              </tr>
              <tr>
                <th className="r">AVG</th>
                <th className="r">#</th>
                <th className="r">AVG</th>
                <th className="r">#</th>
                <th className="r">AVG</th>
                <th className="r">#</th>
                <th className="r">AVG</th>
              </tr>
            </thead>
            <tbody>
              <ScoreLine
                label="Accepted, not Dep."
                row={report.scores.acceptedNotDep}
                honors={report.hasHonorsField}
              />
              <ScoreLine
                label="Active Deposited"
                row={report.scores.activeDeposited}
                honors={report.hasHonorsField}
              />
              <ScoreLine
                label={report.scores.priorClassLabel}
                row={report.scores.priorClass}
                honors={report.hasHonorsField}
              />
            </tbody>
          </table>
          {!report.hasHonorsField && (
            <p className="fall-missing">
              Honors Decision is not on the current Slate feed yet, so the
              Honors GPA columns are hidden.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function FragmentYear({
  cell,
  missing,
}: {
  cell: CountPct | undefined;
  missing: boolean;
}) {
  if (missing) {
    return (
      <>
        <td className="r">—</td>
        <td className="r">—</td>
      </>
    );
  }
  return (
    <>
      <td className="r">{n(cell?.n ?? 0)}</td>
      <td className="r">{pct(cell?.pct ?? null)}</td>
    </>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="sec-row">
      <span className="sec-lbl">{label}</span>
      <span className="sec-rule" />
    </div>
  );
}
