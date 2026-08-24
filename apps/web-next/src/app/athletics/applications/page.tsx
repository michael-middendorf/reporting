"use client";

import { AthleticsPage, useAthletics } from "@/components/athletics/AthleticsShell";
import { APPLICATION_COLUMNS } from "@/components/athletics/columns";
import { DataTable, exportCsv } from "@/components/athletics/DataTable";
import { stageColor } from "@/lib/reports/athletics/normalize";

export default function ApplicationsPage() {
  const { filteredApplications: rows } = useAthletics();
  return (
    <AthleticsPage title="Athlete Applications" description="All athlete applications with global filters, stage coloring, sorting, searching, and export."
      actions={<button className="ath-primary" type="button" onClick={() => exportCsv("athlete-applications.csv", rows, APPLICATION_COLUMNS)}>Export filtered applications</button>}>
      <section className="ath-card"><DataTable rows={rows} columns={APPLICATION_COLUMNS} rowColor={stageColor} limit={1000} /></section>
    </AthleticsPage>
  );
}
