"use client";

import { useEnrollment } from "../EnrollmentProvider";
import { Section } from "@/components/enrollment/ui";
import { fmt } from "@/lib/reports/enrollment/load";

export default function CampusPage() {
  const { data, loading, error } = useEnrollment();
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
  const c = data.campus;

  return (
    <div className="view active">
      <div className="rpt-hdr">
        <div>
          <h1 className="rpt-title">AME / Campus Visits</h1>
          <p className="rpt-sub">
            Live status counts from campus_visits. Event-date AME conversion tables from the
            legacy hub were static fixtures and are not yet re-derived.
          </p>
        </div>
      </div>

      <Section label="Campus Visit Overview" />
      <div className="kpi-strip">
        {[
          ["Total", c.total],
          ["Attended", c.attended],
          ["Registered", c.registered],
          ["Cancelled", c.cancelled],
          ["No show", c.noShow],
        ].map(([l, v]) => (
          <div className="kpi" key={l as string}>
            <div className="kpi-label">{l as string}</div>
            <div className="kpi-val">{fmt(v as number)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
