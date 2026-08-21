"use client";

import { AccessGate, ReportTopBar } from "@/components/AccessGate";
import { CensusDashboard } from "@/components/census/Dashboard";

export default function CensusPage() {
  return (
    <AccessGate report="census">
      <ReportTopBar title="Census" nav={[{ href: "/census", label: "Fall 2026" }]} />
      <CensusDashboard />
    </AccessGate>
  );
}
