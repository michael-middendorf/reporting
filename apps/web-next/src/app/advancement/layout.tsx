"use client";

import { useEffect, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { fetchMe } from "@/lib/api";
import type { ReportId } from "@/lib/access";
import { ADVANCEMENT_NAV, type ReportNavItem } from "@/lib/report-nav";

function navForReports(reports: ReportId[]): ReportNavItem[] {
  return ADVANCEMENT_NAV.filter((item) => {
    if (!item.report) return true;
    return reports.includes(item.report);
  });
}

function AdvancementBar() {
  const [reports, setReports] = useState<ReportId[] | null>(null);
  useEffect(() => {
    fetchMe().then((me) => setReports(me.reports || []));
  }, []);
  const nav = reports ? navForReports(reports) : [];
  return <ReportTopBar title="Advancement" nav={nav} />;
}

export default function AdvancementLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AccessGate report={["advancement", "chapel"]}>
      <AdvancementBar />
      {children}
    </AccessGate>
  );
}
