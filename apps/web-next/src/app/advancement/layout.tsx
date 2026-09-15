"use client";

import { useEffect, useState } from "react";
import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { fetchMe } from "@/lib/api";
import type { ReportId } from "@/lib/access";
import { ADVANCEMENT_NAV, navForReports } from "@/lib/report-nav";

function AdvancementBar() {
  const [reports, setReports] = useState<ReportId[] | null>(null);
  useEffect(() => {
    fetchMe().then((me) => setReports(me.reports || []));
  }, []);
  const nav = reports ? navForReports(ADVANCEMENT_NAV, reports) : [];
  return <ReportTopBar title="Advancement" nav={nav} />;
}

export default function AdvancementLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AccessGate report={["advancement", "chapel", "points", "portfolios"]}>
      <AdvancementBar />
      {children}
    </AccessGate>
  );
}
