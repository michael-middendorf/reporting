"use client";

import { useCallback, useEffect } from "react";
import { LegacyModuleMount } from "@/components/LegacyModuleMount";
import { ReportShell } from "@/components/ReportShell";
import { MAS_METHODOLOGY_BODY } from "@/lib/reports/mas/body_methodology";
import "@/styles/mas.css";

declare global {
  interface Window {
    MAS_REPORT_CONFIG?: { dataBasePath?: string };
  }
}

function ensureMasConfig() {
  window.MAS_REPORT_CONFIG = {
    ...(window.MAS_REPORT_CONFIG || {}),
    dataBasePath: "/api/reports/mas",
  };
}

export default function MasMethodologyPage() {
  useEffect(() => {
    ensureMasConfig();
  }, []);
  const boot = useCallback(() => {
    ensureMasConfig();
    return import("@/lib/reports/mas/methodology.js").then((m) =>
      m.bootMasMethodology(),
    );
  }, []);

  return (
    <ReportShell report="mas" title="MA Follow-on Giving" chrome={false}>
      <LegacyModuleMount bodyHtml={MAS_METHODOLOGY_BODY} boot={boot} />
    </ReportShell>
  );
}
