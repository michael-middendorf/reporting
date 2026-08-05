"use client";

import { useCallback } from "react";
import { LegacyModuleMount } from "@/components/LegacyModuleMount";
import { ReportShell } from "@/components/ReportShell";
import { POINTS_METHODOLOGY_BODY } from "@/lib/reports/points/body_methodology";
import "@/styles/points.css";

export default function PointsMethodologyPage() {
  const boot = useCallback(
    () =>
      import("@/lib/reports/points/methodology.js").then((m) =>
        m.bootPointsMethodology(),
      ),
    [],
  );

  return (
    <ReportShell report="points" title="MA Points" chrome={false}>
      <LegacyModuleMount bodyHtml={POINTS_METHODOLOGY_BODY} boot={boot} />
    </ReportShell>
  );
}
