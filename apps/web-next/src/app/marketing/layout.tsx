"use client";

import { AccessGate, ReportTopBar } from "@/components/AccessGate";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <AccessGate report="marketing"><ReportTopBar title="Marketing" nav={[]} />{children}</AccessGate>;
}
