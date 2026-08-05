"use client";

import { useCallback } from "react";
import { LegacyModuleMount } from "@/components/LegacyModuleMount";
import { ReportShell } from "@/components/ReportShell";
import { POINTS_BODY } from "@/lib/reports/points/body";
import "@/styles/points.css";

export default function PointsPage() {
  const boot = useCallback(
    () => import("@/lib/reports/points/main.js").then((m) => m.bootPoints()),
    [],
  );

  return (
    <ReportShell report="points" title="MA Points" chrome={false}>
      <LegacyModuleMount bodyHtml={POINTS_BODY} boot={boot} />
    </ReportShell>
  );
}
