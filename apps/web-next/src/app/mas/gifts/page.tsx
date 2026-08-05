"use client";

import { useCallback, useEffect } from "react";
import { LegacyModuleMount } from "@/components/LegacyModuleMount";
import { ReportShell } from "@/components/ReportShell";
import { MAS_GIFTS_BODY } from "@/lib/reports/mas/body_gifts";
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

export default function MasGiftsPage() {
  useEffect(() => {
    ensureMasConfig();
  }, []);
  const boot = useCallback(() => {
    ensureMasConfig();
    return import("@/lib/reports/mas/gifts.js").then((m) => m.bootMasGifts());
  }, []);

  return (
    <ReportShell report="mas" title="MA Follow-on Giving" chrome={false}>
      <LegacyModuleMount bodyHtml={MAS_GIFTS_BODY} boot={boot} />
    </ReportShell>
  );
}
