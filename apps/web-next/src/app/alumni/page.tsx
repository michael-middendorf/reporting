"use client";

import { useCallback } from "react";
import { LegacyModuleMount } from "@/components/LegacyModuleMount";
import { ReportShell } from "@/components/ReportShell";
import { ALUMNI_BODY } from "@/lib/reports/alumni/body";
import "@/styles/alumni.css";

export default function AlumniPage() {
  const boot = useCallback(
    () => import("@/lib/reports/alumni/app.js").then((m) => m.bootAlumni()),
    [],
  );

  return (
    <ReportShell report="alumni" title="Alumni Coverage" chrome={false}>
      <LegacyModuleMount bodyHtml={ALUMNI_BODY} boot={boot} />
    </ReportShell>
  );
}
