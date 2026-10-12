"use client";

import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { HOUSING_NAV } from "@/lib/report-nav";

export default function HousingLayout({ children }: { children: React.ReactNode }) {
  return (
    <AccessGate report="housing">
      <ReportTopBar title="Housing" nav={HOUSING_NAV} />
      {children}
    </AccessGate>
  );
}
