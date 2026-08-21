"use client";

import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { ADVANCEMENT_NAV } from "@/lib/report-nav";

export default function AdvancementLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AccessGate report="advancement">
      <ReportTopBar title="Advancement" nav={ADVANCEMENT_NAV} />
      {children}
    </AccessGate>
  );
}
