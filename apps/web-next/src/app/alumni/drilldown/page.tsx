"use client";

import { useCallback } from "react";
import { LegacyModuleMount } from "@/components/LegacyModuleMount";
import { ReportShell } from "@/components/ReportShell";
import { ALUMNI_DRILLDOWN_BODY } from "@/lib/reports/alumni/body_drilldown";
import "@/styles/alumni.css";

export default function AlumniDrilldownPage() {
  const boot = useCallback(
    () =>
      import("@/lib/reports/alumni/drilldown.js").then((m) =>
        m.bootAlumniDrilldown(),
      ),
    [],
  );

  return (
    <ReportShell report="alumni" title="Alumni Coverage" chrome={false}>
      <LegacyModuleMount bodyHtml={ALUMNI_DRILLDOWN_BODY} boot={boot} />
    </ReportShell>
  );
}
