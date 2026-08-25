"use client";

import { AthleticsPage, useAthletics } from "@/components/athletics/AthleticsShell";
import { PROSPECT_COLUMNS } from "@/components/athletics/columns";
import { DataTable, exportCsv } from "@/components/athletics/DataTable";
import { PROSPECT_GPA_MINIMUM } from "@/lib/reports/athletics/normalize";

export default function ProspectsPage() {
  const { filteredProspects: rows } = useAthletics();
  const gpas = rows.map((record) => record.gpa).filter((gpa): gpa is number => gpa !== null);
  const averageGpa = gpas.length ? gpas.reduce((sum, gpa) => sum + gpa, 0) / gpas.length : 0;
  const catholic = rows.filter((record) => record.catholic).length;
  return (
    <AthleticsPage title="Prospects / Inquiries" description={`Athletic prospects and inquiries who have not yet applied and have a GPA of ${PROSPECT_GPA_MINIMUM.toFixed(1)} or higher.`}
      actions={<button className="ath-primary" type="button" onClick={() => exportCsv("athletics-prospects-inquiries.csv", rows, PROSPECT_COLUMNS)}>Export filtered prospects</button>}>
      <section className="ath-kpi-grid ath-kpi-grid-compact">
        <article className="ath-kpi"><span>Prospects / Inquiries</span><strong>{rows.length.toLocaleString()}</strong></article>
        <article className="ath-kpi"><span>Average GPA</span><strong>{averageGpa ? averageGpa.toFixed(2) : "—"}</strong><small>Only GPAs on a 0–5 scale</small></article>
        <article className="ath-kpi"><span>% Catholic</span><strong>{rows.length ? `${(catholic / rows.length * 100).toFixed(1)}%` : "—"}</strong></article>
      </section>
      <section className="ath-card"><DataTable rows={rows} columns={PROSPECT_COLUMNS} limit={1000} /></section>
    </AthleticsPage>
  );
}
