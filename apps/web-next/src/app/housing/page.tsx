"use client";

import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { HousingDashboard } from "@/components/housing/Dashboard";

export default function HousingPage() {
  return (
    <AccessGate report="housing">
      <ReportTopBar title="Housing" nav={[{ href: "/housing", label: "Dashboard" }]} />
      <HousingDashboard />
    </AccessGate>
  );
}
