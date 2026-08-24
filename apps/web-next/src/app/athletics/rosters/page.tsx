"use client";

import { AthleticsPage, useAthletics } from "@/components/athletics/AthleticsShell";
import { ROSTER_COLUMNS } from "@/components/athletics/columns";
import { DataTable, exportCsv } from "@/components/athletics/DataTable";
import { eligibleSigned } from "@/lib/reports/athletics/normalize";

export default function RostersPage() {
  const { filteredApplications } = useAthletics();
  const rows = filteredApplications.filter(eligibleSigned);
  const sports = [...new Set(rows.map((record) => record.sport).filter(Boolean))].sort();
  return (
    <AthleticsPage title="Current Rosters" description="LOI-signed or deposited varsity recruits, grouped by sport. Non-varsity, non-NAIA, student coach/manager, and blank sectors are excluded."
      actions={<button className="ath-primary" type="button" onClick={() => exportCsv("athletics-current-rosters.csv", rows, ROSTER_COLUMNS)}>Export filtered roster</button>}>
      <section className="ath-card">
        <div className="ath-roster-summary">{sports.map((sport) => <div key={sport}><span>{sport}</span><strong>{rows.filter((record) => record.sport === sport).length}</strong></div>)}</div>
        <DataTable rows={rows} columns={ROSTER_COLUMNS} limit={1000} />
      </section>
    </AthleticsPage>
  );
}
