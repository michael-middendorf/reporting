"use client";

import { useEnrollment } from "../EnrollmentProvider";
import {
  AcceptCodesTable,
  AidTable,
  BarChart,
  FunnelHistoryCharts,
  Kpi,
  MetricLabel,
  Section,
  acShort,
} from "@/components/enrollment/ui";
import { cycleMeta, pickCurPrv } from "@/lib/reports/enrollment/cycle";
import { DEFS } from "@/lib/reports/enrollment/defs";
import { fmt } from "@/lib/reports/enrollment/load";

type InterviewsByMonthTerm = {
  months: Record<string, number>;
  before: number;
  after: number;
  total: number;
  toDate: number;
  monthToDate: number;
};
type InterviewsByMonth = Record<string, InterviewsByMonthTerm> & {
  asOf?: string;
  sameDateLastYear?: string;
};

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(monthKey: string) {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTH_ABBR[(m || 1) - 1]} ${y}`;
}

/** Interviews by month, aligned by cycle position (curKey vs prvKey). */
function InterviewsByMonthTable({
  ibm,
  curKey,
  prvKey,
  curLabel,
  prvLabel,
}: {
  ibm: InterviewsByMonth | undefined;
  curKey: string;
  prvKey: string;
  curLabel: string;
  prvLabel: string;
}) {
  if (!ibm || !ibm[curKey]) return null;
  const cur = ibm[curKey];
  const prv = ibm[prvKey];
  const curMonthKeys = Object.keys(cur.months);
  const prvMonthKeys = prv ? Object.keys(prv.months) : [];

  const asOfStr = ibm.asOf;
  let curIsInProgress = false;
  let asOfMonthKey: string | null = null;
  if (asOfStr) {
    const asOfYear = Number(asOfStr.slice(0, 4));
    const asOfMonth1 = Number(asOfStr.slice(5, 7));
    const currentTermYear = asOfMonth1 >= 6 ? asOfYear + 1 : asOfYear;
    const curTermYear = Number((curKey.match(/\d+/) || ["0"])[0]);
    curIsInProgress = curTermYear === currentTermYear;
    asOfMonthKey = asOfStr.slice(0, 7);
  }

  type Row = { monthKey: string; curVal: number; prvVal: number | null; isCurrentMonth: boolean };
  const rows: Row[] = curMonthKeys.map((mk, i) => {
    const prvMk = prvMonthKeys[i];
    return {
      monthKey: mk,
      curVal: cur.months[mk] || 0,
      prvVal: prv && prvMk ? prv.months[prvMk] ?? 0 : null,
      isCurrentMonth: curIsInProgress && mk === asOfMonthKey,
    };
  });

  // Trim trailing future months of an in-progress cycle: zero current value,
  // after the as-of month. Completed cycles keep all 15 rows.
  let visibleRows = rows;
  const currentIdx = rows.findIndex((r) => r.isCurrentMonth);
  if (curIsInProgress && currentIdx >= 0) {
    let cut = rows.length;
    for (let idx = rows.length - 1; idx > currentIdx; idx--) {
      if (rows[idx].curVal === 0) cut = idx;
      else break;
    }
    visibleRows = rows.slice(0, cut);
  }

  // Cumulative columns run through the visible window months only; Earlier
  // (before June of the prior year) is a separate bucket, not folded in.
  let curCum = 0;
  let prvCum = 0;

  const showEarlier = cur.before > 0 || (prv?.before ?? 0) > 0;
  const showLater = cur.after > 0 || (prv?.after ?? 0) > 0;
  const totalCur = cur.total;
  const totalPrv = prv ? prv.total : null;

  return (
    <div className="panel" style={{ overflowX: "auto" }}>
      <p className="rpt-sub" style={{ margin: "0 0 8px" }}>
        {curLabel} to date: {fmt(cur.toDate)} vs {prvLabel} same date last year: {prv ? fmt(prv.toDate) : "n/a"}
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Month</th>
            <th>{curLabel}</th>
            <th>{prvLabel}</th>
            <th>Change</th>
            <th>{curLabel} cumulative</th>
            <th>{prvLabel} cumulative</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => {
            curCum += row.curVal;
            if (row.prvVal != null) prvCum += row.prvVal;
            const change = row.prvVal != null ? row.curVal - row.prvVal : null;
            const label = prv && prvMonthKeys.length
              ? `${monthLabel(row.monthKey)} vs ${monthLabel(prvMonthKeys[curMonthKeys.indexOf(row.monthKey)] || row.monthKey)}`
              : monthLabel(row.monthKey);
            return (
              <tr key={row.monthKey} style={{ fontWeight: row.isCurrentMonth ? 600 : undefined }}>
                <td>{label}</td>
                <td>{fmt(row.curVal)}</td>
                <td>
                  {row.prvVal != null ? fmt(row.prvVal) : "n/a"}
                  {row.isCurrentMonth && prv ? (
                    <span style={{ color: "var(--muted,#666)", fontSize: 12 }}>
                      {" "}
                      ({fmt(prv.monthToDate)} by this date)
                    </span>
                  ) : null}
                </td>
                <td>{change != null ? fmt(change) : "n/a"}</td>
                <td>{fmt(curCum)}</td>
                <td>{row.prvVal != null ? fmt(prvCum) : "n/a"}</td>
              </tr>
            );
          })}
          {showEarlier ? (
            <tr>
              <td>Earlier</td>
              <td>{fmt(cur.before)}</td>
              <td>{prv ? fmt(prv.before) : "n/a"}</td>
              <td>{prv ? fmt(cur.before - prv.before) : "n/a"}</td>
              <td>n/a</td>
              <td>n/a</td>
            </tr>
          ) : null}
          {showLater ? (
            <tr>
              <td>Later</td>
              <td>{fmt(cur.after)}</td>
              <td>{prv ? fmt(prv.after) : "n/a"}</td>
              <td>{prv ? fmt(cur.after - prv.after) : "n/a"}</td>
              <td>n/a</td>
              <td>n/a</td>
            </tr>
          ) : null}
          <tr style={{ fontWeight: 600 }}>
            <td>Total</td>
            <td>{fmt(totalCur)}</td>
            <td>{totalPrv != null ? fmt(totalPrv) : "n/a"}</td>
            <td>{totalPrv != null ? fmt(totalCur - totalPrv) : "n/a"}</td>
            <td>n/a</td>
            <td>n/a</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function AdmissionsPage() {
  const { data, loading, error, cycle } = useEnrollment();
  if (loading)
    return (
      <div className="view active">
        <p>Loading…</p>
      </div>
    );
  if (error || !data)
    return (
      <div className="view active">
        <p>{error || "No data"}</p>
      </div>
    );

  const adm = data.admissions;
  const { label, vs, curKey, prvKey } = cycleMeta(cycle);
  const { cur, prv } = pickCurPrv(adm, cycle);
  const ibm = adm.interviewsByMonth as InterviewsByMonth | undefined;
  const fa24 = adm.fa24;
  const fa25 = adm.fa25;
  const fa26 = adm.fa26;
  const fa27 = adm.fa27;
  const fa26Yoy = adm.fa26Yoy ?? fa26;
  const fa25Yoy = adm.fa25Yoy ?? fa25;
  const fa25Yoy2 = adm.fa25Yoy2 ?? fa25;
  const fa24Yoy2 = adm.fa24Yoy2 ?? fa24;
  const history =
    cycle === "fa25"
      ? [
          { label: "FA24", tone: "muted" as const, stats: fa24 },
          { label: "FA25", tone: "gold" as const, stats: fa25 },
        ]
      : cycle === "fa26"
        ? [
            { label: "FA24", tone: "muted" as const, stats: fa24Yoy2 },
            { label: "FA25", tone: "secondary" as const, stats: fa25Yoy },
            { label: "FA26", tone: "gold" as const, stats: fa26 },
          ]
        : [
            { label: "FA25", tone: "muted" as const, stats: fa25Yoy2 },
            { label: "FA26", tone: "secondary" as const, stats: fa26Yoy },
            { label: "FA27", tone: "gold" as const, stats: fa27 },
          ];
  // 1-4 rec starts FA26. Do not put FA24/FA25 into rec history charts.
  const recHistory =
    cycle === "fa25"
      ? []
      : cycle === "fa26"
        ? [{ label: "FA26", tone: "gold" as const, stats: fa26 }]
        : [
            { label: "FA26", tone: "secondary" as const, stats: fa26Yoy },
            { label: "FA27", tone: "gold" as const, stats: fa27 },
          ];
  const recPrv = cycle === "fa27" ? prv : undefined;

  const funnelRows: [string, string, number | null | undefined, number | null | undefined][] = [
    ["Applications", DEFS.created, cur.created, prv.created],
    ["Submitted", DEFS.submitted, cur.submitted, prv.submitted],
    ["Accepted", DEFS.accepted, cur.accepted, prv.accepted],
    ["Conditional accepts", DEFS.conditional, cur.conditional, prv.conditional],
    ["Net deposits", DEFS.depositsNet, cur.deposits, prv.deposits],
    ["Gross deposits", DEFS.depositsGross, cur.depositsGross, prv.depositsGross],
    ["Deposit withdrawals", DEFS.depositsWithdrawn, cur.depositsWithdrawn, prv.depositsWithdrawn],
    ["Denied", DEFS.denied, cur.denied, prv.denied],
    ["Interviewed", DEFS.interviewed, cur.interviewed, prv.interviewed],
    ["Interviewed athletes", DEFS.interviewedAthletes, cur.interviewedAthletes, prv.interviewedAthletes],
    ["AC Rec 3s", DEFS.acRec3, cur.acRec3, recPrv?.acRec3],
    ["AC Rec 4s", DEFS.acRec4, cur.acRec4, recPrv?.acRec4],
    ["AC Rec 3s & 4s", DEFS.acRec34, cur.acRec34, recPrv?.acRec34],
  ];

  // Counselor activity
  const byAC = (cur.byAC || {}) as Record<
    string,
    {
      created: number;
      submitted: number;
      accepted: number;
      deposited: number;
      denied: number;
      interviewed: number;
    }
  >;
  const acRows = Object.entries(byAC).sort((a, b) => b[1].deposited - a[1].deposited);
  const interviewBars = acRows
    .map(([ac, v]) => ({ label: acShort(ac), value: v.interviewed, tone: "secondary" as const }))
    .filter((r) => r.value > 0);
  const caseloadBars = acRows.map(([ac, v]) => ({
    label: acShort(ac),
    value: v.created,
    tone: "gold" as const,
  }));


  return (
    <div className="view active">
      <div className="rpt-hdr">
        <div>
          <h1 className="rpt-title">{label} Admissions Detail</h1>
          <p className="rpt-sub">
            Year-over-year as of this date in each cycle, not finished-cycle totals.
          </p>
        </div>
      </div>

      <Section label="Key Metrics" info={DEFS.ug} />
      <div className="kpi-strip">
        <Kpi label="Created" cur={cur.created} prv={prv.created} info={DEFS.created} />
        <Kpi label="Submitted" cur={cur.submitted} prv={prv.submitted} info={DEFS.submitted} />
        <Kpi label="Accepted" cur={cur.accepted} prv={prv.accepted} info={DEFS.accepted} />
        <Kpi label="Interviews" cur={cur.interviewed} prv={prv.interviewed} info={DEFS.interviewed} />
        <Kpi label="Total Deposits" cur={cur.deposits} prv={prv.deposits} info={DEFS.depositsNet} />
        <Kpi label="Accept Rate" cur={cur.acceptRate} prv={prv.acceptRate} format="pct" highlight info={DEFS.acceptRate} />
      </div>
      <div className="kpi-strip">
        <Kpi label="Interviewed athletes" cur={cur.interviewedAthletes} prv={prv.interviewedAthletes} info={DEFS.interviewedAthletes} />
        <Kpi label="Athlete %" cur={cur.interviewedAthletePct} prv={prv.interviewedAthletePct} format="pct" info={DEFS.interviewedAthletePct} />
        <Kpi label="AC Rec 3s" cur={cur.acRec3} prv={recPrv?.acRec3} info={DEFS.acRec3} />
        <Kpi label="AC Rec 4s" cur={cur.acRec4} prv={recPrv?.acRec4} info={DEFS.acRec4} />
        <Kpi label="AC Rec 3s & 4s" cur={cur.acRec34} prv={recPrv?.acRec34} highlight info={DEFS.acRec34} />
      </div>

      <Section label="Interviews by Month" info={DEFS.interviewsByMonth} />
      <InterviewsByMonthTable ibm={ibm} curKey={curKey} prvKey={prvKey} curLabel={label} prvLabel={vs} />

      <Section label="AC Recommendations (3s & 4s)" info={DEFS.acRecChart} />
      <BarChart
        title={label}
        info={DEFS.acRecChart}
        rows={[
          { label: "Rec 3s", value: cur.acRec3 ?? 0, tone: "secondary" },
          { label: "Rec 4s", value: cur.acRec4 ?? 0, tone: "gold" },
          { label: "Rec 3s & 4s", value: cur.acRec34 ?? 0, tone: "muted" },
        ]}
      />
      {recHistory.length > 0 ? (
        <div className="g3" style={{ gap: 16, marginTop: 16 }}>
          <BarChart
            title="Rec 3s"
            info={DEFS.acRecHistory}
            rows={recHistory.map((t) => ({
              label: t.label,
              value: t.stats.acRec3 ?? 0,
              tone: t.tone,
            }))}
          />
          <BarChart
            title="Rec 4s"
            info={DEFS.acRecHistory}
            rows={recHistory.map((t) => ({
              label: t.label,
              value: t.stats.acRec4 ?? 0,
              tone: t.tone,
            }))}
          />
          <BarChart
            title="Rec 3s & 4s"
            info={DEFS.acRecHistory}
            rows={recHistory.map((t) => ({
              label: t.label,
              value: t.stats.acRec34 ?? 0,
              tone: t.tone,
            }))}
          />
        </div>
      ) : null}

      <Section label="Academic Profile — Averages" />
      <div className="kpi-strip">
        <Kpi label="Avg GPA" cur={cur.gpa} prv={prv.gpa} format="1" info={DEFS.gpa} />
        <Kpi label="Avg ACT" cur={cur.act} prv={prv.act} format="1" info={DEFS.act} />
        <Kpi label="Avg SAT" cur={cur.sat} prv={prv.sat} format="1" info={DEFS.sat} />
        <Kpi label="Avg CLT" cur={cur.clt} prv={prv.clt} format="1" info={DEFS.clt} />
        <Kpi label="Avg Submit → Accept" cur={cur.daysSubmitAccept} format="days" info={DEFS.daysSubmitAccept} />
        <Kpi label="Avg Accept → Deposit" cur={cur.daysAcceptDeposit} format="days" info={DEFS.daysAcceptDeposit} />
      </div>

      <Section label="Historical Trend — Application Funnel" info={DEFS.history} />
      <FunnelHistoryCharts terms={history} />

      <Section label="Funnel Comparison" info={DEFS.yoy} />
      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>{label}</th>
              <th>{vs}</th>
            </tr>
          </thead>
          <tbody>
            {funnelRows.map(([name, info, c, p]) => (
              <tr key={name}>
                <td><MetricLabel label={name} info={info} /></td>
                <td>{fmt(c)}</td>
                <td>{fmt(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Section label="Financial Aid & Discount Rate" info={DEFS.aidTotal} />
      <AidTable
        curLabel={label}
        prvLabel={vs}
        curAcc={cur.aidAcc}
        prvAcc={prv.aidAcc}
        curDep={cur.aidDep}
        prvDep={prv.aidDep}
      />

      <Section label="Acceptances by Code" info={DEFS.acceptCodes} />
      <AcceptCodesTable codes={cur.codes} />

      <Section label="Demographics" info={DEFS.religion} />
      <div className="g2" style={{ gap: 16 }}>
        <div className="panel" style={{ overflowX: "auto" }}>
          <table className="data-table">
            <caption
              style={{
                textAlign: "left",
                fontWeight: 600,
                fontSize: 12,
                color: "var(--muted, #666)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "8px 0 4px",
              }}
            >
              <MetricLabel label="Religion" info={DEFS.religion} />
            </caption>
            <thead>
              <tr>
                <th></th>
                <th>Apps</th>
                <th>%</th>
                <th>Accepted</th>
                <th>%</th>
                <th>Deposited</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {(["Catholic", "Other"] as const).map((rel) => {
                const isC = rel === "Catholic";
                const apps = isC ? cur.catholic : cur.created - cur.catholic;
                const acc = isC ? cur.catholicAcc : cur.accepted - cur.catholicAcc;
                const dep = isC ? cur.catholicDep : cur.deposits - cur.catholicDep;
                const pApps = cur.created ? (apps / cur.created) * 100 : null;
                const pAcc = cur.accepted ? (acc / cur.accepted) * 100 : null;
                const pDep = cur.deposits ? (dep / cur.deposits) * 100 : null;
                return (
                  <tr key={rel}>
                    <td style={{ fontWeight: 500 }}>{rel}</td>
                    <td>{fmt(apps)}</td>
                    <td>{pApps != null ? `${pApps.toFixed(1)}%` : "—"}</td>
                    <td>{fmt(acc)}</td>
                    <td>{pAcc != null ? `${pAcc.toFixed(1)}%` : "—"}</td>
                    <td>{fmt(dep)}</td>
                    <td>{pDep != null ? `${pDep.toFixed(1)}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="panel" style={{ overflowX: "auto" }}>
          <table className="data-table">
            <caption
              style={{
                textAlign: "left",
                fontWeight: 600,
                fontSize: 12,
                color: "var(--muted, #666)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "8px 0 4px",
              }}
            >
              <MetricLabel label="Gender" info={DEFS.gender} />
            </caption>
            <thead>
              <tr>
                <th></th>
                <th>Apps</th>
                <th>%</th>
                <th>Accepted</th>
                <th>%</th>
                <th>Deposited</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {(["Male", "Female"] as const).map((g) => {
                const isM = g === "Male";
                const apps = isM ? cur.male : cur.female;
                const acc = isM ? cur.maleAcc : cur.femaleAcc;
                const dep = isM ? cur.maleDep : cur.femaleDep;
                const pApps = cur.created ? (apps / cur.created) * 100 : null;
                const pAcc = cur.accepted ? (acc / cur.accepted) * 100 : null;
                const pDep = cur.deposits ? (dep / cur.deposits) * 100 : null;
                return (
                  <tr key={g}>
                    <td style={{ fontWeight: 500 }}>{g}</td>
                    <td>{fmt(apps)}</td>
                    <td>{pApps != null ? `${pApps.toFixed(1)}%` : "—"}</td>
                    <td>{fmt(acc)}</td>
                    <td>{pAcc != null ? `${pAcc.toFixed(1)}%` : "—"}</td>
                    <td>{fmt(dep)}</td>
                    <td>{pDep != null ? `${pDep.toFixed(1)}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Section label="Counselor Activity" info={DEFS.counselor} />
      <BarChart title="Interviews by counselor" info={DEFS.interviewsByAc} rows={interviewBars} />
      <div className="panel" style={{ overflowX: "auto", marginTop: 16 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Counselor</th>
              <th><MetricLabel label="Created" info={DEFS.created} /></th>
              <th><MetricLabel label="Submitted" info={DEFS.submitted} /></th>
              <th><MetricLabel label="Accepted" info={DEFS.accepted} /></th>
              <th><MetricLabel label="Deposited" info={DEFS.depositsNet} /></th>
              <th><MetricLabel label="Denied" info={DEFS.denied} /></th>
              <th><MetricLabel label="Interviewed" info={DEFS.interviewed} /></th>
            </tr>
          </thead>
          <tbody>
            {acRows.map(([ac, v]) => (
              <tr key={ac || "unassigned"}>
                <td>{acShort(ac)}</td>
                <td>{fmt(v.created)}</td>
                <td>{fmt(v.submitted)}</td>
                <td>{fmt(v.accepted)}</td>
                <td>{fmt(v.deposited)}</td>
                <td>{fmt(v.denied)}</td>
                <td>{fmt(v.interviewed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
