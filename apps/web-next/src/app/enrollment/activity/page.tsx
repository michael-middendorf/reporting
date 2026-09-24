"use client";

import { useEffect, useMemo, useState } from "react";
import { useEnrollment } from "../EnrollmentProvider";
import { BarChart, MetricLabel, Section, acShort } from "@/components/enrollment/ui";
import {
  activityByAC,
  EMPTY_AC_OUTREACH,
  type AcFunnel,
  type AcOutreach,
} from "@/lib/reports/enrollment/counselors";
import { cycleMeta, pickCurPrv } from "@/lib/reports/enrollment/cycle";
import { DEFS } from "@/lib/reports/enrollment/defs";
import { fmt, fmt1, loadOutreach, type OutreachRows } from "@/lib/reports/enrollment/load";
import { _procOutreach } from "@/lib/reports/enrollment/process.js";

export default function ActivityPage() {
  const { data, loading, error, cycle } = useEnrollment();
  const [outreachRows, setOutreachRows] = useState<OutreachRows | null>(null);
  const [outreachError, setOutreachError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadOutreach()
      .then((r) => {
        if (live) setOutreachRows(r);
      })
      .catch((e) => {
        if (live) setOutreachError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, []);

  const outreachByAC = useMemo(() => {
    if (!data || !outreachRows) return null;
    return _procOutreach(
      data.admissions.allRows,
      cycleMeta(cycle).curKey,
      outreachRows.messageRows,
      outreachRows.interactionRows,
    ) as Record<string, AcOutreach>;
  }, [data, outreachRows, cycle]);

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
  const outreachFor = (ac: string): AcOutreach => outreachByAC?.[ac] ?? EMPTY_AC_OUTREACH;
  const smsBars = rows
    .map(([ac]) => ({ label: acShort(ac), value: outreachFor(ac).sms, tone: "gold" as const }))
    .filter((r) => r.value > 0);
  const touchpointBars = rows
    .map(([ac]) => ({
      label: acShort(ac),
      value: outreachFor(ac).touchpoints,
      tone: "secondary" as const,
    }))
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

      {outreachError ? (
        <div className="notice" style={{ marginTop: 16 }}>
          Outreach data could not be loaded: {outreachError}
        </div>
      ) : !outreachByAC ? (
        <p className="rpt-sub" style={{ marginTop: 16 }}>
          Loading SMS and touchpoint data…
        </p>
      ) : (
        <>
          <Section label="SMS Sent by Counselor" info={DEFS.smsByAc} />
          <BarChart rows={smsBars} info={DEFS.smsByAc} />

          <Section label="Touchpoints by Counselor" info={DEFS.touchpointsByAc} />
          <BarChart rows={touchpointBars} info={DEFS.touchpointsByAc} />

          <Section
            label="Touchpoints per Applicant & Reply Time by Counselor"
            info={DEFS.touchpointsPerApp}
          />
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
                {rows.map(([ac]) => {
                  const o = outreachFor(ac);
                  return (
                    <tr key={ac || "unassigned"}>
                      <td>{acShort(ac)}</td>
                      <td>{o.touchpointsPerApp == null ? "—" : fmt1(o.touchpointsPerApp)}</td>
                      <td>{o.smsReplyDays == null ? "—" : `${fmt1(o.smsReplyDays)}d`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="notice" style={{ marginTop: 16 }}>
        SMS, call, video-message, and note touchpoints are now shown above (see the info icons for
        exactly what&apos;s counted and each metric&apos;s limits). Email outreach is still not
        available here — it&apos;s pending the Outlook inbox filter fix so only student-sent
        messages are counted.
      </div>
    </div>
  );
}
