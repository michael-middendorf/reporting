"use client";

import { useCallback, useEffect } from "react";
import { LegacyModuleMount } from "@/components/LegacyModuleMount";
import { ReportShell } from "@/components/ReportShell";
import { MAS_BODY } from "@/lib/reports/mas/body";
import "@/styles/mas.css";

function ensureMasConfig() {
  if (typeof window === "undefined") return;
  window.MAS_REPORT_CONFIG = {
    ...(window.MAS_REPORT_CONFIG || {}),
    dataBasePath: "/api/reports/mas",
  };
}

declare global {
  interface Window {
    MAS_REPORT_CONFIG?: { dataBasePath?: string };
  }
}

export default function MasPage() {
  useEffect(() => {
    ensureMasConfig();
  }, []);

  const boot = useCallback(() => {
    ensureMasConfig();
    return import("@/lib/reports/mas/app.js").then((m) => m.bootMas());
  }, []);

  return (
    <ReportShell report="mas" title="MA Follow-on Giving" chrome={false}>
      <LegacyModuleMount bodyHtml={MAS_BODY} boot={boot} />
    </ReportShell>
  );
}
