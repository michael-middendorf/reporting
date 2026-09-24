"use client";

import { useEnrollment } from "../EnrollmentProvider";
import { BarChart, MetricLabel, Section, acShort } from "@/components/enrollment/ui";
import { activityByAC, type AcFunnel } from "@/lib/reports/enrollment/counselors";
import { cycleMeta, pickCurPrv } from "@/lib/reports/enrollment/cycle";
import { DEFS } from "@/lib/reports/enrollment/defs";
import { fmt, fmt1 } from "@/lib/reports/enrollment/load";

export default function ActivityPage() {
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
        <p>{error}</p>
      </div>
    );
  const { label } = cycleMeta(cycle);
  const { cur } = pickCurPrv(data.admissions, cycle);
  const byAC = activityByAC((cur.byAC || {}) as Record<string, AcFunnel>);
  const rows = Object.entries(byAC).sort((a, b) => b[1].deposited - a[1].deposited);
  const interviewBars = rows
    .map(([ac, v]) => ({ label: acShort(ac), value: v.interviewed, tone: "secondary" as const }))
    .filter((r) => r.value > 0);
  const caseloadBars = rows.map(([ac, v]) => ({
    label: acShort(ac),
    value: v.created,
    tone: "gold" as const,
  }));
  const viableBars = rows.map(([ac, v]) => ({
    label: acShort(ac),
    value: v.viable,
    tone: "secondary" as const,
  }));
  const smsBars = rows
    .map(([ac, v]) => ({ label: acShort(ac), value: v.sms, tone: "gold" as const }))
    .filter((r) => r.value > 0);
  const touchpointBars = rows
    .map(([ac, v]) => ({ label: acShort(ac), value: v.touchpoints, tone: "secondary" as const }))
    .filter((r) => r.value > 0);

  return (
    <div className="view active">
      <div className="rpt-hdr">
        <div>
          <h1 className="rpt-title">Counselor Activity</h1>
          <p className="rpt-sub">{label} funnel and interviews by AC assignment</p>
        </div>
      </div>

      <Section label="Interviews by Counselor" info={DEFS.interviewsByAc} />
      <BarChart rows={interviewBars} info={DEFS.interviewsByAc} />

      <Section label="Caseload (Applications) by Counselor" info={DEFS.caseload} />
      <BarChart rows={caseloadBars} info={DEFS.caseload} />

      <Section label="Funnel By Admissions Counselor" info={DEFS.counselor} />
      <div className="panel" style={{ overflowX: "auto" }}>
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
              <th><MetricLabel label="Viable" info={DEFS.viable} /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([ac, v]) => (
              <tr key={ac || "unassigned"}>
                <td>{acShort(ac)}</td>
                <td>{fmt(v.created)}</td>
                <td>{fmt(v.submitted)}</td>
                <td>{fmt(v.accepted)}</td>
                <td>{fmt(v.deposited)}</td>
                <td>{fmt(v.denied)}</td>
                <td>{fmt(v.interviewed)}</td>
                <td>{fmt(v.viable)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Section label="Viable Applications by Counselor" info={DEFS.viableByAc} />
      <BarChart rows={viableBars} info={DEFS.viableByAc} />

      <Section label="SMS Sent by Counselor" info={DEFS.smsByAc} />
      <BarChart rows={smsBars} info={DEFS.smsByAc} />

      <Section label="Touchpoints by Counselor" info={DEFS.touchpointsByAc} />
      <BarChart rows={touchpointBars} info={DEFS.touchpointsByAc} />

      <Section label="Touchpoints per Applicant & Reply Time by Counselor" info={DEFS.touchpointsPerApp} />
      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Counselor</th>
              <th><MetricLabel label="Touchpoints / Applicant" info={DEFS.touchpointsPerApp} /></th>
              <th><MetricLabel label="Days to First SMS Reply (approx.)" info={DEFS.smsReplyDays} /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([ac, v]) => (
              <tr key={ac || "unassigned"}>
                <td>{acShort(ac)}</td>
                <td>{v.touchpointsPerApp == null ? "—" : fmt1(v.touchpointsPerApp)}</td>
                <td>{v.smsReplyDays == null ? "—" : `${fmt1(v.smsReplyDays)}d`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="notice" style={{ marginTop: 16 }}>
        SMS, call, video-message, and note touchpoints are now shown above (see the info icons for
        exactly what&apos;s counted and each metric&apos;s limits). Email outreach is still not
        available here — it&apos;s pending the Outlook inbox filter fix so only student-sent
        messages are counted.
      </div>
    </div>
  );
}
