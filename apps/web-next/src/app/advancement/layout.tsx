"use client";

import { AccessGate, ReportTopBar } from "@/components/AccessGate";

export default function AdvancementLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AccessGate report={["advancement", "chapel", "points", "portfolios"]}>
      <ReportTopBar title="Advancement" nav={[]} />
      {children}
    </AccessGate>
  );
}
