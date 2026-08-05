"use client";

import { useCallback, useEffect } from "react";
import { LegacyModuleMount } from "@/components/LegacyModuleMount";
import { ReportShell } from "@/components/ReportShell";
import { MAS_ACTIVITY_BODY } from "@/lib/reports/mas/body_activity";
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

export default function MasActivityPage() {
  useEffect(() => {
    ensureMasConfig();
  }, []);
  const boot = useCallback(() => {
    ensureMasConfig();
    return import("@/lib/reports/mas/activity.js").then((m) => m.bootMasActivity());
  }, []);

  return (
    <ReportShell report="mas" title="MA Follow-on Giving" chrome={false}>
      <LegacyModuleMount bodyHtml={MAS_ACTIVITY_BODY} boot={boot} />
    </ReportShell>
  );
}
