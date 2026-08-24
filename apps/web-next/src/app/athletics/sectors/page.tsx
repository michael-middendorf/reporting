"use client";

import { AthleticsPage, useAthletics } from "@/components/athletics/AthleticsShell";
import { APPLICATION_COLUMNS } from "@/components/athletics/columns";
import { DataTable, exportCsv } from "@/components/athletics/DataTable";
import { stageColor, STAGE_COLORS } from "@/lib/reports/athletics/normalize";

const SECTORS = ["Sector 1", "Sector 2", "Sector 3"];

export default function SectorBoardsPage() {
  const { filteredApplications } = useAthletics();
  const rows = filteredApplications.filter((record) => SECTORS.includes(record.sector));
  return (
    <AthleticsPage title="Sector Boards" description="Applicant boards by recruiting sector. Every row is colored by its current stage."
      actions={<button className="ath-primary" type="button" onClick={() => exportCsv("athletics-sector-boards.csv", rows, APPLICATION_COLUMNS)}>Export filtered boards</button>}>
      <div className="ath-legend">
        {Object.entries(STAGE_COLORS).map(([label, color]) => <span key={label}><i style={{ background: color }} />{label}</span>)}
      </div>
      <div className="ath-sector-grid">
        {SECTORS.map((sector) => {
          const sectorRows = rows.filter((record) => record.sector === sector);
          return <section className="ath-card ath-sector" key={sector}><div className="ath-card-title"><div><h2>{sector}</h2><p>{sectorRows.length.toLocaleString()} applicants</p></div></div><DataTable rows={sectorRows} columns={APPLICATION_COLUMNS} rowColor={stageColor} limit={500} /></section>;
        })}
      </div>
    </AthleticsPage>
  );
}
