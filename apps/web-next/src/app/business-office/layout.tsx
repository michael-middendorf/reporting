"use client";

import { useEffect, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import type { ReportId } from "@/lib/access";
import { fetchMe } from "@/lib/api";
import { BUSINESS_OFFICE_NAV, navForReports } from "@/lib/report-nav";
import "@/styles/athletics.css";

export default function BusinessOfficeLayout({ children }: { children: React.ReactNode }) {
  const [reports, setReports] = useState<ReportId[]>([]);
  useEffect(() => {
    fetchMe().then((me) => setReports(me.reports || []));
  }, []);
  return (
    <AccessGate report="business-office">
      <div className="ath-root">
        <ReportTopBar title="Business Office" nav={navForReports(BUSINESS_OFFICE_NAV, reports)} />
        {children}
      </div>
    </AccessGate>
  );
}
